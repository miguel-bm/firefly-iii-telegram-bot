import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateTelegramInitData } from "./auth.js";

function signedInitData(token: string, authDate: number, includeUser = true): string {
    const params = new URLSearchParams({ auth_date: String(authDate), query_id: "test" });
    if (includeUser) params.set("user", JSON.stringify({ id: 42, first_name: "Test" }));
    const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(token).digest();
    params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
    return params.toString();
}

describe("Telegram Mini App authentication", () => {
    const token = "123:test";
    const now = 2_000_000;

    it("accepts a fresh signed user", () => {
        expect(validateTelegramInitData(signedInitData(token, now), token, { nowSeconds: now })?.user.id).toBe(42);
    });

    it("rejects missing users, stale dates, future dates, and bad hashes", () => {
        expect(validateTelegramInitData(signedInitData(token, now, false), token, { nowSeconds: now })).toBeNull();
        expect(validateTelegramInitData(signedInitData(token, now - 3601), token, { nowSeconds: now })).toBeNull();
        expect(validateTelegramInitData(signedInitData(token, now + 61), token, { nowSeconds: now })).toBeNull();
        expect(validateTelegramInitData(signedInitData(token, now), "wrong", { nowSeconds: now })).toBeNull();
    });
});
