import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { BottomNav } from "./BottomNav";
import type { Account } from "../lib/dashboard";
import { AccountRow, BalanceChart, NetWorthChart, AccountDistributionChart, formatCurrency, getAccountIcon, getAccountColor, getAccountIconColor, getAccountTypeLabel, type BalancePoint, type NetWorthPoint } from "./AccountsVisuals";

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

      // Net worth is meaningful only within one currency unless explicit FX rates are available.
      const primaryCurrency = assets[0]?.currency_code || "EUR";
      const allAccounts = [...assets, ...liabilities]
        .filter((account) => account.currency_code === primaryCurrency);
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

  const mainCurrency = assets[0]?.currency_code || "EUR";
  const totalAssets = assets
    .filter((account) => account.currency_code === mainCurrency)
    .reduce((sum, account) => sum + account.current_balance, 0);
  const totalLiabilities = liabilities
    .filter((account) => account.currency_code === mainCurrency)
    .reduce((sum, account) => sum + Math.abs(account.current_balance), 0);
  const netWorth = totalAssets - totalLiabilities;

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
