import { Bar } from "react-chartjs-2";
import type { ActiveElement, ChartEvent } from "chart.js";
import { es } from "date-fns/locale";

interface TimeSeriesData { date: string; [category: string]: number | string; }
type TabType = "expenses" | "income";

// Vibrant but refined color palette
export const CHART_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#6366f1", // indigo
  "#84cc16", // lime
  "#a855f7", // purple
  "#22c55e", // green
  "#eab308", // yellow
];

// Helper to get date range in days
export function getDateRangeDays(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
}

// Helper to get week start (Monday)
export function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

// Generate all dates/weeks in range
export function generateTimePoints(start: string, end: string, useWeeks: boolean): string[] {
  const points: string[] = [];
  const startDate = new Date(start);
  const endDate = new Date(end);

  if (useWeeks) {
    const current = new Date(getWeekStart(startDate));
    while (current <= endDate) {
      points.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 7);
    }
  } else {
    const current = new Date(startDate);
    while (current <= endDate) {
      points.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }
  }

  return points;
}

// Stacked Bar Chart Component (for time evolution)
export function StackedBarChart({
  timeData,
  categories,
  loading,
  periodStart,
  periodEnd,
  currency,
  total,
  periodLabel,
  onCategorySelect,
  activeTab,
}: {
  timeData?: TimeSeriesData[];
  categories?: string[];
  loading?: boolean;
  periodStart?: string;
  periodEnd?: string;
  currency: string;
  total: number;
  periodLabel: string;
  onCategorySelect?: (category: string | null, type: "expense" | "income") => void;
  activeTab: TabType;
}) {
  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center">
        <div className="skeleton-light w-full h-full rounded-lg" />
      </div>
    );
  }

  if (!timeData || !categories || timeData.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center">
        <p style={{ color: "var(--tg-theme-hint-color)" }}>
          Sin datos para mostrar
        </p>
      </div>
    );
  }

  // Determine if we should use weeks (> 62 days)
  const rangeDays = periodStart && periodEnd ? getDateRangeDays(periodStart, periodEnd) : 30;
  const useWeeks = rangeDays > 62;

  // Group data by week if needed
  let processedData = timeData;
  if (useWeeks) {
    const weekGroups: Record<string, Record<string, number>> = {};
    timeData.forEach(entry => {
      const weekStart = getWeekStart(new Date(entry.date));
      if (!weekGroups[weekStart]) {
        weekGroups[weekStart] = {};
        categories.forEach(cat => weekGroups[weekStart][cat] = 0);
      }
      categories.forEach(cat => {
        weekGroups[weekStart][cat] += (entry[cat] as number) || 0;
      });
    });
    processedData = Object.entries(weekGroups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));
  }

  // Create datasets for each category
  const datasets = categories.map((category, index) => ({
    label: category,
    data: processedData.map(entry => ({
      x: entry.date,
      y: (entry[category] as number) || 0,
    })),
    backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
    borderWidth: 0,
    borderRadius: 2,
  }));

  const stackedChartData = {
    datasets,
  };

  const stackedChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 300,
    },
    onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
      if (elements.length > 0 && onCategorySelect) {
        const datasetIndex = elements[0].datasetIndex;
        const category = categories[datasetIndex];
        if (category && category !== "Otros") {
          onCategorySelect(category, activeTab === "expenses" ? "expense" : "income");
        }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(28, 25, 23, 0.95)",
        padding: 12,
        cornerRadius: 8,
        mode: "index" as const,
        intersect: false,
        callbacks: {
          title: (items: any[]) => {
            if (!items.length) return "";
            const date = new Date(items[0].parsed.x);
            if (useWeeks) {
              const endOfWeek = new Date(date);
              endOfWeek.setDate(endOfWeek.getDate() + 6);
              return `${date.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} - ${endOfWeek.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`;
            }
            return date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" });
          },
          label: (context: { dataset: { label: string }, parsed: { y: number } }) => {
            const value = context.parsed.y;
            if (value === 0) return null;
            return ` ${context.dataset.label}: ${formatCurrency(value, currency, 2)}`;
          },
          footer: (items: any[]) => {
            const total = items.reduce((sum, item) => sum + (item.parsed.y || 0), 0);
            return `Total: ${formatCurrency(total, currency, 2)}`;
          },
        },
      },
    },
    scales: {
      x: {
        type: "time" as const,
        stacked: true,
        time: {
          unit: useWeeks ? "week" as const : "day" as const,
          displayFormats: {
            day: "d MMM",
            week: "d MMM",
          },
        },
        adapters: {
          date: {
            locale: es,
          },
        },
        grid: { display: false },
        ticks: {
          color: "var(--tg-theme-hint-color)",
          font: { size: 10 },
          maxTicksLimit: 7,
        },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: {
          color: "rgba(0,0,0,0.05)",
        },
        ticks: {
          color: "var(--tg-theme-hint-color)",
          font: { size: 10 },
          callback: (value: number | string) => formatCurrencyCompact(Number(value), currency),
        },
      },
    },
  };

  return (
    <>
      {/* Total header */}
      <div className="flex items-center justify-between mb-4">
        <span
          className="text-sm"
          style={{ color: "var(--tg-theme-hint-color)" }}
        >
          {periodLabel}
        </span>
        <span
          className="text-xl font-bold tabular-nums"
          style={{ color: "var(--tg-theme-text-color)" }}
        >
          {formatCurrency(total, currency)}
        </span>
      </div>

      <div className="h-48 mb-4">
        <Bar data={stackedChartData} options={stackedChartOptions as any} />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {categories.map((category, index) => {
          const isClickable = category !== "Otros";
          return (
            <div
              key={category}
              className={`flex items-center gap-1.5 py-1 ${
                isClickable ? "cursor-pointer" : ""
              }`}
              onClick={() => {
                if (isClickable && onCategorySelect) {
                  onCategorySelect(category, activeTab === "expenses" ? "expense" : "income");
                }
              }}
            >
              <div
                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
              />
              <span
                className="text-xs"
                style={{ color: "var(--tg-theme-text-color)" }}
              >
                {category}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function formatCurrency(amount: number, currency: string, decimals = 2): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

function formatCurrencyCompact(amount: number, currency: string): string {
  if (amount >= 1000) {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  }
  return formatCurrency(amount, currency);
}
