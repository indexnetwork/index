import { describe, expect, it } from "bun:test";

import { describeIntentUpdateFailure } from "../intent.tools.js";

describe("describeIntentUpdateFailure", () => {
  it("reports ASSERTIVE speech as non-actionable and does not blame broadness", () => {
    const failure = describeIntentUpdateFailure({
      validationFailures: [{
        category: "non_actionable",
        classification: "ASSERTIVE",
        referentialBreadth: "broad",
        message: "Description was classified as ASSERTIVE, not an actionable goal.",
      }],
    });

    expect(failure.failureCategory).toBe("non_actionable");
    expect(failure.error).toContain("ASSERTIVE");
    expect(failure.error).toContain("not the blocking reason");
    expect(failure.details).toBe("Speech act: ASSERTIVE.");
  });

  it("distinguishes vague verification, boundary, and persistence failures", () => {
    expect(describeIntentUpdateFailure({
      validationFailures: [{
        category: "vague_or_invalid",
        message: "Description failed clarity requirements.",
      }],
    }).failureCategory).toBe("vague_or_invalid");

    expect(describeIntentUpdateFailure({}).failureCategory).toBe("reconciliation_boundary");

    expect(describeIntentUpdateFailure({
      executionResults: [{
        actionType: "update",
        success: false,
        error: "row disappeared",
      }],
    })).toEqual({
      failureCategory: "persistence_failure",
      error: "Intent update could not be persisted.",
      details: "row disappeared",
    });
  });
});
