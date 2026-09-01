const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TRANSACTION_TYPES = new Set(["withdrawal", "deposit", "transfer"]);

export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ValidationError";
    }
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ValidationError("Expected a JSON object");
    }
    return value as Record<string, unknown>;
}

function string(value: unknown, field: string, maxLength: number, allowEmpty = false): string {
    if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
    const result = value.trim();
    if (!allowEmpty && !result) throw new ValidationError(`${field} is required`);
    if (result.length > maxLength) throw new ValidationError(`${field} is too long`);
    return result;
}

export function parseDate(value: unknown, field = "date"): string {
    const result = string(value, field, 10);
    if (!DATE_PATTERN.test(result)) throw new ValidationError(`${field} must use YYYY-MM-DD`);
    const [year, month, day] = result.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.toISOString().slice(0, 10) !== result) throw new ValidationError(`${field} is invalid`);
    return result;
}

export function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
        throw new ValidationError(`Value must be an integer between 1 and ${max}`);
    }
    return parsed;
}

export function parseOptionalDate(value: string | undefined, field: string): string | undefined {
    return value === undefined ? undefined : parseDate(value, field);
}

export function parseTransactionType(value: string | undefined): "withdrawal" | "deposit" | "transfer" | undefined {
    if (value === undefined) return undefined;
    if (!TRANSACTION_TYPES.has(value)) throw new ValidationError("Unsupported transaction type");
    return value as "withdrawal" | "deposit" | "transfer";
}

function tags(value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 20) throw new ValidationError("tags must contain at most 20 items");
    return [...new Set(value.map((tag) => string(tag, "tag", 100)))];
}

export interface CreateExpenseBody {
    amount: number;
    description: string;
    category?: string;
    tags: string[];
    date?: string;
    sourceAccount?: string;
}

export function parseCreateExpense(value: unknown): CreateExpenseBody {
    const body = object(value);
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
        throw new ValidationError("amount must be a positive finite number");
    }

    return {
        amount,
        description: string(body.description, "description", 255),
        category: body.category === undefined || body.category === null || body.category === ""
            ? undefined
            : string(body.category, "category", 100),
        tags: tags(body.tags),
        date: body.date === undefined || body.date === "" ? undefined : parseDate(body.date),
        sourceAccount: body.sourceAccount === undefined
            ? undefined
            : string(body.sourceAccount, "sourceAccount", 32),
    };
}

export interface UpdateTransactionBody {
    type?: "withdrawal" | "deposit" | "transfer";
    date?: string;
    amount?: number;
    description?: string;
    category_name?: string;
    source_id?: string;
    destination_id?: string;
    tags?: string[];
    notes?: string | null;
}

export function parseUpdateTransaction(value: unknown): UpdateTransactionBody {
    const body = object(value);
    const allowed = new Set([
        "type", "date", "amount", "description", "category", "category_name",
        "source_id", "destination_id", "tags", "notes",
    ]);
    const unknown = Object.keys(body).filter((key) => !allowed.has(key));
    if (unknown.length) throw new ValidationError(`Unknown fields: ${unknown.join(", ")}`);

    const result: UpdateTransactionBody = {};
    if (body.type !== undefined) result.type = parseTransactionType(String(body.type));
    if (body.date !== undefined) result.date = parseDate(body.date);
    if (body.amount !== undefined) {
        const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError("amount must be positive");
        result.amount = amount;
    }
    if (body.description !== undefined) result.description = string(body.description, "description", 255);
    const category = body.category_name ?? body.category;
    if (category !== undefined) result.category_name = category === null ? "" : string(category, "category", 100, true);
    if (body.source_id !== undefined) result.source_id = string(body.source_id, "source_id", 32);
    if (body.destination_id !== undefined) result.destination_id = string(body.destination_id, "destination_id", 32);
    if (body.tags !== undefined) result.tags = tags(body.tags);
    if (body.notes !== undefined) result.notes = body.notes === null ? null : string(body.notes, "notes", 10_000, true);
    if (!Object.keys(result).length) throw new ValidationError("No supported updates supplied");
    return result;
}

export function escapeFireflySearch(value: string): string {
    return value.replace(/["\\]/g, "\\$&").replace(/[\r\n]/g, " ");
}
