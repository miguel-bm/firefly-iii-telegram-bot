import { describe, expect, it } from "vitest";
import {
  applyImportChoice,
  importCallbackData,
  parseImportCallback,
  type PendingImport,
} from "./pending.js";

describe("pending Telegram imports", () => {
  const pending: PendingImport = {
    fileId: "telegram-file",
    fileName: "statement.csv",
    chatId: "100",
    userId: "200",
  };

  it("accepts only known choices with an opaque token", () => {
    const token = "0123456789abcdef01234567";
    expect(parseImportCallback(importCallbackData(token, "imaginbank")))
      .toEqual({ token, action: "imaginbank" });
    expect(parseImportCallback(importCallbackData(token, "household")))
      .toEqual({ token, action: "household" });
    expect(parseImportCallback(`bank-import:${token}:other`)).toBeNull();
    expect(parseImportCallback("bank-import:short:bbva")).toBeNull();
  });

  it("preserves successive date, account and per-transaction choices", () => {
    const dated = applyImportChoice(pending, "dmy");
    const targeted = applyImportChoice(dated, "imaginbank");
    const first = applyImportChoice({ ...targeted, contributionIndex: 0 }, "household");
    const second = applyImportChoice({ ...first, contributionIndex: 2 }, "regular");
    expect(second).toEqual({ ...pending, dateOrder: "dmy", targetBank: "imaginbank",
      contributionIndex: undefined, contributionChoices: { 0: "household", 2: "regular" } });
    expect(() => applyImportChoice(pending, "household")).toThrow("No contribution");
  });
});
