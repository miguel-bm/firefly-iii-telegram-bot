import type { FireflyTransactionSplit } from "../types.js";

type Transaction = Omit<FireflyTransactionSplit, "category_name"> & { category_name?: string | null };

// One contract for search, review and detail; never infer type from the description.
export function transactionView(id: string, tx: Transaction) {
    return {
        id, type: tx.type, date: tx.date, amount: tx.amount,
        currency: tx.currency_code ?? null,
        description: tx.description, category: tx.category_name ?? null,
        source_id: tx.source_id ?? null, source_name: tx.source_name ?? null,
        destination_id: tx.destination_id ?? null, destination_name: tx.destination_name ?? null,
        tags: tx.tags ?? [], notes: tx.notes ?? null,
    };
}
