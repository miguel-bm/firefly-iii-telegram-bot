import type { BankId } from "./types.js";

export const PENDING_IMPORT_TTL_SECONDS = 15 * 60;
const KEY_PREFIX = "pending-import:";
const CALLBACK_PREFIX = "bank-import";

export interface PendingImport {
  fileId: string;
  fileName: string;
  chatId: string;
  userId: string;
}

export type PendingImportAction = BankId | "cancel";

function key(token: string): string {
  return `${KEY_PREFIX}${token}`;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function savePendingImport(kv: KVNamespace, pending: PendingImport): Promise<string> {
  const token = newToken();
  await kv.put(key(token), JSON.stringify(pending), { expirationTtl: PENDING_IMPORT_TTL_SECONDS });
  return token;
}

export async function consumePendingImport(
  kv: KVNamespace,
  token: string,
): Promise<PendingImport | null> {
  const pending = await kv.get<PendingImport>(key(token), "json");
  if (!pending) return null;
  await kv.delete(key(token));
  return pending;
}

export async function getPendingImport(kv: KVNamespace, token: string): Promise<PendingImport | null> {
  return kv.get<PendingImport>(key(token), "json");
}

export function importCallbackData(token: string, action: PendingImportAction): string {
  return `${CALLBACK_PREFIX}:${token}:${action}`;
}

export function ownsPendingImport(pending: PendingImport, chatId: string, userId: string): boolean {
  return pending.chatId === chatId && pending.userId === userId;
}

export function parseImportCallback(data: string): { token: string; action: PendingImportAction } | null {
  const match = data.match(/^bank-import:([a-f0-9]{24}):(bbva|caixabank|imaginbank|cancel)$/);
  if (!match) return null;
  return { token: match[1], action: match[2] as PendingImportAction };
}
