import { describe, expect, it, vi } from "vitest";
import type { Env, FireflySearchResult } from "../types.js";
import type { FireflyClient } from "../tools/firefly.js";
import { contributionFor, importContribution } from "./transfers.js";
import { targetForBank } from "./accounts.js";

const env = { BANK_ACCOUNT_ID_CAIXABANK: "1", BANK_ACCOUNT_ID_BBVA: "9", BANK_ACCOUNT_ID_IMAGINBANK: "65", DEFAULT_CURRENCY: "EUR" } as Env;
const outgoing = { date: "2026-07-01", amount: -850, description: "PAGO TRASPASOS" };
const incoming = { date: "2026-07-01", amount: 850, description: "MARIA GARCIA ARAU", notes: "Hipoteca y gastos" };

function fakeFirefly() {
  const records: FireflySearchResult[] = [];
  const create = vi.fn(async (input) => {
    records.push({ id: String(records.length + 1), attributes: { transactions: [{
      type: input.type, date: input.date, amount: String(input.amount), description: input.description,
      source_id: input.source_account_id, destination_id: input.destination_account_id, currency_code: "EUR",
      tags: input.tags ?? [],
    }] } });
  });
  const search = vi.fn(async () => records);
  return { records, create, search, client: { createTransaction: create, searchTransactions: search } as unknown as FireflyClient };
}

describe("household contribution reconciliation", () => {
  it.each([false, true])("creates one transfer regardless of upload order (source first: %s)", async sourceFirst => {
    const { client, create, records } = fakeFirefly();
    const source = { tx: outgoing, target: targetForBank("imaginbank", env) };
    const destination = { tx: incoming, target: targetForBank("caixabank", env) };
    const ordered = sourceFirst ? [source, destination] : [destination, source];
    for (const { tx, target } of [...ordered, ...ordered]) {
      await importContribution(tx, contributionFor(tx, target, env)!, client, env);
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(records[0].attributes.transactions[0]).toMatchObject({ type: "transfer", source_id: "65", destination_id: "1", amount: "850" });
  });

  it("retains a complete transfer when only the receiving statement exists", async () => {
    const { client, records } = fakeFirefly();
    expect(await importContribution(incoming, contributionFor(incoming, targetForBank("caixabank", env), env)!, client, env)).toBe(true);
    expect(records).toHaveLength(1);
  });

  it("matches Miguel's one-day booking delay", async () => {
    const { client, create } = fakeFirefly();
    const sent = { ...outgoing, description: "Transferencia realizada", notes: "Aportacion periodica - APORTACION PERIODICA" };
    const received = { ...incoming, date: "2026-07-02", description: "TRANSF. A SU FAVOR", notes: "Bank reference-MIGUEL BLANCO MARCOS" };
    await importContribution(sent, contributionFor(sent, targetForBank("bbva", env), env)!, client, env);
    await importContribution(received, contributionFor(received, targetForBank("caixabank", env), env)!, client, env);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not match a previous month or the other contributor", async () => {
    const { client, create } = fakeFirefly();
    const contribution = contributionFor(outgoing, targetForBank("imaginbank", env), env)!;
    await importContribution(outgoing, contribution, client, env);
    await importContribution({ ...outgoing, date: "2026-08-01" }, contribution, client, env);
    await importContribution(outgoing, { ...contribution, sourceId: "9" }, client, env);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it.each([
    { description: "Another transfer", tags: [] },
    { description: "Traspaso Mensual María", tags: [] },
    { description: "Another transfer", tags: ["household-contribution"] },
  ])("requires both the managed description and tag: %j", async metadata => {
    const { client, records, create } = fakeFirefly();
    records.push({ id: "old", attributes: { transactions: [{
      type: "transfer", date: outgoing.date, amount: "850", ...metadata,
      source_id: "65", destination_id: "1", currency_code: "EUR",
    }] } });
    const contribution = contributionFor(outgoing, targetForBank("imaginbank", env), env)!;
    expect(await importContribution(outgoing, contribution, client, env)).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("fails closed if two matching transfers already exist", async () => {
    const { client, records, create } = fakeFirefly();
    const contribution = contributionFor(outgoing, targetForBank("imaginbank", env), env)!;
    await importContribution(outgoing, contribution, client, env);
    records.push(structuredClone(records[0]));
    await expect(importContribution(incoming, contribution, client, env)).rejects.toThrow("Multiple");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("leaves unrelated payments and unknown incoming senders alone", () => {
    expect(contributionFor({ ...outgoing, amount: -30 }, targetForBank("imaginbank", env), env)).toBeNull();
    expect(contributionFor({ ...incoming, notes: "Birthday" }, targetForBank("caixabank", env), env)).toBeNull();
    expect(contributionFor(outgoing, targetForBank("caixabank", env), env)).toBeNull();
  });
});
