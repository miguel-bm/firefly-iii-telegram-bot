import type { Context } from "hono";

// Environment bindings for Cloudflare Worker
export interface Env {
    // Durable Objects
    CHAT_AGENT: DurableObjectNamespace;

    // KV
    CATEGORY_CACHE: KVNamespace;
    IMPORT_HASHES: KVNamespace;

    // Environment variables
    DEFAULT_CURRENCY: string;
    DEFAULT_ACCOUNT_ID?: string;
    BOT_LANGUAGE: "es" | "en";
    BOT_TIMEZONE: string;
    MAX_HISTORY_MESSAGES: string;
    
    // Cron job settings
    ENABLE_MONTHLY_REPORT: string;       // "true" or "false"
    BANK_IMPORT_REMINDER_DAYS: string;   // Number of days

    // Import settings
    IMPORT_HASH_TTL_DAYS?: string;       // TTL for import hash cache (default: 365 days)

    // Secrets
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_WEBHOOK_SECRET: string;
    TELEGRAM_ALLOWED_CHAT_ID: string;
    FIREFLY_API_URL: string;
    FIREFLY_API_TOKEN: string;
    OPENAI_API_KEY: string;
}

export type HonoContext = Context<{ Bindings: Env }>;

// Chat message for history
export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    userName?: string;
    timestamp: number;
}

// Agent state shape
export interface ChatAgentState {
    chatId: number;
    defaultAccountId: string | null;
    defaultCurrency: string;
    lastMode: "transaction" | "query" | null;
    categorySnapshotVersion: string | null;
    messageHistory: ChatMessage[];
    isProcessing: boolean;
}

// Firefly III types
export interface FireflyTransaction {
    type: "withdrawal" | "deposit" | "transfer";
    date: string;
    amount: string;
    currency_code?: string;
    description: string;
    category_name?: string | null;
    source_id?: string;
    destination_id?: string;
    budget_id?: string;
    tags?: string[];
    notes?: string;
}

export interface FireflyTransactionSplit {
    type: string;
    date: string;
    amount: string;
    description: string;
    currency_code?: string;
    category_name?: string;
    source_id?: string;
    source_name?: string;
    destination_id?: string;
    destination_name?: string;
    tags?: string[];
}

export interface FireflyCategory {
    id: string;
    name: string;
    spent?: { sum: string; currency_code: string }[];
    earned?: { sum: string; currency_code: string }[];
}

export interface FireflyTag {
    id: string;
    tag: string;
}

export interface FireflySearchResult {
    id: string;
    attributes: {
        transactions: FireflyTransactionSplit[];
    };
}

// Tool schemas for OpenAI function calling
export interface CreateTransactionInput {
    type?: "withdrawal" | "deposit" | "transfer";
    date: string;
    amount: number;
    currency?: string;
    description: string;
    category_name?: string | null;
    source_account_id?: string;
    destination_account_id?: string;
    budget_id?: string;
    tags?: string[];
    notes?: string;
}

export interface QueryTransactionsInput {
    date_from?: string;
    date_to?: string;
    filters?: {
        category_name?: string;
        text_contains?: string;
        tag?: string;
        transaction_type?: "withdrawal" | "deposit" | "transfer";
        min_amount?: number;
        max_amount?: number;
    };
    aggregate?: {
        kind: "sum" | "count" | "avg";
        group_by?: "category" | "month" | "week" | "day" | "merchant" | "tag";
    };
    limit?: number;
}

// Agent response that may include charts
export interface AgentResponse {
    text: string;
    chartUrl?: string;
}

// Detailed transaction info for single fetch
export interface TransactionDetail {
    id: string;
    type: "withdrawal" | "deposit" | "transfer";
    date: string;
    amount: string;
    description: string;
    category_name: string | null;
    source_id?: string;
    source_name?: string;
    destination_id?: string;
    destination_name?: string;
    tags: string[];
    notes: string | null;
}

