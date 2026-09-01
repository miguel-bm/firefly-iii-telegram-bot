import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env, FireflySearchResult } from "../types.js";
import { FireflyClient } from "./firefly.js";

function transaction(id: string): FireflySearchResult {
    return { id, attributes: { transactions: [] } };
}

describe("Firefly transaction pagination", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("fetches subsequent pages up to the requested limit", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const page = Number(new URL(String(input)).searchParams.get("page"));
            const data = page === 1
                ? Array.from({ length: 100 }, (_, index) => transaction(String(index)))
                : Array.from({ length: 20 }, (_, index) => transaction(String(index + 100)));
            return Response.json({ data, meta: { pagination: { current_page: page, total_pages: 2 } } });
        });
        vi.stubGlobal("fetch", fetchMock);

        const client = new FireflyClient({
            FIREFLY_API_URL: "https://firefly.example",
            FIREFLY_API_TOKEN: "token",
        } as unknown as Env);
        const results = await client.searchTransactions("type:withdrawal", 120);

        expect(results).toHaveLength(120);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
