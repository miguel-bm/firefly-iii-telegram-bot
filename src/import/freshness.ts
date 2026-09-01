import type { ImportTarget } from "./accounts.js";
import type { BankId, ParsedTransaction } from "./types.js";

const FRESHNESS_PREFIX = "import-freshness:v1:";
const REMINDER_PREFIX = "import-reminder:last-sent:";

export interface ImportFreshness {
  bank: BankId;
  accountId: string;
  uploadedAt: string;
  latestTransactionDate: string | null;
  totalParsed: number;
}

function freshnessKey(bank: BankId): string {
  return `${FRESHNESS_PREFIX}${bank}`;
}

function reminderKey(bank: BankId): string {
  return `${REMINDER_PREFIX}${bank}`;
}

export async function saveImportFreshness(
  kv: KVNamespace,
  freshness: ImportFreshness,
  updateLegacyTimestamp = true,
): Promise<void> {
  const operations: Promise<unknown>[] = [
    kv.put(freshnessKey(freshness.bank), JSON.stringify(freshness)),
    kv.delete(reminderKey(freshness.bank)),
  ];
  if (updateLegacyTimestamp) operations.push(kv.put("last-bank-import", freshness.uploadedAt));
  await Promise.all(operations);
}

export async function recordImportFreshness(
  kv: KVNamespace,
  target: ImportTarget,
  transactions: ParsedTransaction[],
  now = new Date(),
): Promise<void> {
  const latestTransactionDate = transactions
    .map(({ date }) => date)
    .sort()
    .at(-1) ?? null;

  await saveImportFreshness(kv, {
    bank: target.bank,
    accountId: target.accountId,
    uploadedAt: now.toISOString(),
    latestTransactionDate,
    totalParsed: transactions.length,
  });
}

export async function getImportFreshness(
  kv: KVNamespace,
  target: ImportTarget,
): Promise<ImportFreshness | null> {
  const value = await kv.get<ImportFreshness>(freshnessKey(target.bank), "json");
  return value?.accountId === target.accountId ? value : null;
}

export function isImportFresh(
  freshness: ImportFreshness | null,
  maxAgeDays: number,
  now = new Date(),
): boolean {
  if (!freshness) return false;
  const uploadedAt = new Date(freshness.uploadedAt).getTime();
  if (!Number.isFinite(uploadedAt)) return false;
  return now.getTime() - uploadedAt < maxAgeDays * 86_400_000;
}

export async function wasReminderSentRecently(
  kv: KVNamespace,
  bank: BankId,
  repeatDays: number,
  now = new Date(),
): Promise<boolean> {
  const value = await kv.get(reminderKey(bank));
  if (!value) return false;
  const sentAt = new Date(value).getTime();
  return Number.isFinite(sentAt) && now.getTime() - sentAt < repeatDays * 86_400_000;
}

export async function recordReminderSent(
  kv: KVNamespace,
  banks: BankId[],
  now = new Date(),
): Promise<void> {
  await Promise.all(banks.map((bank) => kv.put(reminderKey(bank), now.toISOString())));
}
