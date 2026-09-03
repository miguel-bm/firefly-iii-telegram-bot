import { describe, expect, it, vi } from "vitest";
import type { Env, FireflySearchResult, TransactionDetail } from "../types.js";
import type { FireflyClient } from "../tools/firefly.js";
import { executeTool } from "./tool-executor.js";
import { TOOLS } from "./tools.js";

// Synthetic identities; model-facing amounts/descriptions must not override type.
const transfer = {
    transaction_journal_id: "11", type: "transfer" as const, date: "2026-09-01", amount: "850.00",
    currency_code: "EUR", description: "Monthly contribution", category_name: undefined,
    source_id: "1", source_name: "Personal", destination_id: "2", destination_name: "Shared", tags: [],
};
const expense = { ...transfer, transaction_journal_id: "12", type: "withdrawal", description: "Vending machine" };
const groups: FireflySearchResult[] = [{ id: "10", attributes: { transactions: [transfer, expense] } }];

function setup() {
    const client = {
        searchTransactions: vi.fn().mockResolvedValue(groups),
        getTransaction: vi.fn().mockResolvedValue({ ...transfer, id: "10:11", category_name: null, notes: null } satisfies TransactionDetail),
        updateTransaction: vi.fn(),
    };
    const call = async (name: string, args: object = {}) => JSON.parse((await executeTool({
        type: "function_call", call_id: "test", name, arguments: JSON.stringify(args),
    }, client as unknown as FireflyClient, {} as Env, "es", "EUR")).result);
    return { client, call };
}

describe("transaction type confusion regression", () => {
    it("returns identical essential fields from search, explicit transfer review and detail", async () => {
        const { call } = setup();
        const search = await call("firefly_query_transactions");
        const review = await call("firefly_review_uncategorized", { transaction_type: "transfer" });
        const detail = await call("firefly_get_transaction", { transaction_id: "10:11" });
        expect(search[0]).toEqual(detail);
        expect(review.transactions).toEqual([detail]);
        expect(detail).toMatchObject({ type: "transfer", currency: "EUR", category: null,
            source_id: "1", source_name: "Personal", destination_id: "2", destination_name: "Shared" });
    });

    it.each([undefined, null, "withdrawal"])("expense review excludes transfers with type=%s", async transaction_type => {
        const { client, call } = setup();
        const result = await call("firefly_review_uncategorized", { transaction_type });
        expect(client.searchTransactions).toHaveBeenCalledWith("has_no_category:true type:withdrawal", 10);
        expect(result.transactions.map((t: { type: string }) => t.type)).toEqual(["withdrawal"]);
        expect(result.count).toBe(1);
    });

    it("rechecks split-level category, dates and account during review", async () => {
        const { client, call } = setup();
        client.searchTransactions.mockResolvedValue([{ id: "10", attributes: { transactions: [
            expense, { ...expense, category_name: "Food" }, { ...expense, date: "2026-08-01" },
            { ...expense, source_id: "3", destination_id: "4" },
        ] } }]);
        const result = await call("firefly_review_uncategorized", {
            account_id: "1", date_from: "2026-09-01", date_to: "2026-09-30",
        });
        expect(result.transactions).toHaveLength(1);
    });

    it.each(["850.00", "1.00"])("never converts an existing %s transfer or creates its counterpart", async amount => {
        const { client, call } = setup();
        client.getTransaction.mockResolvedValue({ ...transfer, amount, id: "10:11", category_name: null, notes: null });
        const result = await call("firefly_convert_to_transfer", { transaction_id: "10:11", destination_account_id: "2" });
        expect(result.error).toBeDefined();
        expect(result.transaction).toMatchObject({ type: "transfer", amount, source_id: "1", destination_id: "2" });
        expect(client.getTransaction).toHaveBeenCalledWith("10:11");
        expect(client.updateTransaction).not.toHaveBeenCalled();
    });

    it("defines the review type in the strict schema", () => {
        const tool = TOOLS.find(t => t.name === "firefly_review_uncategorized")!;
        expect(tool.parameters?.required).toContain("transaction_type");
        expect(tool.parameters?.properties).toHaveProperty("transaction_type");
    });
});
