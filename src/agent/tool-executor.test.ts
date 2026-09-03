import { describe, expect, it, vi } from "vitest";
import type { Env } from "../types.js";
import type { FireflyClient } from "../tools/firefly.js";
import { executeTool } from "./tool-executor.js";

describe("Responses tool dispatch", () => {
    it("accepts native function-call fields and returns the existing account result format", async () => {
        const getAccounts = vi.fn().mockResolvedValue([
            { id: "1", name: "Test", type: "asset", current_balance: 42, currency_code: "EUR" },
        ]);
        const client = { getAccounts } as unknown as FireflyClient;
        const result = await executeTool({
            type: "function_call", call_id: "call_1", name: "firefly_get_accounts",
            arguments: '{"account_type":"asset"}',
        }, client, {} as Env, "es", "EUR");
        expect(getAccounts).toHaveBeenCalledWith("asset");
        expect(JSON.parse(result.result)).toEqual([{ id: "1", name: "Test", type: "asset", balance: "42.00 EUR" }]);
    });

    it("keeps malformed arguments as tool errors without invoking Firefly", async () => {
        const getAccounts = vi.fn();
        const result = await executeTool({
            type: "function_call", call_id: "call_1", name: "firefly_get_accounts", arguments: "not-json",
        }, { getAccounts } as unknown as FireflyClient, {} as Env, "es", "EUR");
        expect(JSON.parse(result.result)).toHaveProperty("error");
        expect(getAccounts).not.toHaveBeenCalled();
    });
});
