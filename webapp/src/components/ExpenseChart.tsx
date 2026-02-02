import { useState, useRef } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Filler,
  TimeScale,
  type ChartEvent,
  type ActiveElement,
} from "chart.js";
import "chartjs-adapter-date-fns";
import { Doughnut, Bar, Line } from "react-chartjs-2";
import { PieChart, ArrowLeft, BarChart3, TrendingUp, Layers } from "lucide-react";
import { es } from "date-fns/locale";

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Filler,
  TimeScale
);

interface CategoryData {
  category: string;
  amount: number;
  currency: string;
}

interface CategoryTransactionData {
  id: string;
  date: string;
  amount: number;
  description: string;
  type?: string;
  category?: string | null;
}

interface TimeSeriesData {
  date: string;
  [category: string]: number | string;
}

interface CategoryChartProps {
  expenseData: CategoryData[];
  incomeData: CategoryData[];
  loading: boolean;
  periodLabel: string;
  periodStart?: string;
  periodEnd?: string;
  categoryTransactions?: CategoryTransactionData[];
  categoryTransactionsLoading?: boolean;
  selectedCategory?: string | null;
  onCategorySelect?: (category: string | null, type: "expense" | "income") => void;
  onTransactionClick?: (tx: CategoryTransactionData) => void;
  // Time series data for stacked bar chart
  expenseTimeData?: TimeSeriesData[];
  expenseTimeCategories?: string[];
  incomeTimeData?: TimeSeriesData[];
  incomeTimeCategories?: string[];
  timeDataLoading?: boolean;
}

// Vibrant but refined color palette
const CHART_COLORS = [
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

type TabType = "expenses" | "income";
type DetailChartType = "bar" | "area";
type SummaryChartType = "doughnut" | "bar" | "stacked";

// Helper to get date range in days
function getDateRangeDays(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
}

// Helper to get week start (Monday)
function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split("T")[0];
}

// Generate all dates/weeks in range
function generateTimePoints(start: string, end: string, useWeeks: boolean): string[] {
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
function StackedBarChart({
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

export function CategoryChart({
  expenseData,
  incomeData,
  loading,
  periodLabel,
  periodStart,
  periodEnd,
  categoryTransactions,
  categoryTransactionsLoading,
  selectedCategory,
  onCategorySelect,
  onTransactionClick,
  expenseTimeData,
  expenseTimeCategories,
  incomeTimeData,
  incomeTimeCategories,
  timeDataLoading,
}: CategoryChartProps) {
  const [activeTab, setActiveTab] = useState<TabType>("expenses");
  const [detailChartType, setDetailChartType] = useState<DetailChartType>("bar");
  const [summaryChartType, setSummaryChartType] = useState<SummaryChartType>("doughnut");
  const chartRef = useRef<ChartJS<"doughnut"> | null>(null);

  const data = activeTab === "expenses" ? expenseData : incomeData;
  const emptyMessage = activeTab === "expenses" ? "Sin gastos" : "Sin ingresos";
  const emptySubMessage = activeTab === "expenses"
    ? "El desglose de gastos aparecerá aquí"
    : "El desglose de ingresos aparecerá aquí";

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="skeleton-light w-44 h-44 rounded-full mb-6" />
        <div className="grid grid-cols-2 gap-3 w-full">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton-light h-8 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // Tab switcher component
  const TabSwitcher = () => (
    <div
      className="flex mb-4 p-1 rounded-lg"
      style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
    >
      <button
        onClick={() => {
          setActiveTab("expenses");
          if (selectedCategory) onCategorySelect?.(null, "expense");
        }}
        className="flex-1 py-2 px-3 text-sm font-medium rounded-md transition-all duration-200"
        style={{
          backgroundColor: activeTab === "expenses" ? "var(--tg-theme-bg-color)" : "transparent",
          color: activeTab === "expenses" ? "var(--tg-theme-text-color)" : "var(--tg-theme-hint-color)",
          boxShadow: activeTab === "expenses" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
        }}
      >
        Gastos
      </button>
      <button
        onClick={() => {
          setActiveTab("income");
          if (selectedCategory) onCategorySelect?.(null, "income");
        }}
        className="flex-1 py-2 px-3 text-sm font-medium rounded-md transition-all duration-200"
        style={{
          backgroundColor: activeTab === "income" ? "var(--tg-theme-bg-color)" : "transparent",
          color: activeTab === "income" ? "var(--tg-theme-text-color)" : "var(--tg-theme-hint-color)",
          boxShadow: activeTab === "income" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
        }}
      >
        Ingresos
      </button>
    </div>
  );

  // Category detail view (bar/area chart)
  if (selectedCategory && categoryTransactions) {
    const categoryIndex = data.findIndex(d => d.category === selectedCategory);
    const categoryColor = CHART_COLORS[categoryIndex >= 0 ? categoryIndex % CHART_COLORS.length : 0];
    const currency = data[0]?.currency || "EUR";

    // Determine if we should use weeks (> 62 days)
    const rangeDays = periodStart && periodEnd ? getDateRangeDays(periodStart, periodEnd) : 30;
    const useWeeks = rangeDays > 62;

    // Generate all time points in range
    const allTimePoints = periodStart && periodEnd
      ? generateTimePoints(periodStart, periodEnd, useWeeks)
      : [];

    // Group transactions by date or week
    const groupedData = categoryTransactions.reduce((acc, tx) => {
      const txDate = tx.date.split("T")[0];
      const key = useWeeks ? getWeekStart(new Date(txDate)) : txDate;
      if (!acc[key]) acc[key] = 0;
      acc[key] += Math.abs(tx.amount);
      return acc;
    }, {} as Record<string, number>);

    // Create data points for all time points (fill zeros)
    const chartDataPoints = allTimePoints.map(point => ({
      x: point,
      y: groupedData[point] || 0,
    }));

    const totalForCategory = categoryTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    const timeChartData = {
      datasets: [
        {
          data: chartDataPoints,
          backgroundColor: detailChartType === "area"
            ? `${categoryColor}40`
            : categoryColor,
          borderColor: categoryColor,
          borderWidth: detailChartType === "area" ? 2 : 0,
          borderRadius: detailChartType === "bar" ? 4 : 0,
          fill: detailChartType === "area",
          tension: 0.3,
          pointRadius: detailChartType === "area" ? 0 : undefined,
          pointHoverRadius: detailChartType === "area" ? 4 : undefined,
          maxBarThickness: 24,
        },
      ],
    };

    const timeChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 300,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(28, 25, 23, 0.95)",
          padding: 12,
          cornerRadius: 8,
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
            label: (context: { parsed: { y: number } }) => {
              return ` ${formatCurrency(context.parsed.y, currency, 2)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "time" as const,
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
      <div className="chart-transition">
        <TabSwitcher />

        {/* Back button and category header */}
        <button
          onClick={() => onCategorySelect?.(null, activeTab === "expenses" ? "expense" : "income")}
          className="flex items-center gap-2 mb-4 text-sm font-medium transition-colors"
          style={{ color: "var(--tg-theme-link-color)" }}
        >
          <ArrowLeft size={16} />
          Volver al resumen
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-4 h-4 rounded"
            style={{ backgroundColor: categoryColor }}
          />
          <h3
            className="text-lg font-semibold"
            style={{ color: "var(--tg-theme-text-color)" }}
          >
            {selectedCategory}
          </h3>
          <span
            className="ml-auto text-lg font-bold tabular-nums"
            style={{ color: "var(--tg-theme-text-color)" }}
          >
            {formatCurrency(totalForCategory, currency)}
          </span>
        </div>

        {/* Chart type toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setDetailChartType("bar")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200"
            style={{
              backgroundColor: detailChartType === "bar" ? "var(--tg-theme-button-color)" : "var(--tg-theme-secondary-bg-color)",
              color: detailChartType === "bar" ? "var(--tg-theme-button-text-color)" : "var(--tg-theme-hint-color)",
            }}
          >
            <BarChart3 size={14} />
            Barras
          </button>
          <button
            onClick={() => setDetailChartType("area")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200"
            style={{
              backgroundColor: detailChartType === "area" ? "var(--tg-theme-button-color)" : "var(--tg-theme-secondary-bg-color)",
              color: detailChartType === "area" ? "var(--tg-theme-button-text-color)" : "var(--tg-theme-hint-color)",
            }}
          >
            <TrendingUp size={14} />
            Área
          </button>
        </div>

        {/* Time-based chart */}
        {categoryTransactionsLoading ? (
          <div className="h-48 flex items-center justify-center">
            <div className="skeleton-light w-full h-full rounded-lg" />
          </div>
        ) : chartDataPoints.length > 0 ? (
          <div className="h-48 mb-4 chart-transition">
            {detailChartType === "bar" ? (
              <Bar data={timeChartData} options={timeChartOptions as any} />
            ) : (
              <Line data={timeChartData} options={timeChartOptions as any} />
            )}
          </div>
        ) : (
          <div className="h-48 flex items-center justify-center">
            <p style={{ color: "var(--tg-theme-hint-color)" }}>
              Sin transacciones en este período
            </p>
          </div>
        )}

        {/* Transaction list for this category */}
        <div className="mt-4 space-y-2 chart-transition">
          <h4
            className="text-sm font-medium mb-2"
            style={{ color: "var(--tg-theme-hint-color)" }}
          >
            Transacciones ({categoryTransactions.length})
          </h4>
          {categoryTransactions.slice(0, 10).map((tx, i) => (
            <div
              key={`${tx.id}-${i}`}
              className={`flex items-center justify-between py-2 border-b transition-opacity ${
                onTransactionClick ? "cursor-pointer active:opacity-70" : ""
              }`}
              style={{ borderColor: "var(--tg-theme-secondary-bg-color)" }}
              onClick={() => onTransactionClick?.(tx)}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm truncate"
                  style={{ color: "var(--tg-theme-text-color)" }}
                >
                  {tx.description}
                </p>
                <p
                  className="text-xs"
                  style={{ color: "var(--tg-theme-hint-color)" }}
                >
                  {new Date(tx.date).toLocaleDateString("es-ES", {
                    day: "numeric",
                    month: "short",
                  })}
                </p>
              </div>
              <span
                className="text-sm font-medium tabular-nums ml-3"
                style={{ color: "var(--tg-theme-text-color)" }}
              >
                {formatCurrency(Math.abs(tx.amount), currency, 2)}
              </span>
            </div>
          ))}
          {categoryTransactions.length > 10 && (
            <p
              className="text-xs text-center pt-2"
              style={{ color: "var(--tg-theme-hint-color)" }}
            >
              +{categoryTransactions.length - 10} más
            </p>
          )}
        </div>
      </div>
    );
  }

  // Empty state
  if (data.length === 0) {
    return (
      <div className="chart-transition">
        <TabSwitcher />
        <div className="empty-state py-8">
          <PieChart size={48} className="empty-state-icon" style={{ opacity: 0.3 }} />
          <p
            className="font-medium mb-1"
            style={{ color: "var(--tg-theme-text-color)" }}
          >
            {emptyMessage}
          </p>
          <p
            className="text-sm"
            style={{ color: "var(--tg-theme-hint-color)" }}
          >
            {emptySubMessage}
          </p>
        </div>
      </div>
    );
  }

  // Take top 8 categories, group rest as "Other"
  const topCategories = data.slice(0, 8);
  const otherAmount = data.slice(8).reduce((sum, d) => sum + d.amount, 0);

  const chartData = otherAmount > 0
    ? [...topCategories, { category: "Otros", amount: otherAmount, currency: data[0]?.currency || "EUR" }]
    : topCategories;

  const total = chartData.reduce((sum, d) => sum + d.amount, 0);
  const currency = chartData[0]?.currency || "EUR";

  const chartConfig = {
    labels: chartData.map((d) => d.category),
    datasets: [
      {
        data: chartData.map((d) => d.amount),
        backgroundColor: CHART_COLORS.slice(0, chartData.length),
        borderWidth: 0,
        hoverOffset: 4,
        borderRadius: 0,
      },
    ],
  };

  const handleChartClick = (_event: ChartEvent, elements: ActiveElement[]) => {
    if (elements.length > 0 && onCategorySelect) {
      const index = elements[0].index;
      const category = chartData[index].category;
      if (category !== "Otros") {
        onCategorySelect(category, activeTab === "expenses" ? "expense" : "income");
      }
    }
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "70%",
    onClick: handleChartClick,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: "rgba(28, 25, 23, 0.95)",
        padding: 12,
        cornerRadius: 8,
        titleFont: { size: 13, weight: 600 as const },
        bodyFont: { size: 12 },
        displayColors: true,
        boxWidth: 10,
        boxHeight: 10,
        boxPadding: 4,
        callbacks: {
          label: (context: { parsed: number }) => {
            const value = context.parsed;
            const percentage = ((value / total) * 100).toFixed(1);
            return ` ${formatCurrency(value, currency, 2)} (${percentage}%)`;
          },
        },
      },
    },
    animation: {
      animateRotate: true,
      animateScale: false,
      duration: 300,
    },
  };

  const handleLegendItemClick = (category: string) => {
    if (onCategorySelect && category !== "Otros") {
      onCategorySelect(category, activeTab === "expenses" ? "expense" : "income");
    }
  };

  // Horizontal bar chart config
  const barChartConfig = {
    labels: chartData.map((d) => d.category),
    datasets: [
      {
        data: chartData.map((d) => d.amount),
        backgroundColor: CHART_COLORS.slice(0, chartData.length),
        borderWidth: 0,
        borderRadius: 6,
        maxBarThickness: 32,
      },
    ],
  };

  const barChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: "y" as const,
    onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
      if (elements.length > 0 && onCategorySelect) {
        const index = elements[0].index;
        const category = chartData[index].category;
        if (category !== "Otros") {
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
        callbacks: {
          label: (context: { parsed: { x: number } }) => {
            const value = context.parsed.x;
            const percentage = ((value / total) * 100).toFixed(1);
            return ` ${formatCurrency(value, currency, 2)} (${percentage}%)`;
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: { display: false },
        ticks: {
          color: "var(--tg-theme-hint-color)",
          font: { size: 10 },
          callback: (value: number | string) => formatCurrencyCompact(Number(value), currency),
        },
      },
      y: {
        grid: { display: false },
        ticks: {
          color: "var(--tg-theme-text-color)",
          font: { size: 11 },
        },
      },
    },
    animation: {
      duration: 300,
    },
  };

  return (
    <div className="chart-transition">
      <TabSwitcher />

      {/* Chart type toggle */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        <button
          onClick={() => setSummaryChartType("doughnut")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap"
          style={{
            backgroundColor: summaryChartType === "doughnut" ? "var(--tg-theme-button-color)" : "var(--tg-theme-secondary-bg-color)",
            color: summaryChartType === "doughnut" ? "var(--tg-theme-button-text-color)" : "var(--tg-theme-hint-color)",
          }}
        >
          <PieChart size={14} />
          Circular
        </button>
        <button
          onClick={() => setSummaryChartType("bar")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap"
          style={{
            backgroundColor: summaryChartType === "bar" ? "var(--tg-theme-button-color)" : "var(--tg-theme-secondary-bg-color)",
            color: summaryChartType === "bar" ? "var(--tg-theme-button-text-color)" : "var(--tg-theme-hint-color)",
          }}
        >
          <BarChart3 size={14} />
          Categorías
        </button>
        <button
          onClick={() => setSummaryChartType("stacked")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap"
          style={{
            backgroundColor: summaryChartType === "stacked" ? "var(--tg-theme-button-color)" : "var(--tg-theme-secondary-bg-color)",
            color: summaryChartType === "stacked" ? "var(--tg-theme-button-text-color)" : "var(--tg-theme-hint-color)",
          }}
        >
          <Layers size={14} />
          Evolución
        </button>
      </div>

      {/* Doughnut Chart */}
      {summaryChartType === "doughnut" && (
        <>
          <div className="relative h-48 mb-6">
            <Doughnut
              ref={chartRef}
              data={chartConfig}
              options={options}
            />
            {/* Center content */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p
                  className="text-xl font-bold tabular-nums"
                  style={{ color: "var(--tg-theme-text-color)" }}
                >
                  {formatCurrency(total, currency)}
                </p>
                <p
                  className="text-xs mt-0.5"
                  style={{ color: "var(--tg-theme-hint-color)" }}
                >
                  {periodLabel}
                </p>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="space-y-2">
            {chartData.map((item, index) => {
              const percentage = ((item.amount / total) * 100).toFixed(0);
              const isClickable = item.category !== "Otros";
              return (
                <div
                  key={item.category}
                  className={`flex items-center gap-3 py-1 px-1 -mx-1 rounded-lg transition-all duration-200 ${
                    isClickable ? "cursor-pointer hover:bg-black/5 active:bg-black/10" : ""
                  }`}
                  onClick={() => isClickable && handleLegendItemClick(item.category)}
                >
                  <div
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: CHART_COLORS[index] }}
                  />
                  <span
                    className="text-sm flex-1 truncate"
                    style={{ color: "var(--tg-theme-text-color)" }}
                  >
                    {item.category}
                  </span>
                  <span
                    className="text-xs tabular-nums w-8 text-right"
                    style={{ color: "var(--tg-theme-hint-color)" }}
                  >
                    {percentage}%
                  </span>
                  <span
                    className="text-sm font-medium tabular-nums w-20 text-right"
                    style={{ color: "var(--tg-theme-text-color)" }}
                  >
                    {formatCurrencyFull(item.amount, currency)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Horizontal Bar Chart (by category) */}
      {summaryChartType === "bar" && (
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

          <div style={{ height: Math.max(180, chartData.length * 36) }} className="mb-4">
            <Bar data={barChartConfig} options={barChartOptions as any} />
          </div>
        </>
      )}

      {/* Stacked Bar Chart (over time) */}
      {summaryChartType === "stacked" && (
        <StackedBarChart
          timeData={activeTab === "expenses" ? expenseTimeData : incomeTimeData}
          categories={activeTab === "expenses" ? expenseTimeCategories : incomeTimeCategories}
          loading={timeDataLoading}
          periodStart={periodStart}
          periodEnd={periodEnd}
          currency={currency}
          total={total}
          periodLabel={periodLabel}
          onCategorySelect={onCategorySelect}
          activeTab={activeTab}
        />
      )}
    </div>
  );
}

// Legacy export for backwards compatibility
export { CategoryChart as ExpenseChart };

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
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(amount);
  }
  return formatCurrency(amount, currency);
}

function formatCurrencyFull(amount: number, currency: string): string {
  if (amount >= 10000) {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(amount);
  }
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
