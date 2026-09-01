import { describe, expect, it } from "vitest";
import { assertStatementFile, readResponseWithLimit } from "./file.js";

describe("statement file guards", () => {
    it("checks workbook signatures", () => {
        expect(() => assertStatementFile(new Uint8Array([0x50, 0x4b, 3, 4]).buffer, "bank.xlsx")).not.toThrow();
        expect(() => assertStatementFile(new Uint8Array([1, 2, 3]).buffer, "bank.xlsx")).toThrow();
    });

    it("enforces streamed response limits", async () => {
        const response = new Response(new Uint8Array([1, 2, 3, 4]));
        await expect(readResponseWithLimit(response, 3)).rejects.toThrow(/upload limit/);
    });
});
