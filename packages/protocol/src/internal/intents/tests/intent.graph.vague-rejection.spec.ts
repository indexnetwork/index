/**
 * Verification never rewrites a description from the user's profile.
 *
 * A vague signal used to be silently enriched with a role inferred from the
 * global user_context paragraph ("a job" → "a software engineering role") and
 * re-verified, so profile text could land in a persisted payload the user never
 * wrote. An intent derives only from what the person said: when the description
 * is too vague to match on, verification rejects it and the callers ask.
 */
import { describe, expect, it } from "bun:test";

import { IntentGraphFactory } from "../graph/intent.graph.js";
import { verificationNode } from "../graph/intent.graph.reconcile.js";

import type { SemanticVerifierOutput } from "../intent.verifier.js";
import type { IntentGraphDeps, IntentState } from "../graph/intent.graph.shared.js";
import type { IntentGraphDatabase } from "../../../platform/database.js";

const CLEAR_VERDICT: SemanticVerifierOutput = {
  reasoning: "Actionable directive",
  classification: "DIRECTIVE",
  felicity_scores: { authority: 90, sincerity: 90, clarity: 90 },
  semantic_entropy: 0.2,
  referential_breadth: "narrow",
  referential_anchor: "a design partner",
  missing_selectional_constraints: [],
  specificity_warning: null,
  flags: [],
};

const VAGUE_VERDICT: SemanticVerifierOutput = {
  ...CLEAR_VERDICT,
  reasoning: "Too broad to act on",
  felicity_scores: { authority: 90, sincerity: 90, clarity: 20 },
  semantic_entropy: 0.9,
  referential_anchor: null,
};

/**
 * Build the verification node's dependencies. Both the verifier and the
 * user_context reader count their calls, so a test can assert the node stopped
 * at one verification pass and never went looking for the profile.
 */
function makeDeps(verdicts: SemanticVerifierOutput[]) {
  const verifierCalls: string[] = [];
  let contextReads = 0;
  const deps = {
    database: {
      getUserContext: async () => {
        contextReads += 1;
        return { text: "Ada is a staff software engineer at a large search company." };
      },
    },
    verifier: {
      invoke: async (description: string) => {
        verifierCalls.push(description);
        return verdicts[Math.min(verifierCalls.length - 1, verdicts.length - 1)];
      },
    },
  } as unknown as IntentGraphDeps;
  return { deps, verifierCalls, contextReads: () => contextReads };
}

/** Minimal state carrying one inferred intent through verification. */
function makeState(description: string, operationMode: IntentState["operationMode"]): IntentState {
  return {
    userId: "u1",
    userProfile: "",
    operationMode,
    inferredIntents: [{
      type: "goal",
      description,
      reasoning: "Stated by the user",
      confidence: "high",
    }],
  } as unknown as IntentState;
}

describe("verificationNode vague handling", () => {
  it("rejects a vague description instead of rewriting it from the profile", async () => {
    const { deps, verifierCalls, contextReads } = makeDeps([VAGUE_VERDICT]);

    const result = await verificationNode(makeState("Find a job", "create"), deps);

    expect(result.verifiedIntents).toHaveLength(0);
    expect(result.validationFailures?.[0]?.category).toBe("vague_or_invalid");
    // One verification pass, on exactly what the user said.
    expect(verifierCalls).toEqual(["Find a job"]);
    expect(contextReads()).toBe(0);
  });

  it("leaves a generic job phrase untouched even when the verdict scores well", async () => {
    // The enrichment branch fired on this shape specifically: a clear-looking
    // verdict on "a job" used to be rewritten to "a software engineering role".
    const { deps, verifierCalls, contextReads } = makeDeps([CLEAR_VERDICT]);

    const result = await verificationNode(makeState("I want to find a job", "create"), deps);

    expect(result.verifiedIntents).toHaveLength(0);
    expect(result.validationFailures?.[0]?.category).toBe("vague_or_invalid");
    expect(verifierCalls).toEqual(["I want to find a job"]);
    expect(contextReads()).toBe(0);
  });

  it("rejects rather than crashing in update mode", async () => {
    const { deps, contextReads } = makeDeps([VAGUE_VERDICT]);

    const result = await verificationNode(makeState("Find a job", "update"), deps);

    expect(result.verifiedIntents).toHaveLength(0);
    expect(result.validationFailures?.[0]?.category).toBe("vague_or_invalid");
    expect(contextReads()).toBe(0);
  });

  it("still passes a clear description through verification unchanged", async () => {
    const { deps } = makeDeps([CLEAR_VERDICT]);

    const result = await verificationNode(
      makeState("Find a design partner to test my developer tooling", "create"),
      deps,
    );

    expect(result.verifiedIntents).toHaveLength(1);
    expect(result.verifiedIntents?.[0]?.description)
      .toBe("Find a design partner to test my developer tooling");
    expect(result.validationFailures).toHaveLength(0);
  });
});

describe("intent graph propose mode", () => {
  /**
   * `SignalIntakeService.runSynthesis` treats an empty `verifiedIntents` as
   * `verification_rejected` and answers the wizard with a clarifying question
   * (HTTP 422). A vague signal has to actually land there rather than being
   * enriched into something that verifies.
   */
  it("returns nothing verified for a vague signal, which is the wizard's clarify trigger", async () => {
    let contextReads = 0;
    const database = {
      getProfile: async () => ({ identity: { name: "Ada" } }),
      getActiveIntents: async () => [],
      getUserContext: async () => {
        contextReads += 1;
        return { text: "Ada is a staff software engineer." };
      },
    } as unknown as IntentGraphDatabase;

    const graph = new IntentGraphFactory(database, undefined, undefined, {
      inferrer: {
        invoke: async () => ({
          intents: [{
            type: "goal" as const,
            description: "Find a job",
            confidence: "high" as const,
            reasoning: "Stated by the user",
          }],
        }),
      },
      verifier: { invoke: async () => VAGUE_VERDICT },
      reconciler: { invoke: async () => ({ actions: [] }) },
    }).createGraph();

    const result = await graph.invoke({
      userId: "ada",
      // The propose path attaches no profile at all.
      userProfile: "",
      operationMode: "propose",
      inputContent: "Find a job",
    });

    expect(result.verifiedIntents).toEqual([]);
    expect(result.validationFailures?.[0]?.category).toBe("vague_or_invalid");
    expect(contextReads).toBe(0);
  });
});
