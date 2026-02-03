import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Check,
  ChevronRight,
  FolderOpen,
  Tag,
  Banknote,
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
  Package,
  Fuel,
  Baby,
  PawPrint,
  Wrench,
  Building2,
  Wallet,
  type LucideIcon,
} from "lucide-react";

// Icon category mapping with multiple keywords per category
const ICON_CATEGORIES: { icon: LucideIcon; keywords: string[] }[] = [
  { icon: ShoppingCart, keywords: ["supermercado", "mercadona", "lidl", "carrefour", "aldi", "dia", "eroski", "groceries", "grocery", "alimentación", "alimentacion", "supermarket", "hipercor", "alcampo", "consum", "bonarea", "ahorramas", "market"] },
  { icon: Utensils, keywords: ["restaurante", "restaurant", "comida", "cena", "almuerzo", "dining", "food", "lunch", "dinner", "meal", "eat", "bistro", "pizzeria", "burger", "sushi", "tapas", "brunch", "catering"] },
  { icon: Coffee, keywords: ["café", "cafe", "coffee", "starbucks", "bar", "cafetería", "cafeteria", "desayuno", "breakfast", "bakery", "panadería", "panaderia"] },
  { icon: Car, keywords: ["transporte", "transport", "uber", "cabify", "taxi", "bolt", "lyft", "coche", "car", "auto", "vehicle", "vehiculo", "parking", "aparcamiento", "peaje", "toll", "metro", "bus", "tren", "train", "renfe"] },
  { icon: Fuel, keywords: ["gasolina", "gasolinera", "fuel", "gas", "petrol", "diesel", "repsol", "cepsa", "bp", "shell", "carburante", "repostaje"] },
  { icon: Plane, keywords: ["viaje", "travel", "vuelo", "flight", "hotel", "airbnb", "booking", "hostel", "vacation", "vacaciones", "aeropuerto", "airport", "iberia", "ryanair", "vueling", "trip", "tourism", "turismo"] },
  { icon: Film, keywords: ["ocio", "cine", "cinema", "movie", "entretenimiento", "entertainment", "teatro", "theater", "theatre", "concert", "concierto", "museo", "museum", "netflix", "hbo", "disney", "spotify", "streaming", "gaming", "juegos"] },
  { icon: ShoppingBag, keywords: ["compras", "shopping", "ropa", "clothing", "clothes", "fashion", "moda", "zara", "h&m", "primark", "mango", "retail", "tienda", "store", "shop", "amazon", "aliexpress", "ebay", "online"] },
  { icon: Pill, keywords: ["salud", "health", "farmacia", "pharmacy", "medicina", "medicine", "médico", "medico", "doctor", "hospital", "clínica", "clinica", "dentista", "dentist", "óptica", "optica"] },
  { icon: Heart, keywords: ["bienestar", "wellness", "spa", "masaje", "massage", "therapy", "terapia", "psicólogo", "psicologo", "mental"] },
  { icon: Lightbulb, keywords: ["luz", "electricidad", "electricity", "electric", "endesa", "iberdrola", "naturgy", "energía", "energia", "power", "suministros", "utilities"] },
  { icon: Wifi, keywords: ["internet", "wifi", "fibra", "fiber", "broadband", "movistar", "vodafone", "orange", "yoigo", "masmovil"] },
  { icon: Smartphone, keywords: ["teléfono", "telefono", "phone", "móvil", "movil", "mobile", "cellular", "suscripción", "suscripcion", "subscription", "app", "digital"] },
  { icon: FileText, keywords: ["facturas", "factura", "bill", "bills", "invoice", "recibo", "receipt", "impuestos", "taxes", "tax", "iva", "irpf", "hacienda"] },
  { icon: Dumbbell, keywords: ["gimnasio", "gym", "fitness", "deporte", "sport", "sports", "ejercicio", "exercise", "yoga", "pilates", "crossfit", "entrenamiento", "training"] },
  { icon: Home, keywords: ["hogar", "home", "casa", "house", "alquiler", "rent", "hipoteca", "mortgage", "vivienda", "housing", "inmobiliaria", "real estate", "comunidad", "piso", "apartment"] },
  { icon: Wrench, keywords: ["reparación", "reparacion", "repair", "mantenimiento", "maintenance", "fontanero", "plumber", "electricista", "electrician", "reformas", "bricolaje", "ikea", "leroy", "ferretería", "ferreteria"] },
  { icon: GraduationCap, keywords: ["educación", "educacion", "education", "escuela", "school", "universidad", "university", "college", "curso", "course", "formación", "formacion", "training", "libro", "book", "matrícula", "matricula", "tuition"] },
  { icon: Gift, keywords: ["regalo", "regalos", "gift", "gifts", "present", "cumpleaños", "birthday", "navidad", "christmas", "celebración", "celebracion"] },
  { icon: Shield, keywords: ["seguro", "seguros", "insurance", "póliza", "poliza", "aseguradora", "mapfre", "axa", "allianz", "zurich", "sanitas", "adeslas"] },
  { icon: CreditCard, keywords: ["banco", "bank", "banking", "tarjeta", "card", "comisión", "comision", "fee", "cuenta", "account", "bbva", "santander", "caixa", "sabadell", "ing", "n26", "revolut", "wise"] },
  { icon: ArrowLeftRight, keywords: ["transferencia", "transfer", "envío", "envio", "remesa", "bizum", "paypal", "traspaso"] },
  { icon: TrendingUp, keywords: ["inversión", "inversion", "investment", "acciones", "stocks", "fondos", "funds", "etf", "crypto", "cripto", "bitcoin", "bolsa", "trading"] },
  { icon: Banknote, keywords: ["ahorro", "ahorros", "savings", "depósito", "deposito", "deposit", "hucha", "emergency"] },
  { icon: Wallet, keywords: ["nómina", "nomina", "salario", "salary", "sueldo", "wage", "income", "ingreso", "pago", "payment", "freelance", "facturación", "facturacion"] },
  { icon: Baby, keywords: ["bebé", "bebe", "baby", "niño", "niños", "nino", "ninos", "child", "children", "guardería", "guarderia", "daycare", "colegio", "escuela"] },
  { icon: PawPrint, keywords: ["mascota", "mascotas", "pet", "pets", "perro", "dog", "gato", "cat", "veterinario", "veterinary", "vet", "animal"] },
  { icon: Building2, keywords: ["trabajo", "work", "oficina", "office", "negocio", "business", "empresa", "company", "profesional", "professional", "coworking"] },
];

function getCategoryIcon(category: string): LucideIcon {
  const lower = category.toLowerCase();
  for (const { icon, keywords } of ICON_CATEGORIES) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return icon;
      }
    }
  }
  return Package;
}

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

  // Filter and sort tags: hide "import" and "bot" tags, put "esencial"/"no esencial" at top
  const filteredTags = useMemo(() => {
    const searchLower = tagSearch.toLowerCase();
    const filtered = tags.filter((t) => {
      const tagLower = t.tag.toLowerCase();
      // Hide tags containing "import" or "bot"
      if (tagLower.includes("import") || tagLower.includes("bot")) {
        return false;
      }
      // Apply search filter
      return tagLower.includes(searchLower);
    });

    // Sort: "esencial" and "no esencial" at top
    return filtered.sort((a, b) => {
      const aLower = a.tag.toLowerCase();
      const bLower = b.tag.toLowerCase();
      const aIsEsencial = aLower === "esencial" || aLower === "no esencial";
      const bIsEsencial = bLower === "esencial" || bLower === "no esencial";

      if (aIsEsencial && !bIsEsencial) return -1;
      if (!aIsEsencial && bIsEsencial) return 1;
      // If both are esencial tags, put "esencial" before "no esencial"
      if (aIsEsencial && bIsEsencial) {
        if (aLower === "esencial") return -1;
        if (bLower === "esencial") return 1;
      }
      return a.tag.localeCompare(b.tag);
    });
  }, [tags, tagSearch]);

  const isValid = parseFloat(amount.replace(",", ".")) > 0 && description.trim();

  if (!isOpen) return null;

  const modalContent = (
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

        <div className="space-y-4 mt-4 flex-1">
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
                {selectedCategory ? (
                  (() => {
                    const SelectedIcon = getCategoryIcon(selectedCategory);
                    return <SelectedIcon size={18} />;
                  })()
                ) : (
                  <FolderOpen size={18} />
                )}
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
        <div className="mt-6 pt-4" style={{ borderTop: "1px solid var(--tg-theme-secondary-bg-color)" }}>
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
                {filteredCategories.map((cat) => {
                  const CategoryIcon = getCategoryIcon(cat.name);
                  return (
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
                      <span className="flex items-center gap-2" style={{ color: "var(--tg-theme-text-color)" }}>
                        <CategoryIcon size={18} style={{ color: "var(--tg-theme-hint-color)" }} />
                        {cat.name}
                      </span>
                      {selectedCategory === cat.name && (
                        <Check size={18} style={{ color: "#059669" }} />
                      )}
                    </button>
                  );
                })}
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

  // Render as a portal to ensure it's always on top
  return createPortal(modalContent, document.body);
}
