import { Hono } from "hono";
import { Bot } from "grammy";
import { stream } from "@grammyjs/stream";
import { autoRetry } from "@grammyjs/auto-retry";
import type { Env } from "./types.js";
import { ChatAgentDO } from "./agent.js";
import { processMessage, getMessages, type AgentProxy, type StreamContext } from "./bot.js";
import { handleScheduled } from "./cron.js";
import { importBankStatement, formatImportResult } from "./import/importer.js";
import { ImportAccountError } from "./import/accounts.js";
import { parseIdList } from "./webapp/auth.js";
import { parsePositiveInt, ValidationError } from "./webapp/validation.js";
import { assertStatementFile, readResponseWithLimit } from "./import/file.js";
import { registerWebAppRoutes } from "./webapp/routes.js";

const app = new Hono<{ Bindings: Env }>();

registerWebAppRoutes(app);

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

async function callAgentStream(
    env: Env,
    chatId: number,
    message: string,
    userName?: string,
): Promise<ReadableStream> {
    const agentId = env.CHAT_AGENT.idFromName(String(chatId));
    const stub = env.CHAT_AGENT.get(agentId);

    const response = await stub.fetch(
        new Request("http://agent/runAgentTurnStream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, userName }),
        })
    );

    if (!response.ok || !response.body) {
        throw new Error(`Agent stream failed: ${response.status}`);
    }

    return response.body;
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
    const allowedChatIds = parseIdList(env.TELEGRAM_ALLOWED_CHAT_ID);
    if (!chatId || !allowedChatIds.includes(String(chatId))) {
        console.log(`Ignoring message from unauthorized chat: ${chatId}`);
        return c.json({ ok: true });
    }

    // Create bot instance and initialize (required for serverless)
    const bot = new Bot<StreamContext>(env.TELEGRAM_BOT_TOKEN);
    await bot.init();
    bot.api.config.use(autoRetry());
    bot.use(stream());

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
            const maxBytes = parsePositiveInt(env.MAX_IMPORT_FILE_BYTES, 5 * 1024 * 1024, 20 * 1024 * 1024);
            if (document.file_size && document.file_size > maxBytes) {
                throw new ValidationError(`File exceeds the ${maxBytes}-byte upload limit`);
            }

            // Download the file from Telegram
            const file = await ctx.api.getFile(document.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
            const response = await fetch(fileUrl);

            if (!response.ok) {
                throw new Error(`Failed to download file: ${response.status}`);
            }

            const buffer = await readResponseWithLimit(response, maxBytes);
            assertStatementFile(buffer, fileName);

            // Import the bank statement
            const chatId = String(ctx.chat?.id ?? "");
            const result = await importBankStatement(buffer, fileName, env, { chatId });

            // Format and send result
            const message = formatImportResult(result, lang);
            await ctx.reply(message);
        } catch (error) {
            console.error("Import error:", error);
            if (error instanceof ImportAccountError) {
                await ctx.reply(error.localized(lang));
                return;
            }
            const errorMsg = error instanceof ValidationError
                ? error.message
                : (lang === "es" ? "No se pudo importar el archivo." : "The file could not be imported.");
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
                runAgentTurnStream: async (message: string, userName?: string) => {
                    return callAgentStream(env, id, message, userName);
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
