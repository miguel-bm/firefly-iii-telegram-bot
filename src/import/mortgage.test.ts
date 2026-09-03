import { describe, expect, it, vi } from "vitest";
import type { FireflyClient } from "../tools/firefly.js";
import type { FireflySearchResult } from "../types.js";
import { importMortgage } from "./mortgage.js";
import { mortgageConfig, mortgagePlan, mortgageSplits, type MortgageConfig } from "./mortgage-plan.js";

const config: MortgageConfig = {
  sourceId: "10", liabilityId: "20", interestAccountId: "30", subscriptionId: "40", title: "Test mortgage",
  statementDescription: "LOAN", anchorDate: "2030-01-01", anchorBalanceCents: 20000000,
  paymentCents: 100000, annualRateBps: 180,
};
function setup() {
  const groups: FireflySearchResult[] = [];
  const client = {
    getAccount: vi.fn(async () => ({ active: true, type: "liabilities", currency_code: "EUR", interest: "1.8", interest_period: "yearly" })),
    searchTransactions: vi.fn(async () => groups),
    getTransactionGroup: vi.fn(async (id: string) => groups.find(g => g.id === id)!),
    createSplitWithdrawal: vi.fn(async (splits: FireflySearchResult["attributes"]["transactions"]) => {
      const group = { id: String(groups.length + 1), attributes: { transactions: splits } };
      groups.push(group);
      return group;
    }),
  };
  return { groups, client, firefly: client as unknown as FireflyClient };
}
const tx = (date = "2030-02-01") => ({ date, description: "LOAN", amount: -1000 });

describe("monthly mortgage allocation", () => {
  it("matches a ten-month synthetic schedule, not an average split", () => {
    const plan = mortgagePlan(config, "2030-11-01");
    expect(plan.map(p => [p.principalCents, p.interestCents, p.closingCents])).toEqual([
      [70000, 30000, 19930000], [70105, 29895, 19859895], [70210, 29790, 19789685],
      [70315, 29685, 19719370], [70421, 29579, 19648949], [70527, 29473, 19578422],
      [70632, 29368, 19507790], [70738, 29262, 19437052], [70844, 29156, 19366208],
      [70951, 29049, 19295257],
    ]);
  });
  it("rounds exact half-cent ties up using integer arithmetic", () => {
    const p = mortgagePlan({ ...config, anchorBalanceCents: 10001000 }, "2030-02-01")[0];
    expect(p.interestCents).toBe(15002);
  });
  it("rejects invalid config, old/irregular dates and final payments", () => {
    expect(() => mortgageConfig(JSON.stringify({ ...config, sourceId: "20" }))).toThrow();
    expect(() => mortgagePlan(config, config.anchorDate)).toThrow();
    expect(() => mortgagePlan(config, "2030-02-02")).toThrow();
    expect(() => mortgagePlan({ ...config, anchorBalanceCents: 100 }, "2030-02-01")).toThrow();
  });
  it("creates one split debit and recovers after a lost hash write without duplication", async () => {
    const { client, firefly } = setup();
    expect(await importMortgage(tx(), config, firefly)).toBe(true);
    expect(await importMortgage(tx(), config, firefly)).toBe(false);
    expect(client.createSplitWithdrawal).toHaveBeenCalledTimes(1);
    const splits = client.createSplitWithdrawal.mock.calls[0][0];
    expect(splits.reduce((sum, s) => sum + Math.round(Number(s.amount) * 100), 0)).toBe(100000);
    expect(splits.map(s => s.destination_id)).toEqual(["20", "30"]);
  });
  it("refuses missing months, changed payments and a changed configured rate", async () => {
    const { firefly, client } = setup();
    await expect(importMortgage(tx("2030-03-01"), config, firefly)).rejects.toThrow("missing");
    await expect(importMortgage({ ...tx(), amount: -999 }, config, firefly)).rejects.toThrow("changed payment");
    client.getAccount.mockResolvedValueOnce({ active: true, type: "liabilities", currency_code: "EUR", interest: "3", interest_period: "yearly" });
    await expect(importMortgage(tx(), config, firefly)).rejects.toThrow("rate");
    expect(client.createSplitWithdrawal).not.toHaveBeenCalled();
  });
  it("loads the full payment when account-filtered search only returns principal", async () => {
    const { groups, client, firefly } = setup();
    await importMortgage(tx(), config, firefly);
    client.searchTransactions.mockImplementation(async () => groups.map(g => ({ ...g,
      attributes: { transactions: g.attributes.transactions.filter(t => t.destination_id === config.liabilityId) },
    })));
    expect(await importMortgage(tx(), config, firefly)).toBe(false);
    expect(client.getTransactionGroup).toHaveBeenCalledWith("1");
    expect(client.createSplitWithdrawal).toHaveBeenCalledTimes(1);
  });
  it("refuses modified, duplicated and extra repayment records", async () => {
    const { groups, firefly } = setup();
    await importMortgage(tx(), config, firefly);
    groups[0].attributes.transactions[0].amount = "1";
    await expect(importMortgage(tx(), config, firefly)).rejects.toThrow("differs");
    groups[0].attributes.transactions = mortgageSplits(config, mortgagePlan(config, "2030-02-01")[0]);
    groups.push(structuredClone(groups[0]));
    groups[1].id = "2";
    await expect(importMortgage(tx(), config, firefly)).rejects.toThrow("multiple");
    groups[1].attributes.transactions.forEach(s => { s.date = "2030-02-15"; s.external_id = null; });
    await expect(importMortgage(tx("2030-03-01"), config, firefly)).rejects.toThrow("unexpected");
  });
});
