import { Agent } from "agents";
import OpenAI from "openai";
import type { Env, ChatAgentState, ChatMessage, AgentResponse } from "./types.js";
import { FireflyClient, getCachedCategories, getCachedTags, getCachedAssetAccounts } from "./tools/firefly.js";
import { SYSTEM_PROMPTS, BUSY_MESSAGES, RESET_MESSAGES } from "./agent/config.js";
import { executeTool } from "./agent/tool-executor.js";
import { runResponseLoop, type TurnEvent } from "./agent/responses.js";

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

    async fetch(request: Request): Promise<Response> {
        const action = new URL(request.url).pathname.slice(1);
        try {
            const body = request.method === "POST"
                ? await request.json() as { message?: string; userName?: string }
                : {};
            if (action === "checkBusy") return Response.json({ result: this.checkBusy() });
            if (action === "resetHistory") return Response.json({ result: this.resetHistory() });
            if (action === "runAgentTurn") {
                return Response.json({ result: await this.runAgentTurn(body.message ?? "", body.userName) });
            }
            if (action === "runAgentTurnStream") {
                const events = this.runAgentTurnStream(body.message ?? "", body.userName);
                const encoder = new TextEncoder();
                const stream = new ReadableStream({
                    async pull(controller) {
                        const { done, value } = await events.next();
                        if (done) controller.close();
                        else controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
                    },
                    async cancel() { await events.return(undefined); },
                });
                return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
            }
            return Response.json({ error: "Unknown action" }, { status: 404 });
        } catch (error) {
            console.error("Agent fetch error:", error);
            return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
        }
    }

    checkBusy(): string | null {
        return this.state.isProcessing ? BUSY_MESSAGES[this.env.BOT_LANGUAGE ?? "es"] : null;
    }

    resetHistory(): string {
        this.setState({ ...this.state, messageHistory: [], isProcessing: false });
        return RESET_MESSAGES[this.env.BOT_LANGUAGE ?? "es"];
    }

    async runAgentTurn(message: string, userName?: string): Promise<AgentResponse> {
        for await (const event of this.runAgentTurnStream(message, userName)) {
            if (event.type === "error") throw new Error(event.message);
            if (event.type === "done") return { text: event.text, chartUrl: event.chartUrl };
        }
        throw new Error("Agent turn ended without a response");
    }

    async *runAgentTurnStream(message: string, userName?: string): AsyncGenerator<TurnEvent> {
        const env = this.env;
        const lang = env.BOT_LANGUAGE ?? "es";
        let outcome: TurnEvent | undefined;
        this.setState({ ...this.state, isProcessing: true });
        try {
            const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
            const firefly = new FireflyClient(env);
            const [categories, tags, accounts] = await Promise.all([
                getCachedCategories(env), getCachedTags(env), getCachedAssetAccounts(env),
            ]);
            const currency = this.state.defaultCurrency ?? env.DEFAULT_CURRENCY;
            const userMsg: ChatMessage = { role: "user", content: message, userName, timestamp: Date.now() };
            const events = runResponseLoop({
                instructions: SYSTEM_PROMPTS[lang](
                    categories.map(c => c.name), tags, accounts, currency, env.BOT_TIMEZONE ?? "Europe/Madrid",
                ),
                input: [...this.state.messageHistory, userMsg].map(msg => ({
                    role: msg.role,
                    content: (msg.role === "user" && msg.userName ? `[${msg.userName}]: ` : "") + msg.content,
                })),
                lang,
                create: params => openai.responses.create(params),
                execute: call => executeTool(call, firefly, env, lang, currency),
            });
            for await (const event of events) {
                if (event.type === "done") {
                    const assistantMsg: ChatMessage = {
                        role: "assistant", content: event.text, timestamp: Date.now(),
                    };
                    this.setState({
                        ...this.state,
                        messageHistory: [...this.state.messageHistory, userMsg, assistantMsg]
                            .slice(-parseInt(env.MAX_HISTORY_MESSAGES ?? "20", 10)),
                    });
                    outcome = event;
                } else yield event;
            }
        } catch (error) {
            outcome = { type: "error", message: error instanceof Error ? error.message : "Unknown error" };
        } finally {
            this.setState({ ...this.state, isProcessing: false });
        }
        if (outcome) yield outcome;
    }
}
