import { useEffect, useState } from "react";
import { ExpenseChart } from "./components/ExpenseChart";
import { TransactionTable } from "./components/TransactionTable";
import { AccountSummary } from "./components/AccountSummary";
import { useTelegram } from "./hooks/useTelegram";

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

interface ExpenseData {
  category: string;
  amount: number;
  currency: string;
}

interface Account {
  id: string;
  name: string;
  current_balance: number;
  currency_code: string;
  type: string;
}

function App() {
  const { initData, isReady, colorScheme } = useTelegram();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [expenses, setExpenses] = useState<ExpenseData[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady) return;

    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const headers: HeadersInit = {
          "Content-Type": "application/json",
        };

        if (initData) {
          headers["X-Telegram-Init-Data"] = initData;
        }

        // Fetch all data in parallel
        const [txRes, expRes, accRes] = await Promise.all([
          fetch("/api/transactions?limit=25&type=withdrawal", { headers }),
          fetch("/api/expenses/by-category?days=30", { headers }),
          fetch("/api/accounts", { headers }),
        ]);

        if (!txRes.ok || !expRes.ok || !accRes.ok) {
          throw new Error("Failed to fetch data");
        }

        const [txData, expData, accData] = await Promise.all([
          txRes.json(),
          expRes.json(),
          accRes.json(),
        ]);

        setTransactions(txData.transactions || []);
        setExpenses(expData.data || []);
        setAccounts(accData.accounts || []);
      } catch (err) {
        console.error("Fetch error:", err);
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [isReady, initData]);

  return (
    <div
      className={`min-h-screen p-4 pb-8 ${
        colorScheme === "dark" ? "dark" : ""
      }`}
      style={{
        backgroundColor: "var(--tg-theme-bg-color)",
        color: "var(--tg-theme-text-color)",
      }}
    >
      {/* Header */}
      <header className="mb-6">
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ color: "var(--tg-theme-text-color)" }}
        >
          Firefly Dashboard
        </h1>
        <p
          className="text-sm mt-1"
          style={{ color: "var(--tg-theme-hint-color)" }}
        >
          Your finances at a glance
        </p>
      </header>

      {error && (
        <div
          className="card p-4 mb-4"
          style={{ backgroundColor: "#fef2f2", borderColor: "#fecaca" }}
        >
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* Account Summary */}
      <section className="mb-6 fade-in" style={{ animationDelay: "0ms" }}>
        <AccountSummary accounts={accounts} loading={loading} />
      </section>

      {/* Expense Chart */}
      <section className="mb-6 fade-in" style={{ animationDelay: "100ms" }}>
        <div className="card p-4">
          <h2
            className="text-lg font-semibold mb-4"
            style={{ color: "var(--tg-theme-text-color)" }}
          >
            Expenses by Category
          </h2>
          <p
            className="text-xs mb-4"
            style={{ color: "var(--tg-theme-hint-color)" }}
          >
            Last 30 days
          </p>
          <ExpenseChart data={expenses} loading={loading} />
        </div>
      </section>

      {/* Transactions Table */}
      <section className="fade-in" style={{ animationDelay: "200ms" }}>
        <div className="card p-4">
          <h2
            className="text-lg font-semibold mb-4"
            style={{ color: "var(--tg-theme-text-color)" }}
          >
            Recent Expenses
          </h2>
          <TransactionTable transactions={transactions} loading={loading} />
        </div>
      </section>
    </div>
  );
}

export default App;
