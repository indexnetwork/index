import { describe, expect, test } from "bun:test";

import { DEFAULT_BYTE_BUDGET, assessmentContext } from "./context.ts";
import { AssessmentError } from "./selection.ts";

const result = (overrides?: { valueB?: number[]; ownerNull?: boolean; badCount?: boolean }) => ({
  run_id: "run-123",
  assessment: {
    ordered_action_ids: ["a", "b"],
    participant_map: { owner: overrides?.ownerNull ? null : "native-owner", other: "native-other" },
    settings: { n_samples: 3 },
    actions: [
      { action_id: "a", value: [1, 2, 3], welfare: [1, 1, 1], severity: [0, 0, 0], utilities: { ...(overrides?.ownerNull ? {} : { owner: [1, 2, 3] }), other: [0, 0, 0] } },
      { action_id: "b", value: overrides?.valueB ?? [4, 5, 6], welfare: [2, 2, 2], severity: [0, 0, 0], utilities: { ...(overrides?.ownerNull ? {} : { owner: overrides?.badCount ? [1, 2] : [2, 2, 2] }), other: [1, 1, 1] } },
    ],
  },
});

describe("assessmentContext", () => {
  test("scores the menu under the template and prefers the unique top action", () => {
    const context = assessmentContext(result(), "aggregate-value-mean-hold-v1", "owner", DEFAULT_BYTE_BUDGET);
    expect(context.scores).toEqual({ a: 2, b: 5 });
    expect(context.preferredActionId).toBe("b");
    expect(context.orderedActionIds).toEqual(["a", "b"]);
    expect(context.text.startsWith("PRIVATE MORALMOD ASSESSMENT")).toBe(true);
  });

  test("an exact top tie yields no preferred action", () => {
    const context = assessmentContext(result({ valueB: [1, 2, 3] }), "aggregate-value-mean-hold-v1", "owner", DEFAULT_BYTE_BUDGET);
    expect(context.preferredActionId).toBeNull();
  });

  test("principal utility scores use the owner's samples", () => {
    const context = assessmentContext(result(), "principal-utility-mean-hold-v1", "owner", DEFAULT_BYTE_BUDGET);
    expect(context.scores).toEqual({ a: 2, b: 2 });
    expect(context.preferredActionId).toBeNull();
  });

  test("an owner missing from the participant map is refused", () => {
    expect(() => assessmentContext(result({ ownerNull: true }), "aggregate-value-mean-hold-v1", "owner", DEFAULT_BYTE_BUDGET))
      .toThrow(new AssessmentError("missing_owner"));
  });

  test("a sample-count mismatch is an invalid assessment", () => {
    expect(() => assessmentContext(result({ badCount: true }), "aggregate-value-mean-hold-v1", "owner", DEFAULT_BYTE_BUDGET))
      .toThrow(new AssessmentError("invalid_assessment"));
  });

  test("a context past the byte budget is refused", () => {
    expect(() => assessmentContext(result(), "aggregate-value-mean-hold-v1", "owner", 64))
      .toThrow(new AssessmentError("oversize"));
  });
});
