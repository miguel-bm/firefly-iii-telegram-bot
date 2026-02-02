import { useEffect, useState, useCallback, useMemo } from "react";
import {
  LayoutDashboard,
  Landmark,
  Search,
  X,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Calendar,
  Tag,
  FolderOpen,
} from "lucide-react";
import { CategoryChart } from "./components/ExpenseChart";
import { TransactionList } from "./components/TransactionList";
import { TransactionDetail } from "./components/TransactionDetail";
import { AccountsPage } from "./components/AccountsPage";
import { useTelegram } from "./hooks/useTelegram";

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

type PeriodOption = {
  label: string;
  id: string;
  getRange: () => { start: string; end: string };
  isCustom?: boolean;
};

interface CategoryTransactionData {
  id: string;
  date: string;
  amount: number;
  description: string;
  type?: string;
  category?: string | null;
}

type Page = "dashboard" | "accounts";

// Helper to get month name in Spanish
function getMonthName(date: Date): string {
  return date.toLocaleDateString("es-ES", { month: "long" });
}

// Helper to capitalize first letter
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Format currency
function formatCurrency(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Generate period options dynamically
function getPeriodOptions(customStart?: string, customEnd?: string): PeriodOption[] {
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
function getUniqueCategories(transactions: Transaction[]): string[] {
  const categories = new Set<string>();
  transactions.forEach((tx) => {
    if (tx.category) categories.add(tx.category);
  });
  return Array.from(categories).sort();
}

// Extract unique tags from transactions
function getUniqueTags(transactions: Transaction[]): string[] {
  const tags = new Set<string>();
  transactions.forEach((tx) => {
    tx.tags?.forEach((tag) => tags.add(tag));
  });
  return Array.from(tags).sort();
}

function App() {
  const { initData, isReady, colorScheme, webApp } = useTelegram();

  // Navigation
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");

  // Data state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [expenses, setExpenses] = useState<ExpenseData[]>([]);
  const [income, setIncome] = useState<ExpenseData[]>([]);
  const [assets, setAssets] = useState<Account[]>([]);
  const [liabilities, setLiabilities] = useState<Account[]>([]);
  const [summary, setSummary] = useState<SummaryData>({ income: 0, expenses: 0, net: 0 });

  // Category drill-down state
  const [selectedChartCategory, setSelectedChartCategory] = useState<string | null>(null);
  const [categoryTransactions, setCategoryTransactions] = useState<CategoryTransactionData[]>([]);
  const [categoryTransactionsLoading, setCategoryTransactionsLoading] = useState(false);

  // Time-based data for stacked bar chart
  const [expenseTimeData, setExpenseTimeData] = useState<{ date: string; [key: string]: number | string }[]>([]);
  const [expenseTimeCategories, setExpenseTimeCategories] = useState<string[]>([]);
  const [incomeTimeData, setIncomeTimeData] = useState<{ date: string; [key: string]: number | string }[]>([]);
  const [incomeTimeCategories, setIncomeTimeCategories] = useState<string[]>([]);
  const [timeDataLoading, setTimeDataLoading] = useState(false);

  // Loading state
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("current-month");
  const [customDateStart, setCustomDateStart] = useState<string>("");
  const [customDateEnd, setCustomDateEnd] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchAllHistory, setSearchAllHistory] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Advanced search filters
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [dateFromFilter, setDateFromFilter] = useState<string>("");
  const [dateToFilter, setDateToFilter] = useState<string>("");

  // Detail view
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  const periodOptions = useMemo(() => getPeriodOptions(customDateStart, customDateEnd), [customDateStart, customDateEnd]);
  const selectedPeriod = periodOptions.find((p) => p.id === selectedPeriodId) || periodOptions[1];
  const isCustomPeriod = selectedPeriod.isCustom;

  // Get unique categories and tags for filter dropdowns
  const availableCategories = useMemo(() => getUniqueCategories(transactions), [transactions]);
  const availableTags = useMemo(() => getUniqueTags(transactions), [transactions]);

  // Check if any filter is active
  const hasActiveFilters = searchQuery || typeFilter !== "all" || categoryFilter || tagFilter || dateFromFilter || dateToFilter;

  // Build headers for API calls
  const getHeaders = useCallback(() => {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (initData) {
      headers["X-Telegram-Init-Data"] = initData;
    }
    return headers;
  }, [initData]);

  // Fetch base data (accounts)
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts", { headers: getHeaders() });
      if (!res.ok) throw new Error("Error al cargar cuentas");
      const data = await res.json();
      setAssets(data.assets || []);
      setLiabilities(data.liabilities || []);
    } catch (err) {
      console.error("Fetch accounts error:", err);
    }
  }, [getHeaders]);

  // Fetch transactions
  const fetchTransactions = useCallback(async (searchAll = false) => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (searchAll && searchQuery) {
        params.set("search", searchQuery);
      }
      const res = await fetch(`/api/transactions?${params}`, { headers: getHeaders() });
      if (!res.ok) throw new Error("Error al cargar transacciones");
      const data = await res.json();
      setTransactions(data.transactions || []);
    } catch (err) {
      console.error("Fetch transactions error:", err);
    }
  }, [getHeaders, searchQuery]);

  // Fetch period-specific data (expenses, income, and summary)
  const fetchPeriodData = useCallback(async () => {
    if (!initData) return;

    try {
      setSummaryLoading(true);
      setTimeDataLoading(true);
      const { start, end } = selectedPeriod.getRange();

      const [expRes, incRes, sumRes, expTimeRes, incTimeRes] = await Promise.all([
        fetch(`/api/expenses/by-category?start=${start}&end=${end}`, { headers: getHeaders() }),
        fetch(`/api/income/by-category?start=${start}&end=${end}`, { headers: getHeaders() }),
        fetch(`/api/summary?start=${start}&end=${end}`, { headers: getHeaders() }),
        fetch(`/api/expenses/by-time?start=${start}&end=${end}&type=withdrawal`, { headers: getHeaders() }),
        fetch(`/api/expenses/by-time?start=${start}&end=${end}&type=deposit`, { headers: getHeaders() }),
      ]);

      if (expRes.ok) {
        const expData = await expRes.json();
        setExpenses(expData.data || []);
      }

      if (incRes.ok) {
        const incData = await incRes.json();
        setIncome(incData.data || []);
      }

      if (sumRes.ok) {
        const sumData = await sumRes.json();
        setSummary({
          income: sumData.income || 0,
          expenses: sumData.expenses || 0,
          net: sumData.net || 0,
        });
      }

      if (expTimeRes.ok) {
        const expTimeData = await expTimeRes.json();
        setExpenseTimeData(expTimeData.data || []);
        setExpenseTimeCategories(expTimeData.categories || []);
      }

      if (incTimeRes.ok) {
        const incTimeData = await incTimeRes.json();
        setIncomeTimeData(incTimeData.data || []);
        setIncomeTimeCategories(incTimeData.categories || []);
      }
    } catch (err) {
      console.error("Fetch period data error:", err);
    } finally {
      setSummaryLoading(false);
      setTimeDataLoading(false);
    }
  }, [initData, selectedPeriod, getHeaders]);

  // Fetch transactions for a specific category (for drill-down)
  const fetchCategoryTransactions = useCallback(async (category: string, type: "expense" | "income") => {
    if (!initData) return;

    try {
      setCategoryTransactionsLoading(true);
      const { start, end } = selectedPeriod.getRange();
      const txType = type === "expense" ? "withdrawal" : "deposit";

      const res = await fetch(
        `/api/transactions/by-category?category=${encodeURIComponent(category)}&type=${txType}&start=${start}&end=${end}`,
        { headers: getHeaders() }
      );

      if (res.ok) {
        const data = await res.json();
        setCategoryTransactions(data.data || []);
      }
    } catch (err) {
      console.error("Fetch category transactions error:", err);
    } finally {
      setCategoryTransactionsLoading(false);
    }
  }, [initData, selectedPeriod, getHeaders]);

  // Handle category selection from chart
  const handleCategorySelect = useCallback((category: string | null, type: "expense" | "income") => {
    setSelectedChartCategory(category);
    webApp?.HapticFeedback?.impactOccurred("light");

    if (category) {
      fetchCategoryTransactions(category, type);
    } else {
      setCategoryTransactions([]);
    }
  }, [fetchCategoryTransactions, webApp]);

  // Initial load
  useEffect(() => {
    if (!isReady) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([fetchAccounts(), fetchTransactions()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ha ocurrido un error");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isReady, fetchAccounts, fetchTransactions]);

  // Fetch period data when period changes
  useEffect(() => {
    if (!isReady || !initData) return;
    fetchPeriodData();
  }, [isReady, initData, fetchPeriodData]);

  // Scroll to top when changing pages or views
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentPage, selectedTransaction]);

  // Handle period change
  const handlePeriodChange = (periodId: string) => {
    if (periodId !== selectedPeriodId) {
      setSelectedPeriodId(periodId);
      setSelectedChartCategory(null); // Clear category drill-down
      setCategoryTransactions([]);
      webApp?.HapticFeedback?.selectionChanged();
    }
  };

  // Handle custom date change
  const handleCustomDateChange = (start: string, end: string) => {
    setCustomDateStart(start);
    setCustomDateEnd(end);
    setSelectedChartCategory(null);
    setCategoryTransactions([]);
  };

  // Handle search all history toggle
  const handleSearchAllHistory = async () => {
    const newValue = !searchAllHistory;
    setSearchAllHistory(newValue);
    webApp?.HapticFeedback?.selectionChanged();

    if (newValue && searchQuery) {
      await fetchTransactions(true);
    }
  };

  // Clear all filters
  const clearAllFilters = () => {
    setSearchQuery("");
    setTypeFilter("all");
    setCategoryFilter("");
    setTagFilter("");
    setDateFromFilter("");
    setDateToFilter("");
    setSearchAllHistory(false);
    webApp?.HapticFeedback?.selectionChanged();
  };

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // Type filter
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;

      // Category filter
      if (categoryFilter && tx.category !== categoryFilter) return false;

      // Tag filter
      if (tagFilter && !tx.tags?.includes(tagFilter)) return false;

      // Date range filter
      if (dateFromFilter) {
        const txDate = tx.date.split("T")[0];
        if (txDate < dateFromFilter) return false;
      }
      if (dateToFilter) {
        const txDate = tx.date.split("T")[0];
        if (txDate > dateToFilter) return false;
      }

      // Search query filter (client-side when not searching all history)
      if (searchQuery && !searchAllHistory) {
        const query = searchQuery.toLowerCase();
        const matches =
          tx.description.toLowerCase().includes(query) ||
          tx.category?.toLowerCase().includes(query) ||
          tx.source?.toLowerCase().includes(query) ||
          tx.destination?.toLowerCase().includes(query);
        if (!matches) return false;
      }

      return true;
    });
  }, [transactions, searchQuery, typeFilter, searchAllHistory, categoryFilter, tagFilter, dateFromFilter, dateToFilter]);

  // Calculate totals
  const totalAssets = assets.reduce((sum, acc) => sum + acc.current_balance, 0);
  const totalLiabilities = liabilities.reduce((sum, acc) => sum + acc.current_balance, 0);
  const netWorth = totalAssets - Math.abs(totalLiabilities);
  const mainCurrency = assets[0]?.currency_code || "EUR";

  // Handle transaction update
  const handleTransactionUpdate = async (id: string, updates: Partial<Transaction>) => {
    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify(updates),
      });

      if (!res.ok) throw new Error("Error al actualizar");

      // Refresh transactions
      await fetchTransactions();
      webApp?.HapticFeedback?.notificationOccurred("success");
      return true;
    } catch (err) {
      console.error("Update error:", err);
      webApp?.HapticFeedback?.notificationOccurred("error");
      return false;
    }
  };

  // Transaction detail view
  if (selectedTransaction) {
    return (
      <TransactionDetail
        transaction={selectedTransaction}
        onBack={() => setSelectedTransaction(null)}
        onUpdate={handleTransactionUpdate}
        colorScheme={colorScheme}
      />
    );
  }

  // Accounts page
  if (currentPage === "accounts") {
    return (
      <AccountsPage
        assets={assets}
        liabilities={liabilities}
        loading={loading}
        colorScheme={colorScheme}
        initData={initData}
        onNavigate={setCurrentPage}
      />
    );
  }

  // Dashboard page
  return (
    <div className={`app-container ${colorScheme === "dark" ? "dark" : ""}`}>
      {/* Header with balance display */}
      <div className="header-gradient" style={{ margin: 0, padding: "20px 20px 32px" }}>
        {/* Main balance: Total Assets */}
        <div className="mb-4">
          <p className="text-overline" style={{ color: "rgba(255,255,255,0.6)" }}>
            Activos totales
          </p>
          {loading ? (
            <div className="skeleton h-12 w-48 mt-2" />
          ) : (
            <p className="text-display text-white tabular-nums">
              {formatCurrency(totalAssets, mainCurrency)}
            </p>
          )}
        </div>

        {/* Secondary: Liabilities & Net Worth */}
        <div className="flex gap-8">
          <div>
            <p className="text-caption" style={{ color: "rgba(255,255,255,0.5)" }}>Pasivos</p>
            <p className="text-lg font-semibold tabular-nums" style={{ color: "#fca5a5" }}>
              {loading ? "—" : `-${formatCurrency(Math.abs(totalLiabilities), mainCurrency)}`}
            </p>
          </div>
          <div>
            <p className="text-caption" style={{ color: "rgba(255,255,255,0.5)" }}>Balance neto</p>
            <p className="text-lg font-semibold text-white tabular-nums">
              {loading ? "—" : formatCurrency(netWorth, mainCurrency)}
            </p>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ padding: "0 20px" }}>
        {/* Error state */}
        {error && (
          <div className="error-banner fade-in" style={{ marginTop: 20 }}>
            <p className="font-medium" style={{ color: "#dc2626" }}>Algo salió mal</p>
            <p className="text-caption">{error}</p>
          </div>
        )}

        {/* Period selector */}
        <div className="filter-row fade-in" style={{ marginTop: 20, marginBottom: isCustomPeriod ? 8 : 16, flexWrap: "wrap", gap: 8 }}>
          {periodOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => handlePeriodChange(option.id)}
              className={`chip ${selectedPeriodId === option.id ? "chip-active" : "chip-inactive"}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Custom date range picker */}
        {isCustomPeriod && (
          <div className="custom-date-range fade-in" style={{ marginBottom: 16 }}>
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={customDateStart}
                onChange={(e) => handleCustomDateChange(e.target.value, customDateEnd || e.target.value)}
                className="date-input"
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--tg-theme-hint-color)",
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: "var(--tg-theme-text-color)",
                  fontSize: 14,
                }}
              />
              <span style={{ color: "var(--tg-theme-hint-color)" }}>→</span>
              <input
                type="date"
                value={customDateEnd}
                onChange={(e) => handleCustomDateChange(customDateStart || e.target.value, e.target.value)}
                className="date-input"
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--tg-theme-hint-color)",
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: "var(--tg-theme-text-color)",
                  fontSize: 14,
                }}
              />
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="stats-grid fade-in" style={{ marginBottom: 24 }}>
          <div className="stat-item">
            <p className="text-overline">Ingresos</p>
            <p className="text-lg font-semibold tabular-nums" style={{ color: "#059669" }}>
              {summaryLoading ? "—" : `+${formatCurrency(summary.income, mainCurrency)}`}
            </p>
          </div>
          <div className="stat-item">
            <p className="text-overline">Gastos</p>
            <p className="text-lg font-semibold tabular-nums" style={{ color: "#dc2626" }}>
              {summaryLoading ? "—" : `-${formatCurrency(summary.expenses, mainCurrency)}`}
            </p>
          </div>
          <div className="stat-item">
            <p className="text-overline">Neto</p>
            <p
              className="text-lg font-semibold tabular-nums"
              style={{ color: summary.net >= 0 ? "#059669" : "#dc2626" }}
            >
              {summaryLoading ? "—" : formatCurrency(summary.net, mainCurrency)}
            </p>
          </div>
        </div>

        {/* Expense/Income chart section */}
        <section className="fade-in" style={{ marginBottom: 32 }}>
          <h2 className="text-title mb-4" style={{ color: "var(--tg-theme-text-color)" }}>
            Por categoría
          </h2>
          <CategoryChart
            expenseData={expenses}
            incomeData={income}
            loading={loading || summaryLoading}
            periodLabel={isCustomPeriod && customDateStart && customDateEnd
              ? `${new Date(customDateStart).toLocaleDateString("es-ES", { day: "numeric", month: "short" })} - ${new Date(customDateEnd).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`
              : selectedPeriod.label
            }
            periodStart={selectedPeriod.getRange().start}
            periodEnd={selectedPeriod.getRange().end}
            categoryTransactions={categoryTransactions}
            categoryTransactionsLoading={categoryTransactionsLoading}
            selectedCategory={selectedChartCategory}
            onCategorySelect={handleCategorySelect}
            onTransactionClick={(tx) => {
              // Convert category transaction to full Transaction type for detail view
              const fullTx: Transaction = {
                id: tx.id,
                date: tx.date,
                description: tx.description,
                amount: Math.abs(tx.amount),
                type: tx.type || "withdrawal",
                category: tx.category || null,
              };
              setSelectedTransaction(fullTx);
              webApp?.HapticFeedback?.impactOccurred("light");
            }}
            expenseTimeData={expenseTimeData}
            expenseTimeCategories={expenseTimeCategories}
            incomeTimeData={incomeTimeData}
            incomeTimeCategories={incomeTimeCategories}
            timeDataLoading={timeDataLoading}
          />
        </section>

        <div className="section-divider" />

        {/* Transactions section */}
        <section className="fade-in">
          <h2 className="text-title mb-4" style={{ color: "var(--tg-theme-text-color)" }}>
            Actividad reciente
          </h2>

          {/* Search bar with advanced toggle */}
          <div className="search-wrapper mb-3">
            <Search className="search-icon" size={18} />
            <input
              type="text"
              className="search-input"
              placeholder="Buscar transacciones..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setShowAdvancedFilters(true)}
            />
            {hasActiveFilters && (
              <button className="search-clear" onClick={clearAllFilters}>
                <X size={18} />
              </button>
            )}
            <button
              className="advanced-filter-toggle"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              style={{
                color: showAdvancedFilters ? "var(--tg-theme-text-color)" : "var(--tg-theme-hint-color)"
              }}
            >
              <SlidersHorizontal size={18} />
            </button>
          </div>

          {/* Advanced filters panel */}
          {showAdvancedFilters && (
            <div className="advanced-filters fade-in">
              {/* Search all history toggle */}
              <div className="toggle-wrapper mb-3">
                <button
                  className={`toggle ${searchAllHistory ? "active" : ""}`}
                  onClick={handleSearchAllHistory}
                >
                  <div className="toggle-knob" />
                </button>
                <span className="text-caption">Buscar en todo el historial</span>
              </div>

              {/* Type filters */}
              <div className="filter-row mb-3">
                {[
                  { id: "all", label: "Todos" },
                  { id: "withdrawal", label: "Gastos" },
                  { id: "deposit", label: "Ingresos" },
                  { id: "transfer", label: "Transferencias" },
                ].map((filter) => (
                  <button
                    key={filter.id}
                    onClick={() => {
                      setTypeFilter(filter.id);
                      webApp?.HapticFeedback?.selectionChanged();
                    }}
                    className={`chip ${typeFilter === filter.id ? "chip-active" : "chip-inactive"}`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              {/* Category and Tag filters */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="filter-select-wrapper">
                  <FolderOpen size={16} className="filter-select-icon" />
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="filter-select"
                  >
                    <option value="">Categoría</option>
                    {availableCategories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="filter-select-arrow" />
                </div>

                <div className="filter-select-wrapper">
                  <Tag size={16} className="filter-select-icon" />
                  <select
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    className="filter-select"
                  >
                    <option value="">Etiqueta</option>
                    {availableTags.map((tag) => (
                      <option key={tag} value={tag}>{tag}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="filter-select-arrow" />
                </div>
              </div>

              {/* Date range filters */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="filter-select-wrapper">
                  <Calendar size={16} className="filter-select-icon" />
                  <input
                    type="date"
                    value={dateFromFilter}
                    onChange={(e) => setDateFromFilter(e.target.value)}
                    className="filter-select"
                    placeholder="Desde"
                  />
                </div>

                <div className="filter-select-wrapper">
                  <Calendar size={16} className="filter-select-icon" />
                  <input
                    type="date"
                    value={dateToFilter}
                    onChange={(e) => setDateToFilter(e.target.value)}
                    className="filter-select"
                    placeholder="Hasta"
                  />
                </div>
              </div>

              {/* Collapse button */}
              <button
                className="collapse-filters-btn"
                onClick={() => setShowAdvancedFilters(false)}
              >
                <ChevronUp size={16} />
                <span>Ocultar filtros</span>
              </button>
            </div>
          )}

          {/* Active filters summary */}
          {hasActiveFilters && !showAdvancedFilters && (
            <div className="active-filters-summary mb-3">
              <span className="text-caption">
                {filteredTransactions.length} resultado{filteredTransactions.length !== 1 ? "s" : ""}
              </span>
              <button onClick={clearAllFilters} className="clear-filters-btn">
                Limpiar filtros
              </button>
            </div>
          )}

          <TransactionList
            transactions={filteredTransactions}
            loading={loading}
            onTransactionClick={(tx) => {
              setSelectedTransaction(tx);
              webApp?.HapticFeedback?.impactOccurred("light");
            }}
          />
        </section>
      </div>

      {/* Bottom navigation */}
      <nav className="bottom-nav">
        <button
          className="nav-item active"
          onClick={() => setCurrentPage("dashboard")}
        >
          <LayoutDashboard size={20} className="nav-item-icon" />
          <span className="nav-item-label">Dashboard</span>
        </button>
        <button
          className="nav-item"
          onClick={() => setCurrentPage("accounts")}
        >
          <Landmark size={20} className="nav-item-icon" />
          <span className="nav-item-label">Cuentas</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
