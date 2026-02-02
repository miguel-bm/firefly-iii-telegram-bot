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
        console.log("WebApp auth failed: Missing init data");
        return c.json({ error: "Missing Telegram init data" }, 401);
    }

    console.log("WebApp auth: initData length:", initData.length);

    const validated = validateTelegramWebApp(initData, c.env.TELEGRAM_BOT_TOKEN);
    if (!validated) {
        console.log("WebApp auth failed: Invalid init data");
        return c.json({ error: "Invalid Telegram init data" }, 401);
    }

    // Verify user is allowed (supports comma-separated list of IDs)
    const allowedIds = c.env.TELEGRAM_ALLOWED_CHAT_ID.split(",").map(id => id.trim());
    if (validated.user && !allowedIds.includes(String(validated.user.id))) {
        console.log("WebApp auth failed: User not authorized", validated.user.id);
        return c.json({ error: "User not authorized" }, 403);
    }

    console.log("WebApp auth: Success for user", validated.user?.id);

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
        const limit = parseInt(c.req.query("limit") || "50", 10);
        const type = c.req.query("type") as "withdrawal" | "deposit" | "transfer" | undefined;
        const search = c.req.query("search") || "";
        const start = c.req.query("start"); // YYYY-MM-DD
        const end = c.req.query("end"); // YYYY-MM-DD

        // Build search query
        let query = "";

        // Date range
        if (start) {
            query += `date_after:${start} `;
        } else {
            query += `date_after:${getDateDaysAgo(90)} `; // Default: last 90 days
        }
        if (end) {
            query += `date_before:${end} `;
        }

        // Type filter
        if (type) {
            query += `type:${type} `;
        }

        // Text search
        if (search) {
            query += `"${search}" `;
        }

        const results = await client.searchTransactions(query.trim(), Math.min(limit, 100));

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
                tags: t.tags || [],
                notes: (t as unknown as Record<string, unknown>).notes || null,
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
        // Support both days (legacy) and start/end date params
        const startParam = c.req.query("start");
        const endParam = c.req.query("end");
        const days = parseInt(c.req.query("days") || "30", 10);

        const start = startParam || getDateDaysAgo(days);
        const end = endParam || getToday();

        const expenses = await client.getExpenseByCategory(start, end);

        // Transform to chart-friendly format
        const data = expenses
            .filter((e) => e.difference_float < 0)
            .map((e) => ({
                category: e.name || "Sin categoría",
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

// Get income summary by category (for chart)
app.get("/api/income/by-category", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        // Support both days (legacy) and start/end date params
        const startParam = c.req.query("start");
        const endParam = c.req.query("end");
        const days = parseInt(c.req.query("days") || "30", 10);

        const start = startParam || getDateDaysAgo(days);
        const end = endParam || getToday();

        const income = await client.getIncomeByCategory(start, end);

        // Transform to chart-friendly format (income has positive values)
        const data = income
            .filter((e) => e.difference_float > 0)
            .map((e) => ({
                category: e.name || "Sin categoría",
                amount: e.difference_float,
                currency: e.currency_code,
            }))
            .sort((a, b) => b.amount - a.amount);

        return c.json({ data, period: { start, end } });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to fetch income summary" }, 500);
    }
});

// Get expenses grouped by time and category (for stacked bar chart)
app.get("/api/expenses/by-time", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const start = c.req.query("start") || getDateDaysAgo(30);
        const end = c.req.query("end") || getToday();
        const type = c.req.query("type") || "withdrawal"; // withdrawal or deposit

        // Search for all transactions in the period
        const query = `type:${type} date_after:${start} date_before:${end}`;
        const results = await client.searchTransactions(query, 500);

        // Group by date and category
        const grouped: Record<string, Record<string, number>> = {};
        const categoriesSet = new Set<string>();

        results.forEach((r) => {
            r.attributes.transactions.forEach((t) => {
                const date = t.date.split("T")[0];
                const category = t.category_name || "Sin categoría";
                categoriesSet.add(category);

                if (!grouped[date]) grouped[date] = {};
                if (!grouped[date][category]) grouped[date][category] = 0;
                grouped[date][category] += Math.abs(parseFloat(t.amount));
            });
        });

        // Sort categories by total amount (descending)
        const categoryTotals = Array.from(categoriesSet).map(cat => ({
            category: cat,
            total: Object.values(grouped).reduce((sum, day) => sum + (day[cat] || 0), 0),
        })).sort((a, b) => b.total - a.total);

        // Take top 8 categories, group rest as "Otros"
        const topCategories = categoryTotals.slice(0, 8).map(c => c.category);
        const hasOthers = categoryTotals.length > 8;

        // Transform to array format with dates
        const data = Object.entries(grouped)
            .map(([date, categories]) => {
                const entry: Record<string, number | string> = { date };
                topCategories.forEach(cat => {
                    entry[cat] = categories[cat] || 0;
                });
                if (hasOthers) {
                    entry["Otros"] = categoryTotals.slice(8).reduce(
                        (sum, c) => sum + (categories[c.category] || 0), 0
                    );
                }
                return entry;
            })
            .sort((a, b) => (a.date as string).localeCompare(b.date as string));

        const categories = hasOthers ? [...topCategories, "Otros"] : topCategories;

        return c.json({ data, categories, period: { start, end } });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to fetch time-based expenses" }, 500);
    }
});

// Get transactions for a specific category (for drill-down view)
app.get("/api/transactions/by-category", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const category = c.req.query("category");
        const type = c.req.query("type") || "withdrawal"; // withdrawal or deposit
        const start = c.req.query("start") || getDateDaysAgo(30);
        const end = c.req.query("end") || getToday();

        if (!category) {
            return c.json({ error: "Category parameter is required" }, 400);
        }

        // Search for transactions in this category
        const query = `category_is:"${category}" type:${type} date_after:${start} date_before:${end}`;
        const results = await client.searchTransactions(query, 100);

        const transactions = results.flatMap((r) =>
            r.attributes.transactions.map((t) => ({
                id: r.id,
                date: t.date,
                amount: parseFloat(t.amount),
                description: t.description,
                type: t.type,
                category: t.category_name || null,
            }))
        ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return c.json({ data: transactions, category, period: { start, end } });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to fetch category transactions" }, 500);
    }
});

// Get account balances (assets and liabilities)
app.get("/api/accounts", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const [assets, liabilities] = await Promise.all([
            client.getAccounts("asset"),
            client.getAccounts("liability"),
        ]);
        return c.json({ assets, liabilities });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to fetch accounts" }, 500);
    }
});

// Get all categories
app.get("/api/categories", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const categories = await client.getCategories();
        return c.json({
            categories: categories.map((cat) => ({
                id: cat.id,
                name: cat.name,
            })),
        });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to fetch categories" }, 500);
    }
});

// Get all tags
app.get("/api/tags", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const tags = await client.getTags();
        return c.json({
            tags: tags.map((t) => ({
                id: t.id,
                tag: t.tag,
            })),
        });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to fetch tags" }, 500);
    }
});

// Get income/expense summary for a period
app.get("/api/summary", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const start = c.req.query("start") || getDateDaysAgo(30);
        const end = c.req.query("end") || getToday();

        // Get all transactions for the period
        const query = `date_after:${start} date_before:${end}`;
        const results = await client.searchTransactions(query, 500);

        let totalIncome = 0;
        let totalExpenses = 0;

        for (const r of results) {
            for (const t of r.attributes.transactions) {
                const amount = parseFloat(t.amount);
                if (t.type === "deposit") {
                    totalIncome += amount;
                } else if (t.type === "withdrawal") {
                    totalExpenses += amount;
                }
            }
        }

        return c.json({
            income: totalIncome,
            expenses: totalExpenses,
            net: totalIncome - totalExpenses,
            period: { start, end },
        });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to fetch summary" }, 500);
    }
});

// Get account balance history
app.get("/api/accounts/:id/history", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const accountId = c.req.param("id");
        const start = c.req.query("start") || getDateDaysAgo(30);
        const end = c.req.query("end") || getToday();

        const history = await client.getAccountHistory(accountId, start, end);
        return c.json({ history });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to fetch account history" }, 500);
    }
});

// Update a transaction
app.put("/api/transactions/:id", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const transactionId = c.req.param("id");
        const body = await c.req.json();

        const result = await client.updateTransaction(transactionId, body);
        return c.json({ success: true, transaction: result });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to update transaction" }, 500);
    }
});

// Create a new transaction (for quick expense entry)
app.post("/api/transactions", webAppAuth, async (c) => {
    try {
        const client = new FireflyClient(c.env);
        const body = await c.req.json();
        const { amount, description, category, tags, date, sourceAccount } = body;

        // Default to the configured default account if no source specified
        const sourceAccountId = sourceAccount || c.env.DEFAULT_ACCOUNT_ID;

        const result = await client.createTransaction({
            type: "withdrawal",
            amount: parseFloat(amount),
            description,
            date: date || getToday(),
            source_account_id: sourceAccountId,
            category_name: category || undefined,
            tags: tags || [],
        }, c.env);

        return c.json({ success: true, transaction: result });
    } catch (error) {
        console.error("API error:", error);
        return c.json({ error: "Failed to create transaction" }, 500);
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

    // Verify allowed chat (supports comma-separated list of IDs)
    const allowedChatIds = env.TELEGRAM_ALLOWED_CHAT_ID.split(",").map(id => id.trim());
    if (chatId && !allowedChatIds.includes(String(chatId))) {
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

    bot.command("dashboard", async (ctx) => {
        const webAppUrl = env.DASHBOARD_WEBAPP_URL;
        if (!webAppUrl) {
            await ctx.reply(msgs.dashboardNoUrl);
            return;
        }

        // Use a URL button with direct Mini App link (t.me/bot/app format)
        // This works in all chat types (private, group, channel)
        await ctx.reply(msgs.dashboardButton, {
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: msgs.dashboardButton,
                        url: webAppUrl,
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
