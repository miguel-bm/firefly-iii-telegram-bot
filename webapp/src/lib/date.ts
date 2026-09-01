type DateValue = Date | string | number;

function asDate(value: DateValue): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatSpanishDate(
  value: DateValue,
  options: Intl.DateTimeFormatOptions,
): string {
  return asDate(value).toLocaleDateString("es-ES", options);
}

export function formatSpanishTime(
  value: DateValue,
  options: Intl.DateTimeFormatOptions,
): string {
  return asDate(value).toLocaleTimeString("es-ES", options);
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
