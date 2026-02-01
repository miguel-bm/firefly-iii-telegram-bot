import type {
    Env,
    FireflyCategory,
    FireflySearchResult,
    CreateTransactionInput,
    FireflyTag,
    TransactionDetail,
} from "../types.js";

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

        return response.json() as Promise<T>;
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
        }
        const params = new URLSearchParams({ query, limit: String(limit) });
        const response = await this.request<SearchResponse>(
            `/search/transactions?${params}`
        );
        return response.data;
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

    async getRecentTransactions(limit = 5): Promise<FireflySearchResult[]> {
        // Get recent transactions for context
        return this.searchTransactions("*", limit);
    }

    // Create transaction with duplicate hash checking (for imports)
    async createTransactionWithDuplicateCheck(
        input: CreateTransactionInput,
        env: Env
    ): Promise<{ id: string; description: string; isDuplicate: boolean }> {
        const txType = input.type ?? "withdrawal";
        const tags = [...(input.tags ?? [])];

        const payload = {
            error_if_duplicate_hash: true, // Enable duplicate detection
            apply_rules: true,
            fire_webhooks: true,
            transactions: [
                {
                    type: txType,
                    date: input.date,
                    amount: String(input.amount),
                    description: input.description,
                    currency_code: input.currency ?? env.DEFAULT_CURRENCY,
                    category_name: input.category_name ?? undefined,
                    source_id:
                        txType === "withdrawal"
                            ? input.source_account_id ?? env.DEFAULT_ACCOUNT_ID
                            : undefined,
                    destination_name:
                        txType === "withdrawal"
                            ? input.description
                            : undefined,
                    destination_id:
                        txType === "deposit"
                            ? input.destination_account_id ?? env.DEFAULT_ACCOUNT_ID
                            : undefined,
                    source_name:
                        txType === "deposit"
                            ? input.description
                            : undefined,
                    budget_id: input.budget_id,
                    tags,
                    notes: input.notes,
                },
            ],
        };

        interface CreateResponse {
            data: {
                id: string;
                attributes: { transactions: { description: string }[] };
            };
        }

        try {
            const response = await this.request<CreateResponse>("/transactions", {
                method: "POST",
                body: JSON.stringify(payload),
            });

            return {
                id: response.data.id,
                description: response.data.attributes.transactions[0]?.description ?? "",
                isDuplicate: false,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "";
            // Firefly returns 422 with "duplicate" message for hash duplicates
            if (message.includes("Duplicate") || message.includes("duplicate")) {
                return { id: "", description: input.description, isDuplicate: true };
            }
            throw error;
        }
    }

    // Get transactions for a specific account and date range (for duplicate checking)
    async getTransactionsForAccount(
        accountId: string,
        startDate: string,
        endDate: string
    ): Promise<FireflySearchResult[]> {
        // Use search with account filter and date range
        const query = `account_id:${accountId} date_after:${startDate} date_before:${endDate}`;
        return this.searchTransactions(query, 500); // High limit for import checking
    }

    async deleteTransaction(id: string): Promise<void> {
        await this.request(`/transactions/${id}`, {
            method: "DELETE",
        });
    }

    async getTransaction(id: string): Promise<TransactionDetail> {
        interface TransactionResponse {
            data: {
                id: string;
                attributes: {
                    transactions: Array<{
                        type: string;
                        date: string;
                        amount: string;
                        description: string;
                        category_name?: string | null;
                        source_id?: string;
                        source_name?: string;
                        destination_id?: string;
                        destination_name?: string;
                        tags?: string[];
                        notes?: string | null;
                    }>;
                };
            };
        }
        const response = await this.request<TransactionResponse>(`/transactions/${id}`);
        const tx = response.data.attributes.transactions[0];
        if (!tx) throw new Error(`Transaction ${id} not found`);

        return {
            id: response.data.id,
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
            notes?: string;
        }
    ): Promise<{ id: string; description: string }> {
        // Build the update payload - only include non-undefined fields
        const transactionUpdate: Record<string, unknown> = {};

        if (updates.type !== undefined) transactionUpdate.type = updates.type;
        if (updates.date !== undefined) transactionUpdate.date = updates.date;
        if (updates.amount !== undefined) transactionUpdate.amount = String(updates.amount);
        if (updates.description !== undefined) transactionUpdate.description = updates.description;
        if (updates.category_name !== undefined) transactionUpdate.category_name = updates.category_name;
        if (updates.source_id !== undefined) transactionUpdate.source_id = updates.source_id;
        if (updates.destination_id !== undefined) transactionUpdate.destination_id = updates.destination_id;
        if (updates.tags !== undefined) transactionUpdate.tags = updates.tags;
        if (updates.notes !== undefined) transactionUpdate.notes = updates.notes;

        const payload = {
            apply_rules: true,
            fire_webhooks: true,
            transactions: [transactionUpdate],
        };

        interface UpdateResponse {
            data: {
                id: string;
                attributes: { transactions: { description: string }[] };
            };
        }

        const response = await this.request<UpdateResponse>(`/transactions/${id}`, {
            method: "PUT",
            body: JSON.stringify(payload),
        });

        return {
            id: response.data.id,
            description: response.data.attributes.transactions[0]?.description ?? "",
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

    async getBasicSummary(
        start: string,
        end: string,
        currencyCode?: string
    ): Promise<Record<string, BasicSummaryEntry>> {
        const params = new URLSearchParams({ start, end });
        if (currencyCode) params.set("currency_code", currencyCode);
        const response = await this.request<Record<string, BasicSummaryEntry>>(
            `/summary/basic?${params}`
        );
        return response;
    }

    async getExpenseTotal(
        start: string,
        end: string
    ): Promise<InsightEntry[]> {
        const params = new URLSearchParams({ start, end });
        const response = await this.request<InsightEntry[]>(
            `/insight/expense/total?${params}`
        );
        return response;
    }

    async getIncomeTotal(
        start: string,
        end: string
    ): Promise<InsightEntry[]> {
        const params = new URLSearchParams({ start, end });
        const response = await this.request<InsightEntry[]>(
            `/insight/income/total?${params}`
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

export interface BasicSummaryEntry {
    key: string;
    title: string;
    monetary_value: number;
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

