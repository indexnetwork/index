import { describe, it, expect } from "bun:test";
import type { ToolDeps } from "../tool.helpers.js";
import type { PendingQuestionSummary } from "../../schemas/pending-question.schema.js";

describe("ToolDeps.findPendingQuestions", () => {
  it("is optional on ToolDeps", () => {
    const deps = {} as Partial<ToolDeps>;
    expect(deps.findPendingQuestions).toBeUndefined();
  });

  it("accepts a callback with the correct signature", () => {
    const mockFn = async (
      _userId: string,
      _filters?: { sourceType?: string; sourceId?: string; purpose?: "uptake" },
    ): Promise<PendingQuestionSummary[]> => [];

    const deps = { findPendingQuestions: mockFn } as Pick<ToolDeps, "findPendingQuestions">;
    expect(deps.findPendingQuestions).toBeDefined();
    void deps.findPendingQuestions?.("user-1", { purpose: "uptake" });
  });
});
