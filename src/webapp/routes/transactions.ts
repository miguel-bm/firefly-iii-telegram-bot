import { FireflyClient, getCachedAssetAccounts } from "../../tools/firefly.js";
import { transactionReference } from "../../tools/transaction-reference.js";
import {
  ValidationError,
  escapeFireflySearch,
  parseCreateExpense,
  parseOptionalDate,
  parsePositiveInt,
  parseTransactionType,
  parseUpdateTransaction,
} from "../validation.js";
import { apiError, getDateDaysAgo, getToday, webAppAuth, type WebApp } from "./shared.js";

export function registerTransactionRoutes(app: WebApp): void {
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
      let query = start
        ? `date_after:${start} `
        : `date_after:${getDateDaysAgo(90, c.env)} `;
      if (end) query += `date_before:${end} `;
      if (type) query += `type:${type} `;
      if (uncategorized) query += "has_no_category:true ";
      if (search) query += `description_contains:"${escapeFireflySearch(search)}" `;

      const results = await client.searchTransactions(query.trim(), limit);
      const transactions = results.flatMap((result) =>
        result.attributes.transactions.filter(t => !uncategorized || !t.category_name).map((transaction) => ({
          id: transactionReference(result, transaction),
          date: transaction.date,
          description: transaction.description,
          amount: parseFloat(transaction.amount),
          type: transaction.type,
          category: transaction.category_name || null,
          source: transaction.source_name,
          destination: transaction.destination_name,
          tags: transaction.tags || [],
          notes: (transaction as unknown as Record<string, unknown>).notes || null,
        }))
      );
      return c.json({ transactions });
    } catch (error) {
      return apiError(c, error, "Failed to fetch transactions");
    }
  });

  app.get("/api/transactions/by-category", webAppAuth, async (c) => {
    try {
      const client = new FireflyClient(c.env);
      const category = c.req.query("category");
      const type = parseTransactionType(c.req.query("type")) || "withdrawal";
      const start = parseOptionalDate(c.req.query("start"), "start") || getDateDaysAgo(30, c.env);
      const end = parseOptionalDate(c.req.query("end"), "end") || getToday(c.env);
      if (!category) return c.json({ error: "Category parameter is required" }, 400);

      const query = `category_is:"${escapeFireflySearch(category)}" type:${type} date_after:${start} date_before:${end}`;
      const results = await client.searchTransactions(query, 500);
      const transactions = results.flatMap((result) =>
        result.attributes.transactions.filter(t => t.category_name === category && t.type === type).map((transaction) => ({
          id: transactionReference(result, transaction),
          date: transaction.date,
          amount: parseFloat(transaction.amount),
          description: transaction.description,
          type: transaction.type,
          category: transaction.category_name || null,
        }))
      ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return c.json({ data: transactions, category, period: { start, end } });
    } catch (error) {
      return apiError(c, error, "Failed to fetch category transactions");
    }
  });

  app.put("/api/transactions/:id", webAppAuth, async (c) => {
    try {
      const transactionId = c.req.param("id") ?? "";
      if (!/^\d+(?::\d+)?$/.test(transactionId)) throw new ValidationError("Invalid transaction ID");
      const updates = parseUpdateTransaction(await c.req.json());
      const result = await new FireflyClient(c.env).updateTransaction(transactionId, updates);
      return c.json({ success: true, transaction: result });
    } catch (error) {
      return apiError(c, error, "Failed to update transaction");
    }
  });

  app.post("/api/transactions", webAppAuth, async (c) => {
    try {
      const input = parseCreateExpense(await c.req.json());
      const sourceAccountId = input.sourceAccount || c.env.DEFAULT_ACCOUNT_ID;
      if (!sourceAccountId) throw new ValidationError("No default source account is configured");
      const assetAccounts = await getCachedAssetAccounts(c.env);
      if (!assetAccounts.some(({ id }) => id === sourceAccountId)) {
        throw new ValidationError("sourceAccount is not an active asset account");
      }
      const result = await new FireflyClient(c.env).createTransaction({
        type: "withdrawal",
        amount: input.amount,
        description: input.description,
        date: input.date || getToday(c.env),
        source_account_id: sourceAccountId,
        category_name: input.category || undefined,
        tags: input.tags || [],
      }, c.env);
      return c.json({ success: true, transaction: result });
    } catch (error) {
      return apiError(c, error, "Failed to create transaction");
    }
  });
}
