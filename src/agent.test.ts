import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseCreateParamsStreaming, ResponseStreamEvent } from "openai/resources/responses/responses";
import type { ChatAgentState, Env } from "./types.js";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create }; } }));
vi.mock("agents", () => ({ Agent: class {
    initialState!: ChatAgentState;
    private saved?: ChatAgentState;
    constructor(_state: unknown, public env: Env) {}
    get state() { return this.saved ?? this.initialState; }
    setState(state: ChatAgentState) { this.saved = state; }
} }));
vi.mock("./tools/firefly.js", () => ({
    FireflyClient: class {},
    getCachedCategories: async () => [{ name: "Groceries" }],
    getCachedTags: async () => ["household"],
    getCachedAssetAccounts: async () => [{ id: "1", name: "Shared" }],
}));
import { ChatAgentDO } from "./agent.js";

async function* reply(): AsyncGenerator<ResponseStreamEvent> {
    yield { type: "response.output_text.delta", delta: "¡Hola!" } as ResponseStreamEvent;
    yield {
        type: "response.completed", response: { status: "completed", output: [{
            type: "message", role: "assistant", content: [{ type: "output_text", text: "¡Hola!" }],
        }] },
    } as ResponseStreamEvent;
}
function agent() {
    return new ChatAgentDO({} as DurableObjectState, {
        BOT_LANGUAGE: "es", BOT_TIMEZONE: "Europe/Madrid", MAX_HISTORY_MESSAGES: "2", DEFAULT_CURRENCY: "EUR",
    } as unknown as Env);
}
beforeEach(() => { create.mockReset().mockImplementation(async () => reply()); });
afterEach(() => vi.restoreAllMocks());

describe("shared agent turn lifecycle", () => {
    it("keeps existing history readable, prefixes user names, and saves a bounded final reply", async () => {
        const bot = agent();
        bot.setState({ ...bot.state, messageHistory: [
            { role: "user", content: "Earlier", userName: "María", timestamp: 1 },
            { role: "assistant", content: "Previous reply", timestamp: 2 },
        ] });
        expect(await bot.runAgentTurn("Hola", "Miguel")).toEqual({ text: "¡Hola!", chartUrl: undefined });
        const params = create.mock.calls[0][0] as ResponseCreateParamsStreaming;
        expect(params.input).toEqual([
            { role: "user", content: "[María]: Earlier" },
            { role: "assistant", content: "Previous reply" },
            { role: "user", content: "[Miguel]: Hola" },
        ]);
        expect(params.instructions).toContain("Shared (id: 1)");
        expect(bot.state.messageHistory.map(msg => msg.content)).toEqual(["Hola", "¡Hola!"]);
        expect(bot.checkBusy()).toBeNull();
    });

    it("preserves the JSON and NDJSON HTTP contracts", async () => {
        for (const mode of ["runAgentTurn", "runAgentTurnStream"]) {
            const bot = agent();
            const response = await bot.fetch(new Request(`https://agent/${mode}`, {
                method: "POST", body: JSON.stringify({ message: "Hola" }),
            }));
            expect(response.status).toBe(200);
            if (mode === "runAgentTurn") expect(await response.json()).toEqual({ result: { text: "¡Hola!" } });
            else {
                expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
                const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
                expect(events).toEqual([{ type: "text", content: "¡Hola!" }, { type: "done", text: "¡Hola!" }]);
            }
            expect(bot.state.isProcessing).toBe(false);
        }
    });

    it("clears the busy flag without saving a failed turn in either mode", async () => {
        create.mockRejectedValue(new Error("API unavailable"));
        const bot = agent();
        await expect(bot.runAgentTurn("Hola")).rejects.toThrow("API unavailable");
        const events = [];
        for await (const event of bot.runAgentTurnStream("Hola")) events.push(event);
        expect(events).toEqual([{ type: "error", message: "API unavailable" }]);
        expect(bot.state.messageHistory).toEqual([]);
        expect(bot.checkBusy()).toBeNull();
    });

    it("clears the busy flag when a streamed turn is cancelled", async () => {
        const bot = agent();
        const events = bot.runAgentTurnStream("Hola");
        await events.next();
        expect(bot.checkBusy()).not.toBeNull();
        await events.return(undefined);
        expect(bot.checkBusy()).toBeNull();
        expect(bot.state.messageHistory).toEqual([]);
    });

    it("releases before completion and cannot clear a newer turn's busy flag", async () => {
        const bot = agent();
        const events = bot.runAgentTurnStream("Hola");
        await events.next();
        expect((await events.next()).value).toMatchObject({ type: "done" });
        expect(bot.checkBusy()).toBeNull();
        bot.setState({ ...bot.state, isProcessing: true });
        await events.return(undefined);
        expect(bot.checkBusy()).not.toBeNull();
    });

    it("still supports reset, busy checks, and unknown actions", async () => {
        const bot = agent();
        bot.setState({ ...bot.state, isProcessing: true });
        expect(bot.checkBusy()).not.toBeNull();
        await bot.fetch(new Request("https://agent/resetHistory"));
        expect(await (await bot.fetch(new Request("https://agent/checkBusy"))).json()).toEqual({ result: null });
        expect((await bot.fetch(new Request("https://agent/missing"))).status).toBe(404);
    });
});
