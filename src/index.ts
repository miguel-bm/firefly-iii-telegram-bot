import { Hono } from "hono";
import { Bot } from "grammy";
import type { Env } from "./types.js";
import { ChatAgentDO } from "./agent.js";
import { processMessage, getMessages, type AgentProxy } from "./bot.js";
import { handleScheduled } from "./cron.js";
import { importBankStatement, formatImportResult } from "./import/importer.js";

const app = new Hono<{ Bindings: Env }>();

// Health check
app.get("/healthz", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

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
