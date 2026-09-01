import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
}

export interface TelegramInitData {
    user: TelegramUser;
    authDate: number;
}

export interface InitDataValidationOptions {
    nowSeconds?: number;
    maxAgeSeconds?: number;
    maxFutureSkewSeconds?: number;
}

export function parseIdList(value: string): string[] {
    return value.split(",").map((id) => id.trim()).filter(Boolean);
}

export function validateTelegramInitData(
    initData: string,
    botToken: string,
    options: InitDataValidationOptions = {},
): TelegramInitData | null {
    try {
        const params = new URLSearchParams(initData);
        const suppliedHash = params.get("hash");
        const userJson = params.get("user");
        if (!suppliedHash || !/^[a-f\d]{64}$/i.test(suppliedHash) || !userJson) return null;

        const dataCheckString = [...params.entries()]
            .filter(([key]) => key !== "hash")
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");

        const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
        const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
        const actualHash = Buffer.from(suppliedHash, "hex");
        if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) return null;

        const authDate = Number(params.get("auth_date"));
        const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
        const maxAge = options.maxAgeSeconds ?? 3600;
        const maxFutureSkew = options.maxFutureSkewSeconds ?? 60;
        if (!Number.isSafeInteger(authDate) || authDate <= 0) return null;
        if (authDate < now - maxAge || authDate > now + maxFutureSkew) return null;

        const user = JSON.parse(userJson) as Partial<TelegramUser>;
        if (!Number.isSafeInteger(user.id) || !user.first_name) return null;

        return { user: user as TelegramUser, authDate };
    } catch {
        return null;
    }
}
