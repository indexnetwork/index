/**
 * The profile-blind propose path: what it skips, and what it must not score.
 *
 * The signal-intake funnel invokes the graph on the output of synthesis — one
 * clean, self-contained, first-person signal — with no profile attached. Two
 * consequences are asserted here:
 *
 * 1. Inference has nothing to do on that input, so a caller that supplies its
 *    output routes straight to verification.
 * 2. `authority` asks whether the speaker's profile supports the speech act.
 *    With no profile it is a number guessed from nothing, so it must not cap the
 *    score the caller stores.
 */
import { describe, expect, it } from "bun:test";

import { IntentGraphFactory, shouldRunInference } from "../graph/intent.graph.js";
import { combineFelicityScores } from "../graph/intent.graph.shared.js";
import { verificationNode } from "../graph/intent.graph.reconcile.js";

import type { SemanticVerifierOutput } from "../intent.verifier.js";
import type { IntentGraphDeps, IntentState } from "../graph/intent.graph.shared.js";
import type { IntentGraphDatabase } from "../../shared/interfaces/database.interface.js";

const VERDICT: SemanticVerifierOutput = {
  reasoning: "A specific search directive",
  classification: "DIRECTIVE",
  felicity_scores: { authority: 40, sincerity: 90, clarity: 85 },
  semantic_entropy: 0.2,
  referential_anchor: null,
  referential_breadth: "narrow",
  missing_selectional_constraints: [],
  specificity_warning: null,
  flags: ["SKILL_MISMATCH"],
};

const SIGNAL = "I'm looking for a design partner to test my developer tooling this quarter.";

const database = {
  getProfile: async () => ({ identity: { name: "Ada" } }),
  getActiveIntents: async () => [],
} as unknown as IntentGraphDatabase;

/** Build a graph whose inferrer and verifier both count their calls. */
function makeGraph() {
  const inferrerCalls: Array<string | null> = [];
  const verifierCalls: Array<{ content: string; context: string }> = [];
  const graph = new IntentGraphFactory(database, undefined, undefined, {
    inferrer: {
      invoke: async (content: string | null) => {
        inferrerCalls.push(content);
        return {
          intents: [{
            type: "goal" as const,
            description: "Something the inferrer made up",
            reasoning: "Inferred",
            confidence: "high" as const,
          }],
        };
      },
    },
    verifier: {
      invoke: async (content: string, context: string) => {
        verifierCalls.push({ content, context });
        return VERDICT;
      },
    },
    reconciler: { invoke: async () => ({ actions: [] }) },
  }).createGraph();
  return { graph, inferrerCalls, verifierCalls };
}

describe("supplying a stage's output skips that stage", () => {
  it("verifies the caller's signal without re-inferring it", async () => {
    const { graph, inferrerCalls, verifierCalls } = makeGraph();

    const result = await graph.invoke({
      userId: "ada",
      userProfile: "",
      operationMode: "propose",
      inputContent: SIGNAL,
      inferredIntents: [{
        type: "goal",
        description: SIGNAL,
        reasoning: "Synthesized from the intake interview answers.",
        confidence: "high",
      }],
    });

    expect(inferrerCalls).toEqual([]);
    expect(verifierCalls.map((call) => call.content)).toEqual([SIGNAL]);
    expect(result.verifiedIntents).toHaveLength(1);
    expect(result.verifiedIntents[0]?.description).toBe(SIGNAL);
  });

  it("still runs inference when the caller supplies only raw text", async () => {
    const { graph, inferrerCalls, verifierCalls } = makeGraph();

    const result = await graph.invoke({
      userId: "ada",
      userProfile: "",
      operationMode: "propose",
      inputContent: "erm, people to build with I guess",
    });

    expect(inferrerCalls).toEqual(["erm, people to build with I guess"]);
    expect(verifierCalls.map((call) => call.content)).toEqual(["Something the inferrer made up"]);
    expect(result.verifiedIntents).toHaveLength(1);
  });

  it("routes on the seed, not on the operation mode", () => {
    const seeded = {
      operationMode: "create",
      inferredIntents: [{ type: "goal", description: SIGNAL, reasoning: "r", confidence: "high" }],
    } as unknown as IntentState;
    const empty = { operationMode: "create", inferredIntents: [] } as unknown as IntentState;
    const deleting = {
      operationMode: "delete",
      inferredIntents: [{ type: "goal", description: SIGNAL, reasoning: "r", confidence: "high" }],
    } as unknown as IntentState;

    expect(shouldRunInference(seeded)).toBe("verification");
    expect(shouldRunInference(empty)).toBe("inference");
    // Delete still wins: it skips inference to reach the reconciler, not verification.
    expect(shouldRunInference(deleting)).toBe("reconciler");
  });
});

describe("authority scores nothing when no profile was supplied", () => {
  const felicityScores = { authority: 40, sincerity: 90, clarity: 85 };

  it("leaves authority out of the minimum with no profile", () => {
    for (const profile of ["", "   ", undefined]) {
      expect(combineFelicityScores(felicityScores, profile)).toBe(85);
    }
  });

  it("keeps authority in the minimum when a profile backs it", () => {
    expect(combineFelicityScores(felicityScores, "Ada is a staff engineer.")).toBe(40);
  });

  it("does not cap the stored score of a profile-blind verification", async () => {
    const deps = {
      verifier: { invoke: async () => VERDICT },
    } as unknown as IntentGraphDeps;
    const state = {
      userId: "ada",
      userProfile: "",
      operationMode: "propose",
      inferredIntents: [{
        type: "goal",
        description: SIGNAL,
        reasoning: "Synthesized from the intake interview answers.",
        confidence: "high",
      }],
    } as unknown as IntentState;

    const result = await verificationNode(state, deps);

    expect(result.verifiedIntents?.[0]?.score).toBe(85);
    // The raw verdict is stored untouched; only the combination changes.
    expect(result.verifiedIntents?.[0]?.verification?.felicity_scores.authority).toBe(40);
  });

  it("still lets authority cap the score when a profile was supplied", async () => {
    const deps = {
      verifier: { invoke: async () => VERDICT },
    } as unknown as IntentGraphDeps;
    const state = {
      userId: "ada",
      userProfile: "Ada is a staff engineer at a large search company.",
      operationMode: "create",
      inferredIntents: [{
        type: "goal",
        description: SIGNAL,
        reasoning: "Stated by the user",
        confidence: "high",
      }],
    } as unknown as IntentState;

    const result = await verificationNode(state, deps);

    expect(result.verifiedIntents?.[0]?.score).toBe(40);
  });
});
