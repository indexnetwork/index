import { afterEach, describe, expect, it } from "bun:test";

import { POOL_VISIT_MINING_DEBOUNCE_MS, poolQuestionsPushMode, poolQuestionsStampNewborn, poolQuestionsVisitTrigger } from "../discriminator.env.js";

const savedStamp = process.env.POOL_QUESTIONS_STAMP_NEWBORN;
const savedPush = process.env.POOL_QUESTIONS_PUSH;
const savedVisitTrigger = process.env.POOL_QUESTIONS_VISIT_TRIGGER;

afterEach(() => {
  if (savedStamp === undefined) delete process.env.POOL_QUESTIONS_STAMP_NEWBORN;
  else process.env.POOL_QUESTIONS_STAMP_NEWBORN = savedStamp;
  if (savedPush === undefined) delete process.env.POOL_QUESTIONS_PUSH;
  else process.env.POOL_QUESTIONS_PUSH = savedPush;
  if (savedVisitTrigger === undefined) delete process.env.POOL_QUESTIONS_VISIT_TRIGGER;
  else process.env.POOL_QUESTIONS_VISIT_TRIGGER = savedVisitTrigger;
});

describe("poolQuestionsPushMode", () => {
  it("defaults off and accepts only the trimmed literal 'on'", () => {
    delete process.env.POOL_QUESTIONS_PUSH;
    expect(poolQuestionsPushMode()).toBe("off");

    process.env.POOL_QUESTIONS_PUSH = "true";
    expect(poolQuestionsPushMode()).toBe("off");

    process.env.POOL_QUESTIONS_PUSH = " on ";
    expect(poolQuestionsPushMode()).toBe("on");
  });
});

describe("poolQuestionsVisitTrigger", () => {
  it("defaults off and accepts only the trimmed literal 'on'", () => {
    delete process.env.POOL_QUESTIONS_VISIT_TRIGGER;
    expect(poolQuestionsVisitTrigger()).toBe("off");

    process.env.POOL_QUESTIONS_VISIT_TRIGGER = "true";
    expect(poolQuestionsVisitTrigger()).toBe("off");

    process.env.POOL_QUESTIONS_VISIT_TRIGGER = " on ";
    expect(poolQuestionsVisitTrigger()).toBe("on");
  });

  it("debounces at six hours per intent", () => {
    expect(POOL_VISIT_MINING_DEBOUNCE_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe("poolQuestionsStampNewborn", () => {
  it("defaults off and accepts only the trimmed literal 'on'", () => {
    delete process.env.POOL_QUESTIONS_STAMP_NEWBORN;
    expect(poolQuestionsStampNewborn()).toBe("off");

    process.env.POOL_QUESTIONS_STAMP_NEWBORN = "true";
    expect(poolQuestionsStampNewborn()).toBe("off");

    process.env.POOL_QUESTIONS_STAMP_NEWBORN = " on ";
    expect(poolQuestionsStampNewborn()).toBe("on");
  });
});
