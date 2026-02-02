import { useState, useEffect, useCallback } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import {
  LayoutDashboard,
  Landmark,
  ArrowLeft,
  Wallet,
  PiggyBank,
  CreditCard,
  TrendingUp,
  Smartphone,
  Home,
  FileText,
  Banknote,
} from "lucide-react";
import type { Account } from "../App";
import type { ReactNode } from "react";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

interface AccountsPageProps {
  assets: Account[];
  liabilities: Account[];
  loading: boolean;
  colorScheme: string;
  initData: string | null;
  onNavigate: (page: "dashboard" | "accounts") => void;
}

interface BalancePoint {
  date: string;
  balance: number;
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

  // Fetch balance history for selected account
  const fetchHistory = useCallback(async (accountId: string) => {
    if (!initData) return;

    try {
      setHistoryLoading(true);
      const end = new Date().toISOString().split("T")[0];
      const start = new Date();
      start.setMonth(start.getMonth() - 3);
      const startStr = start.toISOString().split("T")[0];

      const res = await fetch(
        `/api/accounts/${accountId}/history?start=${startStr}&end=${end}`,
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

  useEffect(() => {
    if (selectedAccount) {
      fetchHistory(selectedAccount.id);
    }
  }, [selectedAccount, fetchHistory]);

  // Scroll to top when viewing account detail
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [selectedAccount]);

  const totalAssets = assets.reduce((sum, acc) => sum + acc.current_balance, 0);
  const totalLiabilities = liabilities.reduce((sum, acc) => sum + acc.current_balance, 0);
  const mainCurrency = assets[0]?.currency_code || "EUR";

  return (
    <div className={`app-container ${colorScheme === "dark" ? "dark" : ""}`}>
      {/* Header */}
      <div className="header-gradient" style={{ margin: 0, padding: "20px 20px 32px" }}>
        <h1 className="text-2xl font-bold text-white mb-2">Cuentas</h1>
        <p className="text-caption" style={{ color: "rgba(255,255,255,0.6)" }}>
          Gestiona tus activos y pasivos
        </p>
      </div>

      <div style={{ padding: "0 20px" }}>
        {/* Summary cards */}
        <div className="stats-grid fade-in" style={{ marginTop: 20 }}>
          <div className="stat-item">
            <p className="text-overline">Activos</p>
            <p className="text-lg font-semibold tabular-nums" style={{ color: "#059669" }}>
              {loading ? "—" : formatCurrency(totalAssets, mainCurrency)}
            </p>
          </div>
          <div className="stat-item">
            <p className="text-overline">Pasivos</p>
            <p className="text-lg font-semibold tabular-nums" style={{ color: "#dc2626" }}>
              {loading ? "—" : formatCurrency(Math.abs(totalLiabilities), mainCurrency)}
            </p>
          </div>
          <div className="stat-item">
            <p className="text-overline">Neto</p>
            <p className="text-lg font-semibold tabular-nums" style={{ color: "var(--tg-theme-text-color)" }}>
              {loading ? "—" : formatCurrency(totalAssets - Math.abs(totalLiabilities), mainCurrency)}
            </p>
          </div>
        </div>

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

            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: getAccountColor(selectedAccount) }}
                >
                  {getAccountIcon(selectedAccount.name, getAccountIconColor(selectedAccount))}
                </div>
                <div>
                  <p className="font-semibold" style={{ color: "var(--tg-theme-text-color)" }}>
                    {selectedAccount.name}
                  </p>
                  <p className="text-caption">{getAccountTypeLabel(selectedAccount.type)}</p>
                </div>
              </div>

              <p
                className="text-3xl font-bold tabular-nums"
                style={{
                  color: selectedAccount.current_balance >= 0 ? "#059669" : "#dc2626",
                }}
              >
                {formatCurrency(selectedAccount.current_balance, selectedAccount.currency_code)}
              </p>

              {/* Balance history chart */}
              <div className="balance-chart-container">
                {historyLoading ? (
                  <div className="skeleton-light h-full w-full" />
                ) : balanceHistory.length > 0 ? (
                  <BalanceChart data={balanceHistory} colorScheme={colorScheme} />
                ) : (
                  <p className="text-caption text-center py-8">Sin historial disponible</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Assets section */}
        {!selectedAccount && (
          <>
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
            <section className="fade-in" style={{ marginTop: 24 }}>
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
      <nav className="bottom-nav">
        <button className="nav-item" onClick={() => onNavigate("dashboard")}>
          <LayoutDashboard size={20} className="nav-item-icon" />
          <span className="nav-item-label">Dashboard</span>
        </button>
        <button className="nav-item active" onClick={() => onNavigate("accounts")}>
          <Landmark size={20} className="nav-item-icon" />
          <span className="nav-item-label">Cuentas</span>
        </button>
      </nav>
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

function BalanceChart({ data, colorScheme }: { data: BalancePoint[]; colorScheme: string }) {
  const isDark = colorScheme === "dark";

  const chartData = {
    labels: data.map((p) => {
      const date = new Date(p.date);
      return date.toLocaleDateString("es-ES", { month: "short", day: "numeric" });
    }),
    datasets: [
      {
        data: data.map((p) => p.balance),
        fill: true,
        borderColor: "#059669",
        backgroundColor: isDark ? "rgba(5, 150, 105, 0.1)" : "rgba(5, 150, 105, 0.1)",
        tension: 0.4,
        pointRadius: 0,
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
        backgroundColor: "rgba(28, 25, 23, 0.95)",
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (context: { parsed: { y: number | null } }) =>
            formatCurrency(context.parsed.y ?? 0, "EUR"),
        },
      },
    },
    scales: {
      x: {
        display: false,
      },
      y: {
        display: false,
      },
    },
    interaction: {
      intersect: false,
      mode: "index" as const,
    },
  };

  return <Line data={chartData} options={options} />;
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
