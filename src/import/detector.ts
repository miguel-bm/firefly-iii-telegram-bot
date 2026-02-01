import * as XLSX from "xlsx";
import type { BankId, DetectionResult } from "./types.js";

// Detect bank from file content
export function detectBank(
  buffer: ArrayBuffer,
  fileName: string
): DetectionResult | null {
  const ext = fileName.toLowerCase().split(".").pop();

  // CSV files - check content for ImaginBank
  if (ext === "csv") {
    const decoder = new TextDecoder("utf-8");
    const content = decoder.decode(buffer);
    const firstLines = content.split(/\r?\n/).slice(0, 5).join("\n");

    // ImaginBank: First line contains "IBAN;Saldo" or similar pattern
    if (firstLines.includes("IBAN;") || firstLines.includes("CaixaBank")) {
      return { bank: "imaginbank", confidence: "high" };
    }

    // Check for semicolon-delimited with Concepto;Fecha pattern
    if (firstLines.includes("Concepto;Fecha")) {
      return { bank: "imaginbank", confidence: "high" };
    }

    // Could be CaixaBank exported as CSV
    if (firstLines.includes("Fecha,Fecha valor,Movimiento")) {
      return { bank: "caixabank", confidence: "high" };
    }

    // Could be BBVA exported as CSV
    if (firstLines.includes("F.Valor,Fecha,Concepto")) {
      return { bank: "bbva", confidence: "high" };
    }

    return null;
  }

  // Excel files - parse and check content
  if (ext === "xlsx" || ext === "xls") {
    try {
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Convert first 10 rows to check content
      const data = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
        header: 1,
        defval: "",
        range: "A1:J10",
      });

      // Check sheet name and content
      const flatContent = data.flat().map((v) => String(v)).join(" ");

      // BBVA: Sheet name "Informe BBVA" or contains "Últimos movimientos"
      if (
        sheetName.includes("Informe BBVA") ||
        flatContent.includes("Últimos movimientos") ||
        flatContent.includes("F.Valor")
      ) {
        return { bank: "bbva", confidence: "high" };
      }

      // CaixaBank: Sheet name starts with "Movimientos_cuenta" or content pattern
      if (
        sheetName.startsWith("Movimientos_cuenta") ||
        flatContent.includes("Movimientos de la cuenta") ||
        (flatContent.includes("Fecha valor") && flatContent.includes("Movimiento"))
      ) {
        return { bank: "caixabank", confidence: "high" };
      }

      // Fallback: check filename patterns
      const lowerFileName = fileName.toLowerCase();
      if (lowerFileName.includes("movimientos") && lowerFileName.includes("bbva")) {
        return { bank: "bbva", confidence: "medium" };
      }
      if (lowerFileName.includes("movimientos_cuenta")) {
        return { bank: "caixabank", confidence: "medium" };
      }
    } catch (error) {
      console.error("Error detecting bank from Excel:", error);
    }
  }

  // Filename-based detection as fallback
  const lowerFileName = fileName.toLowerCase();

  if (
    lowerFileName.includes("últimos movimientos") ||
    lowerFileName.includes("ultimos movimientos") ||
    (lowerFileName.includes("bbva") && lowerFileName.includes("movimiento"))
  ) {
    return { bank: "bbva", confidence: "medium" };
  }

  if (lowerFileName.includes("movimientos_cuenta")) {
    return { bank: "caixabank", confidence: "medium" };
  }

  if (
    lowerFileName.includes("caixabank") ||
    lowerFileName.includes("imaginbank") ||
    lowerFileName.includes("caixabanknow")
  ) {
    return { bank: "imaginbank", confidence: "medium" };
  }

  return null;
}

// Get bank display name
export function getBankName(bankId: BankId): string {
  const names: Record<BankId, string> = {
    bbva: "BBVA",
    caixabank: "CaixaBank",
    imaginbank: "ImaginBank",
  };
  return names[bankId];
}
