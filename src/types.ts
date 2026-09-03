import type { Context } from "hono";

// Environment bindings for Cloudflare Worker
export interface Env extends Cloudflare.Env {
    MORTGAGE_CONFIG?: string; // Private JSON configuration; see docs/mortgage.md.
    BANK_IMPORT_REMINDER_REPEAT_DAYS: string;
    // Optional secrets that are intentionally not declared in wrangler.toml.
    IMPORT_HASH_TTL_DAYS?: string;       // TTL for import hash cache (default: 365 days)
    TELEGRAM_ALLOWED_USER_IDS?: string;
    BANK_ACCOUNT_SUFFIX_CAIXABANK: string;
    BANK_ACCOUNT_SUFFIX_IMAGINBANK: string;
    BANK_ACCOUNT_NAME_BBVA: string;
    BANK_ACCOUNT_NAME_CAIXABANK: string;
    BANK_ACCOUNT_NAME_IMAGINBANK: string;
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
    transaction_journal_id?: string;
    bill_id?: string | null;
    external_id?: string | null;
    notes?: string | null;
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
        group_title?: string | null;
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

// Agent response that may include charts
export interface AgentResponse {
    text: string;
    chartUrl?: string;
}

// Detailed transaction info for single fetch
export interface TransactionDetail {
    transaction_journal_id?: string;
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

// NDJSON streaming protocol between DO and webhook handler
export type StreamEvent =
    | { type: "tool"; name: string }
    | { type: "text"; content: string }
    | { type: "done"; chartUrl?: string }
    | { type: "error"; message: string };
