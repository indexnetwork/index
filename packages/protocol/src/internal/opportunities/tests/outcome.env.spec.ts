import { describe, expect, it } from "bun:test";

import { OUTCOME_MIN_INDEPENDENT_EXAMPLES, OUTCOME_MIN_COMPARED_SIDES, OUTCOME_MIN_INDEPENDENT_SUPPORT, OUTCOME_QUESTIONS_MODE, isOutcomeQuestionsActivated } from "../outcome/outcome.env.js";

describe("outcome lens configuration", () => {
  it("runs in shadow", () => {
    expect(OUTCOME_QUESTIONS_MODE).toBe("shadow");
  });

  it("always activates capture + mining", () => {
    expect(isOutcomeQuestionsActivated()).toBe(true);
  });
});

describe("outcome thresholds", () => {
  it("keeps k=5 and derives the pass floor from k x minComparedSides", () => {
    expect(OUTCOME_MIN_INDEPENDENT_SUPPORT).toBe(5);
    expect(OUTCOME_MIN_COMPARED_SIDES).toBe(2);
    expect(OUTCOME_MIN_INDEPENDENT_EXAMPLES).toBe(
      OUTCOME_MIN_INDEPENDENT_SUPPORT * OUTCOME_MIN_COMPARED_SIDES,
    );
  });
});
