import { describe, expect, it } from "bun:test";

import { buildExplicitUpdateActions, enforceIntentActionBoundary } from "../intent.graph.js";
import type { NormalizedIntentAction } from "../intent.reconciler.js";
import type { VerifiedIntent } from "../intent.state.js";

const broadDirective: VerifiedIntent = {
  type: "goal",
  description: "Collaborating with narrative AI infrastructure builders",
  confidence: 0.91,
  reasoning: "Explicit collaboration goal",
  verification: {
    classification: "DIRECTIVE",
    felicity_scores: { authority: 95, sincerity: 90, clarity: 88 },
    semantic_entropy: 0.2,
    referential_breadth: "broad",
    referential_anchor: null,
    missing_selectional_constraints: ["concrete_need"],
    specificity_warning: "This signal could benefit from a more specific collaborator.",
    flags: ["BROAD_ATTRIBUTIVE_REFERENCE"],
  },
  score: 88,
};

describe("IntentGraph update action safety", () => {
  it("drops creates, expires, and updates targeting a non-target intent", () => {
    const actions: NormalizedIntentAction[] = [
      {
        type: "create",
        payload: "A new intent that must not be created",
        score: 90,
        reasoning: "bad update-mode reconciliation",
        intentMode: "ATTRIBUTIVE",
        referentialAnchor: null,
        semanticEntropy: 0.2,
      },
      {
        type: "update",
        id: "intent-target",
        payload: "Safely refined target",
        score: 90,
        reasoning: "valid target update",
        intentMode: "ATTRIBUTIVE",
      },
      {
        type: "update",
        id: "intent-other",
        payload: "Must not mutate this intent",
        score: 90,
        reasoning: "wrong target",
        intentMode: "ATTRIBUTIVE",
      },
      {
        type: "expire",
        id: "intent-target",
        reason: "must not expire in update mode",
      },
    ];

    expect(enforceIntentActionBoundary("update", ["intent-target"], actions)).toEqual([
      actions[1],
    ]);
    expect(enforceIntentActionBoundary("update", undefined, actions)).toEqual([]);
  });

  it("binds a broad verified DIRECTIVE to the supplied explicit-update target", () => {
    const result = buildExplicitUpdateActions(
      ["intent-target"],
      ["intent-target"],
      [broadDirective],
    );

    expect(result.failure).toBeUndefined();
    expect(result.actions).toEqual([
      expect.objectContaining({
        type: "update",
        id: "intent-target",
        payload: broadDirective.description,
      }),
    ]);
  });

  it("fails closed for missing, foreign, or ambiguous update targets", () => {
    expect(buildExplicitUpdateActions(undefined, ["intent-target"], [broadDirective]).failure?.category)
      .toBe("update_target_boundary");
    expect(buildExplicitUpdateActions(["intent-other"], ["intent-target"], [broadDirective]).failure?.category)
      .toBe("update_target_boundary");
    expect(buildExplicitUpdateActions(
      ["intent-target", "intent-other"],
      ["intent-target", "intent-other"],
      [broadDirective],
    ).failure?.category).toBe("update_target_boundary");
  });

  it("does not let a multi-candidate inference choose or create another intent", () => {
    const result = buildExplicitUpdateActions(
      ["intent-target"],
      ["intent-target"],
      [broadDirective, { ...broadDirective, description: "A second goal" }],
    );

    expect(result.actions).toEqual([]);
    expect(result.failure?.category).toBe("reconciliation_boundary");
  });
});
