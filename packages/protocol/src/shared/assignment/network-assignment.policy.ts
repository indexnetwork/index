import { deriveAllowedNetworkIds, scopeFromNetworkId } from "../agent/tool.scope.js";
import type { ScopeMembership, ToolScopeEnvelope } from "../agent/tool.scope.js";
import type { NetworkAssignmentMetadata, NetworkAssignmentMode, NetworkAssignmentPromptPresence, NetworkAssignmentRawScores, NetworkAssignmentResourceType, NetworkAssignmentScope } from "../schemas/network-assignment.schema.js";

/** Centralized default for unified premise/intent network assignment. */
export const DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD = 0.7;

export interface PromptPresenceInput {
  indexPrompt?: string | null;
  memberPrompt?: string | null;
}

export type AssignmentScopeMembership = ScopeMembership | string;

export interface ResolveAssignmentNetworkScopeArgs extends ToolScopeEnvelope {
  memberships: AssignmentScopeMembership[];
  /** @deprecated Use `scopeType: 'network'` + `scopeId`. */
  networkScopeId?: string;
}

export interface BuildNetworkAssignmentDecisionArgs extends PromptPresenceInput {
  resourceType: NetworkAssignmentResourceType;
  mode: NetworkAssignmentMode;
  scope: NetworkAssignmentScope;
  rawScores?: NetworkAssignmentRawScores | null;
  threshold?: number;
  evaluator?: string;
  source?: string;
  reason?: string;
  createdAt?: string;
}

export interface NetworkAssignmentDecision {
  assigned: boolean;
  finalScore: number;
  metadata: NetworkAssignmentMetadata;
}

/**
 * Classifies whether a network/member prompt pair can filter a resource.
 *
 * @param input - Network and member prompt values to inspect.
 * @returns Prompt-presence classification for assignment policy decisions.
 */
export function classifyPromptPresence(input: PromptPresenceInput): NetworkAssignmentPromptPresence {
  const hasIndex = !!input.indexPrompt?.trim();
  const hasMember = !!input.memberPrompt?.trim();
  if (hasIndex && hasMember) return "both";
  if (hasIndex) return "index";
  if (hasMember) return "member";
  return "none";
}

/**
 * Resolves the networks to evaluate: all memberships in global scope, or the
 * focused network plus personal memberships in network scope. The focused
 * network must also be a membership to avoid broadening scope accidentally.
 *
 * @param args - User memberships plus optional active network scope.
 * @returns Network IDs that assignment should evaluate.
 */
export function resolveAssignmentNetworkScope(args: ResolveAssignmentNetworkScopeArgs): string[] {
  const memberships = args.memberships.map((membership) => (
    typeof membership === "string"
      ? { networkId: membership, isPersonal: false }
      : membership
  ));
  const scope = args.scopeType && args.scopeId
    ? { scopeType: args.scopeType, scopeId: args.scopeId }
    : scopeFromNetworkId(args.networkScopeId);

  return deriveAllowedNetworkIds({ memberships, ...scope });
}

/**
 * Builds a unified assignment decision and metadata envelope.
 *
 * @param args - Assignment resource, scope, prompt, score, and provenance inputs.
 * @returns Assignment decision and explainability metadata.
 */
export function buildNetworkAssignmentDecision(args: BuildNetworkAssignmentDecisionArgs): NetworkAssignmentDecision {
  const threshold = clampScore(args.threshold ?? DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD);
  const promptPresence = classifyPromptPresence(args);

  if (args.mode === "manual_override") {
    const finalScore = 1.0;
    return buildDecision(args, promptPresence, threshold, finalScore, true, args.reason ?? "Explicit manual override.");
  }

  if (promptPresence === "none") {
    const finalScore = 1.0;
    return buildDecision(args, promptPresence, threshold, finalScore, true, args.reason ?? "No prompts configured; network has no dynamic filtration.");
  }

  const finalScore = combineAssignmentScores(args.rawScores ?? {}, promptPresence);
  const assigned = finalScore >= threshold;
  return buildDecision(args, promptPresence, threshold, finalScore, assigned, args.reason);
}

/**
 * Combines index/member scores according to available prompt filtration.
 *
 * @param rawScores - Optional normalized index and member scores.
 * @param promptPresence - Which prompts are present for this assignment decision.
 * @returns Final normalized score in the 0..1 range.
 */
export function combineAssignmentScores(
  rawScores: NetworkAssignmentRawScores,
  promptPresence: NetworkAssignmentPromptPresence,
): number {
  const indexScore = clampScore(rawScores.indexScore ?? 0);
  const memberScore = clampScore(rawScores.memberScore ?? 0);

  switch (promptPresence) {
    case "both":
      return clampScore(indexScore * 0.6 + memberScore * 0.4);
    case "index":
      return indexScore;
    case "member":
      return memberScore;
    case "none":
      return 1.0;
  }
}

function buildDecision(
  args: BuildNetworkAssignmentDecisionArgs,
  promptPresence: NetworkAssignmentPromptPresence,
  threshold: number,
  finalScore: number,
  assigned: boolean,
  reason?: string,
): NetworkAssignmentDecision {
  return {
    assigned,
    finalScore,
    metadata: {
      resourceType: args.resourceType,
      mode: args.mode,
      scope: args.scope,
      policy: "unified-threshold-v1",
      threshold,
      promptPresence,
      ...(args.rawScores ? { rawScores: args.rawScores } : {}),
      finalScore,
      assigned,
      ...(reason ? { reason } : {}),
      ...(args.evaluator ? { evaluator: args.evaluator } : {}),
      ...(args.source ? { source: args.source } : {}),
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    },
  };
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}
