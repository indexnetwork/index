import { describe, it, expect, mock } from "bun:test";
import type { PendingQuestionSummary } from "../../shared/schemas/pending-question.schema.js";

/**
 * Unit test for the pending-question merge logic extracted into a helper.
 * The actual tool handler delegates to this helper.
 */
import { mergePendingQuestions, type MergePendingQuestionsInput } from "../opportunity.pending-questions.js";

describe("mergePendingQuestions", () => {
  const baseSummary: PendingQuestionSummary = {
    id: "pq-1",
    title: "What kind of connections?",
    prompt: "What are you most interested in?",
    options: [{ label: "A", description: "a" }],
    multiSelect: false,
    mode: "discovery",
    sourceType: "discovery",
    sourceId: "sess-1",
    createdAt: "2026-05-25T10:00:00.000Z",
  };

  it("returns empty when findPendingQuestions is absent", async () => {
    const result = await mergePendingQuestions({
      findPendingQuestions: undefined,
      userId: "u1",
      surfacedQuestionIds: new Set(),
    });
    expect(result.questions).toEqual([]);
    expect(result.surfacedIds).toEqual([]);
  });

  it("returns pending questions from the callback", async () => {
    const fn = mock(async () => [baseSummary]);
    const result = await mergePendingQuestions({
      findPendingQuestions: fn,
      userId: "u1",
      surfacedQuestionIds: new Set(),
    });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].title).toBe("What kind of connections?");
    expect(result.surfacedIds).toEqual(["pq-1"]);
  });

  it("deduplicates questions already surfaced in this session", async () => {
    const fn = mock(async () => [baseSummary]);
    const result = await mergePendingQuestions({
      findPendingQuestions: fn,
      userId: "u1",
      surfacedQuestionIds: new Set(["pq-1"]),
    });
    expect(result.questions).toEqual([]);
    expect(result.surfacedIds).toEqual([]);
  });

  it("filters by sourceType and sourceId when provided", async () => {
    const fn = mock(async (_uid: string, filters?: { sourceType?: string; sourceId?: string }) => {
      if (filters?.sourceType === "opportunity") return [{ ...baseSummary, id: "pq-2", sourceType: "opportunity" }];
      return [baseSummary];
    });
    const result = await mergePendingQuestions({
      findPendingQuestions: fn,
      userId: "u1",
      sourceType: "opportunity",
      sourceId: "opp-1",
      surfacedQuestionIds: new Set(),
    });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].id).toBe("pq-2");
  });

  it("caps at MAX_PENDING_QUESTIONS (3)", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...baseSummary,
      id: `pq-${i}`,
    }));
    const fn = mock(async () => many);
    const result = await mergePendingQuestions({
      findPendingQuestions: fn,
      userId: "u1",
      surfacedQuestionIds: new Set(),
    });
    expect(result.questions).toHaveLength(3);
  });
});
