import {
  ShoppingCart,
  Utensils,
  Car,
  Plane,
  Film,
  ShoppingBag,
  Pill,
  Lightbulb,
  FileText,
  Smartphone,
  Coffee,
  Dumbbell,
  Home,
  GraduationCap,
  Gift,
  Heart,
  Shield,
  Wifi,
  CreditCard,
  ArrowLeftRight,
  TrendingUp,
  Banknote,
  Package,
  Receipt,
  Fuel,
  Baby,
  PawPrint,
  Wrench,
  Building2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

// Icon category mapping with multiple keywords per category
// Keywords are matched against the category name (case-insensitive, partial match)
const ICON_CATEGORIES: { icon: LucideIcon; keywords: string[] }[] = [
  // Groceries & Supermarkets
  {
    icon: ShoppingCart,
    keywords: [
      "supermercado", "mercadona", "lidl", "carrefour", "aldi", "dia", "eroski",
      "groceries", "grocery", "alimentación", "alimentacion", "supermarket",
      "hipercor", "alcampo", "consum", "bonarea", "ahorramas", "market"
    ]
  },
  // Dining & Restaurants
  {
    icon: Utensils,
    keywords: [
      "restaurante", "restaurant", "comida", "cena", "almuerzo", "dining",
      "food", "lunch", "dinner", "meal", "eat", "bistro", "pizzeria", "burger",
      "sushi", "tapas", "brunch", "catering"
    ]
  },
  // Coffee & Cafes
  {
    icon: Coffee,
    keywords: [
      "café", "cafe", "coffee", "starbucks", "bar", "cafetería", "cafeteria",
      "desayuno", "breakfast", "bakery", "panadería", "panaderia"
    ]
  },
  // Transport & Vehicles
  {
    icon: Car,
    keywords: [
      "transporte", "transport", "uber", "cabify", "taxi", "bolt", "lyft",
      "coche", "car", "auto", "vehicle", "vehiculo", "parking", "aparcamiento",
      "peaje", "toll", "metro", "bus", "tren", "train", "renfe"
    ]
  },
  // Fuel & Gas
  {
    icon: Fuel,
    keywords: [
      "gasolina", "gasolinera", "fuel", "gas", "petrol", "diesel", "repsol",
      "cepsa", "bp", "shell", "carburante", "repostaje"
    ]
  },
  // Travel & Hotels
  {
    icon: Plane,
    keywords: [
      "viaje", "travel", "vuelo", "flight", "hotel", "airbnb", "booking",
      "hostel", "vacation", "vacaciones", "aeropuerto", "airport", "iberia",
      "ryanair", "vueling", "trip", "tourism", "turismo"
    ]
  },
  // Entertainment & Leisure
  {
    icon: Film,
    keywords: [
      "ocio", "cine", "cinema", "movie", "entretenimiento", "entertainment",
      "teatro", "theater", "theatre", "concert", "concierto", "museo", "museum",
      "netflix", "hbo", "disney", "spotify", "streaming", "gaming", "juegos"
    ]
  },
  // Shopping & Retail
  {
    icon: ShoppingBag,
    keywords: [
      "compras", "shopping", "ropa", "clothing", "clothes", "fashion", "moda",
      "zara", "h&m", "primark", "mango", "retail", "tienda", "store", "shop",
      "amazon", "aliexpress", "ebay", "online"
    ]
  },
  // Health & Medical
  {
    icon: Pill,
    keywords: [
      "salud", "health", "farmacia", "pharmacy", "medicina", "medicine",
      "médico", "medico", "doctor", "hospital", "clínica", "clinica",
      "dentista", "dentist", "óptica", "optica"
    ]
  },
  // Wellness & Heart
  {
    icon: Heart,
    keywords: [
      "bienestar", "wellness", "spa", "masaje", "massage", "therapy", "terapia",
      "psicólogo", "psicologo", "mental"
    ]
  },
  // Utilities - Electricity
  {
    icon: Lightbulb,
    keywords: [
      "luz", "electricidad", "electricity", "electric", "endesa", "iberdrola",
      "naturgy", "energía", "energia", "power", "suministros", "utilities"
    ]
  },
  // Utilities - Internet & Phone
  {
    icon: Wifi,
    keywords: [
      "internet", "wifi", "fibra", "fiber", "broadband", "movistar", "vodafone",
      "orange", "yoigo", "masmovil"
    ]
  },
  // Phone & Mobile
  {
    icon: Smartphone,
    keywords: [
      "teléfono", "telefono", "phone", "móvil", "movil", "mobile", "cellular",
      "suscripción", "suscripcion", "subscription", "app", "digital"
    ]
  },
  // Bills & Documents
  {
    icon: FileText,
    keywords: [
      "facturas", "factura", "bill", "bills", "invoice", "recibo", "receipt",
      "impuestos", "taxes", "tax", "iva", "irpf", "hacienda"
    ]
  },
  // Fitness & Sports
  {
    icon: Dumbbell,
    keywords: [
      "gimnasio", "gym", "fitness", "deporte", "sport", "sports", "ejercicio",
      "exercise", "yoga", "pilates", "crossfit", "entrenamiento", "training"
    ]
  },
  // Home & Housing
  {
    icon: Home,
    keywords: [
      "hogar", "home", "casa", "house", "alquiler", "rent", "hipoteca",
      "mortgage", "vivienda", "housing", "inmobiliaria", "real estate",
      "comunidad", "piso", "apartment"
    ]
  },
  // Home Maintenance
  {
    icon: Wrench,
    keywords: [
      "reparación", "reparacion", "repair", "mantenimiento", "maintenance",
      "fontanero", "plumber", "electricista", "electrician", "reformas",
      "bricolaje", "ikea", "leroy", "ferretería", "ferreteria"
    ]
  },
  // Education
  {
    icon: GraduationCap,
    keywords: [
      "educación", "educacion", "education", "escuela", "school", "universidad",
      "university", "college", "curso", "course", "formación", "formacion",
      "training", "libro", "book", "matrícula", "matricula", "tuition"
    ]
  },
  // Gifts
  {
    icon: Gift,
    keywords: [
      "regalo", "regalos", "gift", "gifts", "present", "cumpleaños", "birthday",
      "navidad", "christmas", "celebración", "celebracion"
    ]
  },
  // Insurance
  {
    icon: Shield,
    keywords: [
      "seguro", "seguros", "insurance", "póliza", "poliza", "aseguradora",
      "mapfre", "axa", "allianz", "zurich", "sanitas", "adeslas"
    ]
  },
  // Banking & Finance
  {
    icon: CreditCard,
    keywords: [
      "banco", "bank", "banking", "tarjeta", "card", "comisión", "comision",
      "fee", "cuenta", "account", "bbva", "santander", "caixa", "sabadell",
      "ing", "n26", "revolut", "wise"
    ]
  },
  // Transfers
  {
    icon: ArrowLeftRight,
    keywords: [
      "transferencia", "transfer", "envío", "envio", "remesa", "bizum",
      "paypal", "traspaso"
    ]
  },
  // Savings & Investments
  {
    icon: TrendingUp,
    keywords: [
      "inversión", "inversion", "investment", "acciones", "stocks", "fondos",
      "funds", "etf", "crypto", "cripto", "bitcoin", "bolsa", "trading"
    ]
  },
  // Savings
  {
    icon: Banknote,
    keywords: [
      "ahorro", "ahorros", "savings", "depósito", "deposito", "deposit",
      "hucha", "emergency"
    ]
  },
  // Income & Salary
  {
    icon: Wallet,
    keywords: [
      "nómina", "nomina", "salario", "salary", "sueldo", "wage", "income",
      "ingreso", "pago", "payment", "freelance", "facturación", "facturacion"
    ]
  },
  // Children & Baby
  {
    icon: Baby,
    keywords: [
      "bebé", "bebe", "baby", "niño", "niños", "nino", "ninos", "child",
      "children", "guardería", "guarderia", "daycare", "colegio", "escuela"
    ]
  },
  // Pets
  {
    icon: PawPrint,
    keywords: [
      "mascota", "mascotas", "pet", "pets", "perro", "dog", "gato", "cat",
      "veterinario", "veterinary", "vet", "animal"
    ]
  },
  // Work & Business
  {
    icon: Building2,
    keywords: [
      "trabajo", "work", "oficina", "office", "negocio", "business", "empresa",
      "company", "profesional", "professional", "coworking"
    ]
  },
];

/**
 * Get icon for a category using smart keyword matching
 * Matches partial keywords against category name (case-insensitive)
 */
function getCategoryIcon(category: string | null, isTransfer: boolean, color: string): ReactNode {
  const iconProps = { size: 18, color, strokeWidth: 2 };

  if (isTransfer) return <ArrowLeftRight {...iconProps} />;
  if (!category) return <Package {...iconProps} />;

  const lower = category.toLowerCase();

  // Find first matching category
  for (const { icon: Icon, keywords } of ICON_CATEGORIES) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return <Icon {...iconProps} />;
      }
    }
  }

  // Fallback: generic package icon
  return <Package {...iconProps} />;
}

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

  return date.toLocaleDateString("es-ES", {
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

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

