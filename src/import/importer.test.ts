import { describe, expect, it } from "vitest";
import type { Env } from "../types.js";
import { getBankAccountId } from "./importer.js";

describe("bank account configuration", () => {
    it("resolves configured Firefly accounts", () => {
        const env = { BANK_ACCOUNT_ID_BBVA: " 9 " } as unknown as Env;
        expect(getBankAccountId("bbva", env)).toBe("9");
    });

    it("fails before importing when a mapping is missing", () => {
        expect(() => getBankAccountId("caixabank", {} as unknown as Env)).toThrow("BANK_ACCOUNT_ID_CAIXABANK");
    });
});
