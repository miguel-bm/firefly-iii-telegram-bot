import type {
    Response, ResponseCreateParamsStreaming, ResponseFunctionToolCall,
    ResponseInput, ResponseStreamEvent,
} from "openai/resources/responses/responses";
import type { AgentResponse, StreamEvent } from "../types.js";
import { CHAT_MODEL } from "./config.js";
import { TOOLS } from "./tools.js";

export type TurnEvent = Exclude<StreamEvent, { type: "done" }> | ({ type: "done" } & AgentResponse);
export interface ResponseLoopOptions {
    instructions: string;
    input: ResponseInput;
    lang: "es" | "en";
    create: (params: ResponseCreateParamsStreaming) => Promise<AsyncIterable<ResponseStreamEvent>>;
    execute: (call: ResponseFunctionToolCall) => Promise<{ result: string; chartUrl?: string }>;
}

// One streamed loop powers both private-chat drafts and complete group replies.
export async function* runResponseLoop(options: ResponseLoopOptions): AsyncGenerator<TurnEvent> {
    const input = [...options.input];
    let chartUrl: string | undefined;

    for (let step = 0; step < 10; step++) {
        const stream = await options.create({
            model: CHAT_MODEL,
            reasoning: { effort: "medium" },
            instructions: options.instructions,
            input: [...input],
            tools: TOOLS,
            tool_choice: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
            stream: true,
        });
        let response: Response | undefined;
        let streamedText = "";
        for await (const event of stream) {
            if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
                streamedText += event.delta;
                yield { type: "text", content: event.delta };
            } else if (event.type === "response.completed") {
                response = event.response;
            } else if (event.type === "response.failed" || event.type === "response.incomplete") {
                throw new Error(event.response.error?.message ?? `Response ${event.response.status}`);
            } else if (event.type === "error") {
                throw new Error(event.message);
            }
        }
        if (!response) throw new Error("Response stream ended before completion");

        // Replay ALL output, including encrypted reasoning, before adding tool results.
        input.push(...response.output);
        const calls = response.output.filter(item => item.type === "function_call");
        if (calls.length === 0) {
            const text = response.output.flatMap(item => item.type === "message" ? item.content : [])
                .map(part => part.type === "output_text" ? part.text : part.refusal).join("")
                || (options.lang === "es" ? "Hecho." : "Done.");
            if (!streamedText) yield { type: "text", content: text };
            yield { type: "done", text, chartUrl };
            return;
        }
        for (const call of calls) {
            yield { type: "tool", name: call.name };
            const result = await options.execute(call);
            if (result.chartUrl) chartUrl = result.chartUrl;
            input.push({ type: "function_call_output", call_id: call.call_id, output: result.result });
        }
    }

    const text = options.lang === "es"
        ? "Alcancé el número máximo de pasos. Por favor, intenta una solicitud más simple."
        : "I reached the maximum number of steps. Please try a simpler request.";
    yield { type: "text", content: text };
    yield { type: "done", text, chartUrl };
}
