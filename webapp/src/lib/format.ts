export function formatCurrencyDecimals(
  amount: number,
  currency = "EUR",
  decimals = 2,
): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatCurrencyWhole(amount: number, currency = "EUR"): string {
  return formatCurrencyDecimals(amount, currency, 0);
}

export function formatCurrencyWithCents(amount: number, currency = "EUR"): string {
  return formatCurrencyDecimals(amount, currency, 2);
}

export function formatCurrencyCompact(amount: number, currency: string): string {
  if (amount < 1000) return formatCurrencyWithCents(amount, currency);
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(amount);
}

export function formatCurrencyFull(amount: number, currency: string): string {
  return amount >= 10_000
    ? formatCurrencyCompact(amount, currency)
    : formatCurrencyWithCents(amount, currency);
}
