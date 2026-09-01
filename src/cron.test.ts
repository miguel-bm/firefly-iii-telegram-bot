import { describe, expect, it } from "vitest";
import { formatImportReminder } from "./cron.js";

describe("bank import reminder messages", () => {
  it("lists only the stale accounts with useful freshness details", () => {
    const message = formatImportReminder([
      {
        target: { bank: "caixabank", accountId: "1", accountName: "Shared account" },
        freshness: {
          bank: "caixabank",
          accountId: "1",
          uploadedAt: "2026-08-01T10:00:00Z",
          latestTransactionDate: "2026-07-31",
          totalParsed: 40,
        },
      },
      {
        target: { bank: "imaginbank", accountId: "65", accountName: "Imagin account" },
        freshness: null,
      },
    ], "en", "Europe/Madrid");

    expect(message).toContain("Shared account: last upload");
    expect(message).toContain("latest transaction");
    expect(message).toContain("Imagin account: no recorded imports");
    expect(message).not.toContain("BBVA");
  });
});
