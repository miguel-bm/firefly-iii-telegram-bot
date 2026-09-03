import { z } from "zod";

const accountId = z.string().regex(/^\d+$/);
const cents = z.number().int().positive().max(100_000_000_000);
const configSchema = z.object({
  sourceId: accountId,
  liabilityId: accountId,
  interestAccountId: accountId,
  subscriptionId: accountId.optional(),
  statementDescription: z.string().min(1),
  title: z.string().min(1),
  anchorDate: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/),
  anchorBalanceCents: cents,
  paymentCents: cents,
  annualRateBps: z.number().int().positive().max(10_000),
});
export type MortgageConfig = z.infer<typeof configSchema>;
export interface MortgagePayment {
  date: string;
  interestCents: number;
  principalCents: number;
  closingCents: number;
}

export function mortgageConfig(json?: string): MortgageConfig | null {
  if (!json) return null;
  const config = configSchema.parse(JSON.parse(json));
  if (new Set([config.sourceId, config.liabilityId, config.interestAccountId]).size !== 3) {
    throw new Error("Mortgage accounts must be different");
  }
  return config;
}

export const money = (cents: number) => (cents / 100).toFixed(2);
export const paymentKey = (config: MortgageConfig, date: string) => `mortgage:${config.liabilityId}:${date}`;

// Integer cents, rational rate, half-up rounding. No floating-point money arithmetic.
export function mortgagePlan(config: MortgageConfig, through: string): MortgagePayment[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(through) || through <= config.anchorDate) {
    throw new Error("Mortgage: date is outside the verified schedule; review required");
  }
  const cursor = new Date(`${config.anchorDate}T00:00:00Z`);
  const payments: MortgagePayment[] = [];
  let balance = config.anchorBalanceCents;
  while (payments.length < 600) {
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    const date = cursor.toISOString().slice(0, 10);
    const interestCents = Number((BigInt(balance) * BigInt(config.annualRateBps) + 60_000n) / 120_000n);
    const principalCents = config.paymentCents - interestCents;
    if (principalCents <= 0 || principalCents > balance) throw new Error("Mortgage: nonstandard/final payment; review required");
    balance -= principalCents;
    payments.push({ date, interestCents, principalCents, closingCents: balance });
    if (date === through) return payments;
  }
  throw new Error("Mortgage schedule exceeds 600 months");
}

export function mortgageSplits(config: MortgageConfig, payment: MortgagePayment, notes?: string) {
  const common = {
    type: "withdrawal", date: payment.date, source_id: config.sourceId, currency_code: "EUR",
    bill_id: config.subscriptionId, // API writes still use bill_id, although reads also expose subscription_id.
    notes: [notes, `Mortgage allocation calculated at ${config.annualRateBps / 100}% from bank-confirmed balance ${money(config.anchorBalanceCents)} on ${config.anchorDate}. Expected closing principal: ${money(payment.closingCents)} EUR. Verify against lender schedule.`].filter(Boolean).join("\n"),
  };
  return [
    { ...common, amount: money(payment.principalCents), destination_id: config.liabilityId,
      description: `${config.title} · capital`, category_name: "Amortización hipoteca",
      external_id: `${paymentKey(config, payment.date)}:principal`, tags: ["bank-import", "import-caixabank", "telegram-bot", "esencial", "pareja", "mortgage-principal"] },
    { ...common, amount: money(payment.interestCents), destination_id: config.interestAccountId,
      description: `${config.title} · intereses`, category_name: "Intereses hipoteca",
      external_id: `${paymentKey(config, payment.date)}:interest`, tags: ["bank-import", "import-caixabank", "telegram-bot", "esencial", "pareja", "mortgage-interest"] },
  ];
}
