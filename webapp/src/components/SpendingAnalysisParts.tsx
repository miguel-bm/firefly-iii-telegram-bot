import { ChevronDown, ChevronUp, Check, X, Loader2 } from "lucide-react";
import type { CategoryBreakdown, ClassifiedExpense } from "./SpendingAnalysis";

export function LegendItem({
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

export function CategoryRow({
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

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
