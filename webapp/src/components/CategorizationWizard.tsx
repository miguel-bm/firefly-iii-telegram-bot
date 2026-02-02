import { useState, useEffect, useCallback } from "react";
import {
  ChevronRight,
  Check,
  X,
  Tag,
  FolderOpen,
  Sparkles,
  CheckCircle2,
  ArrowLeft,
  Calendar,
  FileText,
  Wallet,
} from "lucide-react";
import { BottomNav } from "./BottomNav";
import type { Transaction } from "../App";

interface CategorizationWizardProps {
  colorScheme: string;
  initData: string | null;
  onNavigate: (page: "dashboard" | "accounts" | "wizard" | "analysis") => void;
}

interface Category {
  id: string;
  name: string;
}

interface TagItem {
  id: string;
  tag: string;
}

type ViewMode = "list" | "edit";

export function CategorizationWizard({
  colorScheme,
  initData,
  onNavigate,
}: CategorizationWizardProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  // View mode: list or edit
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  // Form state for editing
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editNotes, setEditNotes] = useState("");
  const [editSourceAccount, setEditSourceAccount] = useState("");

  // Picker states
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");

  const getHeaders = useCallback(() => {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (initData) {
      headers["X-Telegram-Init-Data"] = initData;
    }
    return headers;
  }, [initData]);

  // Fetch uncategorized transactions
  const fetchUncategorized = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/transactions?limit=100&uncategorized=true", {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        // Filter to only uncategorized (no category)
        const uncategorized = (data.transactions || []).filter(
          (tx: Transaction) => !tx.category
        );
        setTransactions(uncategorized);
      }
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [getHeaders]);

  // Fetch categories and tags
  const fetchMetadata = useCallback(async () => {
    try {
      const [catRes, tagRes] = await Promise.all([
        fetch("/api/categories", { headers: getHeaders() }),
        fetch("/api/tags", { headers: getHeaders() }),
      ]);

      if (catRes.ok) {
        const data = await catRes.json();
        setCategories(data.categories || []);
      }
      if (tagRes.ok) {
        const data = await tagRes.json();
        setTags(data.tags || []);
      }
    } catch (err) {
      console.error("Fetch metadata error:", err);
    }
  }, [getHeaders]);

  useEffect(() => {
    fetchUncategorized();
    fetchMetadata();
  }, [fetchUncategorized, fetchMetadata]);

  // Open edit mode for a transaction
  const handleSelectTransaction = (tx: Transaction) => {
    setSelectedTransaction(tx);
    setEditDescription(tx.description);
    setEditDate(tx.date.split("T")[0]);
    setEditCategory("");
    setEditTags(tx.tags || []);
    setEditNotes(tx.notes || "");
    setEditSourceAccount(tx.source || "");
    setViewMode("edit");
  };

  // Go back to list
  const handleBackToList = () => {
    setViewMode("list");
    setSelectedTransaction(null);
  };

  // Save edited transaction
  const handleSave = async () => {
    if (!selectedTransaction || !editCategory) return;

    try {
      setSaving(true);
      const res = await fetch(`/api/transactions/${selectedTransaction.id}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({
          description: editDescription.trim() || selectedTransaction.description,
          date: editDate,
          category: editCategory,
          tags: editTags,
          notes: editNotes.trim() || null,
        }),
      });

      if (res.ok) {
        setCompleted((prev) => new Set(prev).add(selectedTransaction.id));
        // Update local transaction list
        setTransactions((prev) =>
          prev.map((tx) =>
            tx.id === selectedTransaction.id
              ? { ...tx, category: editCategory, tags: editTags, description: editDescription, notes: editNotes }
              : tx
          )
        );
        handleBackToList();
      }
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setSaving(false);
    }
  };

  // Filter categories/tags by search
  const filteredCategories = categories.filter((c) =>
    c.name.toLowerCase().includes(categorySearch.toLowerCase())
  );
  const filteredTags = tags.filter((t) =>
    t.tag.toLowerCase().includes(tagSearch.toLowerCase())
  );

  // Suggest categories based on description patterns
  const suggestedCategories = selectedTransaction
    ? categories
        .filter((c) => {
          const desc = selectedTransaction.description.toLowerCase();
          const catName = c.name.toLowerCase();
          return desc.includes(catName) || catName.includes(desc.split(" ")[0]);
        })
        .slice(0, 3)
    : [];

  const remainingCount = transactions.filter((tx) => !completed.has(tx.id) && !tx.category).length;

  // List View
  const renderListView = () => (
    <>
      {/* Header */}
      <div className="header-gradient" style={{ margin: 0, padding: "20px 20px 32px" }}>
        <h1 className="text-2xl font-bold text-white mb-2">Categorizar</h1>
        <p className="text-caption" style={{ color: "rgba(255,255,255,0.6)" }}>
          {remainingCount > 0
            ? `${remainingCount} transacciones sin categoría`
            : "¡Todo categorizado!"}
        </p>
      </div>

      <div style={{ padding: "0 20px", paddingBottom: 100 }}>
        {loading ? (
          <div className="space-y-3" style={{ marginTop: 20 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton-light h-20 rounded-xl" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="empty-state fade-in" style={{ marginTop: 40 }}>
            <CheckCircle2 size={48} style={{ color: "#059669", marginBottom: 16 }} />
            <p className="font-medium mb-1" style={{ color: "var(--tg-theme-text-color)" }}>
              ¡Todo categorizado!
            </p>
            <p className="text-sm" style={{ color: "var(--tg-theme-hint-color)" }}>
              No hay transacciones pendientes de categorizar
            </p>
          </div>
        ) : (
          <div className="space-y-3" style={{ marginTop: 20 }}>
            {/* Progress summary */}
            {completed.size > 0 && (
              <div className="flex items-center justify-between mb-4 px-1">
                <span className="text-caption">
                  {completed.size} de {transactions.length} completadas
                </span>
                <div
                  className="h-2 rounded-full flex-1 ml-4"
                  style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${(completed.size / transactions.length) * 100}%`,
                      backgroundColor: "#059669",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Transaction list */}
            {transactions
              .filter((tx) => !completed.has(tx.id))
              .map((tx) => (
                <button
                  key={tx.id}
                  onClick={() => handleSelectTransaction(tx)}
                  className="w-full p-4 rounded-xl flex items-center justify-between transition-all active:scale-[0.98]"
                  style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
                >
                  <div className="flex-1 min-w-0 text-left">
                    <p
                      className="font-medium mb-1 truncate"
                      style={{ color: "var(--tg-theme-text-color)" }}
                    >
                      {tx.description}
                    </p>
                    <p className="text-caption text-sm">
                      {new Date(tx.date).toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "short",
                      })}
                      {tx.source && ` · ${tx.source}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-3">
                    <p
                      className="font-semibold tabular-nums"
                      style={{
                        color: tx.type === "withdrawal" ? "#dc2626" : "#059669",
                      }}
                    >
                      {tx.type === "withdrawal" ? "-" : "+"}
                      {formatCurrency(tx.amount, "EUR")}
                    </p>
                    <ChevronRight size={18} style={{ color: "var(--tg-theme-hint-color)" }} />
                  </div>
                </button>
              ))}

            {/* Completed transactions (collapsed) */}
            {completed.size > 0 && (
              <div className="mt-6">
                <p className="text-caption mb-3 px-1">Completadas</p>
                {transactions
                  .filter((tx) => completed.has(tx.id))
                  .map((tx) => (
                    <div
                      key={tx.id}
                      className="p-3 rounded-xl mb-2 flex items-center justify-between opacity-60"
                      style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
                    >
                      <div className="flex items-center gap-3">
                        <CheckCircle2 size={18} style={{ color: "#059669" }} />
                        <div>
                          <p
                            className="font-medium text-sm truncate"
                            style={{ color: "var(--tg-theme-text-color)", maxWidth: 180 }}
                          >
                            {tx.description}
                          </p>
                          <p className="text-xs" style={{ color: "var(--tg-theme-hint-color)" }}>
                            {tx.category}
                          </p>
                        </div>
                      </div>
                      <p
                        className="text-sm font-medium tabular-nums"
                        style={{ color: tx.type === "withdrawal" ? "#dc2626" : "#059669" }}
                      >
                        {tx.type === "withdrawal" ? "-" : "+"}
                        {formatCurrency(tx.amount, "EUR")}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  // Edit View
  const renderEditView = () => {
    if (!selectedTransaction) return null;

    return (
      <>
        {/* Header with back button */}
        <div
          className="sticky top-0 z-10 flex items-center gap-3 p-4"
          style={{ backgroundColor: "var(--tg-theme-bg-color)" }}
        >
          <button
            onClick={handleBackToList}
            className="p-2 rounded-full"
            style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
          >
            <ArrowLeft size={20} style={{ color: "var(--tg-theme-text-color)" }} />
          </button>
          <h2 className="font-semibold text-lg" style={{ color: "var(--tg-theme-text-color)" }}>
            Editar transacción
          </h2>
        </div>

        <div style={{ padding: "0 20px", paddingBottom: 100 }}>
          {/* Transaction summary card */}
          <div
            className="p-4 rounded-xl mb-6"
            style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-caption mb-1">Importe</p>
                <p
                  className="text-2xl font-bold tabular-nums"
                  style={{
                    color: selectedTransaction.type === "withdrawal" ? "#dc2626" : "#059669",
                  }}
                >
                  {selectedTransaction.type === "withdrawal" ? "-" : "+"}
                  {formatCurrency(selectedTransaction.amount, "EUR")}
                </p>
              </div>
              <div
                className="px-3 py-1 rounded-full text-sm"
                style={{
                  backgroundColor:
                    selectedTransaction.type === "withdrawal"
                      ? "rgba(220, 38, 38, 0.1)"
                      : "rgba(5, 150, 105, 0.1)",
                  color: selectedTransaction.type === "withdrawal" ? "#dc2626" : "#059669",
                }}
              >
                {selectedTransaction.type === "withdrawal" ? "Gasto" : "Ingreso"}
              </div>
            </div>
          </div>

          {/* Edit form */}
          <div className="space-y-4">
            {/* Description */}
            <div>
              <label className="text-caption mb-2 block flex items-center gap-2">
                <FileText size={14} />
                Descripción
              </label>
              <input
                type="text"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full p-3 rounded-xl"
                style={{
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: "var(--tg-theme-text-color)",
                  border: "none",
                }}
              />
            </div>

            {/* Date */}
            <div>
              <label className="text-caption mb-2 block flex items-center gap-2">
                <Calendar size={14} />
                Fecha
              </label>
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="w-full p-3 rounded-xl"
                style={{
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: "var(--tg-theme-text-color)",
                  border: "none",
                }}
              />
            </div>

            {/* Source account (read-only info) */}
            {editSourceAccount && (
              <div>
                <label className="text-caption mb-2 block flex items-center gap-2">
                  <Wallet size={14} />
                  Cuenta origen
                </label>
                <div
                  className="w-full p-3 rounded-xl"
                  style={{
                    backgroundColor: "var(--tg-theme-secondary-bg-color)",
                    color: "var(--tg-theme-hint-color)",
                  }}
                >
                  {editSourceAccount}
                </div>
              </div>
            )}

            {/* Suggested categories */}
            {suggestedCategories.length > 0 && !editCategory && (
              <div>
                <p className="text-caption mb-2 flex items-center gap-1">
                  <Sparkles size={14} />
                  Sugerencias
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestedCategories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setEditCategory(cat.name)}
                      className="px-3 py-1.5 rounded-full text-sm font-medium transition-all"
                      style={{
                        backgroundColor: "rgba(59, 130, 246, 0.1)",
                        color: "#3b82f6",
                      }}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Category selector */}
            <div>
              <label className="text-caption mb-2 block flex items-center gap-2">
                <FolderOpen size={14} />
                Categoría *
              </label>
              <button
                onClick={() => setShowCategoryPicker(true)}
                className="w-full p-3 rounded-xl flex items-center justify-between"
                style={{
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: editCategory
                    ? "var(--tg-theme-text-color)"
                    : "var(--tg-theme-hint-color)",
                }}
              >
                <span>{editCategory || "Seleccionar categoría"}</span>
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Tags selector */}
            <div>
              <label className="text-caption mb-2 block flex items-center gap-2">
                <Tag size={14} />
                Etiquetas
              </label>
              <button
                onClick={() => setShowTagPicker(true)}
                className="w-full p-3 rounded-xl flex items-center justify-between"
                style={{
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: editTags.length > 0
                    ? "var(--tg-theme-text-color)"
                    : "var(--tg-theme-hint-color)",
                }}
              >
                <span>
                  {editTags.length > 0 ? editTags.join(", ") : "Añadir etiquetas"}
                </span>
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Notes */}
            <div>
              <label className="text-caption mb-2 block flex items-center gap-2">
                <FileText size={14} />
                Notas
              </label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Añadir notas..."
                rows={3}
                className="w-full p-3 rounded-xl resize-none"
                style={{
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: "var(--tg-theme-text-color)",
                  border: "none",
                }}
              />
            </div>
          </div>

          {/* Save button */}
          <div className="mt-6">
            <button
              onClick={handleSave}
              disabled={!editCategory || saving}
              className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-opacity"
              style={{
                backgroundColor: editCategory ? "#059669" : "var(--tg-theme-secondary-bg-color)",
                color: editCategory ? "#fff" : "var(--tg-theme-hint-color)",
                opacity: saving ? 0.7 : 1,
              }}
            >
              <Check size={18} />
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>

        {/* Category picker modal */}
        {showCategoryPicker && (
          <div className="modal-overlay" onClick={() => setShowCategoryPicker(false)}>
            <div
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
              style={{ backgroundColor: "var(--tg-theme-bg-color)" }}
            >
              <div className="modal-header">
                <h3 className="font-semibold" style={{ color: "var(--tg-theme-text-color)" }}>
                  Seleccionar categoría
                </h3>
                <button onClick={() => setShowCategoryPicker(false)}>
                  <X size={20} style={{ color: "var(--tg-theme-hint-color)" }} />
                </button>
              </div>
              <input
                type="text"
                placeholder="Buscar categoría..."
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                className="modal-search"
                style={{
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: "var(--tg-theme-text-color)",
                }}
                autoFocus
              />
              <div className="modal-list">
                {filteredCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setEditCategory(cat.name);
                      setShowCategoryPicker(false);
                      setCategorySearch("");
                    }}
                    className="modal-list-item"
                    style={{
                      backgroundColor:
                        editCategory === cat.name
                          ? "rgba(5, 150, 105, 0.1)"
                          : "transparent",
                    }}
                  >
                    <span style={{ color: "var(--tg-theme-text-color)" }}>{cat.name}</span>
                    {editCategory === cat.name && (
                      <Check size={18} style={{ color: "#059669" }} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tag picker modal */}
        {showTagPicker && (
          <div className="modal-overlay" onClick={() => setShowTagPicker(false)}>
            <div
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
              style={{ backgroundColor: "var(--tg-theme-bg-color)" }}
            >
              <div className="modal-header">
                <h3 className="font-semibold" style={{ color: "var(--tg-theme-text-color)" }}>
                  Seleccionar etiquetas
                </h3>
                <button onClick={() => setShowTagPicker(false)}>
                  <X size={20} style={{ color: "var(--tg-theme-hint-color)" }} />
                </button>
              </div>
              <input
                type="text"
                placeholder="Buscar etiqueta..."
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                className="modal-search"
                style={{
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: "var(--tg-theme-text-color)",
                }}
                autoFocus
              />
              <div className="modal-list">
                {filteredTags.map((tag) => {
                  const isSelected = editTags.includes(tag.tag);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => {
                        if (isSelected) {
                          setEditTags(editTags.filter((t) => t !== tag.tag));
                        } else {
                          setEditTags([...editTags, tag.tag]);
                        }
                      }}
                      className="modal-list-item"
                      style={{
                        backgroundColor: isSelected ? "rgba(5, 150, 105, 0.1)" : "transparent",
                      }}
                    >
                      <span style={{ color: "var(--tg-theme-text-color)" }}>{tag.tag}</span>
                      {isSelected && <Check size={18} style={{ color: "#059669" }} />}
                    </button>
                  );
                })}
              </div>
              <div className="modal-footer">
                <button
                  onClick={() => {
                    setShowTagPicker(false);
                    setTagSearch("");
                  }}
                  className="w-full py-3 rounded-xl font-medium"
                  style={{
                    backgroundColor: "var(--tg-theme-button-color)",
                    color: "var(--tg-theme-button-text-color)",
                  }}
                >
                  Listo ({editTags.length} seleccionadas)
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className={`app-container ${colorScheme === "dark" ? "dark" : ""}`}>
      {viewMode === "list" ? renderListView() : renderEditView()}

      {/* Bottom navigation - only show in list view */}
      {viewMode === "list" && <BottomNav currentPage="wizard" onNavigate={onNavigate} />}
    </div>
  );
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
