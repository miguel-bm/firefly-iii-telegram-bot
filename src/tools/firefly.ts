import type {
    Env,
    FireflyCategory,
    FireflySearchResult,
    CreateTransactionInput,
    FireflyTag,
    TransactionDetail,
} from "../types.js";
import { parseTransactionReference, transactionReference } from "./transaction-reference.js";

export class FireflyClient {
    private baseUrl: string;
    private token: string;

    constructor(env: Env) {
        this.baseUrl = env.FIREFLY_API_URL.replace(/\/$/, "");
        this.token = env.FIREFLY_API_TOKEN;
    }

    private async request<T>(
        path: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${this.baseUrl}/api/v1${path}`;
        const response = await fetch(url, {
            ...options,
            signal: options.signal ?? AbortSignal.timeout(15_000),
            headers: {
                Authorization: `Bearer ${this.token}`,
                "Content-Type": "application/json",
                Accept: "application/vnd.api+json",
                ...options.headers,
            },
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Firefly API error ${response.status}: ${error}`);
        }

        return response.status === 204 ? undefined as T : response.json() as Promise<T>;
    }

    async getCategories(): Promise<FireflyCategory[]> {
        interface CategoriesResponse {
            data: { id: string; attributes: { name: string } }[];
        }
        const response = await this.request<CategoriesResponse>("/categories");
        return response.data.map((c) => ({
            id: c.id,
            name: c.attributes.name,
        }));
    }

    async getTags(): Promise<FireflyTag[]> {
        interface TagsResponse {
            data: { id: string; attributes: { tag: string } }[];
        }
        const response = await this.request<TagsResponse>("/tags?limit=100");
        return response.data.map((t) => ({
            id: t.id,
            tag: t.attributes.tag,
        }));
    }

    async searchTransactions(
        query: string,
        limit = 10
    ): Promise<FireflySearchResult[]> {
        interface SearchResponse {
            data: FireflySearchResult[];
            meta?: { pagination?: { current_page: number; total_pages: number } };
        }
        const requested = Math.max(1, Math.min(limit, 2_000));
        const pageSize = Math.min(requested, 100);
        const transactions: FireflySearchResult[] = [];
        let page = 1;

        while (transactions.length < requested) {
            const params = new URLSearchParams({
                query,
                limit: String(pageSize),
                page: String(page),
            });
            const response = await this.request<SearchResponse>(`/search/transactions?${params}`);
            transactions.push(...response.data);

            const totalPages = response.meta?.pagination?.total_pages;
            if (response.data.length < pageSize || (totalPages !== undefined && page >= totalPages)) break;
            page++;
        }

        return transactions.slice(0, requested);
    }

    async createTransaction(
        input: CreateTransactionInput,
        env: Env
    ): Promise<{ id: string; description: string }> {
        const txType = input.type ?? "withdrawal";

        // Always add "telegram-bot" tag to identify transactions created by this bot
        const tags = [...(input.tags ?? []), "telegram-bot"];

        // Build transaction based on type
        const transaction: Record<string, unknown> = {
            type: txType,
            date: input.date,
            amount: String(input.amount),
            description: input.description,
            currency_code: input.currency ?? env.DEFAULT_CURRENCY,
            category_name: input.category_name ?? undefined,
            budget_id: input.budget_id,
            tags,
            notes: input.notes,
        };

        if (txType === "withdrawal") {
            // Withdrawal: source = your asset account, destination = merchant/expense account (by name)
            transaction.source_id = input.source_account_id ?? env.DEFAULT_ACCOUNT_ID;
            transaction.destination_name = input.description; // Use description as merchant name
        } else if (txType === "deposit") {
            // Deposit: source = revenue account (by name), destination = your asset account
            transaction.source_name = input.description; // Use description as payer name
            transaction.destination_id = input.destination_account_id ?? env.DEFAULT_ACCOUNT_ID;
        } else if (txType === "transfer") {
            // Transfer: both source and destination are asset accounts (by ID)
            transaction.source_id = input.source_account_id ?? env.DEFAULT_ACCOUNT_ID;
            transaction.destination_id = input.destination_account_id;
            // For transfers, don't use destination_name - we need the actual account ID
        }

        const payload = {
            error_if_duplicate_hash: false,
            apply_rules: true,
            fire_webhooks: true,
            transactions: [transaction],
        };

        interface CreateResponse {
            data: {
                id: string;
                attributes: { transactions: { description: string }[] };
            };
        }

        const response = await this.request<CreateResponse>("/transactions", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        return {
            id: response.data.id,
            description: response.data.attributes.transactions[0]?.description ?? "",
        };
    }

    async deleteTransaction(id: string): Promise<void> {
        const { groupId } = parseTransactionReference(id);
        const group = await this.getTransactionGroup(groupId);
        if (group.attributes.transactions.length !== 1) {
            throw new Error("Split payment: deletion through the bot is disabled. Review the whole payment in Firefly.");
        }
        await this.getTransaction(id); // Also reject a stale/wrong journal reference.
        await this.request(`/transactions/${groupId}`, {
            method: "DELETE",
        });
    }

    async getTransactionGroup(id: string): Promise<FireflySearchResult> {
        const { groupId } = parseTransactionReference(id);
        return (await this.request<{ data: FireflySearchResult }>(`/transactions/${groupId}`)).data;
    }

    async getAccount(id: string): Promise<{ type: string; currency_code: string; interest: string; interest_period: string; active: boolean }> {
        if (!/^\d+$/.test(id)) throw new Error("Invalid account ID");
        return (await this.request<{ data: { attributes: { type: string; currency_code: string; interest: string; interest_period: string; active: boolean } } }>(`/accounts/${id}`)).data.attributes;
    }

    async createSplitWithdrawal(transactions: Record<string, unknown>[], title: string): Promise<FireflySearchResult> {
        return (await this.request<{ data: FireflySearchResult }>("/transactions", {
            method: "POST",
            body: JSON.stringify({ transactions, group_title: title, apply_rules: false, fire_webhooks: false, error_if_duplicate_hash: true }),
        })).data;
    }

    async getTransaction(id: string): Promise<TransactionDetail> {
        const { journalId } = parseTransactionReference(id);
        const group = await this.getTransactionGroup(id);
        if (!journalId && group.attributes.transactions.length > 1) {
            throw new Error(`Split payment: choose a part: ${group.attributes.transactions.map(t => transactionReference(group, t)).join(", ")}`);
        }
        const tx = journalId ? group.attributes.transactions.find(t => t.transaction_journal_id === journalId) : group.attributes.transactions[0];
        if (!tx) throw new Error(`Transaction ${id} not found`);

        return {
            id: transactionReference(group, tx),
            transaction_journal_id: tx.transaction_journal_id,
            type: tx.type as "withdrawal" | "deposit" | "transfer",
            date: tx.date,
            amount: tx.amount,
            description: tx.description,
            category_name: tx.category_name ?? null,
            source_id: tx.source_id,
            source_name: tx.source_name,
            destination_id: tx.destination_id,
            destination_name: tx.destination_name,
            tags: tx.tags ?? [],
            notes: tx.notes ?? null,
        };
    }

    async updateTransaction(
        id: string,
        updates: {
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
    ): Promise<{ id: string; description: string }> {
        const { groupId } = parseTransactionReference(id);
        const existing = await this.getTransaction(id);
        // Forms can resubmit unchanged values. Only actual financial changes need protection.
        const financialUpdate: Record<string, unknown> = {};
        if (updates.type !== undefined && updates.type !== existing.type) financialUpdate.type = updates.type;
        if (updates.date !== undefined && updates.date !== existing.date.slice(0, 10)) financialUpdate.date = updates.date;
        if (updates.amount !== undefined && updates.amount !== Number(existing.amount)) financialUpdate.amount = String(updates.amount);
        if (updates.source_id !== undefined && updates.source_id !== existing.source_id) financialUpdate.source_id = updates.source_id;
        if (updates.destination_id !== undefined && updates.destination_id !== existing.destination_id) financialUpdate.destination_id = updates.destination_id;
        if (existing.tags.some(tag => tag.startsWith("mortgage-")) && Object.keys(financialUpdate).length > 0) {
            throw new Error("Mortgage allocation: change financial fields through a reconciled mortgage repair, not an individual split edit.");
        }
        const transactionUpdate: Record<string, unknown> = { transaction_journal_id: existing.transaction_journal_id, ...financialUpdate };

        if (updates.description !== undefined) transactionUpdate.description = updates.description;
        if (updates.category_name !== undefined) transactionUpdate.category_name = updates.category_name;
        if (updates.tags !== undefined) transactionUpdate.tags = [...new Set([...updates.tags, ...existing.tags.filter(tag => tag.startsWith("mortgage-"))])];
        if (updates.notes !== undefined) transactionUpdate.notes = updates.notes;

        const group = await this.getTransactionGroup(groupId);
        if (!existing.transaction_journal_id || !group.attributes.transactions.some(t => t.transaction_journal_id === existing.transaction_journal_id)) {
            throw new Error("Transaction changed during edit; reload before retrying");
        }
        const payload = {
            apply_rules: group.attributes.transactions.length === 1 && !existing.tags.some(t => t.startsWith("mortgage-")),
            fire_webhooks: true,
            group_title: group.attributes.transactions.length > 1 ? group.attributes.group_title ?? existing.description : undefined,
            // Firefly deletes omitted journals. ID-only entries explicitly preserve siblings.
            transactions: group.attributes.transactions.map(t => t.transaction_journal_id === existing.transaction_journal_id
                ? transactionUpdate : { transaction_journal_id: t.transaction_journal_id }),
        };

        interface UpdateResponse {
            data: {
                id: string;
                attributes: { transactions: { description: string }[] };
            };
        }

        await this.request<UpdateResponse>(`/transactions/${groupId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
        });

        return {
            id: existing.id,
            description: updates.description ?? existing.description,
        };
    }

    // Insight endpoints for chart data
    async getExpenseByCategory(
        start: string,
        end: string
    ): Promise<InsightEntry[]> {
        const params = new URLSearchParams({ start, end });
        const response = await this.request<InsightEntry[]>(
            `/insight/expense/category?${params}`
        );
        return response;
    }

    async getIncomeByCategory(
        start: string,
        end: string
    ): Promise<InsightEntry[]> {
        const params = new URLSearchParams({ start, end });
        const response = await this.request<InsightEntry[]>(
            `/insight/income/category?${params}`
        );
        return response;
    }

    // Get all accounts with balances
    async getAccounts(type?: "asset" | "expense" | "revenue" | "liability"): Promise<AccountInfo[]> {
        interface AccountsResponse {
            data: {
                id: string;
                attributes: {
                    name: string;
                    type: string;
                    current_balance: string;
                    current_balance_date: string;
                    currency_code: string;
                    active: boolean;
                };
            }[];
        }
        const params = new URLSearchParams({ limit: "100" });
        if (type) params.set("type", type);
        const response = await this.request<AccountsResponse>(`/accounts?${params}`);
        return response.data
            .filter((a) => a.attributes.active)
            .map((a) => ({
                id: a.id,
                name: a.attributes.name,
                type: a.attributes.type,
                current_balance: parseFloat(a.attributes.current_balance),
                currency_code: a.attributes.currency_code,
            }));
    }

    // Get asset accounts for report links (simplified)
    async getAssetAccounts(): Promise<{ id: string; name: string }[]> {
        const accounts = await this.getAccounts("asset");
        return accounts.map((a) => ({ id: a.id, name: a.name }));
    }

    // Get account balance history (chart data)
    async getAccountHistory(
        accountId: string,
        start: string,
        end: string,
        period: "1D" | "1W" | "1M" | "1Y" = "1D"
    ): Promise<AccountBalancePoint[]> {
        interface ChartResponse {
            label: string;
            currency_code: string;
            entries: Record<string, string>; // date -> balance
        }

        // Firefly chart endpoint - uses query params
        const params = new URLSearchParams({
            start,
            end,
            period,
            "accounts[]": accountId,
        });
        const response = await this.request<ChartResponse[]>(
            `/chart/account/overview?${params}`
        );

        // Find the matching account data
        const accountData = response[0];
        if (!accountData) return [];

        // Convert entries object to array of points
        // Dates come as ISO datetime (e.g., "2025-01-01T00:00:00+01:00") - extract just YYYY-MM-DD
        return Object.entries(accountData.entries)
            .map(([dateStr, balance]) => ({
                date: dateStr.slice(0, 10), // Extract YYYY-MM-DD from ISO datetime
                balance: parseFloat(balance),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    getReportUrl(reportType: string, accountIds: string[], start: string, end: string): string {
        // Format dates as YYYYMMDD (no dashes)
        const startFormatted = start.replace(/-/g, "");
        const endFormatted = end.replace(/-/g, "");
        // Join account IDs with commas
        const accountsStr = accountIds.join(",");
        return `${this.baseUrl}/reports/${reportType}/${accountsStr}/${startFormatted}/${endFormatted}`;
    }
}

// Types for insight/chart endpoints
export interface InsightEntry {
    id: string;
    name: string;
    difference: string;
    difference_float: number;
    currency_id: string;
    currency_code: string;
}

export interface AccountInfo {
    id: string;
    name: string;
    type: string;
    current_balance: number;
    currency_code: string;
}

export interface AccountBalancePoint {
    date: string;
    balance: number;
}

// Cache categories in KV with TTL
export async function getCachedCategories(
    env: Env
): Promise<FireflyCategory[]> {
    const cached = await env.CATEGORY_CACHE.get("categories", "json");
    if (cached) {
        return cached as FireflyCategory[];
    }

    const client = new FireflyClient(env);
    const categories = await client.getCategories();

    // Cache for 6 hours
    await env.CATEGORY_CACHE.put("categories", JSON.stringify(categories), {
        expirationTtl: 6 * 60 * 60,
    });

    return categories;
}

// Cache tags in KV with TTL, filtering out import tags
export async function getCachedTags(
    env: Env
): Promise<string[]> {
    const cached = await env.CATEGORY_CACHE.get("tags", "json");
    if (cached) {
        return cached as string[];
    }

    const client = new FireflyClient(env);
    const tags = await client.getTags();

    // Filter out "Data Import on*" tags and return just tag names
    const filteredTags = tags
        .filter((t) => !t.tag.startsWith("Data Import on"))
        .map((t) => t.tag);

    // Cache for 6 hours
    await env.CATEGORY_CACHE.put("tags", JSON.stringify(filteredTags), {
        expirationTtl: 6 * 60 * 60,
    });

    return filteredTags;
}

// Cache asset account IDs in KV with TTL
export async function getCachedAssetAccountIds(
    env: Env
): Promise<string[]> {
    const cached = await env.CATEGORY_CACHE.get("asset_account_ids", "json");
    if (cached) {
        return cached as string[];
    }

    const client = new FireflyClient(env);
    const accounts = await client.getAssetAccounts();
    const accountIds = accounts.map((a) => a.id);

    // Cache for 6 hours
    await env.CATEGORY_CACHE.put("asset_account_ids", JSON.stringify(accountIds), {
        expirationTtl: 6 * 60 * 60,
    });

    return accountIds;
}

// Cache asset accounts (id + name) for context
export async function getCachedAssetAccounts(
    env: Env
): Promise<{ id: string; name: string }[]> {
    const cached = await env.CATEGORY_CACHE.get("asset_accounts", "json");
    if (cached) {
        return cached as { id: string; name: string }[];
    }

    const client = new FireflyClient(env);
    const accounts = await client.getAccounts("asset");
    const simplified = accounts.map((a) => ({ id: a.id, name: a.name }));

    // Cache for 6 hours
    await env.CATEGORY_CACHE.put("asset_accounts", JSON.stringify(simplified), {
        expirationTtl: 6 * 60 * 60,
    });

    return simplified;
}
