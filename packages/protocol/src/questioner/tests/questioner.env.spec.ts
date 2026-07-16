/** Unit tests for the centralized questioner env accessors (hierarchy + parsing). */
import { afterEach, describe, expect, it } from "bun:test";

import { isQuestionerEnabled, isDiscoveryQuestionsEnabled, isUptakeGuardEnabled, uptakeAuthorityThreshold, discoveryQuestionsInputMode, discoveryQuestionsTimeoutMs, chatQuestionWaitTimeoutMs, DISCOVERY_QUESTIONS_TIMEOUT_MS_DEFAULT, CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT, UPTAKE_AUTHORITY_THRESHOLD_DEFAULT } from "../questioner.env.js";

const VARS = [
  "QUESTIONER_ENABLED",
  "QUESTIONER_DISCOVERY_ENABLED",
  "QUESTIONER_UPTAKE_ENABLED",
  "QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD",
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

describe("uptake guard env", () => {
  it("is off by default and requires both master and uptake flags", () => {
    delete process.env.QUESTIONER_ENABLED;
    delete process.env.QUESTIONER_UPTAKE_ENABLED;
    expect(isUptakeGuardEnabled()).toBe(false);

    process.env.QUESTIONER_UPTAKE_ENABLED = "true";
    expect(isUptakeGuardEnabled()).toBe(false);

    process.env.QUESTIONER_ENABLED = "true";
    expect(isUptakeGuardEnabled()).toBe(true);
  });

  it("defaults authority threshold to 70 and clamps valid numbers to 0..100", () => {
    delete process.env.QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD;
    expect(uptakeAuthorityThreshold()).toBe(UPTAKE_AUTHORITY_THRESHOLD_DEFAULT);
    expect(uptakeAuthorityThreshold()).toBe(70);

    process.env.QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD = "not-a-number";
    expect(uptakeAuthorityThreshold()).toBe(70);
    process.env.QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD = "-4";
    expect(uptakeAuthorityThreshold()).toBe(0);
    process.env.QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD = "72.5";
    expect(uptakeAuthorityThreshold()).toBe(70);
    process.env.QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD = "101";
    expect(uptakeAuthorityThreshold()).toBe(100);
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
