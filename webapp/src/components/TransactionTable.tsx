interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: string;
  category: string | null;
  source?: string;
  destination?: string;
}

interface TransactionTableProps {
  transactions: Transaction[];
  loading: boolean;
}

export function TransactionTable({ transactions, loading }: TransactionTableProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <p
          className="text-sm"
          style={{ color: "var(--tg-theme-hint-color)" }}
        >
          No transactions found
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
    <div className="space-y-4">
      {sortedDates.map((date) => (
        <div key={date}>
          {/* Date header */}
          <p
            className="text-xs font-medium uppercase tracking-wide mb-2 px-1"
            style={{ color: "var(--tg-theme-hint-color)" }}
          >
            {formatDate(date)}
          </p>

          {/* Transactions for this date */}
          <div className="space-y-2">
            {groupedByDate[date].map((tx) => (
              <TransactionRow key={`${tx.id}-${tx.date}-${tx.description}`} transaction={tx} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const isExpense = transaction.type === "withdrawal";
  const isIncome = transaction.type === "deposit";

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl transition-colors"
      style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
    >
      {/* Icon */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: isExpense
            ? "rgba(239, 68, 68, 0.1)"
            : isIncome
            ? "rgba(16, 185, 129, 0.1)"
            : "rgba(99, 102, 241, 0.1)",
        }}
      >
        <span className="text-lg">
          {getCategoryEmoji(transaction.category)}
        </span>
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
          className="text-xs truncate"
          style={{ color: "var(--tg-theme-hint-color)" }}
        >
          {transaction.category || "Uncategorized"}
        </p>
      </div>

      {/* Amount */}
      <div className="text-right flex-shrink-0">
        <p
          className="font-semibold tabular-nums"
          style={{
            color: isExpense
              ? "#ef4444"
              : isIncome
              ? "#10b981"
              : "var(--tg-theme-text-color)",
          }}
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
    return "Today";
  }
  if (dateStr === yesterday.toISOString().split("T")[0]) {
    return "Yesterday";
  }

  return date.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getCategoryEmoji(category: string | null): string {
  if (!category) return "📦";

  const lower = category.toLowerCase();

  // Common category mappings
  const emojiMap: Record<string, string> = {
    groceries: "🛒",
    supermercado: "🛒",
    food: "🍽️",
    comida: "🍽️",
    restaurant: "🍽️",
    restaurante: "🍽️",
    transport: "🚗",
    transporte: "🚗",
    uber: "🚕",
    taxi: "🚕",
    gas: "⛽",
    gasolina: "⛽",
    entertainment: "🎬",
    ocio: "🎬",
    shopping: "🛍️",
    compras: "🛍️",
    health: "💊",
    salud: "💊",
    pharmacy: "💊",
    farmacia: "💊",
    utilities: "💡",
    servicios: "💡",
    bills: "📄",
    facturas: "📄",
    subscription: "📱",
    suscripción: "📱",
    travel: "✈️",
    viaje: "✈️",
    hotel: "🏨",
    coffee: "☕",
    café: "☕",
    gym: "🏋️",
    sport: "⚽",
    deporte: "⚽",
    clothing: "👕",
    ropa: "👕",
    electronics: "📱",
    electrónica: "📱",
    home: "🏠",
    hogar: "🏠",
    education: "📚",
    educación: "📚",
    gift: "🎁",
    regalo: "🎁",
    pet: "🐕",
    mascota: "🐕",
    beauty: "💄",
    belleza: "💄",
    insurance: "🛡️",
    seguro: "🛡️",
    taxes: "📋",
    impuestos: "📋",
    internet: "🌐",
    phone: "📞",
    teléfono: "📞",
  };

  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (lower.includes(key)) {
      return emoji;
    }
  }

  return "📦";
}
