export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: string;
  category: string | null;
  source?: string;
  destination?: string;
  tags?: string[];
  notes?: string | null;
}

export interface ExpenseData {
  category: string;
  amount: number;
  currency: string;
}

export interface Account {
  id: string;
  name: string;
  current_balance: number;
  currency_code: string;
  type: string;
}

export interface SummaryData {
  income: number;
  expenses: number;
  net: number;
}

export interface TimeSeriesData {
  date: string;
  [key: string]: number | string;
}

export type PeriodOption = {
  label: string;
  id: string;
  getRange: () => { start: string; end: string };
  isCustom?: boolean;
};

export interface CategoryTransactionData {
  id: string;
  date: string;
  amount: number;
  description: string;
  type?: string;
  category?: string | null;
}

export type Page = "dashboard" | "accounts" | "wizard" | "analysis";

// Helper to get month name in Spanish
function getMonthName(date: Date): string {
  return date.toLocaleDateString("es-ES", { month: "long" });
}

// Helper to capitalize first letter
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Format currency
export function formatCurrency(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Generate period options dynamically
export function getPeriodOptions(customStart?: string, customEnd?: string): PeriodOption[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const currentMonthStart = new Date(currentYear, currentMonth, 1);
  const currentMonthEnd = new Date(currentYear, currentMonth + 1, 0);

  const lastMonthStart = new Date(currentYear, currentMonth - 1, 1);
  const lastMonthEnd = new Date(currentYear, currentMonth, 0);

  const options: PeriodOption[] = [
    {
      label: "7 días",
      id: "7d",
      getRange: () => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 7);
        return {
          start: start.toISOString().split("T")[0],
          end: end.toISOString().split("T")[0],
        };
      },
    },
    {
      label: capitalize(getMonthName(currentMonthStart)),
      id: "current-month",
      getRange: () => ({
        start: currentMonthStart.toISOString().split("T")[0],
        end: currentMonthEnd.toISOString().split("T")[0],
      }),
    },
    {
      label: capitalize(getMonthName(lastMonthStart)),
      id: "last-month",
      getRange: () => ({
        start: lastMonthStart.toISOString().split("T")[0],
        end: lastMonthEnd.toISOString().split("T")[0],
      }),
    },
    {
      label: "1 año",
      id: "1y",
      getRange: () => {
        const end = new Date();
        const start = new Date();
        start.setFullYear(start.getFullYear() - 1);
        return {
          start: start.toISOString().split("T")[0],
          end: end.toISOString().split("T")[0],
        };
      },
    },
    {
      label: "Personalizado",
      id: "custom",
      isCustom: true,
      getRange: () => ({
        start: customStart || now.toISOString().split("T")[0],
        end: customEnd || now.toISOString().split("T")[0],
      }),
    },
  ];

  return options;
}

// Extract unique categories from transactions
export function getUniqueCategories(transactions: Transaction[]): string[] {
  const categories = new Set<string>();
  transactions.forEach((tx) => {
    if (tx.category) categories.add(tx.category);
  });
  return Array.from(categories).sort();
}

// Extract unique tags from transactions
export function getUniqueTags(transactions: Transaction[]): string[] {
  const tags = new Set<string>();
  transactions.forEach((tx) => {
    tx.tags?.forEach((tag) => tags.add(tag));
  });
  return Array.from(tags).sort();
}
