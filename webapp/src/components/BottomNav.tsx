import { useState } from "react";
import {
  Home,
  Landmark,
  PieChart,
  Plus,
  X,
  Tag,
  Banknote,
} from "lucide-react";

type Page = "dashboard" | "accounts" | "wizard" | "analysis";

interface BottomNavProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  onQuickAction?: (action: "add-expense" | "categorize") => void;
}

interface QuickAction {
  id: "add-expense" | "categorize";
  label: string;
  icon: React.ReactNode;
  color: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "add-expense",
    label: "Gasto en efectivo",
    icon: <Banknote size={20} />,
    color: "#059669", // green
  },
  {
    id: "categorize",
    label: "Categorizar",
    icon: <Tag size={20} />,
    color: "#8b5cf6", // violet
  },
];

export function BottomNav({ currentPage, onNavigate, onQuickAction }: BottomNavProps) {
  const [showQuickActions, setShowQuickActions] = useState(false);

  const handleQuickAction = (action: QuickAction) => {
    setShowQuickActions(false);
    if (action.id === "categorize") {
      onNavigate("wizard");
    } else if (onQuickAction) {
      onQuickAction(action.id);
    }
  };

  return (
    <>
      {/* Overlay when quick actions are open */}
      {showQuickActions && (
        <div
          className="quick-actions-overlay"
          onClick={() => setShowQuickActions(false)}
        />
      )}

      {/* Quick actions menu - positioned above FAB on the left */}
      <div className={`quick-actions-menu ${showQuickActions ? "open" : ""}`}>
        {QUICK_ACTIONS.map((action, index) => (
          <button
            key={action.id}
            className="quick-action-item"
            onClick={() => handleQuickAction(action)}
            style={{
              transitionDelay: showQuickActions ? `${index * 50}ms` : "0ms",
            }}
          >
            <div
              className="quick-action-icon"
              style={{ backgroundColor: action.color }}
            >
              {action.icon}
            </div>
            <span className="quick-action-label">{action.label}</span>
          </button>
        ))}
      </div>

      {/* FAB button - positioned on the left */}
      <div className="fab-container-left">
        <button
          className={`fab-button ${showQuickActions ? "active" : ""}`}
          onClick={() => setShowQuickActions(!showQuickActions)}
        >
          {showQuickActions ? <X size={24} /> : <Plus size={24} />}
        </button>
      </div>

      {/* Bottom navigation */}
      <nav className="bottom-nav-new">
        <button
          className={`nav-item-new ${currentPage === "dashboard" ? "active" : ""}`}
          onClick={() => onNavigate("dashboard")}
        >
          <Home size={22} />
          <span>Inicio</span>
        </button>

        <button
          className={`nav-item-new ${currentPage === "analysis" ? "active" : ""}`}
          onClick={() => onNavigate("analysis")}
        >
          <PieChart size={22} />
          <span>Análisis</span>
        </button>

        <button
          className={`nav-item-new ${currentPage === "accounts" ? "active" : ""}`}
          onClick={() => onNavigate("accounts")}
        >
          <Landmark size={22} />
          <span>Cuentas</span>
        </button>
      </nav>
    </>
  );
}
