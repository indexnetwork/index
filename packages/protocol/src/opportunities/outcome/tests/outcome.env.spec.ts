import { afterEach, describe, expect, it } from "bun:test";

import { OUTCOME_MIN_INDEPENDENT_EXAMPLES, OUTCOME_MIN_COMPARED_SIDES, OUTCOME_MIN_INDEPENDENT_SUPPORT, isOutcomeQuestionsActivated, outcomeQuestionsMode } from "../outcome.env.js";

const saved = process.env.OUTCOME_QUESTIONS_MODE;

afterEach(() => {
  if (saved === undefined) delete process.env.OUTCOME_QUESTIONS_MODE;
  else process.env.OUTCOME_QUESTIONS_MODE = saved;
});

describe("outcomeQuestionsMode", () => {
  it("defaults off when unset or empty", () => {
    delete process.env.OUTCOME_QUESTIONS_MODE;
    expect(outcomeQuestionsMode()).toBe("off");
    process.env.OUTCOME_QUESTIONS_MODE = "";
    expect(outcomeQuestionsMode()).toBe("off");
  });

  it("accepts only the trimmed literals 'shadow' and 'on'", () => {
    process.env.OUTCOME_QUESTIONS_MODE = " shadow ";
    expect(outcomeQuestionsMode()).toBe("shadow");
    process.env.OUTCOME_QUESTIONS_MODE = "on";
    expect(outcomeQuestionsMode()).toBe("on");
  });

  it("treats any other value as off", () => {
    for (const value of ["true", "enable", "SHADOW", "1", "yes"]) {
      process.env.OUTCOME_QUESTIONS_MODE = value;
      expect(outcomeQuestionsMode()).toBe("off");
    }
  });

  it("activates capture+mining for shadow and on only", () => {
    delete process.env.OUTCOME_QUESTIONS_MODE;
    expect(isOutcomeQuestionsActivated()).toBe(false);
    process.env.OUTCOME_QUESTIONS_MODE = "shadow";
    expect(isOutcomeQuestionsActivated()).toBe(true);
    process.env.OUTCOME_QUESTIONS_MODE = "on";
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
