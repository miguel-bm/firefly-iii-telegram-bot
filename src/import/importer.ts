import type { Env } from "../types.js";
import { FireflyClient } from "../tools/firefly.js";
import type {
  BankId,
  ParsedTransaction,
  ImportResult,
  ImportError,
  ContributionMode,
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
import { recordImportFreshness } from "./freshness.js";
import type { DateOrder } from "./parsers/csv-values.js";
import { ValidationError } from "../webapp/validation.js";
import { contributionFor, importContribution, ContributionChoiceError } from "./transfers.js";
import { mortgageConfig } from "./mortgage-plan.js";
import { importMortgage } from "./mortgage.js";
export { formatImportResult } from "./result.js";

export interface ImportOptions {
  dryRun?: boolean; // If true, don't actually create transactions
  chatId: string; // Telegram chat ID for multi-user support
  targetBank?: BankId; // Explicit account choice for ambiguous exports
  dateOrder?: DateOrder;
  contributionChoices?: Record<number, ContributionMode>;
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
    transactions = parseStatementFile(buffer, fileName, bank, options.dateOrder);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new Error(
      `Failed to parse ${bankName} file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  // Resolve the destination only after parsing succeeds. Ambiguous files can
  // then be held for an explicit Telegram account choice without creating data.
  const target = resolveImportTarget(bank, fileName, env, targetBank);
  const mortgage = mortgageConfig(env.MORTGAGE_CONFIG);
  const dates = transactions.map(tx => tx.date).sort();
  const period = { dateFrom: dates[0], dateTo: dates.at(-1) };

  const unconfirmed = target.bank === "imaginbank" ? transactions.findIndex((tx, index) =>
    options.contributionChoices?.[index] === undefined && contributionFor(tx, target, env)) : -1;
  if (unconfirmed !== -1) {
    throw new ContributionChoiceError(unconfirmed, transactions[unconfirmed].date);
  }

  if (transactions.length === 0) {
    if (!dryRun) await recordImportFreshness(env.IMPORT_HASHES, target, transactions);
    return {
      bank,
      bankName,
      accountName: target.accountName,
      ...period,
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
      ...period,
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
  for (const { tx, hash, legacyHash, index } of transactionHashes.sort((a, b) => a.tx.date.localeCompare(b.tx.date))) {
    const contribution = options.contributionChoices?.[index] === "regular" ? null : contributionFor(tx, target, env);
    const isMortgage = mortgage && target.accountId === mortgage.sourceId && tx.description === mortgage.statementDescription;
    const futureMortgage = isMortgage && tx.date > mortgage.anchorDate;
    // Check if this transaction was already imported (hash exists in KV)
    // Contributions must also check Firefly: older rules may have deleted the only side.
    if (!contribution && !futureMortgage && (existingHashes.has(hash) || (legacyHash && existingLegacyHashes.has(legacyHash)))) {
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
      if (isMortgage) {
        const added = await importMortgage(tx, mortgage, firefly);
        if (added) created++; else duplicates++;
        await storeHash(env.IMPORT_HASHES, hash,
          createHashData(chatId, target.bank, target.accountId, tx.date, tx.amount, tx.description), hashTTL);
        existingHashes.add(hash);
        continue;
      }
      if (contribution) {
        const added = await importContribution(tx, contribution, firefly, env);
        if (added) created++; else duplicates++;
        await storeHash(env.IMPORT_HASHES, hash,
          createHashData(chatId, target.bank, target.accountId, tx.date, tx.amount, tx.description), hashTTL);
        existingHashes.add(hash);
        continue;
      }
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

  if (errors.length === 0) {
    await recordImportFreshness(env.IMPORT_HASHES, target, transactions);
  }

  return {
    bank,
    bankName,
    accountName: target.accountName,
    ...period,
    totalParsed: transactions.length,
    created,
    duplicates,
    errors,
  };
}
