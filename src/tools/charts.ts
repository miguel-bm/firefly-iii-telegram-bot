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
    currency?: string; // For Y-axis label
    datasets: {
        label: string;
        data: number[];
        backgroundColor?: string | string[];
        borderColor?: string | string[];
    }[];
}

// Sanitize text to avoid JSON issues
function sanitizeText(text: string, maxLength = 30): string {
    return text
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // Remove control characters
        .replace(/"/g, "'") // Replace double quotes
        .slice(0, maxLength);
}

// Max data points to keep charts readable and URLs manageable
const MAX_DATA_POINTS = 100;

export function buildChartConfig(
    type: "pie" | "bar" | "line" | "doughnut",
    title: string,
    data: { label: string; value: number }[],
    currency?: string
): ChartConfig {
    // Limit data points
    const limitedData = data.slice(0, MAX_DATA_POINTS);

    const labels = limitedData.map((d) => sanitizeText(d.label, 20));
    const values = limitedData.map((d) => Math.abs(d.value));

    // For line/bar charts: use single color. For pie/doughnut: use color per segment.
    const useSingleColor = type === "line" || type === "bar";
    const bgColors = useSingleColor ? COLORS[0] + "CC" : BACKGROUND_COLORS.slice(0, limitedData.length);
    const borderColors = useSingleColor ? COLORS[0] : COLORS.slice(0, limitedData.length);

    return {
        type,
        title: sanitizeText(title, 100), // Allow longer titles
        labels,
        currency,
        datasets: [
            {
                label: sanitizeText(title, 50),
                data: values,
                backgroundColor: bgColors,
                borderColor: borderColors,
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

// Build the Chart.js config object
function buildChartJsConfig(config: ChartConfig): object {
    const isPieOrDoughnut = config.type === "pie" || config.type === "doughnut";
    const isSingleDataset = config.datasets.length === 1;

    return {
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
                pointRadius: config.type === "line" ? 3 : undefined,
                tension: config.type === "line" ? 0.1 : undefined, // Slight curve
            })),
        },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: config.title,
                    font: { size: 14, weight: "bold" },
                },
                legend: {
                    // Hide legend for single-dataset line/bar charts (redundant)
                    display: isPieOrDoughnut || !isSingleDataset,
                    position: isPieOrDoughnut ? "right" : "top",
                },
            },
            scales: isPieOrDoughnut ? undefined : {
                y: {
                    beginAtZero: false,
                    title: {
                        display: !!config.currency,
                        text: config.currency ?? "",
                    },
                },
                x: {
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45,
                    },
                },
            },
            responsive: true,
            maintainAspectRatio: true,
        },
    };
}

// Generate short URL via QuickChart POST API
export async function generateQuickChartUrl(config: ChartConfig): Promise<string> {
    const chartJsConfig = buildChartJsConfig(config);

    // Use POST endpoint to get a short URL
    const response = await fetch("https://quickchart.io/chart/create", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            chart: chartJsConfig,
            width: 600,
            height: 400,
            backgroundColor: "white",
            format: "png",
        }),
    });

    if (!response.ok) {
        // Fallback to direct URL if POST fails
        const chartJson = JSON.stringify(chartJsConfig);
        const encoded = encodeURIComponent(chartJson);
        return `https://quickchart.io/chart?c=${encoded}&w=600&h=400&bkg=white&f=png`;
    }

    const result = await response.json() as { success: boolean; url: string };
    if (result.success && result.url) {
        return result.url;
    }

    // Fallback
    const chartJson = JSON.stringify(chartJsConfig);
    const encoded = encodeURIComponent(chartJson);
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
export async function buildExpenseByCategoryChart(
    entries: InsightEntry[],
    title: string,
    chartType: "pie" | "bar" | "doughnut" = "pie"
): Promise<string> {
    const data = insightToChartData(entries);
    const config = buildChartConfig(chartType, title, data);
    return generateQuickChartUrl(config);
}

// Build income vs expense comparison chart
export async function buildIncomeVsExpenseChart(
    months: string[],
    incomeData: number[],
    expenseData: number[],
    title: string
): Promise<string> {
    const config = buildMultiDatasetChartConfig("bar", title, months, [
        { label: "Ingresos", data: incomeData, color: "#10B981" },
        { label: "Gastos", data: expenseData.map((v) => Math.abs(v)), color: "#EF4444" },
    ]);
    return generateQuickChartUrl(config);
}

// Build trend line chart
export async function buildTrendChart(
    labels: string[],
    values: number[],
    title: string,
    datasetLabel: string
): Promise<string> {
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

