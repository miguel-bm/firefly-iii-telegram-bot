import { Context } from "grammy";
import type { Env, AgentResponse } from "./types.js";
import { transcribeVoice } from "./tools/stt.js";

// Interface for agent proxy (used via HTTP calls)
export interface AgentProxy {
    checkBusy(): Promise<string | null>;
    runAgentTurn(message: string, userName?: string): Promise<AgentResponse>;
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
            "**Dashboard:**\n" +
            "Usa /dashboard para abrir el panel con gráficos y tablas.\n\n" +
            "¡También puedes enviar mensajes de voz!",
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
            "**Dashboard:**\n" +
            "Use /dashboard to open the panel with charts and tables.\n\n" +
            "You can also send voice messages!",
    },
};

export function getMessages(lang: "es" | "en") {
    return MESSAGES[lang] ?? MESSAGES.es;
}

// Process a message through the agent
export async function processMessage(
    ctx: Context,
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

        await ctx.replyWithChatAction("typing");

        const response = await agent.runAgentTurn(text, userName);

        // Send text response (chart URLs will be previewed by Telegram automatically)
        if (response.text) {
            await ctx.reply(response.text, { parse_mode: "Markdown" });
        }
    } catch (error) {
        console.error("Agent error:", error);
        await ctx.reply(msgs.processingError);
    }
}
