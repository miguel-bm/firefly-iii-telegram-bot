import type { Env } from "../types.js";
import { importBankStatement, type ImportOptions } from "./importer.js";
import type { ImportResult } from "./types.js";
import { ValidationError } from "../webapp/validation.js";

export async function runBankImport(
  buffer: ArrayBuffer, fileName: string, env: Env, options: ImportOptions,
): Promise<ImportResult> {
  // Preflight preserves typed account/date errors for Telegram's choice buttons.
  const preview = await importBankStatement(buffer, fileName, env, { ...options, dryRun: true });
  if (options.dryRun) return preview;
  const stub = env.BANK_IMPORTS.get(env.BANK_IMPORTS.idFromName("household"));
  const response = await stub.fetch(new Request("http://imports/import", {
    method: "POST", body: buffer,
    headers: { "X-Import-Options": JSON.stringify({ ...options, fileName: encodeURIComponent(fileName) }) },
  }));
  const data = await response.json() as ImportResult & { error?: string };
  if (!response.ok) throw new ValidationError(data.error ?? "Import failed");
  return data;
}
