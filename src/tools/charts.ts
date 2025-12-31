import type { InsightEntry } from "./firefly.js";

// Color palette for charts (clean, modern)
const COLORS = [
    "#4F46E5", // indigo
    "#10B981", // emerald
    "#F59E0B", // amber
    "#EF4444", // red
    "#8B5CF6", // violet
    "#06B6D4", // cyan
    "#F97316", // orange
    "#EC4899", // pink
    "#14B8A6", // teal
    "#6366F1", // indigo light
];

const BACKGROUND_COLORS = COLORS.map((c) => c + "CC"); // Add alpha

export interface ChartConfig {
    type: "pie" | "bar" | "line" | "doughnut";
    title: string;
    labels: string[];
    datasets: {
        label: string;
        data: number[];
        backgroundColor?: string | string[];
        borderColor?: string | string[];
    }[];
}

export function buildChartConfig(
    type: "pie" | "bar" | "line" | "doughnut",
    title: string,
    data: { label: string; value: number }[]
): ChartConfig {
    const labels = data.map((d) => d.label);
    const values = data.map((d) => Math.abs(d.value));

    return {
        type,
        title,
        labels,
        datasets: [
            {
                label: title,
                data: values,
                backgroundColor: BACKGROUND_COLORS.slice(0, data.length),
                borderColor: COLORS.slice(0, data.length),
            },
        ],
    };
}

export function buildMultiDatasetChartConfig(
    type: "bar" | "line",
    title: string,
    labels: string[],
    datasets: { label: string; data: number[]; color: string }[]
): ChartConfig {
    return {
        type,
        title,
        labels,
        datasets: datasets.map((ds) => ({
            label: ds.label,
            data: ds.data,
            backgroundColor: ds.color + "CC",
            borderColor: ds.color,
        })),
    };
}

export function generateQuickChartUrl(config: ChartConfig): string {
    const chartJsConfig = {
        type: config.type,
        data: {
            labels: config.labels,
            datasets: config.datasets.map((ds) => ({
                label: ds.label,
                data: ds.data,
                backgroundColor: ds.backgroundColor,
                borderColor: ds.borderColor,
                borderWidth: config.type === "line" ? 2 : 1,
                fill: config.type === "line" ? false : undefined,
            })),
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: config.title,
                    font: { size: 16, weight: "bold" },
                },
                legend: {
                    position: config.type === "pie" || config.type === "doughnut" ? "right" : "top",
                },
            },
            responsive: true,
            maintainAspectRatio: true,
        },
    };

    const chartJson = JSON.stringify(chartJsConfig);
    const encoded = encodeURIComponent(chartJson);

    // QuickChart URL with options for better quality
    return `https://quickchart.io/chart?c=${encoded}&w=600&h=400&bkg=white&f=png`;
}

// Transform Firefly insight data to chart data
export function insightToChartData(
    entries: InsightEntry[],
    limit = 10
): { label: string; value: number }[] {
    return entries
        .filter((e) => e.difference_float !== 0)
        .sort((a, b) => Math.abs(b.difference_float) - Math.abs(a.difference_float))
        .slice(0, limit)
        .map((e) => ({
            label: e.name || "Sin categoría",
            value: e.difference_float,
        }));
}

// Build expense by category chart
export function buildExpenseByCategoryChart(
    entries: InsightEntry[],
    title: string,
    chartType: "pie" | "bar" | "doughnut" = "pie"
): string {
    const data = insightToChartData(entries);
    const config = buildChartConfig(chartType, title, data);
    return generateQuickChartUrl(config);
}

// Build income vs expense comparison chart
export function buildIncomeVsExpenseChart(
    months: string[],
    incomeData: number[],
    expenseData: number[],
    title: string
): string {
    const config = buildMultiDatasetChartConfig("bar", title, months, [
        { label: "Ingresos", data: incomeData, color: "#10B981" },
        { label: "Gastos", data: expenseData.map((v) => Math.abs(v)), color: "#EF4444" },
    ]);
    return generateQuickChartUrl(config);
}

// Build trend line chart
export function buildTrendChart(
    labels: string[],
    values: number[],
    title: string,
    datasetLabel: string
): string {
    const config: ChartConfig = {
        type: "line",
        title,
        labels,
        datasets: [
            {
                label: datasetLabel,
                data: values.map((v) => Math.abs(v)),
                backgroundColor: [COLORS[0] + "33"],
                borderColor: [COLORS[0]],
            },
        ],
    };
    return generateQuickChartUrl(config);
}

