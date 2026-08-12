import { describe, expect, it } from "bun:test";

import { FALLBACK_BRING_QUESTION, type FollowUpPlan } from "../../../src/signals/application/intake.orchestrator.js";
import { CASES } from "../intake.cases.js";
import { runCase } from "../intake.runner.js";
import { buildJudgeCriteria, scoreCase } from "../intake.scorer.js";
import type { IntakeOrchestratorLike } from "../intake.types.js";

function plan(
  prompt: string,
  options: Array<{ label: string; description: string }>,
): FollowUpPlan {
  return {
    questions: [{ title: "Purpose", prompt, options, multiSelect: false }],
    plannedFollowUpCount: 1,
  };
}

describe("intake eval corpus", () => {
  it("has unique cases for unrelated, relevant, and absent profile bridges", () => {
    expect(new Set(CASES.map((candidate) => candidate.id)).size).toBe(CASES.length);
    expect(CASES.some((candidate) => candidate.id.startsWith("unrelated/"))).toBe(true);
    expect(CASES.some((candidate) => candidate.id.startsWith("relevant/"))).toBe(true);
    expect(CASES.some((candidate) => candidate.maxProfileOptions === 0)).toBe(true);
  });

  it("requires at least two answer-domain options in every case", () => {
    expect(CASES.every((candidate) => candidate.minDomainOptions >= 2)).toBe(true);
  });
});

describe("intake eval scorer", () => {
  const scubaCase = CASES.find((candidate) => candidate.id === "unrelated/scuba-tech-profile")!;

  it("passes an answer-first question with one profile bridge", () => {
    const result = scoreCase(scubaCase, plan(
      "What would make meeting scuba divers valuable to you?",
      [
        { label: "Local dive buddies", description: "Meet people for regular dives" },
        { label: "Experienced instructors", description: "Learn safer diving techniques" },
        { label: "Underwater technology", description: "Explore one connection to your technology background" },
      ],
    ));

    expect(result.passed).toBe(true);
    expect(result.domainOptionCount).toBe(3);
    expect(result.profileOptionCount).toBe(1);
  });

  it("fails when profile-derived options dominate", () => {
    const result = scoreCase(scubaCase, plan(
      "What specific topics would you like to discuss with scuba divers?",
      [
        { label: "Underwater technology", description: "Discuss diving technology" },
        { label: "Marine AI", description: "Discuss AI applications in the ocean" },
        { label: "Digital media underwater", description: "Discuss digital media tools" },
        { label: "General diving", description: "Discuss scuba diving generally" },
      ],
    ));

    expect(result.passed).toBe(false);
    expect(result.profileOptionCount).toBeGreaterThan(1);
  });

  it("fails a generic prompt that drops the newly stated domain", () => {
    const result = scoreCase(scubaCase, plan(
      "What would make this connection valuable?",
      [
        { label: "Dive buddies", description: "Meet people for diving" },
        { label: "Instructors", description: "Learn scuba skills" },
      ],
    ));

    expect(result.promptRelevant).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("fails the model-error fallback", () => {
    const result = scoreCase(scubaCase, {
      questions: [FALLBACK_BRING_QUESTION],
      plannedFollowUpCount: 1,
    });

    expect(result.usedFallback).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("gives the independent judge the answer/profile counterfactual", () => {
    const criteria = buildJudgeCriteria(scubaCase);
    expect(criteria).toContain("scuba divers");
    expect(criteria).toContain("profile brief were completely hidden");
    expect(criteria).toContain("At most 1 option(s)");
    expect(criteria).toContain("would not naturally follow without the profile");
    expect(criteria).toContain("Exactly one profile bridge passes");
    expect(criteria).toContain("Do NOT require answer-grounded options to reflect the profile");
    expect(criteria).toContain("does not re-ask who they want to meet");
  });
});

describe("intake eval runner", () => {
  it("passes the complete fixture input to the orchestrator", async () => {
    let received: unknown;
    const output = plan("Which scuba divers?", [
      { label: "Dive buddies", description: "People for diving" },
      { label: "Instructors", description: "People who teach scuba" },
    ]);
    const orchestrator: IntakeOrchestratorLike = {
      generateFollowUps: async (input) => {
        received = input;
        return output;
      },
    };

    const c = CASES[0];
    expect(await runCase(orchestrator, c)).toBe(output);
    expect(received).toEqual(c.input);
  });
});
