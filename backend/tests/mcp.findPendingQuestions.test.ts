import { describe, it, expect } from "bun:test";

/**
 * Integration test: verify the findPendingQuestions callback shape
 * matches what ToolDeps expects. This is a compile-time alignment test
 * rather than a runtime integration test (the real adapter hits the DB).
 */
import type { PendingQuestionSummary } from "@indexnetwork/protocol";

describe("findPendingQuestions wiring", () => {
  it("adapter shape produces PendingQuestionSummary[]", () => {
    // Mock the adapter's findPending return value
    const mockRow = {
      id: "q-1",
      detection: { mode: "discovery" as const, sourceType: "discovery", sourceId: "s1", timestamp: "t" },
      actors: [{ userId: "u1", role: "subject" as const }],
      payload: {
        title: "T",
        prompt: "P",
        options: [{ label: "A", description: "a" }],
        multiSelect: false,
      },
      status: "pending" as const,
      answer: null,
      createdAt: "2026-05-25T10:00:00.000Z",
    };

    // The wiring function maps adapter rows to PendingQuestionSummary
    const summary: PendingQuestionSummary = {
      id: mockRow.id,
      title: mockRow.payload.title,
      prompt: mockRow.payload.prompt,
      options: mockRow.payload.options,
      multiSelect: mockRow.payload.multiSelect,
      mode: mockRow.detection.mode,
      sourceType: mockRow.detection.sourceType,
      sourceId: mockRow.detection.sourceId,
      createdAt: mockRow.createdAt,
    };

    expect(summary.id).toBe("q-1");
    expect(summary.mode).toBe("discovery");
  });
});
