import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../types.js";
import { BankImportDO } from "./coordinator.js";
import { importBankStatement } from "./importer.js";
import { claimPendingImport, savePendingImport, PENDING_IMPORT_TTL_SECONDS } from "./pending.js";

vi.mock("./importer.js", () => ({ importBankStatement: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

function setup() {
  const saved = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    get: async (key: string) => saved.get(key),
    put: async (key: string, value: unknown) => { saved.set(key, value); },
    delete: async (key: string | string[]) => typeof key === "string" ? saved.delete(key) : key.filter(k => saved.delete(k)).length,
    list: async ({ prefix }: { prefix: string }) => new Map([...saved].filter(([key]) => key.startsWith(prefix))),
    getAlarm: async () => alarm,
    setAlarm: async (time: number) => { alarm = time; },
  };
  // Simulate stale KV reads after a write.
  const kv = { get: async () => null, put: async () => {}, delete: async () => {} };
  const state = { storage } as unknown as DurableObjectState;
  const env = { MAX_IMPORT_FILE_BYTES: "5242880", IMPORT_HASHES: kv } as unknown as Env;
  return { state, env, coordinator: new BankImportDO(state, env) };
}

const request = () => new Request("http://imports/import", {
  method: "POST", body: "CSV", headers: { "X-Import-Options": JSON.stringify({ fileName: "statement.csv", chatId: "1" }) },
});

describe("serialized bank imports", () => {
  it("atomically binds a pending choice to its uploader and consumes it once", async () => {
    const { coordinator, state, env } = setup();
    let current = coordinator;
    const imports = { idFromName: () => ({} as DurableObjectId), get: () => current };
    const pending = { fileId: "file", fileName: "statement.csv", chatId: "100", userId: "200",
      dateOrder: "dmy" as const, contributionChoices: { 0: "household" as const } };
    const token = await savePendingImport(imports, pending);
    expect(token).toMatch(/^[a-f0-9]{24}$/);
    expect(await claimPendingImport(imports, token, "100", "201")).toEqual({ forbidden: true });
    expect(await claimPendingImport(imports, token, "101", "200")).toEqual({ forbidden: true });
    current = new BankImportDO(state, env);
    const claims = await Promise.all([1, 2].map(() => claimPendingImport(imports, token, "100", "200")));
    expect(claims).toEqual([{ pending }, {}]);
  });

  it("expires choices and removes abandoned file references without a click", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { coordinator, state } = setup();
    const imports = { idFromName: () => ({} as DurableObjectId), get: () => coordinator };
    const pending = { fileId: "file", fileName: "statement.csv", chatId: "100", userId: "200" };
    const token = await savePendingImport(imports, pending);
    const expiresAt = 1_000 + PENDING_IMPORT_TTL_SECONDS * 1_000;
    expect(await state.storage.getAlarm()).toBe(expiresAt);
    now.mockReturnValue(expiresAt);
    await coordinator.alarm();
    expect(await state.storage.get(`pending-import:${token}`)).toBeUndefined();
    expect(await claimPendingImport(imports, token, "100", "200")).toEqual({});
  });

  it("queues simultaneous uploads and retains hash writes despite stale KV reads", async () => {
    const { coordinator, state, env } = setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const firstStarted = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(importBankStatement).mockImplementationOnce(async (_b, _f, env) => {
      started(); await gate;
      await env.IMPORT_HASHES.put("import-hash:test", "saved");
      return { created: 1 } as never;
    }).mockImplementation(async (_b, _f, env) => {
      expect(await env.IMPORT_HASHES.get("import-hash:test")).toBe("saved");
      return { created: 0 } as never;
    });
    const first = coordinator.fetch(request());
    await firstStarted;
    const second = coordinator.fetch(request());
    await Promise.resolve();
    expect(importBankStatement).toHaveBeenCalledTimes(1);
    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    // Restarting the object must not lose the durable deduplication ledger.
    expect((await new BankImportDO(state, env).fetch(request())).status).toBe(200);
  });

  it("does not poison the queue after a failed import", async () => {
    const { coordinator } = setup();
    vi.mocked(importBankStatement).mockRejectedValueOnce(new Error("Bad statement"))
      .mockResolvedValueOnce({ created: 1 } as never);
    const responses = await Promise.all([coordinator.fetch(request()), coordinator.fetch(request())]);
    expect(responses.map(r => r.status)).toEqual([400, 200]);
  });
});
