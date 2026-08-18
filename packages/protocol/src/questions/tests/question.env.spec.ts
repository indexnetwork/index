/** Unit tests for the centralized questioner env accessors (hierarchy + parsing). */
import { afterEach, describe, expect, it } from "bun:test";

import { isQuestionerEnabled } from "../question.env.js";

const VARS = [
  "QUESTIONER_ENABLED",
  "QUESTIONER_DISCOVERY_ENABLED",
  "QUESTIONER_DISCOVERY_INPUT_MODE",
  "QUESTIONER_DISCOVERY_TIMEOUT_MS",
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
