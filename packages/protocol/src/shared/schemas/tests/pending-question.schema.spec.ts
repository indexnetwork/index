import { describe, it, expect } from "bun:test";
import type { PendingQuestionSummary } from "../pending-question.schema.js";

describe("PendingQuestionSummary type", () => {
  it("accepts a valid summary object", () => {
    const summary: PendingQuestionSummary = {
      id: "q-123",
      title: "What kind of mentorship?",
      prompt: "What aspect are you most interested in?",
      options: [
        { label: "Technical", description: "Hands-on coding guidance" },
        { label: "Career", description: "Career path advice" },
      ],
      multiSelect: false,
      mode: "discovery",
      sourceType: "discovery",
      sourceId: "sess-abc",
      createdAt: "2026-05-25T10:00:00.000Z",
    };
    expect(summary.id).toBe("q-123");
    expect(summary.options).toHaveLength(2);
  });

  it("compiles with optional expiresAt", () => {
    const summary: PendingQuestionSummary = {
      id: "q-456",
      title: "T",
      prompt: "P",
      options: [],
      multiSelect: false,
      mode: "intent",
      sourceType: "intent",
      sourceId: "int-1",
      createdAt: "2026-05-25T10:00:00.000Z",
      expiresAt: "2026-06-01T10:00:00.000Z",
    };
    expect(summary.expiresAt).toBeDefined();
  });
});
