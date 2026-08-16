import { afterEach, describe, expect, it } from "bun:test";

import { NEGOTIATION_EVIDENCE_MIN_DISTINCT_OPPORTUNITIES, NEGOTIATION_EVIDENCE_QUESTIONS_MODES, negotiationEvidenceQuestionsMode } from "../negotiation-evidence.env.js";

const saved = process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE;

afterEach(() => {
  if (saved === undefined) delete process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE;
  else process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = saved;
});

describe("negotiationEvidenceQuestionsMode", () => {
  it("defaults to off when unset", () => {
    delete process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE;
    expect(negotiationEvidenceQuestionsMode()).toBe("off");
  });

  it("parses every documented mode (trimmed)", () => {
    for (const mode of NEGOTIATION_EVIDENCE_QUESTIONS_MODES) {
      process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = `  ${mode}  `;
      expect(negotiationEvidenceQuestionsMode()).toBe(mode);
    }
  });

  it("coerces unrecognized / empty values to off", () => {
    for (const value of ["", "loud", "true", "on ish", "SHADOW", "1"]) {
      process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = value;
      expect(negotiationEvidenceQuestionsMode()).toBe("off");
    }
  });

  it("pins the recurrence floor at k=5", () => {
    expect(NEGOTIATION_EVIDENCE_MIN_DISTINCT_OPPORTUNITIES).toBe(5);
  });
});
