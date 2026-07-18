import { describe, expect, it } from "bun:test";

import { CASES } from "../opportunity.cases.js";
import { runCase, type PresenterLike } from "../opportunity.runner.js";

describe("opportunity runCase attempt evidence", () => {
  it("forwards AbortSignal and preserves a recovered fallback retry", async () => {
    let calls = 0;
    const signals: AbortSignal[] = [];
    const presenter: PresenterLike = {
      async present(_input, options) {
        calls += 1;
        if (options?.signal) signals.push(options.signal);
        if (calls === 1) {
          return {
            headline: "A promising connection",
            personalizedSummary: "fallback",
            suggestedAction: "Review",
            greeting: "",
            isFallback: true,
            fallbackReason: "timeout",
          };
        }
        return {
          headline: "A relevant collaborator",
          personalizedSummary: "You both work on aligned problems.",
          suggestedAction: "Say hello",
          greeting: "I would enjoy comparing notes.",
        };
      },
    };

    const batch = await runCase(presenter, CASES[0], 1, {
      maxAttempts: 2,
      retryDelayMs: 0,
      attemptTimeoutMs: 100,
    });

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(batch.outputs).toHaveLength(1);
    expect(batch.runs[0].recovered).toBe(true);
    expect(batch.runs[0].attempts.map((attempt) => attempt.outcome)).toEqual(["failure", "success"]);
    expect(batch.runs[0].attempts[0].error?.code).toBe("OPPORTUNITY_PRESENTER_FALLBACK_TIMEOUT");
  });
});
