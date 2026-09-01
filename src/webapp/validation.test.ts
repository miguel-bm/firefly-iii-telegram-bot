import { describe, expect, it } from "vitest";
import {
    ValidationError,
    escapeFireflySearch,
    parseCreateExpense,
    parseDate,
    parseUpdateTransaction,
} from "./validation.js";

describe("Mini App validation", () => {
    it("normalizes a valid expense", () => {
        expect(parseCreateExpense({ amount: "12.50", description: " Lunch ", tags: ["food", "food"] }))
            .toMatchObject({ amount: 12.5, description: "Lunch", tags: ["food"] });
    });

    it("rejects invalid money, dates, and update fields", () => {
        expect(() => parseCreateExpense({ amount: "NaN", description: "x" })).toThrow(ValidationError);
        expect(() => parseDate("2026-02-30")).toThrow(ValidationError);
        expect(() => parseUpdateTransaction({ fire_webhooks: false })).toThrow(/Unknown fields/);
    });

    it("maps the dashboard category field and escapes search syntax", () => {
        expect(parseUpdateTransaction({ category: null })).toEqual({ category_name: "" });
        expect(escapeFireflySearch('shop"\nnext')).toBe('shop\\" next');
    });
});
