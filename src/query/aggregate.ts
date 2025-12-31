import type { FireflySearchResult } from "../types.js";

interface AggregateResult {
    total?: number;
    count?: number;
    average?: number;
    byCategory?: Record<string, number>;
    byMonth?: Record<string, number>;
}

export function aggregateTransactions(
    transactions: FireflySearchResult[],
    aggregate: {
        kind: "sum" | "count" | "avg";
        group_by?: "category" | "month";
    }
): AggregateResult {
    const result: AggregateResult = {};

    // Flatten all transaction splits
    const allSplits = transactions.flatMap((t) => t.attributes.transactions);

    if (aggregate.group_by === "category") {
        const byCategory: Record<string, number> = {};

        for (const split of allSplits) {
            const category = split.category_name ?? "Uncategorized";
            const amount = parseFloat(split.amount) || 0;

            if (aggregate.kind === "sum") {
                byCategory[category] = (byCategory[category] ?? 0) + amount;
            } else if (aggregate.kind === "count") {
                byCategory[category] = (byCategory[category] ?? 0) + 1;
            }
        }

        if (aggregate.kind === "avg") {
            const countByCategory: Record<string, number> = {};
            for (const split of allSplits) {
                const category = split.category_name ?? "Uncategorized";
                const amount = parseFloat(split.amount) || 0;
                byCategory[category] = (byCategory[category] ?? 0) + amount;
                countByCategory[category] = (countByCategory[category] ?? 0) + 1;
            }
            for (const cat of Object.keys(byCategory)) {
                byCategory[cat] = byCategory[cat] / (countByCategory[cat] ?? 1);
            }
        }

        result.byCategory = byCategory;
    } else if (aggregate.group_by === "month") {
        const byMonth: Record<string, number> = {};

        for (const split of allSplits) {
            const month = split.date.slice(0, 7); // YYYY-MM
            const amount = parseFloat(split.amount) || 0;

            if (aggregate.kind === "sum") {
                byMonth[month] = (byMonth[month] ?? 0) + amount;
            } else if (aggregate.kind === "count") {
                byMonth[month] = (byMonth[month] ?? 0) + 1;
            }
        }

        if (aggregate.kind === "avg") {
            const countByMonth: Record<string, number> = {};
            for (const split of allSplits) {
                const month = split.date.slice(0, 7);
                const amount = parseFloat(split.amount) || 0;
                byMonth[month] = (byMonth[month] ?? 0) + amount;
                countByMonth[month] = (countByMonth[month] ?? 0) + 1;
            }
            for (const m of Object.keys(byMonth)) {
                byMonth[m] = byMonth[m] / (countByMonth[m] ?? 1);
            }
        }

        result.byMonth = byMonth;
    } else {
        // No grouping - return single aggregate
        const amounts = allSplits.map((s) => parseFloat(s.amount) || 0);

        if (aggregate.kind === "sum") {
            result.total = amounts.reduce((a, b) => a + b, 0);
        } else if (aggregate.kind === "count") {
            result.count = allSplits.length;
        } else if (aggregate.kind === "avg") {
            const sum = amounts.reduce((a, b) => a + b, 0);
            result.average = amounts.length > 0 ? sum / amounts.length : 0;
        }
    }

    return result;
}

export function formatAggregateResult(
    result: AggregateResult,
    currency: string
): string {
    const lines: string[] = [];

    if (result.total !== undefined) {
        lines.push(`Total: ${result.total.toFixed(2)} ${currency}`);
    }

    if (result.count !== undefined) {
        lines.push(`Count: ${result.count} transactions`);
    }

    if (result.average !== undefined) {
        lines.push(`Average: ${result.average.toFixed(2)} ${currency}`);
    }

    if (result.byCategory) {
        lines.push("\nBy Category:");
        const sorted = Object.entries(result.byCategory).sort(
            ([, a], [, b]) => b - a
        );
        for (const [category, value] of sorted) {
            lines.push(`  ${category}: ${value.toFixed(2)} ${currency}`);
        }
    }

    if (result.byMonth) {
        lines.push("\nBy Month:");
        const sorted = Object.entries(result.byMonth).sort(([a], [b]) =>
            b.localeCompare(a)
        );
        for (const [month, value] of sorted) {
            lines.push(`  ${month}: ${value.toFixed(2)} ${currency}`);
        }
    }

    return lines.join("\n");
}

