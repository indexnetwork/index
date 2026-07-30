import { describe, expect, test } from "bun:test";
import { formatGoalFooterStatus } from "../active-context.ts";

describe("formatGoalFooterStatus", () => {
	test("omits a missing or blank goal status", () => {
		expect(formatGoalFooterStatus(undefined)).toBeUndefined();
		expect(formatGoalFooterStatus("   \n\t")).toBeUndefined();
	});

	test("prefixes the status with the distinct goal icon", () => {
		expect(formatGoalFooterStatus("active 3m")).toBe("🏁 active 3m");
	});

	test("keeps future status values on one compact footer line", () => {
		expect(formatGoalFooterStatus("budget\n100k/100k\t")).toBe("🏁 budget 100k/100k");
	});
});
