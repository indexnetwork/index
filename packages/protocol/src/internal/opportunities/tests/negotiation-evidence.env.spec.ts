import { describe, expect, it } from "bun:test";

import { NEGOTIATION_EVIDENCE_MIN_DISTINCT_OPPORTUNITIES, NEGOTIATION_EVIDENCE_QUESTIONS_MODE, NEGOTIATION_EVIDENCE_QUESTIONS_MODES } from "../negotiation-evidence/negotiation-evidence.env.js";

describe("negotiation-evidence lens configuration", () => {
  it("runs in shadow", () => {
    expect(NEGOTIATION_EVIDENCE_QUESTIONS_MODE).toBe("shadow");
  });

  it("keeps 'on' documented as the reserved next step (IND-438)", () => {
    expect([...NEGOTIATION_EVIDENCE_QUESTIONS_MODES]).toEqual(["shadow", "on"]);
  });

  it("pins the recurrence floor at k=5", () => {
    expect(NEGOTIATION_EVIDENCE_MIN_DISTINCT_OPPORTUNITIES).toBe(5);
  });
});
