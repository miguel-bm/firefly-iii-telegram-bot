import * as XLSX from "xlsx";
import type { ParsedTransaction } from "../types.js";
import { parseDateDMY, parseEuropeanAmount } from "./common.js";

export function parseBBVA(buffer: ArrayBuffer): ParsedTransaction[] {
  const workbook = XLSX.read(buffer, { type: "array", sheetRows: 1001 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1, defval: "", range: "B1:J1000",
  });
  const transactions: ParsedTransaction[] = [];
  let headerRowIndex = -1;
  for (let index = 0; index < Math.min(data.length, 10); index++) {
    if (data[index] && String(data[index][0]).includes("F.Valor")) {
      headerRowIndex = index;
      break;
    }
  }
  if (headerRowIndex === -1) throw new Error("Could not find BBVA header row");

  for (let index = headerRowIndex + 1; index < data.length; index++) {
    const row = data[index];
    if (!row || !row[0]) continue;
    let date: string;
    try { date = parseDateDMY(String(row[0])); } catch { continue; }
    const amount = typeof row[4] === "number" ? row[4] : parseEuropeanAmount(String(row[4]));
    if (Number.isNaN(amount)) continue;
    const notes = [String(row[3]), String(row[8] || "")].filter(Boolean).join(" - ");
    transactions.push({
      date,
      description: String(row[2]),
      amount,
      notes: notes || undefined,
    });
  }
  return transactions;
}
