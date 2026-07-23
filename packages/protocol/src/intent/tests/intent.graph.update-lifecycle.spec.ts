import { describe, expect, it } from "bun:test";

import { IntentGraphFactory } from "../intent.graph.js";

import type { IntentGraphDatabase } from "../../shared/interfaces/database.interface.js";

const TARGET_ID = "efd47fef-332f-498e-8613-5446f87bd463";
const BROAD_DESCRIPTION = "Collaborate with builders of narrative AI infrastructure";

describe("IntentGraph explicit update lifecycle", () => {
  it("persists a broad DIRECTIVE to the exact active owned target", async () => {
    const writes: Array<{ id: string; payload?: string }> = [];
    const database = {
      getProfile: async () => ({ identity: { name: "Alice" } }),
      getActiveIntents: async () => [{
        id: TARGET_ID,
        payload: "Build narrative AI systems",
        summary: null,
        createdAt: new Date(),
      }],
      getUserContext: async () => null,
      updateIntent: async (id: string, data: { payload?: string }) => {
        writes.push({ id, payload: data.payload });
        return {
          id,
          userId: "alice",
          payload: data.payload ?? "",
          summary: null,
          createdAt: new Date(),
        };
      },
    } as unknown as IntentGraphDatabase;

    let reconcilerCalls = 0;
    const graph = new IntentGraphFactory(database, undefined, undefined, undefined, {
      inferrer: {
        invoke: async () => ({
          intents: [{
            type: "goal" as const,
            description: BROAD_DESCRIPTION,
            confidence: 0.94,
            reasoning: "Explicit collaboration directive",
          }],
        }),
      },
      verifier: {
        invoke: async () => ({
          reasoning: "Actionable directive with intentionally broad reference",
          classification: "DIRECTIVE" as const,
          felicity_scores: { authority: 94, sincerity: 93, clarity: 90 },
          semantic_entropy: 0.2,
          referential_breadth: "broad" as const,
          referential_anchor: null,
          missing_selectional_constraints: ["concrete_need" as const],
          specificity_warning: "Adding a concrete need may improve matching.",
          flags: ["BROAD_ATTRIBUTIVE_REFERENCE" as const],
        }),
      },
      reconciler: {
        invoke: async () => {
          reconcilerCalls++;
          return {
            actions: [{
              type: "create" as const,
              payload: "Must never be created",
              score: 90,
              reasoning: "General reconciler chose create",
              intentMode: "ATTRIBUTIVE" as const,
              referentialAnchor: null,
              semanticEntropy: 0.2,
            }],
          };
        },
      },
    }).createGraph();

    const result = await graph.invoke({
      userId: "alice",
      userProfile: "{}",
      operationMode: "update",
      inputContent: BROAD_DESCRIPTION,
      targetIntentIds: [TARGET_ID],
    });

    expect(reconcilerCalls).toBe(0);
    expect(result.validationFailures).toEqual([]);
    expect(result.actions).toEqual([
      expect.objectContaining({ type: "update", id: TARGET_ID, payload: BROAD_DESCRIPTION }),
    ]);
    expect(result.executionResults).toEqual([
      expect.objectContaining({ actionType: "update", success: true, intentId: TARGET_ID }),
    ]);
    expect(writes).toEqual([{ id: TARGET_ID, payload: BROAD_DESCRIPTION }]);
  });
});
