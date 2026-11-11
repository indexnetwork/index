import { describe, expect, it } from "bun:test";

import { MORNING } from "./wake.ts";

describe("MORNING", () => {
  it("asks for a report to the personal agent, never a greeting", () => {
    expect(MORNING).not.toContain("Good morning");
    expect(MORNING).toContain("report");
  });
});
