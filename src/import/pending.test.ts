import { describe, expect, it } from "vitest";
import {
  consumePendingImport,
  getPendingImport,
  importCallbackData,
  ownsPendingImport,
  parseImportCallback,
  PENDING_IMPORT_TTL_SECONDS,
  savePendingImport,
  type PendingImport,
} from "./pending.js";

function fakeKv() {
  const values = new Map<string, string>();
  let lastTtl: number | undefined;
  const kv = {
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      values.set(key, value);
      lastTtl = options?.expirationTtl;
    },
    async get(key: string, type?: string) {
      const value = values.get(key);
      if (value === undefined) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async delete(key: string) {
      values.delete(key);
    },
  } as unknown as KVNamespace;
  return { kv, getLastTtl: () => lastTtl };
}

describe("pending Telegram imports", () => {
  const pending: PendingImport = {
    fileId: "telegram-file",
    fileName: "statement.csv",
    chatId: "100",
    userId: "200",
  };

  it("stores only a short-lived Telegram file reference", async () => {
    const { kv, getLastTtl } = fakeKv();
    const token = await savePendingImport(kv, pending);

    expect(token).toMatch(/^[a-f0-9]{24}$/);
    expect(getLastTtl()).toBe(PENDING_IMPORT_TTL_SECONDS);
    expect(await getPendingImport(kv, token)).toEqual(pending);
  });

  it("consumes a pending import once", async () => {
    const { kv } = fakeKv();
    const token = await savePendingImport(kv, pending);

    expect(await consumePendingImport(kv, token)).toEqual(pending);
    expect(await consumePendingImport(kv, token)).toBeNull();
  });

  it("accepts only known account callbacks with an opaque token", () => {
    const token = "0123456789abcdef01234567";
    expect(parseImportCallback(importCallbackData(token, "imaginbank")))
      .toEqual({ token, action: "imaginbank" });
    expect(parseImportCallback(`bank-import:${token}:other`)).toBeNull();
    expect(parseImportCallback("bank-import:short:bbva")).toBeNull();
  });

  it("binds a choice to both the original chat and uploader", () => {
    expect(ownsPendingImport(pending, "100", "200")).toBe(true);
    expect(ownsPendingImport(pending, "100", "201")).toBe(false);
    expect(ownsPendingImport(pending, "101", "200")).toBe(false);
  });
});
