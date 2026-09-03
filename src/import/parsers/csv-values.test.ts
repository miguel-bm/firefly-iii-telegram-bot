import { describe, expect, it } from "vitest";
import { csvAmount, inferDateOrder, StatementDateError } from "./csv-values.js";
import { parseStatementFile } from "../parsers.js";

function csv(rows: string[]) {
  return new TextEncoder().encode([
    "Fecha,Fecha valor,Movimiento,Más datos,Importe,Saldo", ...rows,
  ].join("\n")).buffer as ArrayBuffer;
}

describe("CSV dates and amounts", () => {
  it("keeps DMY ambiguous dates in the format established by the whole file", () => {
    const transactions = parseStatementFile(csv([
      '01/09/2026,01/09/2026,Mortgage,,"-1,303.80",0',
      "28/08/2026,28/08/2026,Fiber,,-20.00,0",
      "01/07/2026,01/07/2026,Contribution,,850.00,0",
    ]), "statement.csv", "caixabank");
    expect(transactions.map(tx => tx.date)).toEqual(["2026-09-01", "2026-08-28", "2026-07-01"]);
    expect(transactions[0].amount).toBe(-1303.8);
  });

  it("supports MDY exports without corrupting ambiguous first-of-month dates", () => {
    const transactions = parseStatementFile(csv([
      "9/1/2026,9/1/2026,Contribution,,-850.00,0",
      "8/30/2026,8/30/2026,Café,,-42.08,0",
      "8/1/2026,8/1/2026,Contribution,,-850.00,0",
    ]), "statement.csv", "caixabank");
    expect(transactions.map(tx => tx.date)).toEqual(["2026-09-01", "2026-08-30", "2026-08-01"]);
    expect(transactions[1].description).toBe("Café");
  });

  it("requires a per-upload choice for genuinely ambiguous files", () => {
    expect(() => inferDateOrder(["01/07/2026"])).toThrow(StatementDateError);
    expect(inferDateOrder(["01/07/2026"], "dmy")).toBe("dmy");
    expect(inferDateOrder(["01/07/2026"], "mdy")).toBe("mdy");
    expect(inferDateOrder(["01/01/2026"])).toBe("dmy");
  });

  it("rejects conflicting formats and impossible dates without skipping rows", () => {
    expect(() => inferDateOrder(["28/08/2026", "8/30/2026"])).toThrow();
    expect(() => inferDateOrder(["31/02/2026"])).toThrow();
    expect(() => inferDateOrder(["28/08/2026"], "mdy")).toThrow();
    expect(() => parseStatementFile(csv([
      "28/08/2026,28/08/2026,Valid,,-20.00,0",
      "31/02/2026,31/02/2026,Invalid,,-10.00,0",
    ]), "statement.csv", "caixabank")).toThrow();
  });

  it.each([["-1,303.80", -1303.8], ["-1.303,80", -1303.8], ["850.00", 850], ["-20,50", -20.5]])(
    "reads the full amount %s", (value, expected) => expect(csvAmount(value)).toBe(expected),
  );
  it.each(["1,2,3", "12oops", "NaN", "", "1.2345"])("rejects malformed amount %s", value => {
    expect(() => csvAmount(value)).toThrow();
  });
});
