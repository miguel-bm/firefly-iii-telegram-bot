# Mortgage payments

One bank debit is stored as one split withdrawal: principal to the mortgage
liability, interest to an expense account. Categories are `Amortización hipoteca`
and `Intereses hipoteca`; tags are `mortgage-principal` and `mortgage-interest`.
Both parts retain the same subscription. No bank debit is added by splitting it.

Reports of cash outflow include both parts. For consumption/borrowing-cost
analysis, exclude principal. Transaction counts and averages count payment groups,
not their component journals. The bot and Mini App use `group:journal` references
to edit the correct part; omitted sibling journals must be explicitly preserved
because Firefly deletes them otherwise. Financial edits and deletion of mortgage
splits require a reconciled repair in Firefly, not a generic bot operation.
Metadata edits remain allowed when forms resubmit unchanged financial values;
those unchanged fields are omitted from the update payload.

## Configuration

Set the private `MORTGAGE_CONFIG` JSON via `wrangler secret put MORTGAGE_CONFIG`
(and locally in `.dev.vars`). Do not commit actual balances or account details.
Synthetic example:

All committed mortgage test fixtures also use synthetic balances, rates and payments.

```json
{
  "sourceId": "10",
  "liabilityId": "20",
  "interestAccountId": "30",
  "subscriptionId": "5",
  "statementDescription": "LOAN PAYMENT REFERENCE",
  "title": "Mortgage",
  "anchorDate": "2026-09-01",
  "anchorBalanceCents": 10000000,
  "paymentCents": 50000,
  "annualRateBps": 200
}
```

The anchor is the lender-confirmed principal **after** that month's payment.
Money uses integer cents and the annual rate uses basis points (200 = 2%).
Calculation is monthly, interest rounded half-up to cents. This configuration
supports EUR, payments on the first, and an unchanged rate/payment only.

The importer sorts statement rows chronologically. It requires every intervening
payment to match the expected two-part allocation and refuses changed amounts,
missing months, nonstandard dates, unexpected loan activity or a changed Firefly
interest setting. It does not use Firefly's potentially unreconciled current debt
as the calculation base. Stable external IDs permit recovery after a successful
API write whose import-hash write failed. The household Durable Object serializes
uploads; manual concurrent edits in Firefly should be avoided during imports.

Old hashed observations are skipped; unknown pre-anchor mortgage rows require
review rather than guessed historical allocation. Future notes explicitly label
allocations as calculated, not bank-verified. Reconcile periodically against the
lender's actual operations table. A bank rate change is not automatically reflected
in Firefly: update the configuration and its verified anchor after reconciling a
rate change or extra repayment. Never change only the rate retroactively.

Normal Firefly classification rules do not perform the arithmetic. Keep the old
raw-description rule as a classification-only fallback tagged `mortgage-review`;
remove its full-payment-to-liability conversion. Managed splits bypass rules.

## Historical repair

Take a private transaction/account/rule backup; verify exact IDs, dates, currency,
source and totals before writing. Preserve the original principal journal ID,
notes, tags and subscription, append one interest split, and disable rules/webhooks.
Use lender figures where available; do not label reconstructed figures verified.
Check all source balances and unrelated journals remain unchanged. Retain backups
and a per-payment audit log in the gitignored `bank_statement_examples/repairs/`.

Reference: [Firefly mortgage guide](https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/finances/mortgage.md).
