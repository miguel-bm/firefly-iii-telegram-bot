import * as XLSX from "xlsx";
import type { BankId, ParsedTransaction } from "./types.js";

// Parse DD/MM/YYYY to YYYY-MM-DD
function parseDateDMY(dateStr: string): string {
  const [day, month, year] = dateStr.split("/");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// Convert Excel serial date to YYYY-MM-DD
function excelDateToYMD(serial: number): string {
  // Excel dates are days since 1900-01-01 (with a bug for 1900 leap year)
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Parse European number format: "1.234,56" or "-41,04EUR" -> number
function parseEuropeanAmount(value: string): number {
  // Remove currency suffix
  let cleaned = value.replace(/EUR$/i, "").trim();
  // Remove thousand separators (dots) and convert decimal comma to dot
  cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned);
}

// BBVA Parser
// Excel format: Sheet "Informe BBVA", data starts at row 5 (headers), row 6+ data
// Columns B-J: F.Valor, Fecha, Concepto, Movimiento, Importe, Divisa, Disponible, Divisa, Observaciones
export function parseBBVA(buffer: ArrayBuffer): ParsedTransaction[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // Convert to array of arrays, starting from row 1
  const data = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: "",
    range: "B1:J1000" // Read from column B
  });

  const transactions: ParsedTransaction[] = [];

  // Find header row (contains "F.Valor")
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    const row = data[i];
    if (row && String(row[0]).includes("F.Valor")) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error("Could not find BBVA header row");
  }

  // Parse data rows (after header)
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue; // Skip empty rows

    // Columns: 0=F.Valor, 1=Fecha, 2=Concepto, 3=Movimiento, 4=Importe, 5=Divisa, 6=Disponible, 7=Divisa, 8=Observaciones
    const dateStr = String(row[0]); // F.Valor (transaction date)
    const concepto = String(row[2]); // Concepto (description)
    const movimiento = String(row[3]); // Movimiento (type note)
    const importe = row[4]; // Importe (amount)
    const observaciones = String(row[8] || ""); // Observaciones (notes)

    // Parse date (DD/MM/YYYY format)
    let date: string;
    try {
      date = parseDateDMY(dateStr);
    } catch {
      continue; // Skip rows with invalid dates
    }

    // Parse amount
    const amount = typeof importe === "number" ? importe : parseFloat(String(importe));
    if (isNaN(amount)) continue;

    // Build description and notes
    const description = concepto;
    const notes = [movimiento, observaciones].filter(Boolean).join(" - ");

    transactions.push({
      date,
      description,
      amount,
      notes: notes || undefined,
    });
  }

  return transactions;
}

// CaixaBank Parser
// Excel format: Sheet name dynamic, data starts at row 3 (headers), row 4+ data
// Columns A-F: Fecha, Fecha valor, Movimiento, Más datos, Importe, Saldo
// Dates are Excel serial numbers!
export function parseCaixaBank(buffer: ArrayBuffer): ParsedTransaction[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const data = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: "",
  });

  const transactions: ParsedTransaction[] = [];

  // Find header row (contains "Fecha" and "Movimiento")
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    const row = data[i];
    if (row && String(row[0]) === "Fecha" && String(row[2]) === "Movimiento") {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error("Could not find CaixaBank header row");
  }

  // Parse data rows
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    // Columns: 0=Fecha, 1=Fecha valor, 2=Movimiento, 3=Más datos, 4=Importe, 5=Saldo
    const fechaRaw = row[0];
    const movimiento = String(row[2]); // Description
    const masDatos = String(row[3] || ""); // Additional notes
    const importe = row[4];

    // Parse date (Excel serial number)
    let date: string;
    if (typeof fechaRaw === "number") {
      date = excelDateToYMD(fechaRaw);
    } else {
      // Try DD/MM/YYYY format as fallback
      try {
        date = parseDateDMY(String(fechaRaw));
      } catch {
        continue;
      }
    }

    // Parse amount
    const amount = typeof importe === "number" ? importe : parseFloat(String(importe));
    if (isNaN(amount)) continue;

    transactions.push({
      date,
      description: movimiento,
      amount,
      notes: masDatos || undefined,
    });
  }

  return transactions;
}

// Parse ImaginBank amount - handles both formats:
// - New format: "5.0", "-150.48" (standard decimal, no EUR)
// - Old format: "-41,04EUR" (European format with EUR suffix)
function parseImaginBankAmount(value: string): number {
  const trimmed = value.trim();

  // Check if it has EUR suffix (old format with European decimal)
  if (trimmed.toUpperCase().endsWith("EUR")) {
    return parseEuropeanAmount(trimmed);
  }

  // New format - standard decimal notation
  return parseFloat(trimmed);
}

// ImaginBank Parser
// CSV format: semicolon delimiter, first 2 rows metadata, row 3 headers, row 4+ data
// Columns: Concepto, Fecha, Importe, Saldo disponible
// Amounts can be in two formats:
// - New: "5.0", "-150.48" (standard decimal)
// - Old: "-41,04EUR" (European format with EUR suffix)
export function parseImaginBank(content: string): ParsedTransaction[] {
  const lines = content.split(/\r?\n/);
  const transactions: ParsedTransaction[] = [];

  // Find header row (contains "Concepto;Fecha")
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].startsWith("Concepto;Fecha")) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error("Could not find ImaginBank header row");
  }

  // Parse data rows
  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(";")) continue; // Skip empty lines

    const parts = line.split(";");
    if (parts.length < 3) continue;

    // Columns: 0=Concepto, 1=Fecha, 2=Importe, 3=Saldo disponible
    const concepto = parts[0];
    const fechaStr = parts[1]; // DD/MM/YYYY
    const importeStr = parts[2];

    if (!concepto || !fechaStr || !importeStr) continue;

    // Parse date
    let date: string;
    try {
      date = parseDateDMY(fechaStr);
    } catch {
      continue;
    }

    // Parse amount (handles both new and old formats)
    const amount = parseImaginBankAmount(importeStr);
    if (isNaN(amount)) continue;

    transactions.push({
      date,
      description: concepto,
      amount,
    });
  }

  return transactions;
}

// Main parser function - detects bank and parses accordingly
export function parseStatementFile(
  buffer: ArrayBuffer,
  fileName: string,
  detectedBank: BankId
): ParsedTransaction[] {
  const ext = fileName.toLowerCase().split(".").pop();

  if (detectedBank === "imaginbank") {
    // ImaginBank is always CSV
    const decoder = new TextDecoder("utf-8");
    const content = decoder.decode(buffer);
    return parseImaginBank(content);
  }

  if (detectedBank === "bbva") {
    return parseBBVA(buffer);
  }

  if (detectedBank === "caixabank") {
    return parseCaixaBank(buffer);
  }

  throw new Error(`Unknown bank: ${detectedBank}`);
}
