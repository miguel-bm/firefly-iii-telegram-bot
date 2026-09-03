import { ValidationError } from "../../webapp/validation.js";
import { parseDateDMY } from "./common.js";

export type DateOrder = "dmy" | "mdy";

export class StatementDateError extends ValidationError {
  constructor(readonly ambiguous = false) {
    super(ambiguous
      ? "Choose the CSV date format before importing."
      : "The statement contains invalid or conflicting dates. Nothing was imported.");
  }
}

function parts(value: string): number[] {
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value.trim())) throw new StatementDateError();
  return value.trim().split("/").map(Number);
}

export function csvDate(value: string, order: DateOrder): string {
  const [a, b, year] = parts(value);
  try {
    return parseDateDMY(order === "dmy" ? `${a}/${b}/${year}` : `${b}/${a}/${year}`);
  } catch {
    throw new StatementDateError();
  }
}

export function inferDateOrder(values: string[], selected?: DateOrder): DateOrder {
  const candidates = (["dmy", "mdy"] as const).filter(order => values.every(value => {
    try { csvDate(value, order); return true; } catch { return false; }
  }));
  if (selected) {
    if (!candidates.includes(selected)) throw new StatementDateError();
    return selected;
  }
  if (candidates.length === 0) throw new StatementDateError();
  if (candidates.length === 1) return candidates[0];
  if (values.every(value => { const [a, b] = parts(value); return a === b; })) return "dmy";
  throw new StatementDateError(true);
}

export function csvAmount(value: string): number {
  const text = value.trim();
  let normalized: string;
  if (/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) {
    normalized = text.replaceAll(",", "");
  } else if (/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(text)) {
    normalized = text.replaceAll(".", "").replace(",", ".");
  } else {
    throw new ValidationError("Invalid statement amount. Nothing was imported.");
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) throw new ValidationError("Invalid statement amount.");
  return amount;
}
