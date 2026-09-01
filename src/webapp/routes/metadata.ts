import { FireflyClient } from "../../tools/firefly.js";
import { ValidationError, parseOptionalDate } from "../validation.js";
import { apiError, getDateDaysAgo, getToday, webAppAuth, type WebApp } from "./shared.js";

export function registerMetadataRoutes(app: WebApp): void {
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

  app.get("/api/categories", webAppAuth, async (c) => {
    try {
      const categories = await new FireflyClient(c.env).getCategories();
      return c.json({ categories: categories.map(({ id, name }) => ({ id, name })) });
    } catch (error) {
      console.error("API error:", error);
      return c.json({ error: "Failed to fetch categories" }, 500);
    }
  });

  app.get("/api/tags", webAppAuth, async (c) => {
    try {
      const tags = await new FireflyClient(c.env).getTags();
      return c.json({ tags: tags.map(({ id, tag }) => ({ id, tag })) });
    } catch (error) {
      console.error("API error:", error);
      return c.json({ error: "Failed to fetch tags" }, 500);
    }
  });

  app.get("/api/accounts/:id/history", webAppAuth, async (c) => {
    try {
      const accountId = c.req.param("id") ?? "";
      if (!/^\d+$/.test(accountId)) throw new ValidationError("Invalid account ID");
      const start = parseOptionalDate(c.req.query("start"), "start") || getDateDaysAgo(30, c.env);
      const end = parseOptionalDate(c.req.query("end"), "end") || getToday(c.env);
      const history = await new FireflyClient(c.env).getAccountHistory(accountId, start, end);
      return c.json({ history });
    } catch (error) {
      return apiError(c, error, "Failed to fetch account history");
    }
  });
}
