import { describe, expect, it } from "vitest";
import { parseImaginBank } from "./parsers.js";

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
