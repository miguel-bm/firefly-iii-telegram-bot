import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import OpenAI from "openai";
import { expect, it } from "vitest";
import { SYSTEM_PROMPTS } from "./config.js";
import { runResponseLoop } from "./responses.js";

// Opt-in API credits only: all financial data and tool results are synthetic.
it.skipIf(process.env.RUN_OPENAI_SMOKE !== "1")("Luna verifies transfer type despite misleading history", async () => {
    const env = parseEnv(readFileSync(".dev.vars", "utf8"));
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0, timeout: 30_000 });
    for (const amount of [850, 1]) {
        const calls: string[] = [];
        const transaction = {
            id: "10:11", type: "transfer", date: "2026-09-01", amount: String(amount), currency: "EUR",
            description: amount === 850 ? "Aportación mensual" : "Bizum",
            category: null, source_id: "1", source_name: "Personal", destination_id: "2", destination_name: "Compartida",
            tags: [], notes: null,
        };
        let reply = "";
        for await (const event of runResponseLoop({
            lang: "es", instructions: SYSTEM_PROMPTS.es([], [], [
                { id: "1", name: "Personal" }, { id: "2", name: "Compartida" },
            ], "EUR", "Europe/Madrid"),
            input: [
                { role: "user", content: "Revisa el movimiento 10:11." },
                { role: "assistant", content: `El movimiento 10:11 de ${amount} € consta como gasto; parece que falta convertirlo.` },
                { role: "user", content: amount === 850
                    ? "Creo que ya es una transferencia. Comprueba su tipo actual y dime si realmente hace falta cambiarlo."
                    : "¿Ese Bizum tiene contraparte en Compartida o falta registrar un ingreso? Compruébalo." },
            ],
            create: params => client.responses.create(params),
            execute: async call => {
                calls.push(call.name);
                expect(["firefly_get_transaction", "firefly_query_transactions", "firefly_get_accounts"]).toContain(call.name);
                if (call.name === "firefly_get_transaction") {
                    expect(JSON.parse(call.arguments).transaction_id).toBe("10:11");
                    return { result: JSON.stringify(transaction) };
                }
                return { result: JSON.stringify(call.name === "firefly_query_transactions" ? [transaction] : []) };
            },
        })) if (event.type === "done") reply = event.text;
        console.log(`Synthetic ${amount} EUR case: ${reply}`);
        expect(calls).toContain("firefly_get_transaction");
        expect(reply.toLowerCase()).toContain("transferencia");
        expect(reply).not.toMatch(/¿Confirmas/i);
    }
}, 120_000);
