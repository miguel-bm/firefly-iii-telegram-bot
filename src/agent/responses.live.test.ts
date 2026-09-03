import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import OpenAI from "openai";
import { expect, it } from "vitest";
import { runResponseLoop, type TurnEvent } from "./responses.js";

// Explicit opt-in: uses API credits, but never calls Firefly or sends Telegram messages.
it.skipIf(process.env.RUN_OPENAI_SMOKE !== "1")("Luna medium: greeting and synthetic tool round trip", async () => {
    const env = parseEnv(readFileSync(".dev.vars", "utf8"));
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0, timeout: 30_000 });
    for (const useTool of [false, true]) {
        let calls = 0;
        let requests = 0;
        let replayedReasoning = false;
        let final: TurnEvent | undefined;
        for await (const event of runResponseLoop({
            lang: "es",
            instructions: "This is a synthetic API test. Reply briefly in Spanish. For a greeting, do not call tools. " +
                "For the account balance, call firefly_get_accounts, then report the returned balance. Never call other tools.",
            input: [{ role: "user", content: useTool ? "Consulta el saldo de mi cuenta de prueba." : "Hola" }],
            create: async params => {
                requests++;
                expect(params.reasoning?.effort).toBe("medium");
                if (Array.isArray(params.input)) replayedReasoning ||= params.input.some(item =>
                    item.type === "reasoning" && Boolean(item.encrypted_content));
                return client.responses.create(params);
            },
            execute: async call => {
                expect(call.name).toBe("firefly_get_accounts");
                calls++;
                return { result: JSON.stringify({ accounts: [{ id: "test", name: "Test account", balance: "42.00", currency: "EUR" }] }) };
            },
        })) final = event;
        expect(final?.type).toBe("done");
        if (final?.type !== "done") throw new Error("Missing final reply");
        expect(final.text.length).toBeGreaterThan(0);
        expect(calls).toBe(useTool ? 1 : 0);
        if (useTool) {
            expect(requests).toBe(2);
            expect(replayedReasoning).toBe(true);
            expect(final.text).toContain("42");
        }
    }
}, 90_000);
