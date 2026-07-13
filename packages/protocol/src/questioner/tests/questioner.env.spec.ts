/** Unit tests for the centralized questioner env accessors (hierarchy + parsing). */
import { afterEach, describe, expect, it } from "bun:test";

import { isQuestionerEnabled, isDiscoveryQuestionsEnabled, discoveryQuestionsInputMode, discoveryQuestionsTimeoutMs, chatQuestionWaitTimeoutMs, DISCOVERY_QUESTIONS_TIMEOUT_MS_DEFAULT, CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT } from "../questioner.env.js";

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

describe("isDiscoveryQuestionsEnabled (hierarchy)", () => {
  it("is false when only the discovery flag is set (master off)", () => {
    delete process.env.QUESTIONER_ENABLED;
    process.env.QUESTIONER_DISCOVERY_ENABLED = "true";
    expect(isDiscoveryQuestionsEnabled()).toBe(false);
  });

  it("is false when only the master flag is set", () => {
    process.env.QUESTIONER_ENABLED = "true";
    delete process.env.QUESTIONER_DISCOVERY_ENABLED;
    expect(isDiscoveryQuestionsEnabled()).toBe(false);
  });

  it("is true when both flags are set", () => {
    process.env.QUESTIONER_ENABLED = "true";
    process.env.QUESTIONER_DISCOVERY_ENABLED = "true";
    expect(isDiscoveryQuestionsEnabled()).toBe(true);
  });
});

describe("discoveryQuestionsInputMode", () => {
  it("defaults to transcripts and only honors 'insights'", () => {
    delete process.env.QUESTIONER_DISCOVERY_INPUT_MODE;
    expect(discoveryQuestionsInputMode()).toBe("transcripts");
    process.env.QUESTIONER_DISCOVERY_INPUT_MODE = "bogus";
    expect(discoveryQuestionsInputMode()).toBe("transcripts");
    process.env.QUESTIONER_DISCOVERY_INPUT_MODE = " insights ";
    expect(discoveryQuestionsInputMode()).toBe("insights");
  });
});

describe("timeout accessors", () => {
  it("fall back to defaults on unset/invalid values and parse valid ones", () => {
    delete process.env.QUESTIONER_DISCOVERY_TIMEOUT_MS;
    delete process.env.QUESTIONER_CHAT_WAIT_TIMEOUT_MS;
    expect(discoveryQuestionsTimeoutMs()).toBe(DISCOVERY_QUESTIONS_TIMEOUT_MS_DEFAULT);
    expect(chatQuestionWaitTimeoutMs()).toBe(CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT);

    process.env.QUESTIONER_DISCOVERY_TIMEOUT_MS = "-5";
    expect(discoveryQuestionsTimeoutMs()).toBe(DISCOVERY_QUESTIONS_TIMEOUT_MS_DEFAULT);
    process.env.QUESTIONER_DISCOVERY_TIMEOUT_MS = "99999999999999999999";
    expect(discoveryQuestionsTimeoutMs()).toBe(DISCOVERY_QUESTIONS_TIMEOUT_MS_DEFAULT);

    process.env.QUESTIONER_DISCOVERY_TIMEOUT_MS = "1500";
    expect(discoveryQuestionsTimeoutMs()).toBe(1500);
    process.env.QUESTIONER_CHAT_WAIT_TIMEOUT_MS = "60000";
    expect(chatQuestionWaitTimeoutMs()).toBe(60000);
  });
});
