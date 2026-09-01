import type { Env } from "../types.js";
import { FireflyClient } from "../tools/firefly.js";
import type {
  BankId,
  ParsedTransaction,
  ImportResult,
  ImportError,
} from "./types.js";
import { detectBank, getBankName } from "./detector.js";
import { parseStatementFile } from "./parsers.js";
import {
  generateImportHash,
  generateLegacyImportHash,
  storeHash,
  createHashData,
  getHashTTLSeconds,
  batchCheckHashes,
} from "./hash.js";
import { resolveImportTarget } from "./accounts.js";

export interface ImportOptions {
  dryRun?: boolean; // If true, don't actually create transactions
  chatId: string; // Telegram chat ID for multi-user support
  targetBank?: BankId; // Explicit account choice for ambiguous exports
}

// Import transactions from a bank statement file
export async function importBankStatement(
  buffer: ArrayBuffer,
  fileName: string,
  env: Env,
  options: ImportOptions
): Promise<ImportResult> {
  const { chatId, dryRun, targetBank } = options;

  // Detect bank
  const detection = detectBank(buffer, fileName);
  if (!detection) {
    throw new Error(
      `Could not detect bank from file "${fileName}". Supported formats: BBVA (.xlsx), CaixaBank (.xls/.csv), ImaginBank (.csv)`
    );
  }

  const { bank } = detection;
  const bankName = getBankName(bank);
  // Parse transactions
  let transactions: ParsedTransaction[];
  try {
    transactions = parseStatementFile(buffer, fileName, bank);
  } catch (error) {
    throw new Error(
      `Failed to parse ${bankName} file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  // Resolve the destination only after parsing succeeds. Ambiguous files can
  // then be held for an explicit Telegram account choice without creating data.
  const target = resolveImportTarget(bank, fileName, env, targetBank);

  if (transactions.length === 0) {
    return {
      bank,
      bankName,
      accountName: target.accountName,
      totalParsed: 0,
      created: 0,
      duplicates: 0,
      errors: [],
    };
  }

  // If dry run, return what would be imported
  if (dryRun) {
    return {
      bank,
      bankName,
      accountName: target.accountName,
      totalParsed: transactions.length,
      created: transactions.length,
      duplicates: 0,
      errors: [],
    };
  }

  const firefly = new FireflyClient(env);
  const errors: ImportError[] = [];
  let created = 0;
  let duplicates = 0;

  // Get hash TTL from environment (default: 1 year)
  const hashTTL = getHashTTLSeconds(env.IMPORT_HASH_TTL_DAYS);

  // DUPLICATE DETECTION: Generate hashes for all transactions
  const transactionHashes: {
    tx: ParsedTransaction;
    hash: string;
    legacyHash?: string;
    index: number;
  }[] = [];
  const allowLegacyHash = bank === target.bank;
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const hash = await generateImportHash(target.accountId, tx.date, tx.amount, tx.description);
    const legacyHash = allowLegacyHash
      ? await generateLegacyImportHash(chatId, bank, tx.date, tx.amount, tx.description)
      : undefined;
    transactionHashes.push({ tx, hash, legacyHash, index: i });
  }

  // Batch check which hashes already exist in KV
  const allHashes = transactionHashes.map((t) => t.hash);
  const existingHashes = await batchCheckHashes(env.IMPORT_HASHES, allHashes);
  const legacyHashes = transactionHashes
    .map(({ legacyHash }) => legacyHash)
    .filter((hash): hash is string => Boolean(hash));
  const existingLegacyHashes = await batchCheckHashes(env.IMPORT_HASHES, legacyHashes);

  // Process transactions
  for (const { tx, hash, legacyHash, index } of transactionHashes) {
    // Check if this transaction was already imported (hash exists in KV)
    if (existingHashes.has(hash) || (legacyHash && existingLegacyHashes.has(legacyHash))) {
      if (!existingHashes.has(hash)) {
        await storeHash(
          env.IMPORT_HASHES,
          hash,
          createHashData(chatId, target.bank, target.accountId, tx.date, tx.amount, tx.description),
          hashTTL,
        );
      }
      duplicates++;
      continue; // Skip - already imported
    }

    try {
      // Determine transaction type based on amount sign
      const isWithdrawal = tx.amount < 0;
      const type = isWithdrawal ? "withdrawal" : "deposit";
      const amount = Math.abs(tx.amount);

      // Create transaction in Firefly
      await firefly.createTransaction(
        {
          type,
          date: tx.date,
          amount,
          description: tx.description,
          notes: tx.notes,
          source_account_id: isWithdrawal ? target.accountId : undefined,
          destination_account_id: !isWithdrawal ? target.accountId : undefined,
          tags: ["bank-import", `import-${target.bank}`],
        },
        env
      );

      // Store hash in KV to prevent future duplicates
      const hashData = createHashData(
        chatId,
        target.bank,
        target.accountId,
        tx.date,
        tx.amount,
        tx.description,
      );
      await storeHash(env.IMPORT_HASHES, hash, hashData, hashTTL);

      created++;
      // Add to local set to prevent duplicates within same file
      existingHashes.add(hash);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      errors.push({
        row: index + 1,
        description: tx.description,
        error: errorMessage,
      });
    }
  }

  if (created > 0 || duplicates > 0) {
    await env.IMPORT_HASHES.put("last-bank-import", new Date().toISOString());
  }

  return {
    bank,
    bankName,
    accountName: target.accountName,
    totalParsed: transactions.length,
    created,
    duplicates,
    errors,
  };
}

// Format import result as a user-friendly message
export function formatImportResult(result: ImportResult, lang: "es" | "en"): string {
  const messages = {
    es: {
      title: `📥 Importación de ${result.bankName} → ${result.accountName}`,
      parsed: `Transacciones encontradas: ${result.totalParsed}`,
      created: `✅ Creadas: ${result.created}`,
      duplicates: `⏭️ Duplicadas (omitidas): ${result.duplicates}`,
      errors: `❌ Errores: ${result.errors.length}`,
      errorDetails: "Detalles de errores:",
      noTransactions: "No se encontraron transacciones en el archivo.",
    },
    en: {
      title: `📥 ${result.bankName} import → ${result.accountName}`,
      parsed: `Transactions found: ${result.totalParsed}`,
      created: `✅ Created: ${result.created}`,
      duplicates: `⏭️ Duplicates (skipped): ${result.duplicates}`,
      errors: `❌ Errors: ${result.errors.length}`,
      errorDetails: "Error details:",
      noTransactions: "No transactions found in the file.",
    },
  };

  const msg = messages[lang] ?? messages.es;

  if (result.totalParsed === 0) {
    return `${msg.title}\n\n${msg.noTransactions}`;
  }

  const lines = [
    msg.title,
    "",
    msg.parsed,
    msg.created,
    msg.duplicates,
  ];

  if (result.errors.length > 0) {
    lines.push(msg.errors);
    lines.push("");
    lines.push(msg.errorDetails);
    // Show first 5 errors max
    const errorsToShow = result.errors.slice(0, 5);
    for (const err of errorsToShow) {
      lines.push(`• Row ${err.row}: ${err.description.substring(0, 30)}... - ${err.error}`);
    }
    if (result.errors.length > 5) {
      lines.push(`... and ${result.errors.length - 5} more errors`);
    }
  }

  return lines.join("\n");
}
