import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
} from "chart.js";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

interface ExpenseData {
  category: string;
  amount: number;
  currency: string;
}

interface ExpenseChartProps {
  data: ExpenseData[];
  loading: boolean;
}

const CHART_COLORS = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#84cc16", // lime
];

export function ExpenseChart({ data, loading }: ExpenseChartProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="skeleton w-48 h-48 rounded-full" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p
          className="text-sm"
          style={{ color: "var(--tg-theme-hint-color)" }}
        >
          No expense data available
        </p>
      </div>
    );
  }

  // Take top 8 categories, group rest as "Other"
  const topCategories = data.slice(0, 8);
  const otherAmount = data.slice(8).reduce((sum, d) => sum + d.amount, 0);

  const chartData = otherAmount > 0
    ? [...topCategories, { category: "Other", amount: otherAmount, currency: data[0]?.currency || "EUR" }]
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
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "65%",
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        padding: 12,
        titleFont: { size: 13, weight: "bold" as const },
        bodyFont: { size: 12 },
        callbacks: {
          label: (context: { parsed: number }) => {
            const value = context.parsed;
            const percentage = ((value / total) * 100).toFixed(1);
            return `${formatCurrency(value, currency)} (${percentage}%)`;
          },
        },
      },
    },
  };

  return (
    <div>
      {/* Chart */}
      <div className="relative h-56 mb-6">
        <Doughnut data={chartConfig} options={options} />
        {/* Center total */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--tg-theme-hint-color)" }}
            >
              Total
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: "var(--tg-theme-text-color)" }}
            >
              {formatCurrency(total, currency)}
            </p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2">
        {chartData.map((item, index) => (
          <div key={item.category} className="flex items-center gap-2 py-1">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: CHART_COLORS[index] }}
            />
            <span
              className="text-sm truncate flex-1"
              style={{ color: "var(--tg-theme-text-color)" }}
            >
              {item.category}
            </span>
            <span
              className="text-sm font-medium tabular-nums"
              style={{ color: "var(--tg-theme-hint-color)" }}
            >
              {formatCurrency(item.amount, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
