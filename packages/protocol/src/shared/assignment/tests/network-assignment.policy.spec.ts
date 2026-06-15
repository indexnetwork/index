import { describe, expect, it } from "bun:test";

import { buildNetworkAssignmentDecision, classifyPromptPresence, DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD, resolveAssignmentNetworkScope } from "../network-assignment.policy.js";


describe("network-assignment.policy", () => {
  it("classifies prompt presence", () => {
    expect(classifyPromptPresence({ indexPrompt: "Index", memberPrompt: "Member" })).toBe("both");
    expect(classifyPromptPresence({ indexPrompt: "Index", memberPrompt: "  " })).toBe("index");
    expect(classifyPromptPresence({ indexPrompt: null, memberPrompt: "Member" })).toBe("member");
    expect(classifyPromptPresence({ indexPrompt: undefined, memberPrompt: "" })).toBe("none");
  });

  it("evaluates all memberships in global scope", () => {
    expect(resolveAssignmentNetworkScope({ memberships: ["n1", "n2"] })).toEqual(["n1", "n2"]);
  });

  it("evaluates only the active network in network scope", () => {
    expect(resolveAssignmentNetworkScope({ memberships: ["n1", "n2"], networkScopeId: "n2" })).toEqual(["n2"]);
    expect(resolveAssignmentNetworkScope({ memberships: ["n1"], networkScopeId: "n2" })).toEqual([]);
  });

  it("assigns when weighted score meets the unified threshold", () => {
    const decision = buildNetworkAssignmentDecision({
      resourceType: "intent",
      mode: "automatic",
      scope: "global",
      indexPrompt: "founders",
      memberPrompt: "AI",
      rawScores: { indexScore: 0.8, memberScore: 0.7 },
      createdAt: "2026-06-09T00:00:00.000Z",
    });

    expect(decision.assigned).toBe(true);
    expect(decision.finalScore).toBeCloseTo(0.76);
    expect(decision.metadata.threshold).toBe(DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD);
    expect(decision.metadata.promptPresence).toBe("both");
    expect(decision.metadata.createdAt).toBe("2026-06-09T00:00:00.000Z");
  });

  it("does not assign when score is below threshold", () => {
    const decision = buildNetworkAssignmentDecision({
      resourceType: "premise",
      mode: "automatic",
      scope: "global",
      indexPrompt: "founders",
      rawScores: { indexScore: 0.4 },
    });

    expect(decision.assigned).toBe(false);
    expect(decision.finalScore).toBe(0.4);
  });

  it("assigns no-prompt networks because they have no dynamic filtration", () => {
    const decision = buildNetworkAssignmentDecision({
      resourceType: "intent",
      mode: "automatic",
      scope: "network",
      rawScores: { indexScore: 0.1, memberScore: 0.1 },
    });

    expect(decision.assigned).toBe(true);
    expect(decision.finalScore).toBe(1);
    expect(decision.metadata.reason).toContain("No prompts");
  });

  it("marks explicit manual override assignments", () => {
    const decision = buildNetworkAssignmentDecision({
      resourceType: "intent",
      mode: "manual_override",
      scope: "network",
      indexPrompt: "strict prompt",
      rawScores: { indexScore: 0.1 },
    });

    expect(decision.assigned).toBe(true);
    expect(decision.finalScore).toBe(1);
    expect(decision.metadata.mode).toBe("manual_override");
    expect(decision.metadata.reason).toContain("manual override");
  });
});
