export function dateInTimeZone(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

export function shiftDate(date: string, days: number): string {
    const [year, month, day] = date.split("-").map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return shifted.toISOString().slice(0, 10);
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
    return dateInTimeZone(now, timeZone);
}

export function daysAgoInTimeZone(days: number, timeZone: string, now = new Date()): string {
    return shiftDate(todayInTimeZone(timeZone, now), -days);
}

export function previousMonthRange(
    timeZone: string,
    locale: string,
    now = new Date(),
): { start: string; end: string; monthName: string } {
    const [year, month] = todayInTimeZone(timeZone, now).split("-").map(Number);
    const first = new Date(Date.UTC(year, month - 2, 1));
    const last = new Date(Date.UTC(year, month - 1, 0));

    return {
        start: first.toISOString().slice(0, 10),
        end: last.toISOString().slice(0, 10),
        monthName: new Intl.DateTimeFormat(locale, {
            timeZone: "UTC",
            month: "long",
            year: "numeric",
        }).format(first),
    };
}
