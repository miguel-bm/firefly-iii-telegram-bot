import { describe, expect, it } from "vitest";
import type { Env } from "../types.js";
import { formatImportResult } from "./importer.js";
import { getCaixaBankAccountSuffix, resolveImportTarget } from "./accounts.js";

describe("bank account configuration", () => {
    const env = {
        BANK_ACCOUNT_ID_BBVA: "9",
        BANK_ACCOUNT_ID_CAIXABANK: "1",
        BANK_ACCOUNT_ID_IMAGINBANK: "65",
        BANK_ACCOUNT_SUFFIX_CAIXABANK: "1111111",
        BANK_ACCOUNT_SUFFIX_IMAGINBANK: "2222222",
        BANK_ACCOUNT_NAME_CAIXABANK: "Shared account",
        BANK_ACCOUNT_NAME_IMAGINBANK: "Imagin account",
    } as unknown as Env;

    it("extracts the account suffix from copied export filenames", () => {
        expect(getCaixaBankAccountSuffix("Movimientos_cuenta_2222222 (16) (1).csv"))
            .toBe("2222222");
    });

    it("routes CaixaBank-formatted exports by account suffix", () => {
        expect(resolveImportTarget("caixabank", "Movimientos_cuenta_1111111.xls", env))
            .toMatchObject({ bank: "caixabank", accountId: "1", accountName: "Shared account" });
        expect(resolveImportTarget("caixabank", "Movimientos_cuenta_2222222.csv", env))
            .toMatchObject({ bank: "imaginbank", accountId: "65", accountName: "Imagin account" });
    });

    it("fails closed for an unknown CaixaBank account", () => {
        expect(() => resolveImportTarget("caixabank", "Movimientos_cuenta_3333333.csv", env))
            .toThrow("Unknown or ambiguous");
    });

    it("shows the selected asset account in the import result", () => {
        const message = formatImportResult({
            bank: "caixabank",
            bankName: "CaixaBank",
            accountName: "Imagin account",
            totalParsed: 56,
            created: 56,
            duplicates: 0,
            errors: [],
        }, "es");
        expect(message).toContain("CaixaBank → Imagin account");
    });
});
