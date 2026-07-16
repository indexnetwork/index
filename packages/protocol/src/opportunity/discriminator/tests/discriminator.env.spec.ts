import { afterEach, describe, expect, it } from "bun:test";

import { poolQuestionsStampNewborn } from "../discriminator.env.js";

const saved = process.env.POOL_QUESTIONS_STAMP_NEWBORN;

afterEach(() => {
  if (saved === undefined) delete process.env.POOL_QUESTIONS_STAMP_NEWBORN;
  else process.env.POOL_QUESTIONS_STAMP_NEWBORN = saved;
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
