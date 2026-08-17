/** Unit tests for the centralized questioner env accessors (hierarchy + parsing). */
import { afterEach, describe, expect, it } from "bun:test";

import { isQuestionerEnabled, isUptakeGuardEnabled, uptakeAuthorityThreshold, chatQuestionWaitTimeoutMs, CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT, UPTAKE_AUTHORITY_THRESHOLD_DEFAULT } from "../question.env.js";

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
