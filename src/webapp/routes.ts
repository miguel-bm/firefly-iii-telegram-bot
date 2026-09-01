import { Hono } from "hono";
import type { Env } from "../types.js";
import { FireflyClient, getCachedAssetAccounts } from "../tools/firefly.js";
import { daysAgoInTimeZone, todayInTimeZone } from "../lib/dates.js";
import { parseIdList, validateTelegramInitData, type TelegramUser } from "./auth.js";
import {
    ValidationError,
    escapeFireflySearch,
    parseCreateExpense,
    parseOptionalDate,
    parsePositiveInt,
    parseTransactionType,
    parseUpdateTransaction,
} from "./validation.js";

// ============================================================================
// Telegram WebApp Validation
// ============================================================================

// Middleware to validate Telegram WebApp requests
async function webAppAuth(c: import("hono").Context<{ Bindings: Env }>, next: import("hono").Next) {
    const initData = c.req.header("X-Telegram-Init-Data");

    if (!initData) {
        console.log("WebApp auth failed: Missing init data");
        return c.json({ error: "Missing Telegram init data" }, 401);
    }

    const validated = validateTelegramInitData(initData, c.env.TELEGRAM_BOT_TOKEN);
    if (!validated) {
        console.log("WebApp auth failed: Invalid init data");
        return c.json({ error: "Invalid Telegram init data" }, 401);
    }

    // Verify user is allowed (supports comma-separated list of IDs)
    const allowedIds = parseIdList(c.env.TELEGRAM_ALLOWED_USER_IDS ?? c.env.TELEGRAM_ALLOWED_CHAT_ID);
    if (!allowedIds.includes(String(validated.user.id))) {
        console.log("WebApp auth failed: User not authorized", validated.user.id);
        return c.json({ error: "User not authorized" }, 403);
    }

    // Store validated data in context
    c.set("telegramUser", validated.user);
    await next();
}

// Extend Hono context
declare module "hono" {
    interface ContextVariableMap {
        telegramUser: TelegramUser;
    }
}

export function registerWebAppRoutes(app: Hono<{ Bindings: Env }>): void {
    // Health check
    app.get("/healthz", (c) => {
        return c.json({ status: "ok", timestamp: new Date().toISOString() });
    });
    
    function apiError(c: import("hono").Context, error: unknown, fallback: string) {
        if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
        console.error(fallback, error);
        return c.json({ error: fallback }, 500);
    }
    
    // ============================================================================
    // Web App API Routes
    // ============================================================================
    
    // Get recent transactions
    app.get("/api/transactions", webAppAuth, async (c) => {
        try {
            const client = new FireflyClient(c.env);
            const limit = parsePositiveInt(c.req.query("limit"), 50, 500);
            const type = parseTransactionType(c.req.query("type"));
            const search = c.req.query("search") || "";
            if (search.length > 200) throw new ValidationError("search is too long");
            const start = parseOptionalDate(c.req.query("start"), "start");
            const end = parseOptionalDate(c.req.query("end"), "end");
            const uncategorized = c.req.query("uncategorized") === "true";
    
            // Build search query
            let query = "";
    
            // Date range
            if (start) {
                query += `date_after:${start} `;
            } else {
                query += `date_after:${getDateDaysAgo(90, c.env)} `; // Default: last 90 days
            }
            if (end) {
                query += `date_before:${end} `;
            }
    
            // Type filter
            if (type) {
                query += `type:${type} `;
            }
            if (uncategorized) query += "has_no_category:true ";
    
            // Text search
            if (search) {
                query += `description_contains:"${escapeFireflySearch(search)}" `;
            }
    
            const results = await client.searchTransactions(query.trim(), limit);
    
            // Transform to simpler format for the webapp
            const transactions = results.flatMap((r) =>
                r.attributes.transactions.map((t) => ({
                    id: r.id,
                    date: t.date,
                    description: t.description,
                    amount: parseFloat(t.amount),
                    type: t.type,
                    category: t.category_name || null,
                    source: t.source_name,
                    destination: t.destination_name,
                    tags: t.tags || [],
                    notes: (t as unknown as Record<string, unknown>).notes || null,
                }))
            );
    
            return c.json({ transactions });
        } catch (error) {
            return apiError(c, error, "Failed to fetch transactions");
        }
    });
    
    // Get expense summary by category (for chart)
    app.get("/api/expenses/by-category", webAppAuth, async (c) => {
        try {
            const client = new FireflyClient(c.env);
            // Support both days (legacy) and start/end date params
            const startParam = c.req.query("start");
            const endParam = c.req.query("end");
            const days = parsePositiveInt(c.req.query("days"), 30, 3650);
    
            const start = startParam ? parseOptionalDate(startParam, "start")! : getDateDaysAgo(days, c.env);
            const end = endParam ? parseOptionalDate(endParam, "end")! : getToday(c.env);
    
            const expenses = await client.getExpenseByCategory(start, end);
    
            // Transform to chart-friendly format
            const data = expenses
                .filter((e) => e.difference_float < 0)
                .map((e) => ({
                    category: e.name || "Sin categoría",
                    amount: Math.abs(e.difference_float),
                    currency: e.currency_code,
                }))
                .sort((a, b) => b.amount - a.amount);
    
            return c.json({ data, period: { start, end } });
        } catch (error) {
            return apiError(c, error, "Failed to fetch expense summary");
        }
    });
    
    // Get income summary by category (for chart)
    app.get("/api/income/by-category", webAppAuth, async (c) => {
        try {
            const client = new FireflyClient(c.env);
            // Support both days (legacy) and start/end date params
            const startParam = c.req.query("start");
            const endParam = c.req.query("end");
            const days = parsePositiveInt(c.req.query("days"), 30, 3650);
    
            const start = startParam ? parseOptionalDate(startParam, "start")! : getDateDaysAgo(days, c.env);
            const end = endParam ? parseOptionalDate(endParam, "end")! : getToday(c.env);
    
            const income = await client.getIncomeByCategory(start, end);
    
            // Transform to chart-friendly format (income has positive values)
            const data = income
                .filter((e) => e.difference_float > 0)
                .map((e) => ({
                    category: e.name || "Sin categoría",
                    amount: e.difference_float,
                    currency: e.currency_code,
                }))
                .sort((a, b) => b.amount - a.amount);
    
            return c.json({ data, period: { start, end } });
        } catch (error) {
            return apiError(c, error, "Failed to fetch income summary");
        }
    });
    
    // Get expenses grouped by time and category (for stacked bar chart)
    app.get("/api/expenses/by-time", webAppAuth, async (c) => {
        try {
            const client = new FireflyClient(c.env);
            const start = parseOptionalDate(c.req.query("start"), "start") || getDateDaysAgo(30, c.env);
            const end = parseOptionalDate(c.req.query("end"), "end") || getToday(c.env);
            const type = parseTransactionType(c.req.query("type")) || "withdrawal";
    
            // Search for all transactions in the period
            const query = `type:${type} date_after:${start} date_before:${end}`;
            const results = await client.searchTransactions(query, 500);
    
            // Group by date and category
            const grouped: Record<string, Record<string, number>> = {};
            const categoriesSet = new Set<string>();
    
            results.forEach((r) => {
                r.attributes.transactions.forEach((t) => {
                    const date = t.date.split("T")[0];
                    const category = t.category_name || "Sin categoría";
                    categoriesSet.add(category);
    
                    if (!grouped[date]) grouped[date] = {};
                    if (!grouped[date][category]) grouped[date][category] = 0;
                    grouped[date][category] += Math.abs(parseFloat(t.amount));
                });
            });
    
            // Sort categories by total amount (descending)
            const categoryTotals = Array.from(categoriesSet).map(cat => ({
                category: cat,
                total: Object.values(grouped).reduce((sum, day) => sum + (day[cat] || 0), 0),
            })).sort((a, b) => b.total - a.total);
    
            // Take top 8 categories, group rest as "Otros"
            const topCategories = categoryTotals.slice(0, 8).map(c => c.category);
            const hasOthers = categoryTotals.length > 8;
    
            // Transform to array format with dates
            const data = Object.entries(grouped)
                .map(([date, categories]) => {
                    const entry: Record<string, number | string> = { date };
                    topCategories.forEach(cat => {
                        entry[cat] = categories[cat] || 0;
                    });
                    if (hasOthers) {
                        entry["Otros"] = categoryTotals.slice(8).reduce(
                            (sum, c) => sum + (categories[c.category] || 0), 0
                        );
                    }
                    return entry;
                })
                .sort((a, b) => (a.date as string).localeCompare(b.date as string));
    
            const categories = hasOthers ? [...topCategories, "Otros"] : topCategories;
    
            return c.json({ data, categories, period: { start, end } });
        } catch (error) {
            return apiError(c, error, "Failed to fetch time-based expenses");
        }
    });
    
    // Get transactions for a specific category (for drill-down view)
    app.get("/api/transactions/by-category", webAppAuth, async (c) => {
        try {
            const client = new FireflyClient(c.env);
            const category = c.req.query("category");
            const type = parseTransactionType(c.req.query("type")) || "withdrawal";
            const start = parseOptionalDate(c.req.query("start"), "start") || getDateDaysAgo(30, c.env);
            const end = parseOptionalDate(c.req.query("end"), "end") || getToday(c.env);
    
            if (!category) {
                return c.json({ error: "Category parameter is required" }, 400);
            }
    
            // Search for transactions in this category
            const query = `category_is:"${escapeFireflySearch(category)}" type:${type} date_after:${start} date_before:${end}`;
            const results = await client.searchTransactions(query, 500);
    
            const transactions = results.flatMap((r) =>
                r.attributes.transactions.map((t) => ({
                    id: r.id,
                    date: t.date,
                    amount: parseFloat(t.amount),
                    description: t.description,
                    type: t.type,
                    category: t.category_name || null,
                }))
            ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
            return c.json({ data: transactions, category, period: { start, end } });
        } catch (error) {
            return apiError(c, error, "Failed to fetch category transactions");
        }
    });
    
    // Get account balances (assets and liabilities)
    app.get("/api/accounts", webAppAuth, async (c) => {
        try {
            const client = new FireflyClient(c.env);
            const [assets, liabilities] = await Promise.all([
                client.getAccounts("asset"),
                client.getAccounts("liability"),
            ]);
            return c.json({ assets, liabilities });
        } catch (error) {
            console.error("API error:", error);
            return c.json({ error: "Failed to fetch accounts" }, 500);
        }
    });
    
    // Get all categories
    app.get("/api/categories", webAppAuth, async (c) => {
        try {
            const client = new FireflyClient(c.env);
            const categories = await client.getCategories();
            return c.json({
                categories: categories.map((cat) => ({
                    id: cat.id,
                    name: cat.name,
                })),
            });
        } catch (error) {
            console.error("API error:", error);
            return c.json({ error: "Failed to fetch categories" }, 500);
        }
    });
    
    // Get all tags
    app.get("/api/tags", webAppAuth, async (c) => {
        try {
            const client = new FireflyClient(c.env);
            const tags = await client.getTags();
            return c.json({
                tags: tags.map((t) => ({
                    id: t.id,
                    tag: t.tag,
                })),
            });
        } catch (error) {
            console.error("API error:", error);
            return c.json({ error: "Failed to fetch tags" }, 500);
        }
    });
    
    // Get income/expense summary for a period
    app.get("/api/summary", webAppAuth, async (c) => {
        try {
            const client = new FireflyClient(c.env);
            const start = parseOptionalDate(c.req.query("start"), "start") || getDateDaysAgo(30, c.env);
            const end = parseOptionalDate(c.req.query("end"), "end") || getToday(c.env);
    
            // Get all transactions for the period
            const query = `date_after:${start} date_before:${end}`;
            const results = await client.searchTransactions(query, 500);
    
            const currencies: Record<string, { currency: string; income: number; expenses: number; net: number }> = {};
    
            for (const r of results) {
                for (const t of r.attributes.transactions) {
                    const amount = Number(t.amount);
                    if (!Number.isFinite(amount)) continue;
                    const currency = t.currency_code || c.env.DEFAULT_CURRENCY;
                    const totals = currencies[currency] ?? { currency, income: 0, expenses: 0, net: 0 };
                    if (t.type === "deposit") {
                        totals.income += amount;
                    } else if (t.type === "withdrawal") {
                        totals.expenses += amount;
                    }
                    totals.net = totals.income - totals.expenses;
                    currencies[currency] = totals;
                }
            }
    
            const totalsByCurrency = Object.values(currencies).sort((a, b) => a.currency.localeCompare(b.currency));
            const primary = currencies[c.env.DEFAULT_CURRENCY] ?? totalsByCurrency[0] ?? {
                currency: c.env.DEFAULT_CURRENCY,
                income: 0,
                expenses: 0,
                net: 0,
            };
    
            return c.json({
                ...primary,
                currencies: totalsByCurrency,
                period: { start, end },
            });
        } catch (error) {
            return apiError(c, error, "Failed to fetch summary");
        }
    });
    
    // Get account balance history
    app.get("/api/accounts/:id/history", webAppAuth, async (c) => {
        try {
            const client = new FireflyClient(c.env);
            const accountId = c.req.param("id") ?? "";
            if (!/^\d+$/.test(accountId)) throw new ValidationError("Invalid account ID");
            const start = parseOptionalDate(c.req.query("start"), "start") || getDateDaysAgo(30, c.env);
            const end = parseOptionalDate(c.req.query("end"), "end") || getToday(c.env);
    
            const history = await client.getAccountHistory(accountId, start, end);
            return c.json({ history });
        } catch (error) {
            return apiError(c, error, "Failed to fetch account history");
        }
    });
    
    // Update a transaction
    app.put("/api/transactions/:id", webAppAuth, async (c) => {
        try {
            const transactionId = c.req.param("id") ?? "";
            if (!/^\d+$/.test(transactionId)) throw new ValidationError("Invalid transaction ID");
            const updates = parseUpdateTransaction(await c.req.json());
            const client = new FireflyClient(c.env);
            const result = await client.updateTransaction(transactionId, updates);
            return c.json({ success: true, transaction: result });
        } catch (error) {
            return apiError(c, error, "Failed to update transaction");
        }
    });
    
    // Create a new transaction (for quick expense entry)
    app.post("/api/transactions", webAppAuth, async (c) => {
        try {
            const { amount, description, category, tags, date, sourceAccount } = parseCreateExpense(await c.req.json());
            const client = new FireflyClient(c.env);
    
            // Default to the configured default account if no source specified
            const sourceAccountId = sourceAccount || c.env.DEFAULT_ACCOUNT_ID;
            if (!sourceAccountId) throw new ValidationError("No default source account is configured");
            const assetAccounts = await getCachedAssetAccounts(c.env);
            if (!assetAccounts.some((account) => account.id === sourceAccountId)) {
                throw new ValidationError("sourceAccount is not an active asset account");
            }
    
            const result = await client.createTransaction({
                type: "withdrawal",
                amount,
                description,
                date: date || getToday(c.env),
                source_account_id: sourceAccountId,
                category_name: category || undefined,
                tags: tags || [],
            }, c.env);
    
            return c.json({ success: true, transaction: result });
        } catch (error) {
            return apiError(c, error, "Failed to create transaction");
        }
    });
    
    // Helper functions
    function getToday(env: Env): string {
        return todayInTimeZone(env.BOT_TIMEZONE || "Europe/Madrid");
    }
    
    function getDateDaysAgo(days: number, env: Env): string {
        return daysAgoInTimeZone(days, env.BOT_TIMEZONE || "Europe/Madrid");
    }
}
