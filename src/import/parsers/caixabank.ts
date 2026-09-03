import * as XLSX from "xlsx";
import type { ParsedTransaction } from "../types.js";
import { excelDateToYMD, parseDateDMY } from "./common.js";
import { csvAmount, csvDate, inferDateOrder, type DateOrder } from "./csv-values.js";
import { ValidationError } from "../../webapp/validation.js";

export function parseCaixaBank(buffer: ArrayBuffer, csv = false, dateOrder?: DateOrder): ParsedTransaction[] {
  // Never allow SheetJS to guess dates or numbers in CSVs. Exports can use either locale.
  const workbook = csv
    ? XLSX.read(new TextDecoder().decode(buffer), { type: "string", raw: true, sheetRows: 1001 })
    : XLSX.read(buffer, { type: "array", sheetRows: 1001 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1, defval: "", range: "A1:J1001",
  });
  const transactions: ParsedTransaction[] = [];
  let headerRowIndex = -1;
  for (let index = 0; index < Math.min(data.length, 10); index++) {
    const row = data[index];
    if (row && String(row[0]) === "Fecha" && String(row[2]) === "Movimiento") {
      headerRowIndex = index;
      break;
    }
  }
  if (headerRowIndex === -1) throw new Error("Could not find CaixaBank header row");

  const rows = data.slice(headerRowIndex + 1).filter(row => row.some(value => value !== ""));
  const order = csv ? inferDateOrder(rows.map(row => String(row[0])), dateOrder) : undefined;

  for (const row of rows) {
    let date: string;
    if (order) {
      date = csvDate(String(row[0]), order);
    } else if (typeof row[0] === "number") {
      date = excelDateToYMD(row[0]);
    } else {
      date = parseDateDMY(String(row[0]));
    }
    const amount = typeof row[4] === "number" ? row[4] : csvAmount(String(row[4]));
    if (!Number.isFinite(amount) || !row[2]) throw new ValidationError("Invalid statement row. Nothing was imported.");
    const notes = String(row[3] || "");
    transactions.push({
      date,
      description: String(row[2]),
      amount,
      notes: notes || undefined,
    });
  }
  return transactions;
}
