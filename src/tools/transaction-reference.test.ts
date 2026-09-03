import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../types.js";
import { FireflyClient } from "./firefly.js";

afterEach(() => vi.unstubAllGlobals());
function setup() {
  const data = { id: "100", attributes: { group_title: "Mortgage", transactions: [
    { transaction_journal_id: "101", type: "withdrawal", date: "2026-09-01T00:00:00+02:00", amount: "700", description: "Principal", source_id: "10", destination_id: "20", tags: ["mortgage-principal"] },
    { transaction_journal_id: "102", type: "withdrawal", date: "2026-09-01T00:00:00+02:00", amount: "600", description: "Interest", source_id: "10", destination_id: "30", tags: ["mortgage-interest"] },
  ] } };
  const fetcher = vi.fn(async () => Response.json({ data }));
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, client: new FireflyClient({ FIREFLY_API_URL: "https://test.example", FIREFLY_API_TOKEN: "test" } as Env) };
}
describe("split payment references", () => {
  it("reads the selected split, refusing an ambiguous group or stale reference", async () => {
    const { client } = setup();
    expect(await client.getTransaction("100:102")).toMatchObject({ amount: "600", description: "Interest" });
    await expect(client.getTransaction("100")).rejects.toThrow("choose a part");
    await expect(client.getTransaction("100:999")).rejects.toThrow("not found");
  });
  it("targets metadata edits to the correct journal without running rules", async () => {
    const { client, fetcher } = setup();
    await client.updateTransaction("100:102", {
      type: "withdrawal", date: "2026-09-01", amount: 600, source_id: "10", destination_id: "30",
      category_name: "Interest", tags: ["esencial"],
    });
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    const write = calls.find(([, init]) => init.method === "PUT")!;
    expect(write[0]).toBe("https://test.example/api/v1/transactions/100");
    const payload = JSON.parse(String(write[1].body));
    expect(payload).toMatchObject({ apply_rules: false, group_title: "Mortgage" });
    expect(payload.transactions).toEqual([
      { transaction_journal_id: "101" },
      { transaction_journal_id: "102", category_name: "Interest", tags: ["esencial", "mortgage-interest"] },
    ]);
  });
  it("blocks accidental group deletion and mortgage financial edits", async () => {
    const { client, fetcher } = setup();
    await expect(client.deleteTransaction("100:102")).rejects.toThrow("deletion");
    const changes: Parameters<FireflyClient["updateTransaction"]>[1][] = [
      { type: "deposit" }, { amount: 2 }, { date: "2026-09-02" }, { source_id: "11" }, { destination_id: "21" },
    ];
    for (const update of changes) {
      await expect(client.updateTransaction("100:101", update)).rejects.toThrow("reconciled mortgage repair");
    }
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls.every(([, init]) => !init.method)).toBe(true);
  });
});
