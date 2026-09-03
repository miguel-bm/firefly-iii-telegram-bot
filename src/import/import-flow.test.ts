import { afterEach, describe, expect, it, vi } from "vitest";
import { importBankStatement } from "./importer.js";
import { FireflyClient } from "../tools/firefly.js";
import type { Env, FireflySearchResult } from "../types.js";
import { generateImportHash } from "./hash.js";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const values = new Map<string, string>();
  const env = {
    FIREFLY_API_URL: "https://example.test", FIREFLY_API_TOKEN: "test", DEFAULT_CURRENCY: "EUR",
    BANK_ACCOUNT_ID_CAIXABANK: "1", BANK_ACCOUNT_ID_IMAGINBANK: "65", BANK_ACCOUNT_ID_BBVA: "9",
    BANK_ACCOUNT_SUFFIX_CAIXABANK: "111", BANK_ACCOUNT_SUFFIX_IMAGINBANK: "222",
    IMPORT_HASHES: {
      get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string) => { values.set(key, value); },
      delete: async (key: string) => { values.delete(key); },
    },
  } as unknown as Env;
  const records: FireflySearchResult[] = [];
  vi.spyOn(FireflyClient.prototype, "searchTransactions").mockImplementation(async () => records);
  const create = vi.spyOn(FireflyClient.prototype, "createTransaction").mockImplementation(async input => {
    records.push({ id: String(records.length + 1), attributes: { transactions: [{
      type: input.type!, date: input.date, description: input.description, amount: String(input.amount), currency_code: "EUR",
      source_id: input.source_account_id, destination_id: input.destination_account_id, tags: input.tags ?? [],
    }] } });
    return { id: String(records.length), description: input.description };
  });
  return { env, values, records, create };
}

function csv(row: string) {
  return new TextEncoder().encode(`Fecha,Fecha valor,Movimiento,Más datos,Importe,Saldo\n${row}`).buffer as ArrayBuffer;
}

describe("statement import workflow", () => {
  it("repairs a missing contribution even if its old deleted deposit has an import hash", async () => {
    const { env, values, records, create } = setup();
    const hash = await generateImportHash("1", "2026-07-01", 850, "MARIA GARCIA ARAU");
    values.set(`import-hash:${hash}`, "old deleted deposit");
    const source = csv("7/1/2026,7/1/2026,PAGO TRASPASOS,,-850.00,0");
    const receiving = csv("01/07/2026,01/07/2026,MARIA GARCIA ARAU,Hipoteca y gastos,850.00,0");
    const result = await importBankStatement(receiving, "Movimientos_cuenta_111.csv", env, { chatId: "1", dateOrder: "dmy" });
    expect(result).toMatchObject({ created: 1, errors: [], dateFrom: "2026-07-01" });
    for (let count = 0; count < 2; count++) {
      const result = await importBankStatement(source, "Movimientos_cuenta_222.csv", env,
        { chatId: "1", dateOrder: "mdy", contributionChoices: { 0: "household" } });
      expect(result).toMatchObject({ created: 0, duplicates: 1, errors: [] });
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(records[0].attributes.transactions[0].type).toBe("transfer");
  });

  it("asks before classifying an ambiguous Imagin transfer and honors either answer", async () => {
    const { env, values, create } = setup();
    const data = csv("7/1/2026,7/1/2026,PAGO TRASPASOS,,-850.00,0");
    await expect(importBankStatement(data, "Movimientos_cuenta_222.csv", env,
      { chatId: "1", dateOrder: "mdy" })).rejects.toThrow("Confirm whether");
    expect(values.size).toBe(0);
    expect(create).not.toHaveBeenCalled();

    await importBankStatement(data, "Movimientos_cuenta_222.csv", env,
      { chatId: "1", dateOrder: "mdy", contributionChoices: { 0: "regular" } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      type: "withdrawal", source_account_id: "65", description: "PAGO TRASPASOS",
    }), env);
  });

  it("confirms each candidate before any writes and handles mixed household/regular transfers", async () => {
    const { env, values, create } = setup();
    const data = csv("7/20/2026,7/20/2026,PAGO TRASPASOS,,-850.00,0\n7/1/2026,7/1/2026,PAGO TRASPASOS,,-850.00,0");
    await expect(importBankStatement(data, "Movimientos_cuenta_222.csv", env,
      { chatId: "1", dateOrder: "mdy", contributionChoices: { 0: "regular" } }))
      .rejects.toMatchObject({ index: 1, date: "2026-07-01" });
    expect(values.size).toBe(0);
    expect(create).not.toHaveBeenCalled();
    await importBankStatement(data, "Movimientos_cuenta_222.csv", env,
      { chatId: "1", dateOrder: "mdy", contributionChoices: { 0: "regular", 1: "household" } });
    expect(create.mock.calls.map(([input]) => input.type)).toEqual(["transfer", "withdrawal"]);
  });

  it("refuses ambiguous dates before any API calls or deduplication writes", async () => {
    const { env, values, create } = setup();
    await expect(importBankStatement(csv("01/07/2026,01/07/2026,Store,,-20.00,0"),
      "Movimientos_cuenta_111.csv", env, { chatId: "1" })).rejects.toThrow("Choose");
    expect(values.size).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("deduplicates overlapping files while dry-run is read-only", async () => {
    const { env, values, create } = setup();
    const data = csv("28/08/2026,28/08/2026,Store,,-20.00,0");
    await importBankStatement(data, "Movimientos_cuenta_111.csv", env, { chatId: "1", dryRun: true });
    expect(values.size).toBe(0);
    expect(create).not.toHaveBeenCalled();
    await importBankStatement(data, "Movimientos_cuenta_111.csv", env, { chatId: "1" });
    const second = await importBankStatement(data, "Movimientos_cuenta_111 (1).csv", env, { chatId: "1" });
    expect(second).toMatchObject({ created: 0, duplicates: 1, errors: [] });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
