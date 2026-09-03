import type { FireflyClient } from "../tools/firefly.js";
import type { FireflySearchResult } from "../types.js";
import type { ParsedTransaction } from "./types.js";
import { mortgagePlan, mortgageSplits, paymentKey, type MortgageConfig, type MortgagePayment } from "./mortgage-plan.js";

function verifyPayment(group: FireflySearchResult, config: MortgageConfig, payment: MortgagePayment): void {
  const splits = group.attributes.transactions;
  const expected = mortgageSplits(config, payment);
  if (splits.length !== 2 || expected.some(e => !splits.some(s => s.external_id === e.external_id
    && s.type === "withdrawal" && s.source_id === e.source_id && s.destination_id === e.destination_id
    && s.currency_code === "EUR" && s.date.slice(0, 10) === payment.date && Number(s.amount) === Number(e.amount)
    && (!config.subscriptionId || s.bill_id === config.subscriptionId)))) {
    throw new Error(`Mortgage: allocation differs from schedule on ${payment.date}; review required`);
  }
}

export async function importMortgage(tx: ParsedTransaction, config: MortgageConfig, firefly: FireflyClient): Promise<boolean> {
  if (tx.amount !== -config.paymentCents / 100) throw new Error("Mortgage: changed payment amount; review required");
  const plan = mortgagePlan(config, tx.date);
  const account = await firefly.getAccount(config.liabilityId);
  if (!account.active || account.type !== "liabilities" || account.currency_code !== "EUR"
    || account.interest_period !== "yearly" || Number(account.interest) !== config.annualRateBps / 100) {
    throw new Error("Mortgage: account/rate no longer matches verified configuration; review required");
  }
  const groups = await firefly.searchTransactions(
    `account_id:${config.liabilityId} date_after:${config.anchorDate} date_before:${tx.date}`, 2_000);
  if (groups.length >= 2_000) throw new Error("Mortgage: too many transactions; review required");
  const relevant = groups.filter(g => g.attributes.transactions.some(s => s.date.slice(0, 10) > config.anchorDate));
  const seen = new Set<string>();
  let existing = false;
  for (const payment of plan) {
    const key = paymentKey(config, payment.date);
    const matches = relevant.filter(g => g.attributes.transactions.some(s =>
      s.date.slice(0, 10) === payment.date || s.external_id?.startsWith(`${key}:`)));
    if (matches.length > 1) throw new Error(`Mortgage: multiple payments on ${payment.date}; review required`);
    if (matches.length === 1) {
      // Account-filtered search may return only the principal journal, not its interest sibling.
      verifyPayment(await firefly.getTransactionGroup(matches[0].id), config, payment);
      seen.add(matches[0].id);
      if (payment.date === tx.date) existing = true;
    } else if (payment.date !== tx.date) {
      throw new Error(`Mortgage: missing ${payment.date}; import that month first`);
    }
  }
  if (relevant.some(g => !seen.has(g.id))) throw new Error("Mortgage: unexpected loan activity; reconcile before importing");
  if (existing) return false;
  const payment = plan.at(-1)!;
  const created = await firefly.createSplitWithdrawal(mortgageSplits(config, payment, tx.notes), config.title);
  verifyPayment(created, config, payment);
  return true;
}
