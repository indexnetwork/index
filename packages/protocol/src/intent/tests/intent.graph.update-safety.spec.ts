import { describe, expect, it } from "bun:test";

import { enforceIntentActionBoundary } from "../intent.graph.js";
import type { NormalizedIntentAction } from "../intent.reconciler.js";

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
});
