import type { ParsedTransaction } from "../types.js";
import { parseDateDMY, parseDelimitedLine, parseEuropeanAmount } from "./common.js";

function parseImaginBankAmount(value: string): number {
  const trimmed = value.trim();
  return trimmed.toUpperCase().endsWith("EUR") ? parseEuropeanAmount(trimmed) : parseFloat(trimmed);
}

export function parseImaginBank(content: string): ParsedTransaction[] {
  const lines = content.split(/\r?\n/).slice(0, 1001);
  const transactions: ParsedTransaction[] = [];
  let headerRowIndex = -1;
  for (let index = 0; index < Math.min(lines.length, 10); index++) {
    if (lines[index].startsWith("Concepto;Fecha")) {
      headerRowIndex = index;
      break;
    }
  }
  if (headerRowIndex === -1) throw new Error("Could not find ImaginBank header row");

  for (let index = headerRowIndex + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith(";")) continue;
    const [description, rawDate, rawAmount] = parseDelimitedLine(line);
    if (!description || !rawDate || !rawAmount) continue;
    let date: string;
    try { date = parseDateDMY(rawDate); } catch { continue; }
    const amount = parseImaginBankAmount(rawAmount);
    if (Number.isNaN(amount)) continue;
    transactions.push({ date, description, amount });
  }
  return transactions;
}
