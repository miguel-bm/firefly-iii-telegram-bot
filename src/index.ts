import { Hono } from "hono";
import { Bot } from "grammy";
import { stream } from "@grammyjs/stream";
import { autoRetry } from "@grammyjs/auto-retry";
import type { Env } from "./types.js";
import { ChatAgentDO } from "./agent.js";
import { processMessage, getMessages, type AgentProxy, type StreamContext } from "./bot.js";
import { handleScheduled } from "./cron.js";
import { parseIdList } from "./webapp/auth.js";
import { registerWebAppRoutes } from "./webapp/routes.js";
import { registerImportHandlers } from "./import/telegram.js";

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

    registerImportHandlers(bot, env, lang);

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
