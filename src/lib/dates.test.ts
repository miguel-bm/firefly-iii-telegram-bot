import { describe, expect, it } from "vitest";
import { daysAgoInTimeZone, previousMonthRange, todayInTimeZone } from "./dates.js";

describe("timezone date helpers", () => {
    it("uses the configured calendar day instead of UTC", () => {
        const now = new Date("2026-03-28T23:30:00Z");
        expect(todayInTimeZone("Europe/Madrid", now)).toBe("2026-03-29");
        expect(daysAgoInTimeZone(1, "Europe/Madrid", now)).toBe("2026-03-28");
    });

    it("calculates the previous month across year boundaries", () => {
        expect(previousMonthRange("Europe/Madrid", "en-US", new Date("2026-01-15T12:00:00Z")))
            .toMatchObject({ start: "2025-12-01", end: "2025-12-31" });
    });
});
