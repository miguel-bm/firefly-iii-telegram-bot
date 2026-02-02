import { useState, useMemo } from "react";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Calendar,
  Tag,
  Building2,
  Store,
  FileText,
  Pencil,
  FolderOpen,
} from "lucide-react";
import type { Transaction } from "../App";

interface TransactionDetailProps {
  transaction: Transaction;
  onBack: () => void;
  onUpdate: (id: string, updates: Partial<Transaction>) => Promise<boolean>;
  colorScheme: string;
}

export function TransactionDetail({
  transaction,
  onBack,
  onUpdate,
  colorScheme,
}: TransactionDetailProps) {
  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editedDescription, setEditedDescription] = useState(transaction.description);
  const [editedCategory, setEditedCategory] = useState(transaction.category || "");
  const [editedNotes, setEditedNotes] = useState(transaction.notes || "");
  const [saving, setSaving] = useState(false);

  const isExpense = transaction.type === "withdrawal";
  const isIncome = transaction.type === "deposit";
  const isTransfer = transaction.type === "transfer";

  const typeColors = {
    bg: isExpense
      ? "rgba(220, 38, 38, 0.1)"
      : isIncome
      ? "rgba(5, 150, 105, 0.1)"
      : "rgba(99, 102, 241, 0.1)",
    text: isExpense ? "#dc2626" : isIncome ? "#059669" : "#6366f1",
  };

  const typeLabel = isExpense ? "Gasto" : isIncome ? "Ingreso" : "Transferencia";
  const TypeIcon = isExpense ? ArrowDownLeft : isIncome ? ArrowUpRight : ArrowLeftRight;

  const formattedDate = new Date(transaction.date).toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const formattedTime = new Date(transaction.date).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Check if there are unsaved changes
  const hasChanges = useMemo(() => {
    return (
      editedDescription !== transaction.description ||
      editedCategory !== (transaction.category || "") ||
      editedNotes !== (transaction.notes || "")
    );
  }, [editedDescription, editedCategory, editedNotes, transaction]);

  const handleSave = async () => {
    if (!hasChanges) {
      setIsEditing(false);
      return;
    }

    setSaving(true);
    const success = await onUpdate(transaction.id, {
      description: editedDescription,
      category: editedCategory || null,
      notes: editedNotes || null,
    });

    setSaving(false);
    if (success) {
      setIsEditing(false);
    }
  };

  const handleDiscard = () => {
    setEditedDescription(transaction.description);
    setEditedCategory(transaction.category || "");
    setEditedNotes(transaction.notes || "");
    setIsEditing(false);
  };

  return (
    <div className={`app-container ${colorScheme === "dark" ? "dark" : ""}`}>
      {/* Header with description and amount */}
      <div className="header-gradient" style={{ margin: 0, padding: "16px 20px 24px" }}>
        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 mb-4"
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.8)", cursor: "pointer", padding: 0 }}
        >
          <ArrowLeft size={20} />
          <span className="text-sm font-medium">Volver</span>
        </button>

        {/* Amount - prominent display */}
        <p
          className="text-3xl font-bold tabular-nums mb-2"
          style={{ color: "#ffffff" }}
        >
          {isExpense ? "-" : isIncome ? "+" : ""}
          {formatCurrency(transaction.amount)}
        </p>

        {/* Description - editable in header when in edit mode */}
        {isEditing ? (
          <input
            type="text"
            value={editedDescription}
            onChange={(e) => setEditedDescription(e.target.value)}
            className="w-full bg-transparent border-b border-white/30 text-white text-lg font-medium outline-none focus:border-white/60 py-1"
            placeholder="Descripción"
            style={{ color: "rgba(255,255,255,0.95)" }}
          />
        ) : (
          <p
            className="text-lg font-medium"
            style={{ color: "rgba(255,255,255,0.9)" }}
          >
            {transaction.description}
          </p>
        )}

        {/* Type badge */}
        <div className="flex items-center gap-2 mt-3">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.9)" }}
          >
            <TypeIcon size={14} />
            {typeLabel}
          </div>
        </div>
      </div>

      <div style={{ padding: "0 20px", paddingBottom: isEditing ? 100 : 20 }}>
        {/* Details */}
        <div className="space-y-5 fade-in" style={{ marginTop: 20 }}>
          {/* Category */}
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: typeColors.bg }}
            >
              <FolderOpen size={18} color={typeColors.text} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-caption mb-1">Categoría</p>
              {isEditing ? (
                <input
                  type="text"
                  className="w-full bg-transparent border-b font-medium outline-none py-1"
                  style={{
                    borderColor: "var(--tg-theme-secondary-bg-color)",
                    color: "var(--tg-theme-text-color)",
                  }}
                  value={editedCategory}
                  onChange={(e) => setEditedCategory(e.target.value)}
                  placeholder="Sin categoría"
                />
              ) : (
                <p
                  className="font-medium"
                  style={{
                    color: transaction.category
                      ? "var(--tg-theme-text-color)"
                      : "var(--tg-theme-hint-color)",
                  }}
                >
                  {transaction.category || "Sin categoría"}
                </p>
              )}
            </div>
          </div>

          {/* Date */}
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
            >
              <Calendar size={18} style={{ color: "var(--tg-theme-hint-color)" }} />
            </div>
            <div className="flex-1">
              <p className="text-caption mb-1">Fecha</p>
              <p className="font-medium" style={{ color: "var(--tg-theme-text-color)" }}>
                {capitalize(formattedDate)}
              </p>
              <p className="text-caption">{formattedTime}</p>
            </div>
          </div>

          {/* Source Account */}
          {transaction.source && (
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
              >
                <Building2 size={18} style={{ color: "var(--tg-theme-hint-color)" }} />
              </div>
              <div className="flex-1">
                <p className="text-caption mb-1">{isTransfer ? "Cuenta origen" : "Cuenta"}</p>
                <p className="font-medium" style={{ color: "var(--tg-theme-text-color)" }}>
                  {transaction.source}
                </p>
              </div>
            </div>
          )}

          {/* Destination */}
          {transaction.destination && (
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
              >
                <Store size={18} style={{ color: "var(--tg-theme-hint-color)" }} />
              </div>
              <div className="flex-1">
                <p className="text-caption mb-1">{isTransfer ? "Cuenta destino" : "Comercio"}</p>
                <p className="font-medium" style={{ color: "var(--tg-theme-text-color)" }}>
                  {transaction.destination}
                </p>
              </div>
            </div>
          )}

          {/* Tags */}
          {transaction.tags && transaction.tags.length > 0 && (
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
              >
                <Tag size={18} style={{ color: "var(--tg-theme-hint-color)" }} />
              </div>
              <div className="flex-1">
                <p className="text-caption mb-2">Etiquetas</p>
                <div className="flex flex-wrap gap-2">
                  {transaction.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 rounded-full text-sm"
                      style={{
                        backgroundColor: "var(--tg-theme-secondary-bg-color)",
                        color: "var(--tg-theme-text-color)",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
            >
              <FileText size={18} style={{ color: "var(--tg-theme-hint-color)" }} />
            </div>
            <div className="flex-1">
              <p className="text-caption mb-1">Notas</p>
              {isEditing ? (
                <textarea
                  className="w-full bg-transparent border rounded-lg p-2 outline-none resize-none"
                  style={{
                    borderColor: "var(--tg-theme-secondary-bg-color)",
                    color: "var(--tg-theme-text-color)",
                    minHeight: 80,
                  }}
                  value={editedNotes}
                  onChange={(e) => setEditedNotes(e.target.value)}
                  placeholder="Añadir notas..."
                />
              ) : (
                <p
                  className="font-medium"
                  style={{
                    color: transaction.notes
                      ? "var(--tg-theme-text-color)"
                      : "var(--tg-theme-hint-color)",
                  }}
                >
                  {transaction.notes || "Sin notas"}
                </p>
              )}
            </div>
          </div>

          {/* Edit button (when not editing) */}
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="w-full py-3.5 rounded-xl font-medium text-center flex items-center justify-center gap-2 mt-6 transition-all active:scale-[0.98]"
              style={{
                backgroundColor: "var(--tg-theme-button-color)",
                color: "var(--tg-theme-button-text-color)",
                border: "none",
                cursor: "pointer",
              }}
            >
              <Pencil size={16} />
              Editar transacción
            </button>
          )}

          {/* Transaction ID */}
          <p className="text-caption text-center" style={{ marginTop: 16, opacity: 0.6 }}>
            ID: {transaction.id}
          </p>
        </div>
      </div>

      {/* Action bar for save/discard */}
      {isEditing && (
        <div className="action-bar" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <button
            className="action-bar-btn action-bar-btn-secondary"
            onClick={handleDiscard}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            className="action-bar-btn action-bar-btn-primary"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            style={{
              opacity: hasChanges ? 1 : 0.5,
            }}
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
