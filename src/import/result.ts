import type { ImportResult } from "./types.js";

export function formatImportResult(result: ImportResult, lang: "es" | "en"): string {
  const spanish = lang === "es";
  const title = spanish ? `📥 Importación de ${result.bankName}` : `📥 ${result.bankName} import`;
  const lines = [`${title} → ${result.accountName}`];
  if (!result.totalParsed) {
    return `${lines[0]}\n\n${spanish ? "No se encontraron transacciones en el archivo." : "No transactions found in the file."}`;
  }
  if (result.dateFrom && result.dateTo) lines.push(`${result.dateFrom} → ${result.dateTo}`);
  lines.push("",
    `${spanish ? "Transacciones encontradas" : "Transactions found"}: ${result.totalParsed}`,
    `✅ ${spanish ? "Creadas" : "Created"}: ${result.created}`,
    `⏭️ ${spanish ? "Duplicadas (omitidas)" : "Duplicates (skipped)"}: ${result.duplicates}`,
  );
  if (result.errors.length) {
    lines.push(`❌ ${spanish ? "Errores" : "Errors"}: ${result.errors.length}`);
    for (const error of result.errors.slice(0, 5)) {
      lines.push(`• ${error.row}: ${error.description.slice(0, 30)} — ${error.error}`);
    }
    if (result.errors.length > 5) lines.push(`… +${result.errors.length - 5}`);
  }
  return lines.join("\n");
}
