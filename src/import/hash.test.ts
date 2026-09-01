import { describe, expect, it } from "vitest";
import { generateImportHash, generateLegacyImportHash } from "./hash.js";

describe("import hashes", () => {
  it("separates otherwise identical movements by asset account", async () => {
    const shared = await generateImportHash("1", "2026-08-01", -10, "Coffee");
    const imagin = await generateImportHash("65", "2026-08-01", -10, "Coffee");
    expect(shared).not.toBe(imagin);
  });

  it("separates deposits from withdrawals", async () => {
    const withdrawal = await generateImportHash("1", "2026-08-01", -10, "Transfer");
    const deposit = await generateImportHash("1", "2026-08-01", 10, "Transfer");
    expect(withdrawal).not.toBe(deposit);
  });

  it("retains the legacy hash for migration checks", async () => {
    const negative = await generateLegacyImportHash("chat", "caixabank", "2026-08-01", -10, "Coffee");
    const positive = await generateLegacyImportHash("chat", "caixabank", "2026-08-01", 10, "Coffee");
    expect(negative).toBe(positive);
  });
});
