/** Unit tests for the centralized questioner env accessors (hierarchy + parsing). */
import { afterEach, describe, expect, it } from "bun:test";

import { isQuestionerEnabled, chatQuestionWaitTimeoutMs, CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT } from "../question.env.js";

const VARS = [
  "QUESTIONER_ENABLED",
  "QUESTIONER_DISCOVERY_ENABLED",
  "QUESTIONER_DISCOVERY_INPUT_MODE",
  "QUESTIONER_DISCOVERY_TIMEOUT_MS",
  "QUESTIONER_CHAT_WAIT_TIMEOUT_MS",
] as const;

const saved = new Map<string, string | undefined>(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const v of VARS) {
    const prev = saved.get(v);
    if (prev === undefined) delete process.env[v];
    else process.env[v] = prev;
  }
});

describe("isQuestionerEnabled", () => {
  it("is true only for the literal string 'true'", () => {
    delete process.env.QUESTIONER_ENABLED;
    expect(isQuestionerEnabled()).toBe(false);
    process.env.QUESTIONER_ENABLED = "1";
    expect(isQuestionerEnabled()).toBe(false);
    process.env.QUESTIONER_ENABLED = "true";
    expect(isQuestionerEnabled()).toBe(true);
  });
});

describe("timeout accessors", () => {
  it("fall back to defaults on unset/invalid values and parse valid ones", () => {
    delete process.env.QUESTIONER_CHAT_WAIT_TIMEOUT_MS;
    expect(chatQuestionWaitTimeoutMs()).toBe(CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT);

    process.env.QUESTIONER_CHAT_WAIT_TIMEOUT_MS = "-5";
    expect(chatQuestionWaitTimeoutMs()).toBe(CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT);
    process.env.QUESTIONER_CHAT_WAIT_TIMEOUT_MS = "99999999999999999999";
    expect(chatQuestionWaitTimeoutMs()).toBe(CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT);

    process.env.QUESTIONER_CHAT_WAIT_TIMEOUT_MS = "60000";
    expect(chatQuestionWaitTimeoutMs()).toBe(60000);
  });
});
