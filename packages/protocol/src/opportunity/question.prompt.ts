/**
 * @deprecated Use QuestionerAgent and questioner presets instead. Will be removed in a future version.
 *
 * Prompt module for the decision-question generator: the system prompt
 * constant, the `DiscoveryQuestionInput` contract, and a pure string-building
 * `buildQuestionPrompt` that assembles the user message.
 *
 * Pure: no I/O, no LLM call. The generator class (`question.generator.ts`)
 * orchestrates this module + an LLM client.
 */
import type { ChatContextDigest } from "../shared/schemas/chat-context.schema.js";
import type { DiscoveryNegotiationDigest } from "../shared/schemas/negotiation-digest.schema.js";

/** Roles used in the existing negotiation framework. */
export type NegotiationRole = "agent" | "patient" | "peer";

/** One turn within a negotiation. */
export interface DiscoveryTurn {
  action: "propose" | "accept" | "reject" | "counter" | "question" | "outreach" | "withdraw" | "decline" | "ask_user";
  reasoning: string;
  suggestedRoles: { ownUser: NegotiationRole; otherUser: NegotiationRole };
}

/** Outcome of a negotiation. */
export interface DiscoveryOutcome {
  hasOpportunity: boolean;
  reasoning: string;
  agreedRoles?: Array<{ userId: string; role: NegotiationRole }>;
  /** Why the negotiation stopped, when not by an explicit accept/reject. */
  reason?: "turn_cap" | "timeout" | "screened_out";
}

/** One negotiation that ran during this discovery turn. */
export interface DiscoveryNegotiation {
  /** Opaque counterparty identifier; NEVER surfaced to the user (kept out of the prompt). */
  counterpartyId: string;
  /** Abstract profile slice for the LLM (e.g. "AI infra founder, Berlin"). */
  counterpartyHint: string;
  /** The network/community prompt this negotiation ran under. */
  indexContext: string;
  /** Last 6 turns are retained; earlier ones are dropped. */
  turns: DiscoveryTurn[];
  outcome: DiscoveryOutcome;
  /**
   * Optional pre-negotiation evaluator score (0..1). When more than
   * `MAX_NEGOTIATIONS` candidates exist, this is used as a tie-breaker after
   * `turns.length` to decide which to keep.
   */
  seedAssessmentScore?: number;
}

/** Aggregate counters across all negotiations in this discovery turn. */
export interface DiscoverySummary {
  totalCandidates: number;
  opportunitiesFound: number;
  noOpportunityCount: number;
  /** Subset of `noOpportunityCount` where the negotiation hit a turn-cap or timeout. */
  timeoutCount: number;
  /** Map of role → count across all outcomes' `agreedRoles`. */
  roleDistribution: Partial<Record<NegotiationRole, number>>;
}

/**
 * The seeker's profile slice the generator used to see. Retained as an exported
 * type for backward compatibility; the question prompt now consumes the global
 * `userContext` paragraph instead of these discrete fields.
 */
export interface DiscoverySourceProfile {
  name?: string;
  bio?: string;
  location?: string;
  skills?: string[];
  interests?: string[];
}

/** Full input to the question generator. */
export interface DiscoveryQuestionInput {
  /** The seeker's original natural-language query / signal that triggered discovery. */
  query: string;
  /** The seeker's global user_context paragraph (profile-replacing identity text). */
  userContext: string;
  /**
   * Compact per-negotiation digests from THIS discovery turn. Each digest is a
   * fixed-size structured summary (counterparty hint, index, outcome role,
   * keyTake) — pre-summarized so this prompt stays small regardless of how
   * many candidates were negotiated. Raw negotiations are NOT passed here.
   */
  negotiationDigests: DiscoveryNegotiationDigest[];
  summary: DiscoverySummary;
  /** Distilled chat-session digest, when a session is in scope. */
  chatContext?: ChatContextDigest;
  /** ISO timestamp used as the "now" anchor in the prompt. */
  now: string;
}

/** @deprecated Use QuestionerAgent and questioner presets instead. Will be removed in a future version. */
export const SYSTEM_PROMPT = `You help write user-facing follow-up questions after Index has reviewed potential connections for a human. Your job: surface the minimum set of structured decision questions the human must answer to make the next discovery turn sharper, or improve their outlook on the intent.

You may pick from five strategies. Choose contextually; mix when multiple questions genuinely complement.
- refine_intent: ask the user to sharpen or pivot their original signal.
- surface_missing_detail: ask for one concrete missing input (stage, location, timing, scope, …).
- open_adjacent_thread: offer a pivot suggested by recurring connection signals.
- reflective_summary: mirror what the connection review revealed and ask the user to decide.
- surface_emergent_knowledge: cite a fact you learned from the connection review and ask the user to decide in light of it.

Ask a question only when ALL of these hold:
1. Index cannot resolve the decision autonomously from the evidence shown.
2. The answer would materially change which people surface next.
3. The same fact is NOT already in chatContext.statedFacts, NOT already asked in chatContext.openQuestions, and NOT already shared in chatContext.surfacedFindings.

Standalone prompt rule. Every generated \`prompt\` must be understandable outside the conversation where it was created. Naturally include the original query, discovery pattern, connection pattern, or concrete learned fact in the question text itself. Do not rely on \`title\`, UI labels, hidden metadata, or surrounding digest/chat text to explain what the question is about. For example, prefer "For your AI crypto decentralized deep-tech search, which area is most critical right now?" over "Which area is most critical right now?"

Referential closure. The prompt must resolve entirely on its own, with no dangling references. The reader sees ONLY the question text — never the people you reviewed, the events on their calendar, or this conversation. Do not use demonstratives or definite anaphora that point at things the reader cannot see: "these builders", "those founders", "these researchers", "these conversations", "this lunch", "the speaker". If you reference a person, name them. If you reference a group, restate the concrete shared attribute inside the question itself ("founders working on decentralized identity"), never "these founders". Never imply a list, set, or prior exchange the reader is not currently looking at.
- Bad: "What kind of collaboration are you looking for with these builders?"
- Good: "You're meeting people building agent infrastructure — what kind of collaboration are you looking for?"

No process narration. Never describe Index's own activity or internal state. Forbidden: "the previous negotiation", "the negotiation stalled", "opportunities found so far", "my search", "the counterparty", "candidates reviewed", restating why a match did or did not happen, or quoting words a counterparty did or did not use. Ask about the user's goal or intent directly, never about the matching pipeline.
- Bad: "All opportunities found so far are related to 'Edge Esmeralda'. Would you like to broaden the search?"
- Good: "Do you want to focus on people at Edge Esmeralda, or also connect beyond it?"

Cardinality. Default one question. Add a second only when a DIFFERENT strategy genuinely complements the first (e.g. one surface_emergent_knowledge + one refine_intent). Add a third only when there are ≥3 substantive people reviewed and three distinct strategies each unblock a real decision. Two questions of the same strategy are acceptable only if their decision domains differ (different titles). Avoid stacking three pulls (info-from-user); balance with pushes (info-to-user via reflective_summary / surface_emergent_knowledge).

Ordering. Questions whose answer unblocks the most connection reviews come first; then highest-impact; then ambiguity-clarifying. Reviews that needed more detail or ran out of time signal under-specification — prioritize.

User-facing language. Every title, prompt, option label, and option description is shown directly to the user. Never mention raw protocol mechanics or internal labels such as "agent", "patient", "peer", "suggestedRoles", "role distribution", "counterparty", "negotiation", "turn_cap", "timeout", or "candidate". Use natural language instead: people, matches, connections, mutual collaboration, someone who can help, or someone seeking help.

Option construction. Each option must represent a meaningfully different outcome. Suffix the safest path with " (Recommended)" and list it first. The description states the CONSEQUENCE of choosing the option, not its definition. 2–4 options. Never add an "Other" option — clients provide a free-text fallback automatically. For surface_emergent_knowledge questions, anchor the prompt in the concrete cited fact ("Multiple people flagged that…") and let the options represent decisions in light of that fact, not different versions of the fact.

Title rules. ≤12 chars. Noun of the decision domain. Discovery examples: "Stage", "Timing", "Role", "Location", "Stack", "Budget", "Scope", "Format".

Anti-patterns — never do these.
- Don't ask procedural confirmations ("Should I look again?").
- Don't ask about hypothetical edge cases that didn't occur.
- Don't ask about specific person identities; treat the provided person summary as the only allowed reference.
- Don't repeat anything in chatContext.openQuestions.
- Don't re-surface anything in chatContext.surfacedFindings.
- Don't ask for facts in chatContext.statedFacts.

Output. Return at most 3 entries in the "questions" array. Each entry must include a "strategy" field (one of the five values). If nothing is worth asking, return "questions": [].`;

/**
 * @deprecated Use QuestionerAgent and questioner presets instead. Will be removed in a future version.
 *
 * Pure builder: assembles the user message string from a structured input.
 */
export function buildQuestionPrompt(input: DiscoveryQuestionInput): string {
  const profileSummary = input.userContext?.trim() || "(no profile data)";
  const connectionReviewBlocks = renderConnectionReviewDigests(input.negotiationDigests);
  const chatContextBlock = input.chatContext
    ? renderDigest(input.chatContext)
    : "(no chat context available)";
  const engagementPattern = renderEngagementPattern(input.summary.roleDistribution);

  return [
    "## Seeker's query",
    input.query,
    "",
    "## Seeker profile",
    profileSummary,
    "",
    "## This discovery turn",
    `- ${input.summary.totalCandidates} people reviewed`,
    `- ${input.summary.opportunitiesFound} promising connections found`,
    `- ${input.summary.noOpportunityCount} reviews did not find enough fit (${input.summary.timeoutCount} needed more detail or time)`,
    `- Engagement pattern: ${engagementPattern}`,
    "",
    "## Connection review evidence (compact digests)",
    connectionReviewBlocks,
    "",
    "## What the user has already said in this session",
    chatContextBlock,
    "",
    "## Now",
    input.now,
    "",
    "## Your task",
    "Identify the minimum set of decision questions the seeker must answer to make",
    "the next discovery turn sharper. Apply every rule from your system prompt",
    "before outputting. Return an empty `questions` array if nothing is worth asking.",
  ].join("\n");
}

/**
 * Render the negotiation-digest collection into compact one-liners. Each digest
 * is fixed-size (≤ ~400 chars after rendering), so the rendered block scales
 * linearly with candidate count: 10 candidates ≈ 4 KB, well within budget.
 */
function renderConnectionReviewDigests(digests: DiscoveryNegotiationDigest[]): string {
  if (digests.length === 0) return "(no connection reviews)";
  return digests
    .map((d) => {
      const relationshipSignal = d.suggestedRoles
        ? [`  Relationship signal: ${renderRelationshipSignal(d.suggestedRoles)}`]
        : [];
      return [
        `- Person: ${d.counterpartyHint}`,
        `  Community context: ${d.indexContext}`,
        `  Outcome: ${renderOutcome(d)}`,
        ...relationshipSignal,
        `  Take: ${d.keyTake}`,
      ].join("\n");
    })
    .join("\n\n");
}

function renderEngagementPattern(dist: Partial<Record<NegotiationRole, number>>): string {
  const parts: string[] = [];
  if ((dist.peer ?? 0) > 0) {
    parts.push(`${dist.peer} mutual collaboration${dist.peer === 1 ? "" : "s"}`);
  }
  if ((dist.agent ?? 0) > 0) {
    parts.push(`${dist.agent} where the user could offer help or expertise`);
  }
  if ((dist.patient ?? 0) > 0) {
    parts.push(`${dist.patient} where the user seemed to be seeking help or expertise`);
  }
  return parts.length > 0 ? parts.join(", ") : "(no engagement pattern available)";
}

function renderOutcome(digest: DiscoveryNegotiationDigest): string {
  const outcome = digest.outcomeRole === "opportunity"
    ? "promising connection"
    : "not enough fit";
  const reason = renderOutcomeReason(digest.outcomeReason);
  return reason ? `${outcome} (${reason})` : outcome;
}

function renderOutcomeReason(reason: DiscoveryNegotiationDigest["outcomeReason"]): string {
  switch (reason) {
    case "turn_cap":
      return "needed more detail";
    case "timeout":
      return "ran out of time";
    case "rejected":
      return "not enough mutual interest";
    case "stalled":
      return "stalled";
    case "screened_out":
      return "didn't look like a strong enough fit to pursue";
    case null:
      return "";
  }
}

function renderRelationshipSignal(roles: NonNullable<DiscoveryNegotiationDigest["suggestedRoles"]>): string {
  if (roles.ownUser === "peer" && roles.otherUser === "peer") return "mutual collaboration";
  if (roles.ownUser === "agent" && roles.otherUser === "patient") {
    return "the user could offer help or expertise";
  }
  if (roles.ownUser === "patient" && roles.otherUser === "agent") {
    return "the user seemed to be seeking help or expertise";
  }
  if (roles.ownUser === "agent") return "the user could offer help or expertise";
  if (roles.ownUser === "patient") return "the user seemed to be seeking help or expertise";
  return "collaboration fit";
}

function renderDigest(d: ChatContextDigest): string {
  const lines: string[] = [];
  if (d.statedFacts.length > 0) {
    lines.push("Stated facts:");
    for (const f of d.statedFacts) lines.push(`  - ${f}`);
  }
  if (d.openQuestions.length > 0) {
    lines.push("Open questions (assistant already asked):");
    for (const q of d.openQuestions) lines.push(`  - ${q}`);
  }
  if (d.rejectionReasons.length > 0) {
    lines.push("User pushback / rejections:");
    for (const r of d.rejectionReasons) lines.push(`  - ${r}`);
  }
  if (d.surfacedFindings.length > 0) {
    lines.push("Findings already surfaced to user:");
    for (const f of d.surfacedFindings) lines.push(`  - ${f}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(digest is empty)";
}

