interface Account {
  id: string;
  name: string;
  current_balance: number;
  currency_code: string;
  type: string;
}

interface AccountSummaryProps {
  accounts: Account[];
  loading: boolean;
}

export function AccountSummary({ accounts, loading }: AccountSummaryProps) {
  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="skeleton w-40 h-24 rounded-2xl flex-shrink-0" />
        ))}
      </div>
    );
  }

  if (accounts.length === 0) {
    return null;
  }

  // Calculate total balance
  const totalBalance = accounts.reduce((sum, acc) => sum + acc.current_balance, 0);
  const mainCurrency = accounts[0]?.currency_code || "EUR";

  return (
    <div>
      {/* Total Balance Card */}
      <div
        className="card p-5 mb-4"
        style={{
          background: "linear-gradient(135deg, var(--tg-theme-button-color) 0%, #4f46e5 100%)",
        }}
      >
        <p
          className="text-sm opacity-80 mb-1"
          style={{ color: "var(--tg-theme-button-text-color)" }}
        >
          Total Balance
        </p>
        <p
          className="text-3xl font-bold tabular-nums"
          style={{ color: "var(--tg-theme-button-text-color)" }}
        >
          {formatCurrency(totalBalance, mainCurrency)}
        </p>
        <p
          className="text-xs opacity-60 mt-2"
          style={{ color: "var(--tg-theme-button-text-color)" }}
        >
          Across {accounts.length} account{accounts.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Individual Accounts */}
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
        {accounts.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}
      </div>
    </div>
  );
}

function AccountCard({ account }: { account: Account }) {
  const isPositive = account.current_balance >= 0;

  return (
    <div
      className="card p-4 flex-shrink-0 w-40"
      style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
    >
      <p
        className="text-xs truncate mb-2"
        style={{ color: "var(--tg-theme-hint-color)" }}
      >
        {account.name}
      </p>
      <p
        className="text-lg font-semibold tabular-nums"
        style={{
          color: isPositive ? "var(--tg-theme-text-color)" : "#ef4444",
        }}
      >
        {formatCurrency(account.current_balance, account.currency_code)}
      </p>
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
