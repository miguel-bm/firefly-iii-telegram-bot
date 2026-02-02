import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Doughnut } from "react-chartjs-2";
import {
  AlertCircle,
  CheckCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { BottomNav } from "./BottomNav";
import type { Transaction } from "../App";

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface SpendingAnalysisProps {
  colorScheme: string;
  initData: string | null;
  onNavigate: (page: "dashboard" | "accounts" | "wizard" | "analysis") => void;
}

type TimeRange = "7d" | "30d" | "90d" | "365d";

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "90d", label: "3 meses" },
  { value: "365d", label: "1 año" },
];

interface ClassifiedExpense {
  id: string;
  description: string;
  amount: number;
  date: string;
  category: string | null;
  classification: "esencial" | "no-esencial" | "sin-clasificar";
  tags: string[];
}

interface CategoryBreakdown {
  category: string;
  esencial: number;
  noEsencial: number;
  sinClasificar: number;
  total: number;
}

export function SpendingAnalysis({
  colorScheme,
  initData,
  onNavigate,
}: SpendingAnalysisProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [showUnclassified, setShowUnclassified] = useState(false);

  // Track pending tag updates for optimistic UI
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, "esencial" | "no-esencial">>(new Map());
  const [failedUpdates, setFailedUpdates] = useState<Set<string>>(new Set());

  const getHeaders = useCallback(() => {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (initData) {
      headers["X-Telegram-Init-Data"] = initData;
    }
    return headers;
  }, [initData]);

  // Fetch transactions for the selected period
  const fetchTransactions = useCallback(async () => {
    try {
      setLoading(true);
      const days = parseInt(timeRange);
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - days);

      const res = await fetch(
        `/api/transactions?limit=500&start=${start.toISOString().split("T")[0]}&end=${end.toISOString().split("T")[0]}&type=withdrawal`,
        { headers: getHeaders() }
      );

      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
      }
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [getHeaders, timeRange]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Quick tag assignment with optimistic update
  const handleQuickTag = async (txId: string, tag: "esencial" | "no-esencial") => {
    // Get the current transaction to access its existing tags
    const tx = transactions.find((t) => t.id === txId);
    if (!tx) return;

    // Clear any previous error for this transaction
    setFailedUpdates((prev) => {
      const next = new Set(prev);
      next.delete(txId);
      return next;
    });

    // Optimistic update - add to pending
    setPendingUpdates((prev) => new Map(prev).set(txId, tag));

    // Optimistically update local state
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id === txId) {
          const existingTags = (t.tags || []).filter(
            (tg) => tg.toLowerCase() !== "esencial" && tg.toLowerCase() !== "no esencial" && tg.toLowerCase() !== "no-esencial"
          );
          const tagToAdd = tag === "esencial" ? "esencial" : "no esencial";
          return { ...t, tags: [...existingTags, tagToAdd] };
        }
        return t;
      })
    );

    try {
      // Prepare the new tags array - remove existing esencial/no-esencial tags and add the new one
      const existingTags = (tx.tags || []).filter(
        (t) => t.toLowerCase() !== "esencial" && t.toLowerCase() !== "no esencial" && t.toLowerCase() !== "no-esencial"
      );
      const tagToAdd = tag === "esencial" ? "esencial" : "no esencial";
      const newTags = [...existingTags, tagToAdd];

      const res = await fetch(`/api/transactions/${txId}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ tags: newTags }),
      });

      if (!res.ok) {
        throw new Error("Failed to update");
      }

      // Success - remove from pending
      setPendingUpdates((prev) => {
        const next = new Map(prev);
        next.delete(txId);
        return next;
      });
    } catch (err) {
      console.error("Tag update error:", err);

      // Mark as failed
      setFailedUpdates((prev) => new Set(prev).add(txId));

      // Revert optimistic update
      setTransactions((prev) =>
        prev.map((t) => {
          if (t.id === txId) {
            return tx; // Restore original transaction
          }
          return t;
        })
      );

      // Remove from pending
      setPendingUpdates((prev) => {
        const next = new Map(prev);
        next.delete(txId);
        return next;
      });
    }
  };

  // Classify transactions - include pending updates in classification
  const classifiedExpenses = useMemo((): ClassifiedExpense[] => {
    return transactions
      .filter((tx) => tx.type === "withdrawal")
      .map((tx) => {
        const tags = tx.tags || [];
        let classification: "esencial" | "no-esencial" | "sin-clasificar" = "sin-clasificar";

        if (tags.some((t) => t.toLowerCase() === "esencial")) {
          classification = "esencial";
        } else if (tags.some((t) => t.toLowerCase() === "no esencial" || t.toLowerCase() === "no-esencial")) {
          classification = "no-esencial";
        }

        return {
          id: tx.id,
          description: tx.description,
          amount: tx.amount,
          date: tx.date,
          category: tx.category,
          classification,
          tags,
        };
      });
  }, [transactions]);

  // Calculate totals
  const totals = useMemo(() => {
    const esencial = classifiedExpenses
      .filter((e) => e.classification === "esencial")
      .reduce((sum, e) => sum + e.amount, 0);
    const noEsencial = classifiedExpenses
      .filter((e) => e.classification === "no-esencial")
      .reduce((sum, e) => sum + e.amount, 0);
    const sinClasificar = classifiedExpenses
      .filter((e) => e.classification === "sin-clasificar")
      .reduce((sum, e) => sum + e.amount, 0);
    const total = esencial + noEsencial + sinClasificar;

    return { esencial, noEsencial, sinClasificar, total };
  }, [classifiedExpenses]);

  // Calculate category breakdown
  const categoryBreakdown = useMemo((): CategoryBreakdown[] => {
    const map = new Map<string, CategoryBreakdown>();

    classifiedExpenses.forEach((expense) => {
      const category = expense.category || "Sin categoría";
      const existing = map.get(category) || {
        category,
        esencial: 0,
        noEsencial: 0,
        sinClasificar: 0,
        total: 0,
      };

      if (expense.classification === "esencial") {
        existing.esencial += expense.amount;
      } else if (expense.classification === "no-esencial") {
        existing.noEsencial += expense.amount;
      } else {
        existing.sinClasificar += expense.amount;
      }
      existing.total += expense.amount;

      map.set(category, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [classifiedExpenses]);

  // Get transactions for expanded category
  const expandedCategoryTransactions = useMemo(() => {
    if (!expandedCategory) return [];
    return classifiedExpenses
      .filter((e) => (e.category || "Sin categoría") === expandedCategory)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [expandedCategory, classifiedExpenses]);

  // Unclassified transactions
  const unclassifiedTransactions = useMemo(() => {
    return classifiedExpenses
      .filter((e) => e.classification === "sin-clasificar")
      .sort((a, b) => b.amount - a.amount);
  }, [classifiedExpenses]);

  const isDark = colorScheme === "dark";

  // Doughnut chart data
  const doughnutData = {
    labels: ["Esencial", "No esencial", "Sin clasificar"],
    datasets: [
      {
        data: [totals.esencial, totals.noEsencial, totals.sinClasificar],
        backgroundColor: ["#059669", "#f59e0b", "#94a3b8"],
        borderWidth: 0,
        hoverOffset: 4,
      },
    ],
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "70%",
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
        callbacks: {
          label: (context: { parsed: number }) => {
            const value = context.parsed;
            const percentage = totals.total > 0 ? ((value / totals.total) * 100).toFixed(1) : 0;
            return ` ${formatCurrency(value, "EUR")} (${percentage}%)`;
          },
        },
      },
    },
  };

  return (
    <div className={`app-container ${colorScheme === "dark" ? "dark" : ""}`}>
      {/* Compact header with integrated time range */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{
          backgroundColor: "var(--tg-theme-bg-color)",
          borderBottom: "1px solid var(--tg-theme-secondary-bg-color)"
        }}
      >
        <h1 className="text-lg font-semibold" style={{ color: "var(--tg-theme-text-color)" }}>
          Análisis
        </h1>
        <div className="flex gap-1">
          {TIME_RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-all"
              onClick={() => setTimeRange(option.value)}
              style={{
                backgroundColor: timeRange === option.value
                  ? "var(--tg-theme-text-color)"
                  : "transparent",
                color: timeRange === option.value
                  ? "var(--tg-theme-bg-color)"
                  : "var(--tg-theme-hint-color)",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 20px", paddingBottom: 80 }}>

        {loading ? (
          <div className="space-y-4" style={{ marginTop: 20 }}>
            <div className="skeleton-light h-48" />
            <div className="skeleton-light h-24" />
            <div className="skeleton-light h-24" />
          </div>
        ) : (
          <>
            {/* Main chart */}
            <div className="fade-in" style={{ marginTop: 24 }}>
              <div className="relative" style={{ height: 200 }}>
                <Doughnut data={doughnutData} options={doughnutOptions} />
                {/* Center content */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <p
                      className="text-xl font-bold tabular-nums"
                      style={{ color: "var(--tg-theme-text-color)" }}
                    >
                      {formatCurrency(totals.total, "EUR")}
                    </p>
                    <p className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                      Total gastos
                    </p>
                  </div>
                </div>
              </div>

              {/* Legend with amounts */}
              <div className="space-y-3 mt-6">
                <LegendItem
                  color="#059669"
                  label="Esencial"
                  amount={totals.esencial}
                  percentage={totals.total > 0 ? (totals.esencial / totals.total) * 100 : 0}
                  icon={<CheckCircle size={16} />}
                />
                <LegendItem
                  color="#f59e0b"
                  label="No esencial"
                  amount={totals.noEsencial}
                  percentage={totals.total > 0 ? (totals.noEsencial / totals.total) * 100 : 0}
                  icon={<AlertCircle size={16} />}
                />
                <LegendItem
                  color="#94a3b8"
                  label="Sin clasificar"
                  amount={totals.sinClasificar}
                  percentage={totals.total > 0 ? (totals.sinClasificar / totals.total) * 100 : 0}
                  icon={<HelpCircle size={16} />}
                  onClick={() => setShowUnclassified(!showUnclassified)}
                  expanded={showUnclassified}
                  count={unclassifiedTransactions.length}
                />
              </div>
            </div>

            {/* Unclassified transactions expandable with quick tag buttons */}
            {showUnclassified && unclassifiedTransactions.length > 0 && (
              <div
                className="fade-in mt-4 p-3 rounded-xl"
                style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
              >
                <p className="text-caption mb-3">
                  Asigna etiquetas rápidamente:
                </p>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {unclassifiedTransactions.map((tx) => {
                    const isPending = pendingUpdates.has(tx.id);
                    const hasFailed = failedUpdates.has(tx.id);

                    return (
                      <div
                        key={tx.id}
                        className={`p-3 rounded-lg transition-all ${isPending ? "opacity-70" : ""}`}
                        style={{ backgroundColor: "var(--tg-theme-bg-color)" }}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <p
                              className="text-sm font-medium truncate"
                              style={{ color: "var(--tg-theme-text-color)" }}
                            >
                              {tx.description}
                            </p>
                            <p className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                              {tx.category || "Sin categoría"} · {new Date(tx.date).toLocaleDateString("es-ES", {
                                day: "numeric",
                                month: "short",
                              })}
                            </p>
                          </div>
                          <span
                            className="text-sm font-semibold tabular-nums ml-2"
                            style={{ color: "var(--tg-theme-text-color)" }}
                          >
                            {formatCurrency(tx.amount, "EUR")}
                          </span>
                        </div>

                        {/* Quick tag buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleQuickTag(tx.id, "esencial")}
                            disabled={isPending}
                            className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-all active:scale-95"
                            style={{
                              backgroundColor: "rgba(5, 150, 105, 0.1)",
                              color: "#059669",
                              opacity: isPending ? 0.5 : 1,
                            }}
                          >
                            {isPending && pendingUpdates.get(tx.id) === "esencial" ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Check size={12} />
                            )}
                            Esencial
                          </button>
                          <button
                            onClick={() => handleQuickTag(tx.id, "no-esencial")}
                            disabled={isPending}
                            className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-all active:scale-95"
                            style={{
                              backgroundColor: "rgba(245, 158, 11, 0.1)",
                              color: "#f59e0b",
                              opacity: isPending ? 0.5 : 1,
                            }}
                          >
                            {isPending && pendingUpdates.get(tx.id) === "no-esencial" ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <X size={12} />
                            )}
                            No esencial
                          </button>
                        </div>

                        {/* Error message */}
                        {hasFailed && (
                          <p className="text-xs mt-2" style={{ color: "#dc2626" }}>
                            Error al guardar. Toca para reintentar.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Category breakdown */}
            <section className="fade-in" style={{ marginTop: 32 }}>
              <h2 className="text-title mb-4" style={{ color: "var(--tg-theme-text-color)" }}>
                Por categoría
              </h2>

              <div className="space-y-3">
                {categoryBreakdown.map((cat) => (
                  <CategoryRow
                    key={cat.category}
                    data={cat}
                    total={totals.total}
                    expanded={expandedCategory === cat.category}
                    onToggle={() =>
                      setExpandedCategory(
                        expandedCategory === cat.category ? null : cat.category
                      )
                    }
                    transactions={
                      expandedCategory === cat.category
                        ? expandedCategoryTransactions
                        : []
                    }
                    colorScheme={colorScheme}
                    onQuickTag={handleQuickTag}
                    pendingUpdates={pendingUpdates}
                    failedUpdates={failedUpdates}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {/* Bottom navigation */}
      <BottomNav currentPage="analysis" onNavigate={onNavigate} />
    </div>
  );
}

function LegendItem({
  color,
  label,
  amount,
  percentage,
  icon,
  onClick,
  expanded,
  count,
}: {
  color: string;
  label: string;
  amount: number;
  percentage: number;
  icon: React.ReactNode;
  onClick?: () => void;
  expanded?: boolean;
  count?: number;
}) {
  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl transition-all ${onClick ? "cursor-pointer" : ""}`}
      style={{ backgroundColor: `${color}10` }}
      onClick={onClick}
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{ backgroundColor: `${color}20`, color }}
      >
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium" style={{ color: "var(--tg-theme-text-color)" }}>
            {label}
          </span>
          {count !== undefined && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)", color: "var(--tg-theme-hint-color)" }}
            >
              {count}
            </span>
          )}
        </div>
        {/* Progress bar */}
        <div
          className="h-1.5 rounded-full mt-1"
          style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${percentage}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <div className="text-right">
        <p className="font-semibold tabular-nums" style={{ color: "var(--tg-theme-text-color)" }}>
          {formatCurrency(amount, "EUR")}
        </p>
        <p className="text-xs tabular-nums" style={{ color: "var(--tg-theme-hint-color)" }}>
          {percentage.toFixed(1)}%
        </p>
      </div>
      {onClick && (
        <div style={{ color: "var(--tg-theme-hint-color)" }}>
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  data,
  total: _total,
  expanded,
  onToggle,
  transactions,
  colorScheme: _colorScheme,
  onQuickTag,
  pendingUpdates,
  failedUpdates,
}: {
  data: CategoryBreakdown;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  transactions: ClassifiedExpense[];
  colorScheme: string;
  onQuickTag: (txId: string, tag: "esencial" | "no-esencial") => void;
  pendingUpdates: Map<string, "esencial" | "no-esencial">;
  failedUpdates: Set<string>;
}) {
  // Note: total and colorScheme are available for future enhancements
  void _total;
  void _colorScheme;
  const esencialPct = data.total > 0 ? (data.esencial / data.total) * 100 : 0;
  const noEsencialPct = data.total > 0 ? (data.noEsencial / data.total) * 100 : 0;
  const sinClasificarPct = data.total > 0 ? (data.sinClasificar / data.total) * 100 : 0;

  return (
    <div>
      <div
        className="p-3 rounded-xl cursor-pointer transition-all"
        style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
        onClick={onToggle}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium" style={{ color: "var(--tg-theme-text-color)" }}>
            {data.category}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums" style={{ color: "var(--tg-theme-text-color)" }}>
              {formatCurrency(data.total, "EUR")}
            </span>
            <div style={{ color: "var(--tg-theme-hint-color)" }}>
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
          </div>
        </div>

        {/* Stacked progress bar */}
        <div className="h-2 rounded-full overflow-hidden flex" style={{ backgroundColor: "var(--tg-theme-bg-color)" }}>
          {data.esencial > 0 && (
            <div
              className="h-full"
              style={{ width: `${esencialPct}%`, backgroundColor: "#059669" }}
            />
          )}
          {data.noEsencial > 0 && (
            <div
              className="h-full"
              style={{ width: `${noEsencialPct}%`, backgroundColor: "#f59e0b" }}
            />
          )}
          {data.sinClasificar > 0 && (
            <div
              className="h-full"
              style={{ width: `${sinClasificarPct}%`, backgroundColor: "#94a3b8" }}
            />
          )}
        </div>

        {/* Mini legend */}
        <div className="flex gap-4 mt-2 text-xs">
          {data.esencial > 0 && (
            <span style={{ color: "#059669" }}>
              Esencial: {formatCurrency(data.esencial, "EUR")}
            </span>
          )}
          {data.noEsencial > 0 && (
            <span style={{ color: "#f59e0b" }}>
              No esencial: {formatCurrency(data.noEsencial, "EUR")}
            </span>
          )}
          {data.sinClasificar > 0 && (
            <span style={{ color: "#94a3b8" }}>
              ?: {formatCurrency(data.sinClasificar, "EUR")}
            </span>
          )}
        </div>
      </div>

      {/* Expanded transaction list */}
      {expanded && transactions.length > 0 && (
        <div
          className="mt-2 p-3 rounded-xl space-y-2 max-h-80 overflow-y-auto fade-in"
          style={{ backgroundColor: "var(--tg-theme-bg-color)", border: "1px solid var(--tg-theme-secondary-bg-color)" }}
        >
          {transactions.map((tx) => {
            const isPending = pendingUpdates.has(tx.id);
            const hasFailed = failedUpdates.has(tx.id);
            const isUnclassified = tx.classification === "sin-clasificar";

            return (
              <div key={tx.id} className={`py-2 ${isUnclassified ? "pb-3" : ""}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor:
                          tx.classification === "esencial"
                            ? "#059669"
                            : tx.classification === "no-esencial"
                            ? "#f59e0b"
                            : "#94a3b8",
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm truncate"
                        style={{ color: "var(--tg-theme-text-color)" }}
                      >
                        {tx.description}
                      </p>
                      <p className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                        {new Date(tx.date).toLocaleDateString("es-ES", {
                          day: "numeric",
                          month: "short",
                        })}
                      </p>
                    </div>
                  </div>
                  <span
                    className="text-sm font-medium tabular-nums ml-2"
                    style={{ color: "var(--tg-theme-text-color)" }}
                  >
                    {formatCurrency(tx.amount, "EUR")}
                  </span>
                </div>

                {/* Quick tag buttons for unclassified transactions */}
                {isUnclassified && (
                  <div className="flex gap-2 mt-2 ml-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickTag(tx.id, "esencial");
                      }}
                      disabled={isPending}
                      className="py-1 px-2 rounded text-xs font-medium flex items-center gap-1 transition-all"
                      style={{
                        backgroundColor: "rgba(5, 150, 105, 0.1)",
                        color: "#059669",
                        opacity: isPending ? 0.5 : 1,
                      }}
                    >
                      {isPending && pendingUpdates.get(tx.id) === "esencial" ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <Check size={10} />
                      )}
                      Esencial
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickTag(tx.id, "no-esencial");
                      }}
                      disabled={isPending}
                      className="py-1 px-2 rounded text-xs font-medium flex items-center gap-1 transition-all"
                      style={{
                        backgroundColor: "rgba(245, 158, 11, 0.1)",
                        color: "#f59e0b",
                        opacity: isPending ? 0.5 : 1,
                      }}
                    >
                      {isPending && pendingUpdates.get(tx.id) === "no-esencial" ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <X size={10} />
                      )}
                      No esencial
                    </button>
                    {hasFailed && (
                      <span className="text-xs" style={{ color: "#dc2626" }}>
                        Error
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
