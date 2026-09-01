import { FireflyClient } from "../../tools/firefly.js";
import { parseOptionalDate, parsePositiveInt, parseTransactionType } from "../validation.js";
import { apiError, getDateDaysAgo, getToday, webAppAuth, type WebApp, type WebContext } from "./shared.js";

function period(c: WebContext, defaultDays: number) {
  const startParam = c.req.query("start");
  const endParam = c.req.query("end");
  const days = parsePositiveInt(c.req.query("days"), defaultDays, 3650);
  return {
    start: startParam ? parseOptionalDate(startParam, "start")! : getDateDaysAgo(days, c.env),
    end: endParam ? parseOptionalDate(endParam, "end")! : getToday(c.env),
  };
}

export function registerAnalyticsRoutes(app: WebApp): void {
  app.get("/api/expenses/by-category", webAppAuth, async (c) => {
    try {
      const { start, end } = period(c, 30);
      const expenses = await new FireflyClient(c.env).getExpenseByCategory(start, end);
      const data = expenses
        .filter(({ difference_float }) => difference_float < 0)
        .map((entry) => ({
          category: entry.name || "Sin categoría",
          amount: Math.abs(entry.difference_float),
          currency: entry.currency_code,
        }))
        .sort((a, b) => b.amount - a.amount);
      return c.json({ data, period: { start, end } });
    } catch (error) {
      return apiError(c, error, "Failed to fetch expense summary");
    }
  });

  app.get("/api/income/by-category", webAppAuth, async (c) => {
    try {
      const { start, end } = period(c, 30);
      const income = await new FireflyClient(c.env).getIncomeByCategory(start, end);
      const data = income
        .filter(({ difference_float }) => difference_float > 0)
        .map((entry) => ({
          category: entry.name || "Sin categoría",
          amount: entry.difference_float,
          currency: entry.currency_code,
        }))
        .sort((a, b) => b.amount - a.amount);
      return c.json({ data, period: { start, end } });
    } catch (error) {
      return apiError(c, error, "Failed to fetch income summary");
    }
  });

  app.get("/api/expenses/by-time", webAppAuth, async (c) => {
    try {
      const start = parseOptionalDate(c.req.query("start"), "start") || getDateDaysAgo(30, c.env);
      const end = parseOptionalDate(c.req.query("end"), "end") || getToday(c.env);
      const type = parseTransactionType(c.req.query("type")) || "withdrawal";
      const results = await new FireflyClient(c.env).searchTransactions(
        `type:${type} date_after:${start} date_before:${end}`,
        500,
      );
      const grouped: Record<string, Record<string, number>> = {};
      const categoryNames = new Set<string>();
      for (const result of results) {
        for (const transaction of result.attributes.transactions) {
          const date = transaction.date.split("T")[0];
          const category = transaction.category_name || "Sin categoría";
          categoryNames.add(category);
          grouped[date] ??= {};
          grouped[date][category] = (grouped[date][category] || 0) + Math.abs(parseFloat(transaction.amount));
        }
      }
      const categoryTotals = Array.from(categoryNames).map((category) => ({
        category,
        total: Object.values(grouped).reduce((sum, day) => sum + (day[category] || 0), 0),
      })).sort((a, b) => b.total - a.total);
      const topCategories = categoryTotals.slice(0, 8).map(({ category }) => category);
      const otherCategories = categoryTotals.slice(8);
      const data = Object.entries(grouped).map(([date, categories]) => {
        const entry: Record<string, number | string> = { date };
        for (const category of topCategories) entry[category] = categories[category] || 0;
        if (otherCategories.length > 0) {
          entry.Otros = otherCategories.reduce((sum, item) => sum + (categories[item.category] || 0), 0);
        }
        return entry;
      }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const categories = otherCategories.length > 0 ? [...topCategories, "Otros"] : topCategories;
      return c.json({ data, categories, period: { start, end } });
    } catch (error) {
      return apiError(c, error, "Failed to fetch time-based expenses");
    }
  });

  app.get("/api/summary", webAppAuth, async (c) => {
    try {
      const start = parseOptionalDate(c.req.query("start"), "start") || getDateDaysAgo(30, c.env);
      const end = parseOptionalDate(c.req.query("end"), "end") || getToday(c.env);
      const results = await new FireflyClient(c.env).searchTransactions(
        `date_after:${start} date_before:${end}`,
        500,
      );
      const currencies: Record<string, { currency: string; income: number; expenses: number; net: number }> = {};
      for (const result of results) {
        for (const transaction of result.attributes.transactions) {
          const amount = Number(transaction.amount);
          if (!Number.isFinite(amount)) continue;
          const currency = transaction.currency_code || c.env.DEFAULT_CURRENCY;
          const totals = currencies[currency] ?? { currency, income: 0, expenses: 0, net: 0 };
          if (transaction.type === "deposit") totals.income += amount;
          else if (transaction.type === "withdrawal") totals.expenses += amount;
          totals.net = totals.income - totals.expenses;
          currencies[currency] = totals;
        }
      }
      const totalsByCurrency = Object.values(currencies).sort((a, b) => a.currency.localeCompare(b.currency));
      const primary = currencies[c.env.DEFAULT_CURRENCY] ?? totalsByCurrency[0] ?? {
        currency: c.env.DEFAULT_CURRENCY, income: 0, expenses: 0, net: 0,
      };
      return c.json({ ...primary, currencies: totalsByCurrency, period: { start, end } });
    } catch (error) {
      return apiError(c, error, "Failed to fetch summary");
    }
  });
}
