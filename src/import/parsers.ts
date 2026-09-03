import type { BankId, ParsedTransaction } from "./types.js";
import { parseBBVA } from "./parsers/bbva.js";
import { parseCaixaBank } from "./parsers/caixabank.js";
import { parseImaginBank } from "./parsers/imaginbank.js";
import type { DateOrder } from "./parsers/csv-values.js";

export { parseBBVA, parseCaixaBank, parseImaginBank };

export function parseStatementFile(
  buffer: ArrayBuffer,
  fileName: string,
  detectedBank: BankId,
  dateOrder?: DateOrder,
): ParsedTransaction[] {
  if (detectedBank === "imaginbank") {
    return parseImaginBank(new TextDecoder("utf-8").decode(buffer));
  }
  if (detectedBank === "bbva") return parseBBVA(buffer);
  if (detectedBank === "caixabank") return parseCaixaBank(buffer, fileName.toLowerCase().endsWith(".csv"), dateOrder);
  throw new Error(`Unknown bank: ${detectedBank}`);
}
