import { describe, expect, it, vi } from "vitest";
import type { ResponseOutputItem, ResponseStreamEvent } from "openai/resources/responses/responses";
import { runResponseLoop, type ResponseLoopOptions, type TurnEvent } from "./responses.js";

const call = (id = "call_1"): ResponseOutputItem => ({
    type: "function_call", id: `fc_${id}`, call_id: id, name: "firefly_get_accounts", arguments: "{}",
});
const message = (text: string): ResponseOutputItem => ({
    type: "message", id: "msg_1", role: "assistant", status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
});
const complete = (output: ResponseOutputItem[]): ResponseStreamEvent => ({
    type: "response.completed", response: { id: "resp_1", status: "completed", output },
} as ResponseStreamEvent);
const delta = (text: string): ResponseStreamEvent => ({
    type: "response.output_text.delta", delta: text,
} as ResponseStreamEvent);
async function* stream(events: ResponseStreamEvent[]) { yield* events; }
async function collect(events: AsyncIterable<TurnEvent>) {
    const result: TurnEvent[] = [];
    for await (const event of events) result.push(event);
    return result;
}
function setup(...rounds: ResponseStreamEvent[][]) {
    let index = 0;
    const create = vi.fn<ResponseLoopOptions["create"]>(async () => stream(rounds[index++]!));
    const execute = vi.fn<ResponseLoopOptions["execute"]>(async () => ({ result: "{\"balance\":42}" }));
    const options: ResponseLoopOptions = {
        instructions: "Be helpful", input: [{ role: "user", content: "Hola" }], lang: "es", create, execute,
    };
    return { options, create, execute };
}

describe("Responses agent loop", () => {
    it("uses Luna with medium reasoning and streams without duplicating the final text", async () => {
        const { options, create, execute } = setup([delta("¡Ho"), delta("la!"), complete([message("¡Hola!")])]);
        expect(await collect(runResponseLoop(options))).toEqual([
            { type: "text", content: "¡Ho" }, { type: "text", content: "la!" },
            { type: "done", text: "¡Hola!", chartUrl: undefined },
        ]);
        expect(create.mock.calls[0][0]).toMatchObject({
            model: "gpt-5.6-luna", reasoning: { effort: "medium" }, instructions: "Be helpful",
            store: false, include: ["reasoning.encrypted_content"], stream: true, tool_choice: "auto",
            tools: expect.arrayContaining([expect.objectContaining({
                type: "function", name: "firefly_get_accounts", strict: true,
            })]),
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it("replays reasoning, messages and calls with matching call_id outputs, in order", async () => {
        const reasoning: ResponseOutputItem = {
            type: "reasoning", id: "rs_1", summary: [], encrypted_content: "encrypted-test-content",
        };
        const output = [reasoning, message("Consultando…"), call(), call("call_2")];
        const { options, create, execute } = setup(
            [delta("Consultando…"), complete(output)], [complete([message("Saldo: 42€")])],
        );
        execute.mockResolvedValueOnce({ result: "first", chartUrl: "https://chart.test/1" });
        const events = await collect(runResponseLoop(options));
        expect(execute.mock.calls.map(([item]) => item.call_id)).toEqual(["call_1", "call_2"]);
        expect(create.mock.calls[1][0].input).toEqual([
            ...options.input, ...output,
            { type: "function_call_output", call_id: "call_1", output: "first" },
            { type: "function_call_output", call_id: "call_2", output: "{\"balance\":42}" },
        ]);
        expect(options.input).toHaveLength(1);
        expect(events.at(-1)).toEqual({ type: "done", text: "Saldo: 42€", chartUrl: "https://chart.test/1" });
        expect(events.filter(event => event.type === "tool")).toHaveLength(2);
    });

    it("passes a tool failure back to the model without retrying the side effect", async () => {
        const { options, execute } = setup([complete([call()])], [complete([message("No se pudo consultar.")])]);
        execute.mockResolvedValueOnce({ result: '{"error":"Firefly unavailable"}' });
        expect((await collect(runResponseLoop(options))).at(-1)).toMatchObject({ text: "No se pudo consultar." });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it.each(["response.failed", "response.incomplete"] as const)("rejects %s before executing tools", async type => {
        const event = { type, response: { status: type.split(".")[1], output: [call()] } } as ResponseStreamEvent;
        const { options, execute } = setup([event]);
        await expect(collect(runResponseLoop(options))).rejects.toThrow("Response");
        expect(execute).not.toHaveBeenCalled();
    });

    it("rejects API errors and prematurely closed streams", async () => {
        const { options } = setup([{ type: "error", message: "No credits" } as ResponseStreamEvent]);
        await expect(collect(runResponseLoop(options))).rejects.toThrow("No credits");
        const truncated = setup([delta("Partial")]);
        await expect(collect(runResponseLoop(truncated.options))).rejects.toThrow("before completion");
    });

    it("returns refusals rather than claiming success", async () => {
        const refusal = { ...message(""), content: [{ type: "refusal", refusal: "No puedo ayudar." }] } as ResponseOutputItem;
        const { options } = setup([
            { type: "response.refusal.delta", delta: "No puedo ayudar." } as ResponseStreamEvent,
            complete([refusal]),
        ]);
        expect((await collect(runResponseLoop(options))).at(-1)).toMatchObject({ text: "No puedo ayudar." });
    });

    it("retains localized empty-output and ten-step fallbacks", async () => {
        const empty = setup([complete([])]);
        empty.options.lang = "en";
        expect((await collect(runResponseLoop(empty.options))).at(-1)).toMatchObject({ text: "Done." });
        const capped = setup(...Array.from({ length: 10 }, (_, i) => [complete([call(String(i))])]));
        const result = await collect(runResponseLoop(capped.options));
        expect(capped.create).toHaveBeenCalledTimes(10);
        expect(capped.execute).toHaveBeenCalledTimes(10);
        expect(result.at(-1)).toMatchObject({ type: "done", text: expect.stringContaining("máximo") });
    });
});
