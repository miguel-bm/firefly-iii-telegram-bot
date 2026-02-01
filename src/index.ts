import { Hono } from "hono";
import { cors } from "hono/cors";
import { Bot } from "grammy";
import type { Env } from "./types.js";
import { ChatAgentDO } from "./agent.js";
import { processMessage, getMessages, type AgentProxy } from "./bot.js";
import { handleScheduled } from "./cron.js";
import { importBankStatement, formatImportResult } from "./import/importer.js";
import { FireflyClient } from "./tools/firefly.js";
import { createHmac } from "node:crypto";

const app = new Hono<{ Bindings: Env }>();

// ============================================================================
// Telegram WebApp Validation
// ============================================================================

interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
}

interface WebAppInitData {
    user?: TelegramUser;
    auth_date: number;
    hash: string;
    query_id?: string;
}

function parseInitData(initData: string): Record<string, string> {
    const params = new URLSearchParams(initData);
    const result: Record<string, string> = {};
    for (const [key, value] of params) {
        result[key] = value;
    }
    return result;
}

function validateTelegramWebApp(initData: string, botToken: string): WebAppInitData | null {
    try {
        const parsed = parseInitData(initData);
        const hash = parsed.hash;
        if (!hash) return null;

        // Build data-check-string (sorted alphabetically, excluding hash)
        const dataCheckArr: string[] = [];
        for (const key of Object.keys(parsed).sort()) {
            if (key !== "hash") {
                dataCheckArr.push(`${key}=${parsed[key]}`);
            }
        }
        const dataCheckString = dataCheckArr.join("\n");

        // HMAC-SHA256 signature validation
        const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
        const calculatedHash = createHmac("sha256", secretKey)
            .update(dataCheckString)
            .digest("hex");

        if (calculatedHash !== hash) {
            console.log("WebApp hash mismatch");
            return null;
        }

        // Check auth_date is not too old (allow 24 hours for dev)
        const authDate = parseInt(parsed.auth_date || "0", 10);
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > 86400) {
            console.log("WebApp auth_date too old");
            return null;
        }

        return {
            user: parsed.user ? JSON.parse(parsed.user) : undefined,
            auth_date: authDate,
            hash,
            query_id: parsed.query_id,
        };
    } catch (error) {
        console.error("WebApp validation error:", error);
        return null;
    }
}

// Middleware to validate Telegram WebApp requests
async function webAppAuth(c: import("hono").Context<{ Bindings: Env }>, next: import("hono").Next) {
    const initData = c.req.header("X-Telegram-Init-Data");

    if (!initData) {
        return c.json({ error: "Missing Telegram init data" }, 401);
    }

    const validated = validateTelegramWebApp(initData, c.env.TELEGRAM_BOT_TOKEN);
    if (!validated) {
        return c.json({ error: "Invalid Telegram init data" }, 401);
    }

    // Verify user is allowed
    if (validated.user && String(validated.user.id) !== c.env.TELEGRAM_ALLOWED_CHAT_ID) {
        return c.json({ error: "User not authorized" }, 403);
    }

    // Store validated data in context
    c.set("telegramUser", validated.user);
    await next();
}

// Extend Hono context
declare module "hono" {
    interface ContextVariableMap {
        telegramUser: TelegramUser | undefined;
    }
}

// Health check
app.get("/healthz", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================================================
// Web App API Routes
// ============================================================================

// CORS for development
app.use("/api/*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Telegram-Init-Data"],
}));

// Get recent transactions
app.get("/api/transactions", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const limit = parseInt(c.req.query("limit") || "20", 10);
        const type = c.req.query("type") as "withdrawal" | "deposit" | undefined;

        // Build search query
        let query = "date_after:" + getDateDaysAgo(90); // Last 90 days
        if (type) {
            query += ` type:${type}`;
        }

        const results = await client.searchTransactions(query, Math.min(limit, 100));

        // Transform to simpler format for the webapp
        const transactions = results.flatMap((r) =>
            r.attributes.transactions.map((t) => ({
                id: r.id,
                date: t.date,
                description: t.description,
                amount: parseFloat(t.amount),
                type: t.type,
                category: t.category_name || null,
                source: t.source_name,
                destination: t.destination_name,
            }))
        );

        return c.json({ transactions });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to fetch transactions" }, 500);
    }
});

// Get expense summary by category (for chart)
app.get("/api/expenses/by-category", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const days = parseInt(c.req.query("days") || "30", 10);
        const start = getDateDaysAgo(days);
        const end = getToday();

        const expenses = await client.getExpenseByCategory(start, end);

        // Transform to chart-friendly format
        const data = expenses
            .filter((e) => e.difference_float < 0)
            .map((e) => ({
                category: e.name || "Uncategorized",
                amount: Math.abs(e.difference_float),
                currency: e.currency_code,
            }))
            .sort((a, b) => b.amount - a.amount);

        return c.json({ data, period: { start, end } });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to fetch expense summary" }, 500);
    }
});

// Get account balances
app.get("/api/accounts", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const accounts = await client.getAccounts("asset");
        return c.json({ accounts });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to fetch accounts" }, 500);
    }
});

// Helper functions
function getToday(): string {
    return new Date().toISOString().split("T")[0];
}

function getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split("T")[0];
}

// Helper to get agent stub and call methods via fetch
async function callAgent(
    env: Env,
    chatId: number,
    action: "runAgentTurn" | "checkBusy" | "resetHistory",
    payload?: { message?: string; userName?: string }
): Promise<{ result?: string; error?: string }> {
    const agentId = env.CHAT_AGENT.idFromName(String(chatId));
    const stub = env.CHAT_AGENT.get(agentId);

    const response = await stub.fetch(
        new Request(`http://agent/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload ?? {}),
        })
    );

    return response.json();
}

// Telegram webhook
app.post("/telegram/webhook", async (c) => {
    const env = c.env;
    const lang = env.BOT_LANGUAGE ?? "es";
    const msgs = getMessages(lang);

    // Verify webhook secret
    const secretHeader = c.req.header("X-Telegram-Bot-Api-Secret-Token");
    if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const update = await c.req.json();

    // Extract chat ID from update
    const chatId =
        update.message?.chat?.id ??
        update.edited_message?.chat?.id ??
        update.callback_query?.message?.chat?.id;

    // Verify allowed chat
    if (chatId && String(chatId) !== env.TELEGRAM_ALLOWED_CHAT_ID) {
        console.log(`Ignoring message from unauthorized chat: ${chatId}`);
        return c.json({ ok: true });
    }

    // Create bot instance and initialize (required for serverless)
    const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
    await bot.init();

    // Register command handlers
    bot.command("start", async (ctx) => {
        await ctx.reply(msgs.start);
    });

    bot.command("help", async (ctx) => {
        await ctx.reply(msgs.help, { parse_mode: "Markdown" });
    });

    bot.command("reset", async (ctx) => {
        const id = ctx.chat?.id;
        if (!id) return;

        try {
            const response = await callAgent(env, id, "resetHistory");
            await ctx.reply(response.result ?? "✅");
        } catch (error) {
            console.error("Reset error:", error);
            await ctx.reply(lang === "es" ? "Error al resetear." : "Error resetting.");
        }
    });

    // Dashboard command - opens Web App via inline keyboard (works in groups)
    bot.command("dashboard", async (ctx) => {
        // Get the worker URL from the webhook request
        const workerUrl = new URL(c.req.url).origin;

        const buttonText = lang === "es" ? "📊 Abrir Dashboard" : "📊 Open Dashboard";
        const messageText = lang === "es"
            ? "Pulsa el botón para abrir el dashboard:"
            : "Tap the button to open the dashboard:";

        await ctx.reply(messageText, {
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: buttonText,
                        web_app: { url: workerUrl },
                    },
                ]],
            },
        });
    });

    // Handle document uploads (bank statements)
    bot.on("message:document", async (ctx) => {
        const document = ctx.message.document;
        if (!document) return;

        const fileName = document.file_name ?? "unknown";
        const ext = fileName.toLowerCase().split(".").pop();

        // Only handle supported file types
        if (!["csv", "xls", "xlsx"].includes(ext ?? "")) {
            return; // Let it fall through to regular message handler
        }

        try {
            await ctx.replyWithChatAction("typing");

            // Download the file from Telegram
            const file = await ctx.api.getFile(document.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
            const response = await fetch(fileUrl);

            if (!response.ok) {
                throw new Error(`Failed to download file: ${response.status}`);
            }

            const buffer = await response.arrayBuffer();

            // Import the bank statement
            const chatId = String(ctx.chat?.id ?? "");
            const result = await importBankStatement(buffer, fileName, env, { chatId });

            // Format and send result
            const message = formatImportResult(result, lang);
            await ctx.reply(message);
        } catch (error) {
            console.error("Import error:", error);
            const errorMsg = error instanceof Error ? error.message : "Unknown error";
            const response = lang === "es"
                ? `❌ Error importando archivo: ${errorMsg}`
                : `❌ Error importing file: ${errorMsg}`;
            await ctx.reply(response);
        }
    });

    // Handle all other messages through agent
    bot.on("message", async (ctx) => {
        // Create a wrapper that uses HTTP calls to the agent
        const getAgent = async (id: number): Promise<AgentProxy> => {
            return {
                checkBusy: async (): Promise<string | null> => {
                    const response = await callAgent(env, id, "checkBusy");
                    return response.result ?? null;
                },
                runAgentTurn: async (message: string, userName?: string) => {
                    const response = await callAgent(env, id, "runAgentTurn", { message, userName });
                    if (response.error) throw new Error(response.error);
                    // result is now an AgentResponse object
                    const agentResponse = response.result as { text: string; chartUrl?: string } | undefined;
                    return {
                        text: agentResponse?.text ?? "",
                        chartUrl: agentResponse?.chartUrl,
                    };
                },
            };
        };

        await processMessage(ctx, env, getAgent);
    });

    // Process the update
    try {
        await bot.handleUpdate(update);
    } catch (error) {
        console.error("Error handling update:", error);
    }

    return c.json({ ok: true });
});

// ============================================================================
// Static Assets Fallback (SPA)
// ============================================================================

app.all("*", async (c) => {
    // Serve static assets from the ASSETS binding
    return c.env.ASSETS.fetch(c.req.raw);
});

// Export the worker with both fetch and scheduled handlers
export default {
    fetch: app.fetch,
    scheduled: handleScheduled,
};

// Export the ChatAgentDO Durable Object class
export { ChatAgentDO };

// Legacy stub for migration - will be deleted in future migration
export class ChatAgent implements DurableObject {
    fetch(): Response {
        return new Response("Deprecated", { status: 410 });
    }
}
