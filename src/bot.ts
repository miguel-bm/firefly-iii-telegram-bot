import { type Context, type Api } from "grammy";
import { type StreamFlavor } from "@grammyjs/stream";
import type { Env, AgentResponse, StreamEvent } from "./types.js";
import { transcribeVoice } from "./tools/stt.js";

// Context type with stream support
export type StreamContext = StreamFlavor<Context>;

// Interface for agent proxy (used via HTTP calls)
export interface AgentProxy {
    checkBusy(): Promise<string | null>;
    runAgentTurn(message: string, userName?: string): Promise<AgentResponse>;
    runAgentTurnStream(message: string, userName?: string): Promise<ReadableStream>;
}

// Get user display name from Telegram context
function getUserName(ctx: Context): string {
    const user = ctx.message?.from;
    if (!user) return "Unknown";

    if (user.first_name && user.last_name) {
        return `${user.first_name} ${user.last_name}`;
    }
    if (user.first_name) {
        return user.first_name;
    }
    if (user.username) {
        return user.username;
    }
    return "Unknown";
}

// Localized messages
const MESSAGES = {
    es: {
        voiceError: "Lo siento, no pude transcribir ese mensaje de voz.",
        audioError: "Lo siento, no pude transcribir ese audio.",
        processingError: "Lo siento, algo salió mal procesando tu solicitud. Por favor, inténtalo de nuevo.",
        start: "👋 ¡Bienvenido a tu asistente de Firefly III!\n\n" +
            "Puedo ayudarte a registrar gastos y consultar tus finanzas.\n\n" +
            "Simplemente cuéntame sobre tus transacciones de forma natural, por ejemplo:\n" +
            '• "15€ en Mercadona"\n' +
            '• "¿Cuánto gasté en comida este mes?"\n' +
            '• "Café 3.50"\n\n' +
            "¡También puedes enviar mensajes de voz!",
        help: "📖 Cómo usar este bot:\n\n" +
            "**Añadir transacciones:**\n" +
            "Describe el gasto de forma natural:\n" +
            '• "50€ compras en Lidl"\n' +
            '• "Comida 12.50"\n' +
            '• "Transferencia 100 a ahorros"\n\n' +
            "**Consultas:**\n" +
            '• "¿Cuánto gasté esta semana?"\n' +
            '• "Mostrar gastos por categoría este mes"\n' +
            '• "Buscar transacciones en Amazon"\n\n' +
            "¡También puedes enviar mensajes de voz!",
        dashboardButton: "📊 Abrir Dashboard",
        dashboardNoUrl: "URL del dashboard no configurada.",
    },
    en: {
        voiceError: "Sorry, I couldn't transcribe that voice message.",
        audioError: "Sorry, I couldn't transcribe that audio.",
        processingError: "Sorry, something went wrong processing your request. Please try again.",
        start: "👋 Welcome to your Firefly III assistant!\n\n" +
            "I can help you track expenses and query your finances.\n\n" +
            "Just tell me about your transactions naturally, like:\n" +
            '• "15€ at Mercadona for groceries"\n' +
            '• "How much did I spend on food this month?"\n' +
            '• "Coffee 3.50"\n\n' +
            "Or send a voice message!",
        help: "📖 How to use this bot:\n\n" +
            "**Adding transactions:**\n" +
            "Just describe the expense naturally:\n" +
            '• "50€ groceries at Lidl"\n' +
            '• "Lunch 12.50"\n' +
            '• "Transfer 100 to savings"\n\n' +
            "**Querying:**\n" +
            '• "How much did I spend this week?"\n' +
            '• "Show spending by category this month"\n' +
            '• "Find transactions at Amazon"\n\n' +
            "You can also send voice messages!",
        dashboardButton: "📊 Open Dashboard",
        dashboardNoUrl: "Dashboard URL not configured.",
    },
};

export function getMessages(lang: "es" | "en") {
    return MESSAGES[lang] ?? MESSAGES.es;
}

const TOOL_STATUS_LABELS: Record<string, Record<string, string>> = {
    es: {
        firefly_create_transaction: "Registrando transacción...",
        firefly_delete_transaction: "Eliminando transacción...",
        firefly_update_transaction: "Actualizando transacción...",
        firefly_query_transactions: "Consultando transacciones...",
        generate_chart: "Generando gráfico...",
        firefly_report_link: "Obteniendo enlace...",
        firefly_get_accounts: "Consultando cuentas...",
        firefly_get_account_history: "Consultando historial...",
        firefly_get_transaction: "Obteniendo transacción...",
        firefly_review_uncategorized: "Revisando sin categoría...",
        firefly_convert_to_transfer: "Convirtiendo a transferencia...",
        firefly_bulk_categorize: "Categorizando transacciones...",
    },
    en: {
        firefly_create_transaction: "Creating transaction...",
        firefly_delete_transaction: "Deleting transaction...",
        firefly_update_transaction: "Updating transaction...",
        firefly_query_transactions: "Querying transactions...",
        generate_chart: "Generating chart...",
        firefly_report_link: "Getting report link...",
        firefly_get_accounts: "Fetching accounts...",
        firefly_get_account_history: "Fetching history...",
        firefly_get_transaction: "Fetching transaction...",
        firefly_review_uncategorized: "Reviewing uncategorized...",
        firefly_convert_to_transfer: "Converting to transfer...",
        firefly_bulk_categorize: "Categorizing transactions...",
    },
};

async function* ndjsonToText(
    body: ReadableStream,
    lang: string,
    api: Api,
    chatId: number,
    draftId: number,
): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (!line.trim()) continue;
                let event: StreamEvent;
                try {
                    event = JSON.parse(line);
                } catch {
                    console.error("Failed to parse NDJSON line:", line);
                    continue;
                }

                if (event.type === "tool") {
                    const labels = TOOL_STATUS_LABELS[lang] ?? TOOL_STATUS_LABELS.es;
                    const label = labels[event.name] ?? event.name;
                    await api.sendMessageDraft(chatId, draftId, `⏳ ${label}`);
                } else if (event.type === "text") {
                    yield event.content;
                } else if (event.type === "error") {
                    yield event.message;
                }
                // "done" events: generator completes naturally, plugin finalizes
            }
        }
    } finally {
        reader.releaseLock();
    }
}

// Process a message through the agent
export async function processMessage(
    ctx: StreamContext,
    env: Env,
    getAgent: (chatId: number) => Promise<AgentProxy>
): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const lang = env.BOT_LANGUAGE ?? "es";
    const msgs = getMessages(lang);
    const userName = getUserName(ctx);

    let text: string | undefined;

    // Handle voice messages
    if (ctx.message?.voice) {
        try {
            await ctx.replyWithChatAction("typing");
            text = await transcribeVoice(ctx.message.voice.file_id, env);
        } catch (error) {
            await ctx.reply(msgs.voiceError);
            return;
        }
    } else if (ctx.message?.audio) {
        try {
            await ctx.replyWithChatAction("typing");
            text = await transcribeVoice(ctx.message.audio.file_id, env);
        } catch (error) {
            await ctx.reply(msgs.audioError);
            return;
        }
    } else {
        text = ctx.message?.text;
    }

    if (!text) return;

    // Skip if it's a command (handled by grammY)
    if (text.startsWith("/")) return;

    try {
        const agent = await getAgent(chatId);

        // Check if agent is busy
        const busyMessage = await agent.checkBusy();
        if (busyMessage) {
            await ctx.reply(busyMessage);
            return;
        }

        const stream = await agent.runAgentTurnStream(text, userName);

        // Use the same draft_id formula as @grammyjs/stream plugin (256 * update_id)
        // so our tool status drafts get replaced when real text starts streaming
        const draftId = 256 * (ctx.update.update_id ?? 0);

        await ctx.replyWithStream(
            ndjsonToText(stream, lang, ctx.api, chatId, draftId),
            {},
            { parse_mode: "Markdown" },
        );
    } catch (error) {
        console.error("Agent error:", error);
        await ctx.reply(msgs.processingError);
    }
}
