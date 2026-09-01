import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseBBVA, parseCaixaBank, parseImaginBank } from "./parsers.js";

function workbookBuffer(rows: unknown[][], sheetName: string): ArrayBuffer {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
    return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

describe("Excel bank parsers", () => {
    it("keeps the BBVA parser available through the facade", () => {
        const buffer = workbookBuffer([
            ["", "F.Valor", "Fecha", "Concepto", "Movimiento", "Importe", "Divisa", "Disponible", "Divisa", "Observaciones"],
            ["", "01/09/2026", "01/09/2026", "Coffee", "Card", -4.5, "EUR", 100, "EUR", "Note"],
        ], "Informe BBVA");
        expect(parseBBVA(buffer)).toEqual([{
            date: "2026-09-01", description: "Coffee", amount: -4.5, notes: "Card - Note",
        }]);
    });

    it("keeps the CaixaBank parser available through the facade", () => {
        const buffer = workbookBuffer([
            ["Fecha", "Fecha valor", "Movimiento", "Más datos", "Importe", "Saldo"],
            ["01/09/2026", "01/09/2026", "Coffee", "Card", -4.5, 100],
        ], "Movimientos_cuenta_test");
        expect(parseCaixaBank(buffer)).toEqual([{
            date: "2026-09-01", description: "Coffee", amount: -4.5, notes: "Card",
        }]);
    });
});

describe("ImaginBank parser", () => {
    it("handles quoted delimiters and European amounts", () => {
        const csv = [
            "IBAN;Saldo;;",
            ";;;",
            "Concepto;Fecha;Importe;Saldo disponible",
            '"Coffee; shop";01/09/2026;-4,50EUR;100,00EUR',
        ].join("\n");
        expect(parseImaginBank(csv)).toEqual([
            { date: "2026-09-01", description: "Coffee; shop", amount: -4.5 },
        ]);
    });

    it("skips impossible dates", () => {
        const csv = "Concepto;Fecha;Importe;Saldo disponible\nBad;31/02/2026;-1.0;0";
        expect(parseImaginBank(csv)).toEqual([]);
    });
});
