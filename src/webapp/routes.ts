import type { Hono } from "hono";
import type { Env } from "../types.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { registerTransactionRoutes } from "./routes/transactions.js";

export function registerWebAppRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/healthz", (c) => c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));
  registerTransactionRoutes(app);
  registerAnalyticsRoutes(app);
  registerMetadataRoutes(app);
}
