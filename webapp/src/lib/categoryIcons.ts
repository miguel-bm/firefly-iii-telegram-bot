import {
  ArrowLeftRight, Baby, Banknote, Building2, Car, Coffee, CreditCard, Dumbbell,
  FileText, Film, Fuel, Gift, GraduationCap, Heart, Home, Lightbulb, Package,
  PawPrint, Pill, Plane, Shield, ShoppingBag, ShoppingCart, Smartphone,
  TrendingUp, Utensils, Wifi, Wallet, Wrench, type LucideIcon,
} from "lucide-react";

const CATEGORY_ICON_RULES: { icon: LucideIcon; keywords: string[] }[] = [
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

export function getCategoryIcon(category: string | null): LucideIcon {
  if (!category) return Package;
  const normalized = category.toLowerCase();
  return CATEGORY_ICON_RULES.find(({ keywords }) =>
    keywords.some((keyword) => normalized.includes(keyword))
  )?.icon ?? Package;
}
