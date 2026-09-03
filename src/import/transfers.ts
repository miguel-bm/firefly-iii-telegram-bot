import type { Env } from "../types.js";
import type { FireflyClient } from "../tools/firefly.js";
import { targetForBank, type ImportTarget } from "./accounts.js";
import type { ParsedTransaction } from "./types.js";

interface Contribution {
  sourceId: string;
  destinationId: string;
  description: string;
}

export class ContributionChoiceError extends Error {
  constructor(readonly index: number, readonly date: string) {
    super("Confirm whether the Imagin €850 transfer is the household contribution. Nothing was imported.");
    this.name = "ContributionChoiceError";
  }
}

const normalized = (value = "") => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

// Imagin's generic outgoing description is only a candidate: the importer asks first.
export function contributionFor(tx: ParsedTransaction, target: ImportTarget, env: Env): Contribution | null {
  if (Math.abs(tx.amount) !== 850) return null;
  const description = normalized(tx.description);
  const notes = normalized(tx.notes);
  let owner: "bbva" | "imaginbank" | undefined;
  if (target.bank === "bbva" && tx.amount < 0 && description === "TRANSFERENCIA REALIZADA"
    && notes.includes("APORTACION PERIODICA")) owner = "bbva";
  if (target.bank === "imaginbank" && tx.amount < 0 && description === "PAGO TRASPASOS") owner = "imaginbank";
  if (target.bank === "caixabank" && tx.amount > 0) {
    if (description === "MARIA GARCIA ARAU" && notes.includes("HIPOTECA Y GASTOS")) owner = "imaginbank";
    if (description === "TRANSF. A SU FAVOR" && notes.includes("MIGUEL BLANCO MARCOS")) owner = "bbva";
  }
  if (!owner) return null;
  const sourceId = targetForBank(owner, env).accountId;
  const destinationId = targetForBank("caixabank", env).accountId;
  if (sourceId === destinationId) throw new Error("Contribution accounts must be different");
  return { sourceId, destinationId, description: `Traspaso Mensual ${owner === "bbva" ? "Miguel" : "María"}` };
}

function shifted(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export async function importContribution(
  tx: ParsedTransaction, contribution: Contribution, firefly: FireflyClient, env: Env,
): Promise<boolean> {
  // Include a small booking-date lag between the sending and receiving banks.
  const from = shifted(tx.date, -3), to = shifted(tx.date, 3);
  const groups = await firefly.searchTransactions(`type:transfer date_after:${from} date_before:${to}`, 2_000);
  if (groups.length >= 2_000) throw new Error("Too many transfer matches; review required");
  const matches = groups.flatMap(group => group.attributes.transactions).filter(t =>
    t.type === "transfer" && t.source_id === contribution.sourceId && t.destination_id === contribution.destinationId
    && Number(t.amount) === 850 && t.currency_code === (env.DEFAULT_CURRENCY || "EUR")
    && t.date.slice(0, 10) >= from && t.date.slice(0, 10) <= to
    && t.description === contribution.description && t.tags?.includes("household-contribution"));
  if (matches.length > 1) throw new Error("Multiple contribution transfers already exist; review required");
  if (matches.length === 1) return false;
  await firefly.createTransaction({
    type: "transfer", date: tx.date, amount: 850, description: contribution.description,
    source_account_id: contribution.sourceId, destination_account_id: contribution.destinationId,
    tags: ["bank-import", "household-contribution"],
    notes: [tx.notes, `Statement observation: ${tx.date} | ${tx.description}`].filter(Boolean).join("\n"),
  }, env);
  return true;
}
