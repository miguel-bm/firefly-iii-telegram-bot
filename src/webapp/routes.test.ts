import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../types.js";
import { registerWebAppRoutes } from "./routes.js";

function authHeader(token: string): string {
    const params = new URLSearchParams({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 42, first_name: "Test" }),
    });
    const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(token).digest();
    params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
    return params.toString();
}

function testApp() {
    const app = new Hono<{ Bindings: Env }>();
    registerWebAppRoutes(app);
    return app;
}

describe("Mini App routes", () => {
    const token = "123:test";
    const env = {
        TELEGRAM_BOT_TOKEN: token,
        TELEGRAM_ALLOWED_CHAT_ID: "42",
    } as unknown as Env;

    it("requires Telegram authentication", async () => {
        const response = await testApp().request("/api/accounts", {}, env);
        expect(response.status).toBe(401);
    });

    it("returns 400 for invalid write payloads before calling Firefly", async () => {
        const response = await testApp().request("/api/transactions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Telegram-Init-Data": authHeader(token),
            },
            body: JSON.stringify({ amount: -5, description: "Bad" }),
        }, env);
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("positive") });
    });
});
