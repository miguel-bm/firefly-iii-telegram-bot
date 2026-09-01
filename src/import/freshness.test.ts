import { describe, expect, it } from "vitest";
import type { ImportTarget } from "./accounts.js";
import {
  getImportFreshness,
  isImportFresh,
  recordImportFreshness,
  recordReminderSent,
  wasReminderSentRecently,
} from "./freshness.js";

function fakeKv() {
  const values = new Map<string, string>();
  return {
    values,
    kv: {
      async put(key: string, value: string) { values.set(key, value); },
      async get(key: string, type?: string) {
        const value = values.get(key);
        if (value === undefined) return null;
        return type === "json" ? JSON.parse(value) : value;
      },
      async delete(key: string) { values.delete(key); },
    } as unknown as KVNamespace,
  };
}

describe("per-account import freshness", () => {
  const target: ImportTarget = { bank: "imaginbank", accountId: "65", accountName: "Imagin" };
  const now = new Date("2026-09-01T10:00:00Z");

  it("records the upload independently with its newest transaction date", async () => {
    const { kv, values } = fakeKv();
    await recordReminderSent(kv, [target.bank], now);
    await recordImportFreshness(kv, target, [
      { date: "2026-08-20", amount: -2, description: "B" },
      { date: "2026-08-25", amount: -1, description: "A" },
    ], now);

    expect(await getImportFreshness(kv, target)).toMatchObject({
      bank: "imaginbank",
      accountId: "65",
      uploadedAt: now.toISOString(),
      latestTransactionDate: "2026-08-25",
      totalParsed: 2,
    });
    expect(values.has("import-reminder:last-sent:imaginbank")).toBe(false);
  });

  it("does not reuse freshness after an account ID changes", async () => {
    const { kv } = fakeKv();
    await recordImportFreshness(kv, target, [], now);
    expect(await getImportFreshness(kv, { ...target, accountId: "99" })).toBeNull();
  });

  it("keeps each configured account independent", async () => {
    const { kv } = fakeKv();
    const shared: ImportTarget = { bank: "caixabank", accountId: "1", accountName: "Shared" };
    await recordImportFreshness(kv, target, [], now);
    await recordImportFreshness(kv, shared, [], new Date("2026-08-20T10:00:00Z"));

    expect((await getImportFreshness(kv, target))?.uploadedAt).toBe(now.toISOString());
    expect((await getImportFreshness(kv, shared))?.uploadedAt).toBe("2026-08-20T10:00:00.000Z");
  });

  it("expires uploads and throttles repeated reminders independently", async () => {
    const { kv } = fakeKv();
    await recordImportFreshness(kv, target, [], now);
    const freshness = await getImportFreshness(kv, target);

    expect(isImportFresh(freshness, 10, new Date("2026-09-10T09:59:59Z"))).toBe(true);
    expect(isImportFresh(freshness, 10, new Date("2026-09-11T10:00:00Z"))).toBe(false);

    await recordReminderSent(kv, [target.bank], now);
    expect(await wasReminderSentRecently(kv, target.bank, 3, new Date("2026-09-03T10:00:00Z"))).toBe(true);
    expect(await wasReminderSentRecently(kv, target.bank, 3, new Date("2026-09-04T10:00:00Z"))).toBe(false);
  });
});
