import type { FireflySearchResult, FireflyTransactionSplit } from "../types.js";

// A group ID alone is ambiguous once a bank payment has multiple allocations.
export function transactionReference(group: FireflySearchResult, split: FireflyTransactionSplit): string {
  return split.transaction_journal_id ? `${group.id}:${split.transaction_journal_id}` : group.id;
}

export function parseTransactionReference(reference: string): { groupId: string; journalId?: string } {
  const match = /^(\d+)(?::(\d+))?$/.exec(reference);
  if (!match) throw new Error("Invalid transaction reference");
  return { groupId: match[1], journalId: match[2] };
}
