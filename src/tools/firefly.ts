import type {
    Env,
    FireflyCategory,
    FireflySearchResult,
    CreateTransactionInput,
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

        const payload = {
            error_if_duplicate_hash: false,
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
                    // For withdrawals: source = your account, destination = merchant name
                    source_id:
                        txType === "withdrawal"
                            ? input.source_account_id ?? env.DEFAULT_ACCOUNT_ID
                            : undefined,
                    destination_name:
                        txType === "withdrawal"
                            ? input.description // Use description as merchant/destination name
                            : undefined,
                    // For deposits: destination = your account
                    destination_id:
                        txType === "deposit"
                            ? input.destination_account_id ?? env.DEFAULT_ACCOUNT_ID
                            : undefined,
                    budget_id: input.budget_id,
                    tags: input.tags,
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

    // Get asset accounts for report links
    async getAssetAccounts(): Promise<{ id: string; name: string }[]> {
        interface AccountsResponse {
            data: { id: string; attributes: { name: string; type: string } }[];
        }
        const params = new URLSearchParams({ type: "asset", limit: "100" });
        const response = await this.request<AccountsResponse>(`/accounts?${params}`);
        return response.data.map((a) => ({
            id: a.id,
            name: a.attributes.name,
        }));
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

