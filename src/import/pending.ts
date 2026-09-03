import type { BankId, ContributionMode } from "./types.js";
import type { DateOrder } from "./parsers/csv-values.js";

export const PENDING_IMPORT_TTL_SECONDS = 15 * 60;
const KEY_PREFIX = "pending-import:";
const CALLBACK_PREFIX = "bank-import";

export interface PendingImport {
  fileId: string;
  fileName: string;
  chatId: string;
  userId: string;
  targetBank?: BankId;
  dateOrder?: DateOrder;
  contributionIndex?: number;
  contributionChoices?: Record<number, ContributionMode>;
}

export type PendingImportAction = BankId | DateOrder | ContributionMode | "cancel";

export function applyImportChoice(pending: PendingImport, action: Exclude<PendingImportAction, "cancel">): PendingImport {
  if (action === "household" || action === "regular") {
    if (pending.contributionIndex === undefined) throw new Error("No contribution awaiting confirmation");
    return { ...pending, contributionIndex: undefined,
      contributionChoices: { ...pending.contributionChoices, [pending.contributionIndex]: action } };
  }
  return { ...pending, ...(action === "dmy" || action === "mdy" ? { dateOrder: action } : { targetBank: action }) };
}

interface ImportCoordinatorNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

function key(token: string): string {
  return `${KEY_PREFIX}${token}`;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function savePendingImport(
  imports: ImportCoordinatorNamespace, pending: PendingImport,
): Promise<string> {
  const token = newToken();
  const response = await imports.get(imports.idFromName("household")).fetch(new Request(`http://imports/${key(token)}`, {
    method: "PUT", body: JSON.stringify(pending),
  }));
  if (!response.ok) throw new Error("Could not save pending import");
  return token;
}

export function importCallbackData(token: string, action: PendingImportAction): string {
  return `${CALLBACK_PREFIX}:${token}:${action}`;
}

export async function claimPendingImport(
  imports: ImportCoordinatorNamespace, token: string, chatId: string, userId: string,
): Promise<{ pending?: PendingImport; forbidden?: true }> {
  const response = await imports.get(imports.idFromName("household")).fetch(new Request(`http://imports/${key(token)}`, {
    method: "POST", body: JSON.stringify({ chatId, userId }),
  }));
  if (response.status === 404) return {};
  if (response.status === 403) return { forbidden: true };
  if (!response.ok) throw new Error("Could not claim pending import");
  return { pending: await response.json() as PendingImport };
}

export function parseImportCallback(data: string): { token: string; action: PendingImportAction } | null {
  const match = data.match(/^bank-import:([a-f0-9]{24}):(bbva|caixabank|imaginbank|dmy|mdy|household|regular|cancel)$/);
  if (!match) return null;
  return { token: match[1], action: match[2] as PendingImportAction };
}
