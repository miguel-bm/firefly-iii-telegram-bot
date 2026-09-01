import { Agent } from "agents";
import OpenAI from "openai";
import type {
    Env,
    ChatAgentState,
    ChatMessage,
    AgentResponse,
    StreamEvent,
} from "./types.js";
import { FireflyClient, getCachedCategories, getCachedTags, getCachedAssetAccounts } from "./tools/firefly.js";
import { CHAT_MODEL, SYSTEM_PROMPTS, BUSY_MESSAGES, RESET_MESSAGES } from "./agent/config.js";
import { TOOLS } from "./agent/tools.js";
import { executeTool } from "./agent/tool-executor.js";

export class ChatAgentDO extends Agent<Env, ChatAgentState> {
    initialState: ChatAgentState = {
        chatId: 0,
        defaultAccountId: null,
        defaultCurrency: "EUR",
        lastMode: null,
        categorySnapshotVersion: null,
        messageHistory: [],
        isProcessing: false,
    };

    // Handle HTTP requests to the agent
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const action = url.pathname.replace("/", "");

        try {
            const body = request.method === "POST"
                ? await request.json() as { message?: string; userName?: string }
                : {};

            if (action === "checkBusy") {
                const result = this.checkBusy();
                return Response.json({ result });
            }

            if (action === "resetHistory") {
                const result = this.resetHistory();
                return Response.json({ result });
            }

            if (action === "runAgentTurnStream") {
                const { readable, writable } = new TransformStream();
                const writer = writable.getWriter();
                const encoder = new TextEncoder();

                const generator = this.runAgentTurnStream(body.message ?? "", body.userName);

                (async () => {
                    try {
                        for await (const event of generator) {
                            await writer.write(encoder.encode(JSON.stringify(event) + "\n"));
                        }
                    } catch (error) {
                        const errorEvent: StreamEvent = {
                            type: "error",
                            message: error instanceof Error ? error.message : "Unknown error",
                        };
                        await writer.write(encoder.encode(JSON.stringify(errorEvent) + "\n"));
                    } finally {
                        await writer.close();
                    }
                })();

                return new Response(readable, {
                    headers: { "Content-Type": "application/x-ndjson" },
                });
            }

            if (action === "runAgentTurn") {
                const result = await this.runAgentTurn(body.message ?? "", body.userName);
                return Response.json({ result });
            }

            return Response.json({ error: "Unknown action" }, { status: 404 });
        } catch (error) {
            console.error("Agent fetch error:", error);
            return Response.json(
                { error: error instanceof Error ? error.message : "Unknown error" },
                { status: 500 }
            );
        }
    }

    // Check if busy and return error message if so
    checkBusy(): string | null {
        if (this.state.isProcessing) {
            const lang = this.env.BOT_LANGUAGE ?? "es";
            return BUSY_MESSAGES[lang];
        }
        return null;
    }

    // Reset conversation history
    resetHistory(): string {
        this.setState({
            ...this.state,
            messageHistory: [],
            isProcessing: false,
        });
        const lang = this.env.BOT_LANGUAGE ?? "es";
        return RESET_MESSAGES[lang];
    }

    async runAgentTurn(message: string, userName?: string): Promise<AgentResponse> {
        const env = this.env;
        const lang = env.BOT_LANGUAGE ?? "es";
        const timezone = env.BOT_TIMEZONE ?? "Europe/Madrid";
        const maxHistory = parseInt(env.MAX_HISTORY_MESSAGES ?? "20", 10);

        // Set processing flag
        this.setState({ ...this.state, isProcessing: true });

        // Track chart URL if generated
        let chartUrl: string | undefined;

        try {
            const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
            const firefly = new FireflyClient(env);

            // Get categories, tags, and accounts for context
            const [categories, tags, accounts] = await Promise.all([
                getCachedCategories(env),
                getCachedTags(env),
                getCachedAssetAccounts(env),
            ]);
            const categoryNames = categories.map((c) => c.name);

            const currency = this.state.defaultCurrency ?? env.DEFAULT_CURRENCY;

            // Build system prompt
            const systemPrompt = SYSTEM_PROMPTS[lang](categoryNames, tags, accounts, currency, timezone);

            // Build messages with history
            const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
                { role: "system", content: systemPrompt },
            ];

            // Add message history
            for (const historyMsg of this.state.messageHistory) {
                if (historyMsg.role === "user") {
                    const prefix = historyMsg.userName ? `[${historyMsg.userName}]: ` : "";
                    messages.push({ role: "user", content: prefix + historyMsg.content });
                } else {
                    messages.push({ role: "assistant", content: historyMsg.content });
                }
            }

            // Add current message with user name
            const userPrefix = userName ? `[${userName}]: ` : "";
            messages.push({ role: "user", content: userPrefix + message });

            // Agent loop - keep calling until no more tool calls
            let iterations = 0;
            const maxIterations = 10;
            let finalResponse = "";

            while (iterations < maxIterations) {
                iterations++;

                const response = await openai.chat.completions.create({
                    model: CHAT_MODEL,
                    messages,
                    tools: TOOLS,
                    tool_choice: "auto",
                });

                const choice = response.choices[0];
                if (!choice?.message) {
                    finalResponse = lang === "es"
                        ? "No pude procesar esa solicitud."
                        : "I couldn't process that request.";
                    break;
                }

                const assistantMessage = choice.message;
                messages.push(assistantMessage);

                // If no tool calls, return the content
                if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
                    finalResponse = assistantMessage.content ?? (lang === "es" ? "Hecho." : "Done.");
                    break;
                }

                // Process tool calls
                for (const toolCall of assistantMessage.tool_calls) {
                    if (toolCall.type !== "function") continue;
                    const { result, chartUrl: newChartUrl } = await executeTool(
                        toolCall, firefly, env, lang, currency
                    );
                    if (newChartUrl) chartUrl = newChartUrl;
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                }
            }

            if (!finalResponse) {
                finalResponse = lang === "es"
                    ? "Alcancé el número máximo de pasos. Por favor, intenta una solicitud más simple."
                    : "I reached the maximum number of steps. Please try a simpler request.";
            }

            // Update message history
            const userMsg: ChatMessage = { role: "user", content: message, userName, timestamp: Date.now() };
            const assistantMsg: ChatMessage = { role: "assistant", content: finalResponse, timestamp: Date.now() };
            const newHistory: ChatMessage[] = [
                ...this.state.messageHistory,
                userMsg,
                assistantMsg,
            ].slice(-maxHistory); // Keep only last N messages

            this.setState({
                ...this.state,
                messageHistory: newHistory,
                isProcessing: false,
            });

            return { text: finalResponse, chartUrl };
        } catch (error) {
            // Clear processing flag on error
            this.setState({ ...this.state, isProcessing: false });
            throw error;
        }
    }

    async *runAgentTurnStream(message: string, userName?: string): AsyncGenerator<StreamEvent> {
        const env = this.env;
        const lang = env.BOT_LANGUAGE ?? "es";
        const timezone = env.BOT_TIMEZONE ?? "Europe/Madrid";
        const maxHistory = parseInt(env.MAX_HISTORY_MESSAGES ?? "20", 10);

        this.setState({ ...this.state, isProcessing: true });

        let chartUrl: string | undefined;
        let finalResponse = "";

        try {
            const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
            const firefly = new FireflyClient(env);

            const [categories, tags, accounts] = await Promise.all([
                getCachedCategories(env),
                getCachedTags(env),
                getCachedAssetAccounts(env),
            ]);
            const categoryNames = categories.map((c) => c.name);
            const currency = this.state.defaultCurrency ?? env.DEFAULT_CURRENCY;
            const systemPrompt = SYSTEM_PROMPTS[lang](categoryNames, tags, accounts, currency, timezone);

            const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
                { role: "system", content: systemPrompt },
            ];

            for (const historyMsg of this.state.messageHistory) {
                if (historyMsg.role === "user") {
                    const prefix = historyMsg.userName ? `[${historyMsg.userName}]: ` : "";
                    messages.push({ role: "user", content: prefix + historyMsg.content });
                } else {
                    messages.push({ role: "assistant", content: historyMsg.content });
                }
            }

            const userPrefix = userName ? `[${userName}]: ` : "";
            messages.push({ role: "user", content: userPrefix + message });

            let iterations = 0;
            const maxIterations = 10;

            while (iterations < maxIterations) {
                iterations++;

                const stream = await openai.chat.completions.create({
                    model: CHAT_MODEL,
                    messages,
                    tools: TOOLS,
                    tool_choice: "auto",
                    stream: true,
                });

                let fullContent = "";
                const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

                for await (const chunk of stream) {
                    const choice = chunk.choices[0];
                    if (!choice) continue;

                    const delta = choice.delta;

                    if (delta?.content) {
                        fullContent += delta.content;
                        yield { type: "text", content: delta.content };
                    }

                    if (delta?.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const existing = toolCallAccumulator.get(tc.index);
                            if (!existing) {
                                toolCallAccumulator.set(tc.index, {
                                    id: tc.id ?? "",
                                    name: tc.function?.name ?? "",
                                    arguments: tc.function?.arguments ?? "",
                                });
                            } else {
                                if (tc.id) existing.id = tc.id;
                                if (tc.function?.name) existing.name += tc.function.name;
                                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                            }
                        }
                    }
                }

                // If we got tool calls, execute them and loop
                if (toolCallAccumulator.size > 0) {
                    const toolCalls = [...toolCallAccumulator.values()].map((tc) => ({
                        id: tc.id,
                        type: "function" as const,
                        function: { name: tc.name, arguments: tc.arguments },
                    }));

                    messages.push({
                        role: "assistant",
                        content: fullContent || null,
                        tool_calls: toolCalls,
                    });

                    for (const toolCall of toolCalls) {
                        yield { type: "tool", name: toolCall.function.name };
                        const { result, chartUrl: newChartUrl } = await executeTool(
                            toolCall as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall,
                            firefly, env, lang, currency
                        );
                        if (newChartUrl) chartUrl = newChartUrl;
                        messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
                    }

                    continue;
                }

                // No tool calls — this is the final response
                finalResponse = fullContent || (lang === "es" ? "Hecho." : "Done.");
                break;
            }

            if (!finalResponse) {
                const msg = lang === "es"
                    ? "Alcancé el número máximo de pasos. Por favor, intenta una solicitud más simple."
                    : "I reached the maximum number of steps. Please try a simpler request.";
                yield { type: "text", content: msg };
                finalResponse = msg;
            }

            yield { type: "done", chartUrl };

            // Update message history
            const userMsg: ChatMessage = { role: "user", content: message, userName, timestamp: Date.now() };
            const assistantMsg: ChatMessage = { role: "assistant", content: finalResponse, timestamp: Date.now() };
            const newHistory: ChatMessage[] = [
                ...this.state.messageHistory,
                userMsg,
                assistantMsg,
            ].slice(-maxHistory);

            this.setState({
                ...this.state,
                messageHistory: newHistory,
                isProcessing: false,
            });
        } catch (error) {
            this.setState({ ...this.state, isProcessing: false });
            yield { type: "error", message: error instanceof Error ? error.message : "Unknown error" };
        }
    }
}
