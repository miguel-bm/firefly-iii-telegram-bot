import { useState, useEffect, useCallback } from "react";
import {
  X,
  Check,
  ChevronRight,
  FolderOpen,
  Tag,
  Banknote,
} from "lucide-react";

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (expense: ExpenseData) => Promise<boolean>;
  initData: string | null;
}

interface ExpenseData {
  amount: number;
  description: string;
  category: string;
  tags: string[];
  date: string;
}

interface Category {
  id: string;
  name: string;
}

interface TagItem {
  id: string;
  tag: string;
}

export function AddExpenseModal({
  isOpen,
  onClose,
  onSubmit,
  initData,
}: AddExpenseModalProps) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [saving, setSaving] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
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

  // Fetch categories and tags
  useEffect(() => {
    if (!isOpen) return;

    const fetchMetadata = async () => {
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
    };

    fetchMetadata();
  }, [isOpen, getHeaders]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAmount("");
      setDescription("");
      setSelectedCategory("");
      setSelectedTags([]);
      setDate(new Date().toISOString().split("T")[0]);
      setSaving(false);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    const numAmount = parseFloat(amount.replace(",", "."));
    if (isNaN(numAmount) || numAmount <= 0) return;
    if (!description.trim()) return;

    setSaving(true);
    try {
      const success = await onSubmit({
        amount: numAmount,
        description: description.trim(),
        category: selectedCategory,
        tags: selectedTags,
        date,
      });
      if (success) {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const filteredCategories = categories.filter((c) =>
    c.name.toLowerCase().includes(categorySearch.toLowerCase())
  );
  const filteredTags = tags.filter((t) =>
    t.tag.toLowerCase().includes(tagSearch.toLowerCase())
  );

  const isValid = parseFloat(amount.replace(",", ".")) > 0 && description.trim();

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: "var(--tg-theme-bg-color)" }}
      >
        <div className="modal-header">
          <h3 className="font-semibold text-lg" style={{ color: "var(--tg-theme-text-color)" }}>
            <Banknote size={20} className="inline mr-2" style={{ color: "#059669" }} />
            Gasto en efectivo
          </h3>
          <button onClick={onClose}>
            <X size={20} style={{ color: "var(--tg-theme-hint-color)" }} />
          </button>
        </div>

        <div className="space-y-4 mt-4">
          {/* Amount */}
          <div>
            <label className="text-caption mb-1 block">Importe *</label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full p-3 rounded-xl text-2xl font-bold text-right pr-12"
                style={{
                  backgroundColor: "var(--tg-theme-secondary-bg-color)",
                  color: "var(--tg-theme-text-color)",
                  border: "none",
                }}
                autoFocus
              />
              <span
                className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-medium"
                style={{ color: "var(--tg-theme-hint-color)" }}
              >
                €
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-caption mb-1 block">Descripción *</label>
            <input
              type="text"
              placeholder="¿En qué gastaste?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
            <label className="text-caption mb-1 block">Fecha</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full p-3 rounded-xl"
              style={{
                backgroundColor: "var(--tg-theme-secondary-bg-color)",
                color: "var(--tg-theme-text-color)",
                border: "none",
              }}
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-caption mb-1 block">Categoría</label>
            <button
              onClick={() => setShowCategoryPicker(true)}
              className="w-full p-3 rounded-xl flex items-center justify-between"
              style={{
                backgroundColor: "var(--tg-theme-secondary-bg-color)",
                color: selectedCategory
                  ? "var(--tg-theme-text-color)"
                  : "var(--tg-theme-hint-color)",
              }}
            >
              <span className="flex items-center gap-2">
                <FolderOpen size={18} />
                {selectedCategory || "Seleccionar categoría"}
              </span>
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Tags */}
          <div>
            <label className="text-caption mb-1 block">Etiquetas</label>
            <button
              onClick={() => setShowTagPicker(true)}
              className="w-full p-3 rounded-xl flex items-center justify-between"
              style={{
                backgroundColor: "var(--tg-theme-secondary-bg-color)",
                color: selectedTags.length > 0
                  ? "var(--tg-theme-text-color)"
                  : "var(--tg-theme-hint-color)",
              }}
            >
              <span className="flex items-center gap-2">
                <Tag size={18} />
                {selectedTags.length > 0
                  ? selectedTags.join(", ")
                  : "Añadir etiquetas"}
              </span>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* Submit button */}
        <div className="mt-6">
          <button
            onClick={handleSubmit}
            disabled={!isValid || saving}
            className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-opacity"
            style={{
              backgroundColor: isValid ? "#059669" : "var(--tg-theme-secondary-bg-color)",
              color: isValid ? "#fff" : "var(--tg-theme-hint-color)",
              opacity: saving ? 0.7 : 1,
            }}
          >
            <Check size={18} />
            {saving ? "Guardando..." : "Registrar gasto"}
          </button>
        </div>

        {/* Category picker */}
        {showCategoryPicker && (
          <div className="modal-overlay" style={{ zIndex: 210 }} onClick={() => setShowCategoryPicker(false)}>
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
                      setSelectedCategory(cat.name);
                      setShowCategoryPicker(false);
                      setCategorySearch("");
                    }}
                    className="modal-list-item"
                    style={{
                      backgroundColor:
                        selectedCategory === cat.name
                          ? "rgba(5, 150, 105, 0.1)"
                          : "transparent",
                    }}
                  >
                    <span style={{ color: "var(--tg-theme-text-color)" }}>{cat.name}</span>
                    {selectedCategory === cat.name && (
                      <Check size={18} style={{ color: "#059669" }} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tag picker */}
        {showTagPicker && (
          <div className="modal-overlay" style={{ zIndex: 210 }} onClick={() => setShowTagPicker(false)}>
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
                  const isSelected = selectedTags.includes(tag.tag);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedTags(selectedTags.filter((t) => t !== tag.tag));
                        } else {
                          setSelectedTags([...selectedTags, tag.tag]);
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
                  Listo ({selectedTags.length} seleccionadas)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
