import type { Env } from "../types.js";
import { importBankStatement, type ImportOptions } from "./importer.js";
import { readResponseWithLimit } from "./file.js";
import { PENDING_IMPORT_TTL_SECONDS, type PendingImport } from "./pending.js";

interface PendingRecord { pending: PendingImport; expiresAt: number }

// All household accounts share one queue: a source and destination upload cannot race.
export class BankImportDO implements DurableObject {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  fetch(request: Request): Promise<Response> {
    const result = this.queue.then(() => this.import(request));
    this.queue = result.catch(() => undefined);
    return result;
  }

  alarm(): Promise<void> {
    const result = this.queue.then(async () => {
      const records = await this.state.storage.list<PendingRecord>({ prefix: "pending-import:" });
      const expired: string[] = [];
      let next = Infinity;
      for (const [key, record] of records) {
        if (record.expiresAt <= Date.now()) expired.push(key);
        else next = Math.min(next, record.expiresAt);
      }
      for (let offset = 0; offset < expired.length; offset += 128) {
        await this.state.storage.delete(expired.slice(offset, offset + 128));
      }
      if (Number.isFinite(next)) await this.state.storage.setAlarm(next);
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async import(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/pending-import:")) return await this.pending(request, path.slice(1));
      const options = JSON.parse(request.headers.get("X-Import-Options") ?? "{}") as ImportOptions & { fileName: string };
      const buffer = await readResponseWithLimit(new Response(request.body), Number(this.env.MAX_IMPORT_FILE_BYTES));
      // Durable storage provides read-after-write consistency; KV remains the legacy lookup.
      const kv = {
        get: async (key: string, type?: string) => {
          const saved = await this.state.storage.get<string>(key);
          const value = saved ?? await this.env.IMPORT_HASHES.get(key);
          if (saved === undefined && value !== null && key.startsWith("import-hash:")) {
            await this.state.storage.put(key, value);
          }
          return value === null ? null : type === "json" ? JSON.parse(value) : value;
        },
        put: async (key: string, value: string, options?: KVNamespacePutOptions) => {
          await this.state.storage.put(key, value);
          await this.env.IMPORT_HASHES.put(key, value, options);
        },
        delete: async (key: string) => {
          await this.state.storage.delete(key);
          await this.env.IMPORT_HASHES.delete(key);
        },
      } as unknown as KVNamespace;
      const result = await importBankStatement(buffer, decodeURIComponent(options.fileName),
        { ...this.env, IMPORT_HASHES: kv }, options);
      return Response.json(result);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Import failed" }, { status: 400 });
    }
  }

  private async pending(request: Request, key: string): Promise<Response> {
    if (request.method === "PUT") {
      const expiresAt = Date.now() + PENDING_IMPORT_TTL_SECONDS * 1_000;
      await this.state.storage.put(key, {
        pending: await request.json(), expiresAt,
      });
      const alarm = await this.state.storage.getAlarm();
      if (alarm === null || expiresAt < alarm) await this.state.storage.setAlarm(expiresAt);
      return new Response(null, { status: 204 });
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const saved = await this.state.storage.get<PendingRecord>(key);
    if (!saved || saved.expiresAt <= Date.now()) {
      if (saved) await this.state.storage.delete(key);
      return new Response(null, { status: 404 });
    }
    const owner = await request.json() as { chatId?: string; userId?: string };
    if (saved.pending.chatId !== owner.chatId || saved.pending.userId !== owner.userId) {
      return new Response(null, { status: 403 });
    }
    await this.state.storage.delete(key);
    return Response.json(saved.pending);
  }
}
