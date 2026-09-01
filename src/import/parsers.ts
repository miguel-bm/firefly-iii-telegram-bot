import type { BankId, ParsedTransaction } from "./types.js";
import { parseBBVA } from "./parsers/bbva.js";
import { parseCaixaBank } from "./parsers/caixabank.js";
import { parseImaginBank } from "./parsers/imaginbank.js";

export { parseBBVA, parseCaixaBank, parseImaginBank };

export function parseStatementFile(
  buffer: ArrayBuffer,
  _fileName: string,
  detectedBank: BankId,
): ParsedTransaction[] {
  if (detectedBank === "imaginbank") {
    return parseImaginBank(new TextDecoder("utf-8").decode(buffer));
  }
  if (detectedBank === "bbva") return parseBBVA(buffer);
  if (detectedBank === "caixabank") return parseCaixaBank(buffer);
  throw new Error(`Unknown bank: ${detectedBank}`);
}
