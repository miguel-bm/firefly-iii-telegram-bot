import { ArrowLeftRight, Receipt } from "lucide-react";
import type { ReactNode } from "react";
import type { Transaction } from "../lib/dashboard";
import { getCategoryIcon as resolveCategoryIcon } from "../lib/categoryIcons";
import { formatCurrencyWithCents as formatCurrency } from "../lib/format";
import { formatSpanishDate } from "../lib/date";

/**
 * Get icon for a category using smart keyword matching
 * Matches partial keywords against category name (case-insensitive)
 */
function getCategoryIcon(category: string | null, isTransfer: boolean, color: string): ReactNode {
  const iconProps = { size: 18, color, strokeWidth: 2 };
  const Icon = isTransfer ? ArrowLeftRight : resolveCategoryIcon(category);
  return <Icon {...iconProps} />;
}

interface TransactionListProps {
  transactions: Transaction[];
  loading: boolean;
  onTransactionClick?: (tx: Transaction) => void;
}

export function TransactionList({ transactions, loading, onTransactionClick }: TransactionListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton-light h-16 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="empty-state py-6">
        <Receipt size={48} className="empty-state-icon" style={{ opacity: 0.3 }} />
        <p
          className="font-medium mb-1"
          style={{ color: "var(--tg-theme-text-color)" }}
        >
          Sin transacciones
        </p>
        <p
          className="text-sm"
          style={{ color: "var(--tg-theme-hint-color)" }}
        >
          Tu actividad reciente aparecerá aquí
        </p>
      </div>
    );
  }

  // Group transactions by date
  const groupedByDate = transactions.reduce((groups, tx) => {
    const date = tx.date.split("T")[0];
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(tx);
    return groups;
  }, {} as Record<string, Transaction[]>);

  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div>
      {sortedDates.map((date) => (
        <div key={date}>
          {/* Date header */}
          <div className="flex items-center gap-3 py-3">
            <p
              className="text-overline"
              style={{ color: "var(--tg-theme-hint-color)" }}
            >
              {formatDate(date)}
            </p>
            <div className="divider-inline" />
            <p
              className="text-xs tabular-nums font-medium"
              style={{ color: "var(--tg-theme-hint-color)" }}
            >
              {formatDayTotal(groupedByDate[date])}
            </p>
          </div>

          {/* Transactions for this date */}
          <div>
            {groupedByDate[date].map((tx) => (
              <TransactionRow
                key={`${tx.id}-${tx.date}-${tx.description}`}
                transaction={tx}
                onClick={onTransactionClick}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TransactionRow({
  transaction,
  onClick,
}: {
  transaction: Transaction;
  onClick?: (tx: Transaction) => void;
}) {
  const isExpense = transaction.type === "withdrawal";
  const isIncome = transaction.type === "deposit";
  const isTransfer = transaction.type === "transfer";

  // Color scheme based on type
  const typeColors = {
    bg: isExpense
      ? "rgba(220, 38, 38, 0.08)"
      : isIncome
      ? "rgba(5, 150, 105, 0.08)"
      : "rgba(99, 102, 241, 0.08)",
    icon: isExpense ? "#dc2626" : isIncome ? "#059669" : "#6366f1",
    text: isExpense ? "#dc2626" : isIncome ? "#059669" : "#6366f1",
  };

  return (
    <div
      className={`tx-row ${onClick ? "cursor-pointer" : ""}`}
      onClick={() => onClick?.(transaction)}
    >
      {/* Icon */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: typeColors.bg }}
      >
        {getCategoryIcon(transaction.category, isTransfer, typeColors.icon)}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <p
          className="font-medium truncate"
          style={{ color: "var(--tg-theme-text-color)" }}
        >
          {transaction.description}
        </p>
        <p
          className="text-caption truncate"
          style={{ color: "var(--tg-theme-hint-color)" }}
        >
          {transaction.category || "Sin categoría"}
        </p>
      </div>

      {/* Amount */}
      <div className="text-right flex-shrink-0">
        <p
          className="font-semibold tabular-nums"
          style={{ color: typeColors.text }}
        >
          {isExpense ? "-" : isIncome ? "+" : ""}
          {formatCurrency(transaction.amount)}
        </p>
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dateStr === today.toISOString().split("T")[0]) {
    return "Hoy";
  }
  if (dateStr === yesterday.toISOString().split("T")[0]) {
    return "Ayer";
  }

  return formatSpanishDate(date, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function formatDayTotal(transactions: Transaction[]): string {
  const total = transactions.reduce((sum, tx) => {
    if (tx.type === "withdrawal") return sum - tx.amount;
    if (tx.type === "deposit") return sum + tx.amount;
    return sum;
  }, 0);

  const sign = total < 0 ? "-" : "+";
  return `${sign}${formatCurrency(Math.abs(total))}`;
}
