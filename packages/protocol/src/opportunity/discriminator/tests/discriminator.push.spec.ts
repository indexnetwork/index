import { describe, expect, it } from "bun:test";

import { buildPoolQuestionPushMessage, poolQuestionCycleKey, poolQuestionPushThreshold } from "../discriminator.push.js";

describe("poolQuestionCycleKey", () => {
  it("prefers run identity and falls back to mining time", () => {
    expect(poolQuestionCycleKey({ runId: "run-123", minedAt: "2026-07-16T10:00:00Z" })).toBe("run:run-123");
    expect(poolQuestionCycleKey({ minedAt: "2026-07-16T10:00:00Z" })).toBe("mined:2026-07-16T10:00:00Z");
  });
});

describe("poolQuestionPushThreshold", () => {
  it("decays strictly upward with each dismissal", () => {
    expect(poolQuestionPushThreshold(0)).toBe(0.6);
    expect(poolQuestionPushThreshold(1)).toBeCloseTo(0.69);
    expect(poolQuestionPushThreshold(2)).toBeCloseTo(0.7935);
  });
});

describe("buildPoolQuestionPushMessage", () => {
  it("builds one deterministic Markdown-safe intent link", () => {
    const text = buildPoolQuestionPushMessage({
      intentId: "intent-1",
      intentTitle: "Find [AI] partners",
      questionPrompt: "Which side matters?",
    });
    expect(text).toBe("Quick one about [Find \\[AI\\] partners](/i/intent-1): Which side matters?");
  });
});
