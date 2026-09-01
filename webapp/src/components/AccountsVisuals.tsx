import type { ReactNode } from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Tooltip, Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { Wallet, PiggyBank, CreditCard, TrendingUp, Smartphone, Home, FileText, Banknote } from "lucide-react";
import type { Account } from "../lib/dashboard";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler);

export interface BalancePoint { date: string; balance: number; }
export interface NetWorthPoint { date: string; assets: number; liabilities: number; netWorth: number; }

export function AccountRow({
  account,
  onClick,
}: {
  account: Account;
  onClick: () => void;
}) {
  const isPositive = account.current_balance >= 0;

  return (
    <div className="tx-row cursor-pointer" onClick={onClick}>
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: getAccountColor(account) }}
      >
        {getAccountIcon(account.name, getAccountIconColor(account))}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium truncate" style={{ color: "var(--tg-theme-text-color)" }}>
          {account.name}
        </p>
        <p className="text-caption">{getAccountTypeLabel(account.type)}</p>
      </div>

      <div className="text-right">
        <p
          className="font-semibold tabular-nums"
          style={{ color: isPositive ? "#059669" : "#dc2626" }}
        >
          {formatCurrency(account.current_balance, account.currency_code)}
        </p>
      </div>
    </div>
  );
}

export function BalanceChart({
  data,
  colorScheme,
  currency,
  isLiability,
}: {
  data: BalancePoint[];
  colorScheme: string;
  currency: string;
  isLiability: boolean;
}) {
  const isDark = colorScheme === "dark";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)";
  const textColor = isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.5)";

  // Chart color based on account type
  const chartColor = isLiability ? "#dc2626" : "#059669";
  const chartBgColor = isLiability
    ? isDark ? "rgba(220, 38, 38, 0.15)" : "rgba(220, 38, 38, 0.1)"
    : isDark ? "rgba(5, 150, 105, 0.15)" : "rgba(5, 150, 105, 0.1)";

  // Calculate Y-axis bounds
  const balances = data.map((p) => p.balance);
  const minBalance = Math.min(...balances);
  const maxBalance = Math.max(...balances);

  // Y-axis logic:
  // - All positive: min = 0
  // - All negative: max = 0
  // - Mixed: use actual range with padding
  let yMin: number;
  let yMax: number;
  const range = Math.abs(maxBalance - minBalance);
  const padding = range * 0.1 || Math.abs(maxBalance || minBalance) * 0.1 || 100;

  if (minBalance >= 0) {
    yMin = 0;
    yMax = maxBalance + padding;
  } else if (maxBalance <= 0) {
    yMin = minBalance - padding;
    yMax = 0;
  } else {
    yMin = minBalance - padding;
    yMax = maxBalance + padding;
  }

  // Reduce label density for better readability
  const labelInterval = Math.ceil(data.length / 5);

  const chartData = {
    labels: data.map((p, i) => {
      const date = new Date(p.date);
      if (i === 0 || i === data.length - 1 || i % labelInterval === 0) {
        return date.toLocaleDateString("es-ES", { month: "short", day: "numeric" });
      }
      return "";
    }),
    datasets: [
      {
        data: balances,
        fill: true,
        borderColor: chartColor,
        backgroundColor: chartBgColor,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: chartColor,
        pointHoverBorderColor: "#fff",
        pointHoverBorderWidth: 2,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? "rgba(28, 25, 23, 0.95)" : "rgba(255, 255, 255, 0.95)",
        titleColor: isDark ? "#fff" : "#1c1917",
        bodyColor: isDark ? "#fff" : "#1c1917",
        borderColor: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          title: (items: { dataIndex: number }[]) => {
            const idx = items[0]?.dataIndex;
            if (idx !== undefined && data[idx]) {
              const date = new Date(data[idx].date);
              return date.toLocaleDateString("es-ES", {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              });
            }
            return "";
          },
          label: (context: { parsed: { y: number | null } }) =>
            formatCurrency(context.parsed.y ?? 0, currency),
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: {
          display: false,
        },
        ticks: {
          color: textColor,
          font: { size: 10 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 5,
        },
        border: {
          display: false,
        },
      },
      y: {
        display: true,
        min: yMin,
        max: yMax,
        grid: {
          color: gridColor,
          drawTicks: false,
        },
        ticks: {
          color: textColor,
          font: { size: 10 },
          padding: 8,
          maxTicksLimit: 5,
          callback: (value: number | string) => {
            const num = typeof value === "number" ? value : parseFloat(value);
            if (Math.abs(num) >= 1000) {
              return (num / 1000).toFixed(0) + "k";
            }
            return num.toFixed(0);
          },
        },
        border: {
          display: false,
        },
      },
    },
    interaction: {
      intersect: false,
      mode: "index" as const,
    },
  };

  return <Line data={chartData} options={options} />;
}

export function NetWorthChart({
  data,
  colorScheme,
  currency,
}: {
  data: NetWorthPoint[];
  colorScheme: string;
  currency: string;
}) {
  const isDark = colorScheme === "dark";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)";
  const textColor = isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.5)";

  const chartData = {
    labels: data.map((p) => {
      const date = new Date(p.date);
      return date.toLocaleDateString("es-ES", { month: "short", day: "numeric" });
    }),
    datasets: [
      {
        label: "Activos",
        data: data.map((p) => p.assets),
        borderColor: "#059669",
        backgroundColor: "transparent",
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 3,
        borderWidth: 2,
      },
      {
        label: "Pasivos",
        data: data.map((p) => p.liabilities),
        borderColor: "#dc2626",
        backgroundColor: "transparent",
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 3,
        borderWidth: 2,
      },
      {
        label: "Neto",
        data: data.map((p) => p.netWorth),
        borderColor: "#3b82f6",
        backgroundColor: isDark ? "rgba(59, 130, 246, 0.1)" : "rgba(59, 130, 246, 0.08)",
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 3,
        borderWidth: 2.5,
      },
    ],
  };

  const allValues = data.flatMap((p) => [p.assets, p.liabilities, p.netWorth]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const range = maxValue - minValue;
  const padding = range * 0.1 || 100;

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? "rgba(28, 25, 23, 0.95)" : "rgba(255, 255, 255, 0.95)",
        titleColor: isDark ? "#fff" : "#1c1917",
        bodyColor: isDark ? "#fff" : "#1c1917",
        borderColor: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
        mode: "index" as const,
        intersect: false,
        callbacks: {
          title: (items: { dataIndex: number }[]) => {
            const idx = items[0]?.dataIndex;
            if (idx !== undefined && data[idx]) {
              const date = new Date(data[idx].date);
              return date.toLocaleDateString("es-ES", {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              });
            }
            return "";
          },
          label: (context: { dataset: { label?: string }; parsed: { y: number | null } }) => {
            const value = context.parsed.y ?? 0;
            return ` ${context.dataset.label || ""}: ${formatCurrency(value, currency)}`;
          },
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        ticks: {
          color: textColor,
          font: { size: 10 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 5,
        },
        border: { display: false },
      },
      y: {
        display: true,
        min: minValue >= 0 ? 0 : minValue - padding,
        max: maxValue + padding,
        grid: {
          color: gridColor,
          drawTicks: false,
        },
        ticks: {
          color: textColor,
          font: { size: 10 },
          padding: 8,
          maxTicksLimit: 5,
          callback: (value: number | string) => {
            const num = typeof value === "number" ? value : parseFloat(value);
            if (Math.abs(num) >= 1000) {
              return (num / 1000).toFixed(0) + "k";
            }
            return num.toFixed(0);
          },
        },
        border: { display: false },
      },
    },
    interaction: {
      intersect: false,
      mode: "index" as const,
    },
  };

  return <Line data={chartData} options={options} />;
}

export function AccountDistributionChart({
  assets,
  liabilities,
  colorScheme,
  currency,
}: {
  assets: Account[];
  liabilities: Account[];
  colorScheme: string;
  currency: string;
}) {
  const isDark = colorScheme === "dark";
  const textColor = isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.5)";

  // Colors for accounts
  const assetColors = ["#059669", "#10b981", "#34d399", "#6ee7b7", "#a7f3d0"];
  const liabilityColors = ["#dc2626", "#ef4444", "#f87171", "#fca5a5"];

  const sortedAssets = [...assets].sort((a, b) => b.current_balance - a.current_balance);
  const sortedLiabilities = [...liabilities].sort(
    (a, b) => Math.abs(b.current_balance) - Math.abs(a.current_balance)
  );

  const assetData = sortedAssets.map((acc, i) => ({
    name: acc.name,
    value: acc.current_balance,
    color: assetColors[i % assetColors.length],
  }));

  const liabilityData = sortedLiabilities.map((acc, i) => ({
    name: acc.name,
    value: Math.abs(acc.current_balance),
    color: liabilityColors[i % liabilityColors.length],
  }));

  const totalAssets = assetData.reduce((sum, d) => sum + d.value, 0);
  const totalLiabilities = liabilityData.reduce((sum, d) => sum + d.value, 0);
  const maxTotal = Math.max(totalAssets, totalLiabilities);

  if (maxTotal === 0) return null;

  const assetsWidth = (totalAssets / maxTotal) * 100;
  const liabilitiesWidth = (totalLiabilities / maxTotal) * 100;

  return (
    <div className="space-y-4">
      {/* Assets bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium" style={{ color: "#059669" }}>
            Activos
          </span>
          <span className="text-xs font-medium tabular-nums" style={{ color: "var(--tg-theme-text-color)" }}>
            {formatCurrency(totalAssets, currency)}
          </span>
        </div>
        <div
          className="h-6 rounded-lg overflow-hidden flex"
          style={{ backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)", width: "100%" }}
        >
          <div className="flex h-full" style={{ width: `${assetsWidth}%` }}>
            {assetData.map((acc, i) => {
              const width = totalAssets > 0 ? (acc.value / totalAssets) * 100 : 0;
              return (
                <div
                  key={i}
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${width}%`,
                    backgroundColor: acc.color,
                    minWidth: width > 0 ? 2 : 0,
                  }}
                  title={`${acc.name}: ${formatCurrency(acc.value, currency)}`}
                />
              );
            })}
          </div>
        </div>
        {/* Asset account labels */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {assetData.slice(0, 4).map((acc, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: acc.color }} />
              <span className="text-xs" style={{ color: textColor }}>
                {acc.name}
              </span>
            </div>
          ))}
          {assetData.length > 4 && (
            <span className="text-xs" style={{ color: textColor }}>
              +{assetData.length - 4} más
            </span>
          )}
        </div>
      </div>

      {/* Liabilities bar */}
      {liabilityData.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium" style={{ color: "#dc2626" }}>
              Pasivos
            </span>
            <span className="text-xs font-medium tabular-nums" style={{ color: "var(--tg-theme-text-color)" }}>
              {formatCurrency(totalLiabilities, currency)}
            </span>
          </div>
          <div
            className="h-6 rounded-lg overflow-hidden flex"
            style={{ backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)", width: "100%" }}
          >
            <div className="flex h-full" style={{ width: `${liabilitiesWidth}%` }}>
              {liabilityData.map((acc, i) => {
                const width = totalLiabilities > 0 ? (acc.value / totalLiabilities) * 100 : 0;
                return (
                  <div
                    key={i}
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${width}%`,
                      backgroundColor: acc.color,
                      minWidth: width > 0 ? 2 : 0,
                    }}
                    title={`${acc.name}: ${formatCurrency(acc.value, currency)}`}
                  />
                );
              })}
            </div>
          </div>
          {/* Liability account labels */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {liabilityData.slice(0, 4).map((acc, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: acc.color }} />
                <span className="text-xs" style={{ color: textColor }}>
                  {acc.name}
                </span>
              </div>
            ))}
            {liabilityData.length > 4 && (
              <span className="text-xs" style={{ color: textColor }}>
                +{liabilityData.length - 4} más
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getAccountIcon(name: string, color: string): ReactNode {
  const iconProps = { size: 18, color, strokeWidth: 2 };
  const lower = name.toLowerCase();

  if (lower.includes("ahorro") || lower.includes("saving")) return <PiggyBank {...iconProps} />;
  if (lower.includes("efectivo") || lower.includes("cash")) return <Banknote {...iconProps} />;
  if (lower.includes("tarjeta") || lower.includes("card") || lower.includes("credit")) return <CreditCard {...iconProps} />;
  if (lower.includes("inversión") || lower.includes("invest")) return <TrendingUp {...iconProps} />;
  if (lower.includes("paypal") || lower.includes("digital")) return <Smartphone {...iconProps} />;
  if (lower.includes("hipoteca") || lower.includes("mortgage")) return <Home {...iconProps} />;
  if (lower.includes("préstamo") || lower.includes("loan")) return <FileText {...iconProps} />;
  return <Wallet {...iconProps} />;
}

export function getAccountColor(account: Account): string {
  const isLiability = account.type === "liabilities" || account.type === "liability";
  if (isLiability) return "rgba(220, 38, 38, 0.08)";
  return "rgba(5, 150, 105, 0.08)";
}

export function getAccountIconColor(account: Account): string {
  const isLiability = account.type === "liabilities" || account.type === "liability";
  if (isLiability) return "#dc2626";
  return "#059669";
}

export function getAccountTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    asset: "Cuenta de activo",
    liabilities: "Pasivo",
    liability: "Pasivo",
    "Default account": "Cuenta principal",
    "Cash account": "Efectivo",
    "Savings account": "Ahorro",
    Mortgage: "Hipoteca",
    Loan: "Préstamo",
    Debt: "Deuda",
  };
  return labels[type] || type;
}
