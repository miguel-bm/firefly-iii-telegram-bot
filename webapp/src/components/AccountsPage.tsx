import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import {
  ArrowLeft,
  Wallet,
  PiggyBank,
  CreditCard,
  TrendingUp,
  TrendingDown,
  Minus,
  Smartphone,
  Home,
  FileText,
  Banknote,
} from "lucide-react";
import { BottomNav } from "./BottomNav";
import type { Account } from "../App";
import type { ReactNode } from "react";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler);

type TimeRange = "1M" | "3M" | "6M" | "1Y" | "ALL" | "CUSTOM";

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1A" },
  { value: "ALL", label: "Todo" },
  { value: "CUSTOM", label: "Otro" },
];

interface AccountsPageProps {
  assets: Account[];
  liabilities: Account[];
  loading: boolean;
  colorScheme: string;
  initData: string | null;
  onNavigate: (page: "dashboard" | "accounts" | "wizard" | "analysis") => void;
}

interface BalancePoint {
  date: string;
  balance: number;
}

interface NetWorthPoint {
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

function getDateRangeForTimeRange(range: TimeRange, customStart?: string, customEnd?: string): { start: Date; end: Date } {
  if (range === "CUSTOM" && customStart && customEnd) {
    return { start: new Date(customStart), end: new Date(customEnd) };
  }

  const end = new Date();
  const start = new Date();

  switch (range) {
    case "1M":
      start.setMonth(start.getMonth() - 1);
      break;
    case "3M":
      start.setMonth(start.getMonth() - 3);
      break;
    case "6M":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1Y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "ALL":
    case "CUSTOM":
      start.setFullYear(start.getFullYear() - 10);
      break;
  }

  return { start, end };
}

export function AccountsPage({
  assets,
  liabilities,
  loading,
  colorScheme,
  initData,
  onNavigate,
}: AccountsPageProps) {
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [balanceHistory, setBalanceHistory] = useState<BalancePoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("3M");
  const [overviewTimeRange, setOverviewTimeRange] = useState<TimeRange>("6M");
  const [customDateStart, setCustomDateStart] = useState<string>("");
  const [customDateEnd, setCustomDateEnd] = useState<string>("");
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthPoint[]>([]);
  const [netWorthLoading, setNetWorthLoading] = useState(false);

  // Fetch balance history for selected account
  const fetchHistory = useCallback(async (accountId: string, range: TimeRange) => {
    if (!initData) return;

    try {
      setHistoryLoading(true);
      const { start, end } = getDateRangeForTimeRange(range);
      const endStr = end.toISOString().split("T")[0];
      const startStr = start.toISOString().split("T")[0];

      const res = await fetch(
        `/api/accounts/${accountId}/history?start=${startStr}&end=${endStr}`,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Telegram-Init-Data": initData,
          },
        }
      );

      if (res.ok) {
        const data = await res.json();
        setBalanceHistory(data.history || []);
      }
    } catch (err) {
      console.error("Fetch history error:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [initData]);

  // Fetch net worth history (combined assets and liabilities over time)
  const fetchNetWorthHistory = useCallback(async (range: TimeRange, custStart?: string, custEnd?: string) => {
    if (!initData || assets.length === 0) return;

    try {
      setNetWorthLoading(true);
      const { start, end } = getDateRangeForTimeRange(range, custStart, custEnd);
      const endStr = end.toISOString().split("T")[0];
      const startStr = start.toISOString().split("T")[0];

      // Fetch history for all accounts in parallel
      const allAccounts = [...assets, ...liabilities];
      const historyPromises = allAccounts.map(async (account) => {
        const res = await fetch(
          `/api/accounts/${account.id}/history?start=${startStr}&end=${endStr}`,
          {
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Init-Data": initData,
            },
          }
        );
        if (res.ok) {
          const data = await res.json();
          return {
            accountId: account.id,
            type: account.type,
            history: data.history || [],
          };
        }
        return { accountId: account.id, type: account.type, history: [] };
      });

      const allHistories = await Promise.all(historyPromises);

      // Aggregate by date
      const dateMap = new Map<string, { assets: number; liabilities: number }>();

      allHistories.forEach(({ type, history }) => {
        const isLiability = type === "liabilities" || type === "liability";
        history.forEach((point: BalancePoint) => {
          const existing = dateMap.get(point.date) || { assets: 0, liabilities: 0 };
          if (isLiability) {
            existing.liabilities += Math.abs(point.balance);
          } else {
            existing.assets += point.balance;
          }
          dateMap.set(point.date, existing);
        });
      });

      // Convert to array and sort
      const netWorthData: NetWorthPoint[] = Array.from(dateMap.entries())
        .map(([date, values]) => ({
          date,
          assets: values.assets,
          liabilities: values.liabilities,
          netWorth: values.assets - values.liabilities,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setNetWorthHistory(netWorthData);
    } catch (err) {
      console.error("Fetch net worth history error:", err);
    } finally {
      setNetWorthLoading(false);
    }
  }, [initData, assets, liabilities]);

  useEffect(() => {
    if (selectedAccount) {
      fetchHistory(selectedAccount.id, timeRange);
    }
  }, [selectedAccount, timeRange, fetchHistory]);

  // Fetch net worth history when overview time range changes
  useEffect(() => {
    if (!selectedAccount && !loading) {
      if (overviewTimeRange === "CUSTOM" && customDateStart && customDateEnd) {
        fetchNetWorthHistory(overviewTimeRange, customDateStart, customDateEnd);
      } else if (overviewTimeRange !== "CUSTOM") {
        fetchNetWorthHistory(overviewTimeRange);
      }
    }
  }, [selectedAccount, loading, overviewTimeRange, customDateStart, customDateEnd, fetchNetWorthHistory]);

  // Calculate stats for the period
  const periodStats = useMemo(() => {
    if (balanceHistory.length === 0) return null;

    const balances = balanceHistory.map((p) => p.balance);
    const min = Math.min(...balances);
    const max = Math.max(...balances);
    const avg = balances.reduce((a, b) => a + b, 0) / balances.length;
    const first = balances[0];
    const last = balances[balances.length - 1];
    const change = last - first;
    const changePercent = first !== 0 ? (change / Math.abs(first)) * 100 : 0;

    return { min, max, avg, change, changePercent };
  }, [balanceHistory]);

  // Calculate net worth stats
  const netWorthStats = useMemo(() => {
    if (netWorthHistory.length === 0) return null;

    const netWorths = netWorthHistory.map((p) => p.netWorth);
    const first = netWorths[0];
    const last = netWorths[netWorths.length - 1];
    const change = last - first;
    const changePercent = first !== 0 ? (change / Math.abs(first)) * 100 : 0;

    return { change, changePercent };
  }, [netWorthHistory]);

  // Scroll to top when viewing account detail
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [selectedAccount]);

  const totalAssets = assets.reduce((sum, acc) => sum + acc.current_balance, 0);
  const totalLiabilities = liabilities.reduce((sum, acc) => sum + Math.abs(acc.current_balance), 0);
  const netWorth = totalAssets - totalLiabilities;
  const mainCurrency = assets[0]?.currency_code || "EUR";

  // Determine if account is a liability
  const isLiability = selectedAccount
    ? selectedAccount.type === "liabilities" || selectedAccount.type === "liability"
    : false;

  return (
    <div className={`app-container ${colorScheme === "dark" ? "dark" : ""}`}>
      {/* Header with integrated KPIs */}
      <div className="header-gradient" style={{ margin: 0, padding: "16px 20px 24px" }}>
        {/* Main: Net Worth */}
        <div className="mb-3">
          <p className="text-overline" style={{ color: "rgba(255,255,255,0.5)" }}>
            Patrimonio neto
          </p>
          {loading ? (
            <div className="skeleton h-10 w-40 mt-1" />
          ) : (
            <p className="text-display text-white tabular-nums" style={{ fontSize: "2rem" }}>
              {formatCurrency(netWorth, mainCurrency)}
            </p>
          )}
        </div>

        {/* Secondary: Assets & Liabilities side by side */}
        <div className="flex gap-6">
          <div>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>Activos</p>
            <p className="text-base font-semibold tabular-nums" style={{ color: "#86efac" }}>
              {loading ? "—" : formatCurrency(totalAssets, mainCurrency)}
            </p>
          </div>
          <div>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>Pasivos</p>
            <p className="text-base font-semibold tabular-nums" style={{ color: "#fca5a5" }}>
              {loading ? "—" : `-${formatCurrency(totalLiabilities, mainCurrency)}`}
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 20px" }}>

        {/* Account detail view */}
        {selectedAccount && (
          <div className="fade-in" style={{ marginTop: 24 }}>
            <button
              onClick={() => setSelectedAccount(null)}
              className="flex items-center gap-2 mb-4"
              style={{ color: "var(--tg-theme-hint-color)", background: "none", border: "none", cursor: "pointer" }}
            >
              <ArrowLeft size={18} />
              <span className="text-sm font-medium">Volver a cuentas</span>
            </button>

            {/* Account header - no card wrapper */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: getAccountColor(selectedAccount) }}
              >
                {getAccountIcon(selectedAccount.name, getAccountIconColor(selectedAccount))}
              </div>
              <div className="flex-1">
                <p className="font-semibold" style={{ color: "var(--tg-theme-text-color)" }}>
                  {selectedAccount.name}
                </p>
                <p className="text-caption">{getAccountTypeLabel(selectedAccount.type)}</p>
              </div>
            </div>

            {/* Balance with trend */}
            <div className="flex items-center gap-3 mb-4">
              <p
                className="text-3xl font-bold tabular-nums"
                style={{
                  color: selectedAccount.current_balance >= 0 ? "#059669" : "#dc2626",
                }}
              >
                {formatCurrency(selectedAccount.current_balance, selectedAccount.currency_code)}
              </p>
              {periodStats && (
                <div
                  className="flex items-center gap-1 px-2 py-1 rounded-full text-sm font-medium"
                  style={{
                    backgroundColor:
                      periodStats.change >= 0 ? "rgba(5, 150, 105, 0.1)" : "rgba(220, 38, 38, 0.1)",
                    color: periodStats.change >= 0 ? "#059669" : "#dc2626",
                  }}
                >
                  {periodStats.change > 0 ? (
                    <TrendingUp size={14} />
                  ) : periodStats.change < 0 ? (
                    <TrendingDown size={14} />
                  ) : (
                    <Minus size={14} />
                  )}
                  <span>
                    {periodStats.change >= 0 ? "+" : ""}
                    {periodStats.changePercent.toFixed(1)}%
                  </span>
                </div>
              )}
            </div>

            {/* Time range selector */}
            <div className="time-range-selector">
              {TIME_RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`time-range-btn ${timeRange === option.value ? "active" : ""}`}
                  onClick={() => setTimeRange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* Balance history chart */}
            <div className="balance-chart-container">
              {historyLoading ? (
                <div className="skeleton-light h-full w-full" />
              ) : balanceHistory.length > 0 ? (
                <BalanceChart
                  data={balanceHistory}
                  colorScheme={colorScheme}
                  currency={selectedAccount.currency_code}
                  isLiability={isLiability}
                />
              ) : (
                <p className="text-caption text-center py-8">Sin historial disponible</p>
              )}
            </div>

            {/* Period stats */}
            {!historyLoading && periodStats && (
              <div className="period-stats">
                <div className="period-stat">
                  <span className="period-stat-label">Mínimo</span>
                  <span className="period-stat-value">
                    {formatCurrency(periodStats.min, selectedAccount.currency_code)}
                  </span>
                </div>
                <div className="period-stat">
                  <span className="period-stat-label">Promedio</span>
                  <span className="period-stat-value">
                    {formatCurrency(periodStats.avg, selectedAccount.currency_code)}
                  </span>
                </div>
                <div className="period-stat">
                  <span className="period-stat-label">Máximo</span>
                  <span className="period-stat-value">
                    {formatCurrency(periodStats.max, selectedAccount.currency_code)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Global accounts overview */}
        {!selectedAccount && (
          <>
            {/* Net Worth Evolution Chart */}
            <section className="fade-in" style={{ marginTop: 24 }}>
              <h2 className="text-title mb-3" style={{ color: "var(--tg-theme-text-color)" }}>
                Evolución patrimonial
              </h2>

              {/* Time range selector for overview */}
              <div className="time-range-selector" style={{ marginTop: 0, marginBottom: 8 }}>
                {TIME_RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`time-range-btn ${overviewTimeRange === option.value ? "active" : ""}`}
                    onClick={() => setOverviewTimeRange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {/* Custom date range picker */}
              {overviewTimeRange === "CUSTOM" && (
                <div className="flex gap-2 items-center mb-3">
                  <input
                    type="date"
                    value={customDateStart}
                    onChange={(e) => setCustomDateStart(e.target.value)}
                    className="flex-1 p-2 rounded-lg text-sm"
                    style={{
                      backgroundColor: "var(--tg-theme-secondary-bg-color)",
                      color: "var(--tg-theme-text-color)",
                      border: "none",
                    }}
                  />
                  <span style={{ color: "var(--tg-theme-hint-color)" }}>→</span>
                  <input
                    type="date"
                    value={customDateEnd}
                    onChange={(e) => setCustomDateEnd(e.target.value)}
                    className="flex-1 p-2 rounded-lg text-sm"
                    style={{
                      backgroundColor: "var(--tg-theme-secondary-bg-color)",
                      color: "var(--tg-theme-text-color)",
                      border: "none",
                    }}
                  />
                </div>
              )}

              {/* KPIs below time range selector */}
              {netWorthStats && !netWorthLoading && (
                <div
                  className="flex gap-4 mb-4 p-3 rounded-xl"
                  style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
                >
                  <div className="flex-1">
                    <p className="text-xs mb-1" style={{ color: "var(--tg-theme-hint-color)" }}>
                      Cambio absoluto
                    </p>
                    <p
                      className="font-semibold tabular-nums"
                      style={{ color: netWorthStats.change >= 0 ? "#059669" : "#dc2626" }}
                    >
                      {netWorthStats.change >= 0 ? "+" : ""}
                      {formatCurrency(netWorthStats.change, mainCurrency)}
                    </p>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs mb-1" style={{ color: "var(--tg-theme-hint-color)" }}>
                      Cambio porcentual
                    </p>
                    <div className="flex items-center gap-1">
                      {netWorthStats.change >= 0 ? (
                        <TrendingUp size={14} style={{ color: "#059669" }} />
                      ) : (
                        <TrendingDown size={14} style={{ color: "#dc2626" }} />
                      )}
                      <span
                        className="font-semibold tabular-nums"
                        style={{ color: netWorthStats.change >= 0 ? "#059669" : "#dc2626" }}
                      >
                        {netWorthStats.change >= 0 ? "+" : ""}
                        {netWorthStats.changePercent.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ height: 200 }}>
                {netWorthLoading || loading ? (
                  <div className="skeleton-light h-full w-full" />
                ) : netWorthHistory.length > 0 ? (
                  <NetWorthChart data={netWorthHistory} colorScheme={colorScheme} currency={mainCurrency} />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-caption">Sin datos de historial</p>
                  </div>
                )}
              </div>

              {/* Legend */}
              {!netWorthLoading && netWorthHistory.length > 0 && (
                <div className="flex justify-center gap-6 mt-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#059669" }} />
                    <span className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                      Activos
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#dc2626" }} />
                    <span className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                      Pasivos
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#3b82f6" }} />
                    <span className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                      Neto
                    </span>
                  </div>
                </div>
              )}
            </section>

            {/* Account Distribution Bar */}
            {!loading && (assets.length > 0 || liabilities.length > 0) && (
              <section className="fade-in" style={{ marginTop: 24 }}>
                <h2 className="text-title mb-3" style={{ color: "var(--tg-theme-text-color)" }}>
                  Distribución
                </h2>
                <AccountDistributionChart
                  assets={assets}
                  liabilities={liabilities}
                  colorScheme={colorScheme}
                  currency={mainCurrency}
                />
              </section>
            )}

            {/* Assets section */}
            <section className="fade-in" style={{ marginTop: 24 }}>
              <h2 className="text-title mb-3" style={{ color: "var(--tg-theme-text-color)" }}>
                Activos
              </h2>
              {loading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="skeleton-light h-16" />
                  ))}
                </div>
              ) : assets.length === 0 ? (
                <p className="text-caption py-4">Sin cuentas de activos</p>
              ) : (
                <div>
                  {assets.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      onClick={() => setSelectedAccount(account)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Liabilities section */}
            <section className="fade-in" style={{ marginTop: 24, marginBottom: 24 }}>
              <h2 className="text-title mb-3" style={{ color: "var(--tg-theme-text-color)" }}>
                Pasivos
              </h2>
              {loading ? (
                <div className="space-y-2">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="skeleton-light h-16" />
                  ))}
                </div>
              ) : liabilities.length === 0 ? (
                <p className="text-caption py-4">Sin pasivos</p>
              ) : (
                <div>
                  {liabilities.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      onClick={() => setSelectedAccount(account)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Bottom navigation */}
      <BottomNav currentPage="accounts" onNavigate={onNavigate} />
    </div>
  );
}

function AccountRow({
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

function BalanceChart({
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

function NetWorthChart({
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

function AccountDistributionChart({
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

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getAccountIcon(name: string, color: string): ReactNode {
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

function getAccountColor(account: Account): string {
  const isLiability = account.type === "liabilities" || account.type === "liability";
  if (isLiability) return "rgba(220, 38, 38, 0.08)";
  return "rgba(5, 150, 105, 0.08)";
}

function getAccountIconColor(account: Account): string {
  const isLiability = account.type === "liabilities" || account.type === "liability";
  if (isLiability) return "#dc2626";
  return "#059669";
}

function getAccountTypeLabel(type: string): string {
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
