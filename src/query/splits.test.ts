import { describe, expect, it } from "vitest";
import { aggregateTransactions } from "./aggregate.js";
import { filterSplits } from "./filter-splits.js";

const transactions = [{ id: "1", attributes: { transactions: [
  { type: "withdrawal", date: "2026-09-01", amount: "700", description: "Capital", category_name: "Principal", tags: ["mortgage"] },
  { type: "withdrawal", date: "2026-09-01", amount: "600", description: "Interest", category_name: "Interest", tags: ["mortgage"] },
] } }];
describe("split payment reporting", () => {
  it("counts one bank payment while summing both parts", () => {
    expect(aggregateTransactions(transactions, { kind: "sum" })).toEqual({ total: 1300 });
    expect(aggregateTransactions(transactions, { kind: "count" })).toEqual({ count: 1 });
    expect(aggregateTransactions(transactions, { kind: "avg" })).toEqual({ average: 1300 });
    expect(aggregateTransactions(transactions, { kind: "count", group_by: "month" })).toEqual({ grouped: { "2026-09": 1 } });
    expect(aggregateTransactions(transactions, { kind: "count", group_by: "tag" })).toEqual({ grouped: { mortgage: 1 } });
  });
  it("does not leak principal into an interest-only category query", () => {
    const interest = filterSplits(transactions, s => s.category_name === "Interest");
    expect(aggregateTransactions(interest, { kind: "sum" })).toEqual({ total: 600 });
    expect(transactions[0].attributes.transactions).toHaveLength(2);
  });
});
