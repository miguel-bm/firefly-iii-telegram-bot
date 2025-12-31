import type { FireflySearchResult } from "../types.js";

export type GroupByOption = "category" | "month" | "week" | "day" | "merchant" | "tag" | null;

interface AggregateResult {
    total?: number;
    count?: number;
    average?: number;
    grouped?: Record<string, number>;
}

// Get ISO week string YYYY-Www
function getISOWeek(dateStr: string): string {
    const date = new Date(dateStr);
    const thursday = new Date(date.getTime());
    thursday.setDate(date.getDate() + 4 - (date.getDay() || 7));
    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${thursday.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function aggregateTransactions(
    transactions: FireflySearchResult[],
    aggregate: {
        kind: "sum" | "count" | "avg";
        group_by?: GroupByOption;
    }
): AggregateResult {
    const result: AggregateResult = {};

    // Flatten all transaction splits
    const allSplits = transactions.flatMap((t) => t.attributes.transactions);

    if (aggregate.group_by) {
        const grouped: Record<string, number> = {};
        const countByGroup: Record<string, number> = {};

        for (const split of allSplits) {
            let groupKey: string;

            switch (aggregate.group_by) {
                case "category":
                    groupKey = split.category_name ?? "Uncategorized";
                    break;
                case "month":
                    groupKey = split.date.slice(0, 7); // YYYY-MM
                    break;
                case "week":
                    groupKey = getISOWeek(split.date);
                    break;
                case "day":
                    groupKey = split.date.slice(0, 10); // YYYY-MM-DD
                    break;
                case "merchant":
                    groupKey = split.destination_name ?? split.source_name ?? "Unknown";
                    break;
                case "tag":
                    // Tags are in the parent transaction, not split - use first tag or "Untagged"
                    groupKey = "Untagged"; // Default, tags handled below
                    break;
                default:
                    groupKey = "Unknown";
            }

            const amount = parseFloat(split.amount) || 0;

            if (aggregate.kind === "sum" || aggregate.kind === "avg") {
                grouped[groupKey] = (grouped[groupKey] ?? 0) + amount;
            }
            if (aggregate.kind === "count" || aggregate.kind === "avg") {
                countByGroup[groupKey] = (countByGroup[groupKey] ?? 0) + 1;
            }
        }

        // Handle tag grouping specially - tags are at transaction level
        if (aggregate.group_by === "tag") {
            const tagGrouped: Record<string, number> = {};
            const tagCount: Record<string, number> = {};

            for (const tx of transactions) {
                // Tags come from transaction attributes, accessing via search result
                // Note: Firefly search API includes tags in transaction splits
                for (const split of tx.attributes.transactions) {
                    const amount = parseFloat(split.amount) || 0;
                    // Tags might be in split or we default to Untagged
                    // The search API returns tags as a string array in the split
                    const tags = (split as { tags?: string[] }).tags ?? [];

                    if (tags.length === 0) {
                        if (aggregate.kind === "sum" || aggregate.kind === "avg") {
                            tagGrouped["Untagged"] = (tagGrouped["Untagged"] ?? 0) + amount;
                        }
                        if (aggregate.kind === "count" || aggregate.kind === "avg") {
                            tagCount["Untagged"] = (tagCount["Untagged"] ?? 0) + 1;
                        }
                    } else {
                        for (const tag of tags) {
                            if (aggregate.kind === "sum" || aggregate.kind === "avg") {
                                tagGrouped[tag] = (tagGrouped[tag] ?? 0) + amount;
                            }
                            if (aggregate.kind === "count" || aggregate.kind === "avg") {
                                tagCount[tag] = (tagCount[tag] ?? 0) + 1;
                            }
                        }
                    }
                }
            }

            if (aggregate.kind === "avg") {
                for (const tag of Object.keys(tagGrouped)) {
                    tagGrouped[tag] = tagGrouped[tag] / (tagCount[tag] ?? 1);
                }
            }

            result.grouped = tagGrouped;
            return result;
        }

        if (aggregate.kind === "avg") {
            for (const key of Object.keys(grouped)) {
                grouped[key] = grouped[key] / (countByGroup[key] ?? 1);
            }
        }

        result.grouped = grouped;
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
    currency: string,
    groupBy?: GroupByOption
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

    if (result.grouped) {
        const label = groupBy ? groupBy.charAt(0).toUpperCase() + groupBy.slice(1) : "Group";
        lines.push(`\nBy ${label}:`);

        // Sort: time-based keys chronologically desc, others by value desc
        const isTimeBased = groupBy === "month" || groupBy === "week" || groupBy === "day";
        const sorted = Object.entries(result.grouped).sort(([keyA, valA], [keyB, valB]) =>
            isTimeBased ? keyB.localeCompare(keyA) : valB - valA
        );

        for (const [key, value] of sorted) {
            lines.push(`  ${key}: ${value.toFixed(2)} ${currency}`);
        }
    }

    return lines.join("\n");
}


