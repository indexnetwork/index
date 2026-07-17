import { afterEach, describe, expect, it } from "bun:test";

import { poolQuestionsPushMode, poolQuestionsStampNewborn } from "../discriminator.env.js";

const savedStamp = process.env.POOL_QUESTIONS_STAMP_NEWBORN;
const savedPush = process.env.POOL_QUESTIONS_PUSH;

afterEach(() => {
  if (savedStamp === undefined) delete process.env.POOL_QUESTIONS_STAMP_NEWBORN;
  else process.env.POOL_QUESTIONS_STAMP_NEWBORN = savedStamp;
  if (savedPush === undefined) delete process.env.POOL_QUESTIONS_PUSH;
  else process.env.POOL_QUESTIONS_PUSH = savedPush;
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
