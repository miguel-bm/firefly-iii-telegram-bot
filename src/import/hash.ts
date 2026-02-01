/**
 * Hash-based duplicate detection for bank statement imports.
 *
 * Stores SHA-256 hashes of original transaction data in Cloudflare KV.
 * Survives Firefly edits/automations because we check original data, not current state.
 */

// Hash storage metadata (stored as JSON value in KV)
export interface ImportHashData {
  chatId: string;
  bankId: string;
  date: string;
  amount: number;
  description: string;
  importedAt: string; // ISO timestamp
}

// Normalize description for consistent hashing
// - Lowercase
// - Remove non-alphanumeric characters (keep spaces)
// - Collapse multiple spaces
// - Trim and limit to 50 chars
function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 50);
}

// Normalize amount for consistent hashing
// - Absolute value (sign is handled separately)
// - 2 decimal places
function normalizeAmount(amount: number): string {
  return Math.abs(amount).toFixed(2);
}

// Create a unique signature string for hashing
function createSignature(
  chatId: string,
  bankId: string,
  date: string,
  amount: number,
  description: string
): string {
  const normalizedDesc = normalizeDescription(description);
  const normalizedAmount = normalizeAmount(amount);

  // Format: chatId|bankId|date|amount|description
  return `${chatId}|${bankId}|${date}|${normalizedAmount}|${normalizedDesc}`;
}

// Generate SHA-256 hash of the signature
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Generate import hash for a transaction
export async function generateImportHash(
  chatId: string,
  bankId: string,
  date: string,
  amount: number,
  description: string
): Promise<string> {
  const signature = createSignature(chatId, bankId, date, amount, description);
  return sha256(signature);
}

// KV key format
function getKVKey(hash: string): string {
  return `import-hash:${hash}`;
}

// Default TTL: 1 year in seconds
const DEFAULT_HASH_TTL_SECONDS = 365 * 24 * 60 * 60;

// Parse TTL from environment variable (in days)
export function getHashTTLSeconds(envValue?: string): number {
  if (!envValue) return DEFAULT_HASH_TTL_SECONDS;

  const days = parseInt(envValue, 10);
  if (isNaN(days) || days <= 0) return DEFAULT_HASH_TTL_SECONDS;

  return days * 24 * 60 * 60;
}

// Check if a transaction hash exists in KV
export async function hashExists(
  kv: KVNamespace,
  hash: string
): Promise<boolean> {
  const key = getKVKey(hash);
  const value = await kv.get(key);
  return value !== null;
}

// Store a transaction hash in KV
export async function storeHash(
  kv: KVNamespace,
  hash: string,
  data: ImportHashData,
  ttlSeconds: number
): Promise<void> {
  const key = getKVKey(hash);
  await kv.put(key, JSON.stringify(data), {
    expirationTtl: ttlSeconds,
  });
}

// Batch check multiple hashes (more efficient for large imports)
export async function batchCheckHashes(
  kv: KVNamespace,
  hashes: string[]
): Promise<Set<string>> {
  // KV doesn't have native batch get, so we parallelize individual gets
  // For very large batches, consider chunking
  const existingHashes = new Set<string>();

  const results = await Promise.all(
    hashes.map(async (hash) => {
      const exists = await hashExists(kv, hash);
      return { hash, exists };
    })
  );

  for (const { hash, exists } of results) {
    if (exists) {
      existingHashes.add(hash);
    }
  }

  return existingHashes;
}

// Helper to create hash data object
export function createHashData(
  chatId: string,
  bankId: string,
  date: string,
  amount: number,
  description: string
): ImportHashData {
  return {
    chatId,
    bankId,
    date,
    amount,
    description,
    importedAt: new Date().toISOString(),
  };
}
