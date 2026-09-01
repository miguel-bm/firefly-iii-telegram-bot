import type { Context, Hono, Next } from "hono";
import type { Env } from "../../types.js";
import { daysAgoInTimeZone, todayInTimeZone } from "../../lib/dates.js";
import { parseIdList, validateTelegramInitData, type TelegramUser } from "../auth.js";
import { ValidationError } from "../validation.js";

export type WebApp = Hono<{ Bindings: Env }>;
export type WebContext = Context<{ Bindings: Env }>;

export async function webAppAuth(c: WebContext, next: Next) {
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
  const allowedIds = parseIdList(c.env.TELEGRAM_ALLOWED_USER_IDS ?? c.env.TELEGRAM_ALLOWED_CHAT_ID);
  if (!allowedIds.includes(String(validated.user.id))) {
    console.log("WebApp auth failed: User not authorized", validated.user.id);
    return c.json({ error: "User not authorized" }, 403);
  }
  c.set("telegramUser", validated.user);
  await next();
}

export function apiError(c: Context, error: unknown, fallback: string) {
  if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
  console.error(fallback, error);
  return c.json({ error: fallback }, 500);
}

export function getToday(env: Env): string {
  return todayInTimeZone(env.BOT_TIMEZONE || "Europe/Madrid");
}

export function getDateDaysAgo(days: number, env: Env): string {
  return daysAgoInTimeZone(days, env.BOT_TIMEZONE || "Europe/Madrid");
}

declare module "hono" {
  interface ContextVariableMap {
    telegramUser: TelegramUser;
  }
}
