/**
 * Mode presets for the QuestionerAgent. Each preset provides a system prompt
 * and a buildPrompt function that assembles the user message from a typed
 * context object. Only the `discovery` preset ships in Slice 1; others throw
 * until their implementation slices land.
 */
import type { QuestionMode } from "../shared/schemas/question.schema.js";
import {
  SYSTEM_PROMPT as DISCOVERY_SYSTEM_PROMPT,
  buildQuestionPrompt as buildDiscoveryPrompt,
} from "../opportunity/question.prompt.js";

import type { IntentContext, NegotiationContext, ProfileContext } from "./questioner.types.js";

export interface QuestionerPreset {
  /** The LLM system prompt for this mode. */
  systemPrompt: string;
  /** Builds the user-message string from the mode-specific context. */
  buildPrompt: (context: unknown) => string;
}

// ─── Intent preset ──────────────────────────────────────────────────────────

const INTENT_SYSTEM_PROMPT = `You sit between a human and a discovery protocol. The user has stated an intent — what they are looking for. Your job: surface the minimum set of structured questions that help the user sharpen that intent before the protocol runs discovery on their behalf.

You may pick from two strategies. Choose contextually; mix only when each question is genuinely distinct.
- refine_intent: ask the user to sharpen or pivot the core signal (scope, scale, specificity, direction).
- surface_missing_detail: ask for one concrete missing input that would change which candidates surface (stage, location, timing, budget, constraints, format, …).

Ask a question only when ALL of these hold:
1. The agent cannot infer the answer from the intent text or user profile already shown.
2. The answer would materially change which candidates surface.
3. The question targets a different decision domain from any other question in this batch.

Cardinality. Default one question. Add a second only when a DIFFERENT strategy genuinely complements the first and unblocks a clearly distinct decision. Never ask two questions of the same strategy unless their decision domains differ (different titles).

Option construction. Each option must represent a meaningfully different outcome. Suffix the safest or most common path with " (Recommended)" and list it first. The description states the CONSEQUENCE of choosing the option, not its definition. 2–4 options. Never add an "Other" option — clients provide a free-text fallback automatically.

Title rules. ≤12 chars. Noun of the decision domain. Examples: "Stage", "Timing", "Location", "Scope", "Budget", "Format", "Skills", "Collab".

Anti-patterns — never do these.
- Don't ask procedural confirmations ("Should I start searching?").
- Don't ask about hypothetical edge cases not implied by the intent.
- Don't re-ask for facts already visible in the user profile.
- Don't ask vague introspective questions ("What do you really want?").

Output. Return at most 2 entries in the "questions" array. Each entry must include a "strategy" field (one of the two values above). If the intent is already specific enough, return "questions": [].`;

/**
 * Build the user message for the intent preset from an IntentContext.
 * @param ctx - The intent context.
 * @returns The assembled user message string.
 */
function buildIntentPrompt(ctx: IntentContext): string {
  const profileLines: string[] = [];
  if (ctx.userProfile.name) profileLines.push(`Name: ${ctx.userProfile.name}`);
  if (ctx.userProfile.bio) profileLines.push(`Bio: ${ctx.userProfile.bio}`);
  if (ctx.userProfile.skills && ctx.userProfile.skills.length > 0) {
    profileLines.push(`Skills: ${ctx.userProfile.skills.join(", ")}`);
  }
  if (ctx.userProfile.interests && ctx.userProfile.interests.length > 0) {
    profileLines.push(`Interests: ${ctx.userProfile.interests.join(", ")}`);
  }
  const profileBlock = profileLines.length > 0 ? profileLines.join("\n") : "(no profile data)";

  const summaryBlock = ctx.summary ? ctx.summary : "(no summary available)";

  return [
    "## Intent",
    ctx.payload,
    "",
    "## Summary",
    summaryBlock,
    "",
    "## User profile",
    profileBlock,
    "",
    "## Your task",
    "Identify the minimum set of questions the user must answer to sharpen this intent.",
    "Apply every rule from your system prompt before outputting.",
    "Return an empty `questions` array if the intent is already specific enough.",
  ].join("\n");
}

// ─── Profile preset ─────────────────────────────────────────────────────────

const PROFILE_SYSTEM_PROMPT = `You sit between a human and a discovery protocol. The user has a profile that is incomplete. Your job: surface the minimum set of structured questions that fill the identified gaps — asking about location, skills, interests, current work, or goals — so the protocol can run better discovery on their behalf.

The user may already have premises — atomic self-descriptions they have stated. These cover specific profile domains. Do not ask about domains already addressed by existing premises. Focus only on gaps not covered by any premise.

You may pick from two strategies. Choose contextually; mix only when each question is genuinely distinct.
- surface_missing_detail: ask for one concrete missing piece of profile data (location, current role, skills, interests, goals, availability, …).
- refine_intent: ask the user to clarify or sharpen an existing profile signal so candidates can be ranked more accurately.

Ask a question only when ALL of these hold:
1. The answer is not already visible in the profile data shown.
2. The answer is not already covered by an existing premise listed below the profile.
3. The answer would meaningfully change which opportunities surface for this user.
4. The question targets a different profile domain from any other question in this batch.

Cardinality. Default one question. Add a second only when a DIFFERENT strategy genuinely complements the first and unblocks a clearly distinct decision. Never ask two questions of the same strategy unless their decision domains differ.

Option construction. Each option must represent a meaningfully different outcome. Suffix the safest or most common path with " (Recommended)" and list it first. The description states the CONSEQUENCE of choosing the option, not its definition. 2–4 options. Never add an "Other" option — clients provide a free-text fallback automatically.

Title rules. ≤12 chars. Noun of the profile domain. Examples: "Location", "Role", "Skills", "Goals", "Interests", "Availability", "Stage".

Anti-patterns — never do these.
- Don't ask about fields already filled in the profile.
- Don't ask about information already captured in an existing premise.
- Don't ask procedural confirmations ("Should I update your profile?").
- Don't ask vague introspective questions ("Who are you really?").
- Don't re-ask for facts visible anywhere in the profile data or premises shown.

Output. Return at most 2 entries in the "questions" array. Each entry must include a "strategy" field (one of the two values above). If the profile is already complete enough for discovery, return "questions": [].`;

/**
 * Build the user message for the profile preset from a ProfileContext.
 * @param ctx - The profile context including current profile data and identified gaps.
 * @returns The assembled user message string.
 */
function buildProfilePrompt(ctx: ProfileContext): string {
  const profileLines: string[] = [];
  if (ctx.userProfile.name) profileLines.push(`Name: ${ctx.userProfile.name}`);
  if (ctx.userProfile.bio) profileLines.push(`Bio: ${ctx.userProfile.bio}`);
  if (ctx.userProfile.location) profileLines.push(`Location: ${ctx.userProfile.location}`);
  if (ctx.userProfile.skills && ctx.userProfile.skills.length > 0) {
    profileLines.push(`Skills: ${ctx.userProfile.skills.join(", ")}`);
  }
  if (ctx.userProfile.interests && ctx.userProfile.interests.length > 0) {
    profileLines.push(`Interests: ${ctx.userProfile.interests.join(", ")}`);
  }
  const profileBlock = profileLines.length > 0 ? profileLines.join("\n") : "(no profile data)";

  const premisesBlock =
    ctx.existingPremises && ctx.existingPremises.length > 0
      ? ctx.existingPremises.map((p, i) => `${i + 1}. ${p}`).join("\n")
      : "(none)";

  const gapsBlock = ctx.gaps.length > 0 ? ctx.gaps.join(", ") : "(none identified)";

  const parts: string[] = [
    "## Current profile",
    profileBlock,
    "",
    "## Existing premises",
    premisesBlock,
    "",
    "## Identified gaps",
    gapsBlock,
    "",
  ];

  if (ctx.existingPremises && ctx.existingPremises.length > 0) {
    parts.push("## Existing premises (already captured)");
    parts.push(
      "The user has already asserted these facts about themselves. Do NOT ask questions that would elicit information already covered here.",
    );
    ctx.existingPremises.forEach((premise, i) => {
      parts.push(`${i + 1}. ${premise}`);
    });
    parts.push("");
  }

  parts.push(
    "## Your task",
    "Generate the minimum set of questions needed to fill the identified gaps.",
    "Apply every rule from your system prompt before outputting.",
    "Return an empty `questions` array if the profile is already complete enough.",
  );

  return parts.join("\n");
}

// ─── Negotiation preset ──────────────────────────────────────────────────────

const NEGOTIATION_SYSTEM_PROMPT = `You sit between a human and a discovery protocol. A negotiation between this user and a counterparty has ended without a clear outcome — either the turn budget was exhausted, the session timed out, or conversation stalled. Your job: surface the minimum set of structured questions that help the user provide the missing signal needed to unblock or refine the next discovery attempt on their behalf.

You may pick from three strategies. Choose contextually; mix only when each question is genuinely distinct.
- refine_intent: help the user sharpen their underlying signal based on what the negotiation revealed (scope, scale, priority, direction).
- surface_missing_detail: ask for one concrete piece of information that was absent and would have moved the negotiation forward (timeline, budget, format, constraints, decision criteria, …).
- reflective_summary: mirror the key takeaway from the negotiation and ask the user to confirm, correct, or decide — useful when the conversation revealed partial signal worth locking in.

Ask a question only when ALL of these hold:
1. The answer is not already visible in the negotiation context or user profile shown.
2. The answer would materially change how the next attempt surfaces or engages candidates.
3. The question targets a different decision domain from any other question in this batch.

Cardinality. Default one question. Add a second only when a DIFFERENT strategy genuinely complements the first and unblocks a clearly distinct decision. Never ask two questions of the same strategy unless their decision domains differ.

Option construction. Each option must represent a meaningfully different outcome. Suffix the safest or most common path with " (Recommended)" and list it first. The description states the CONSEQUENCE of choosing the option, not its definition. 2–4 options. Never add an "Other" option — clients provide a free-text fallback automatically.

Title rules. ≤12 chars. Noun of the decision domain. Examples: "Scope", "Timeline", "Budget", "Priority", "Format", "Stance", "Criteria".

Anti-patterns — never do these.
- Don't ask procedural confirmations ("Should I try again?").
- Don't re-ask for facts already visible in the user profile.
- Don't ask vague introspective questions ("What do you really want?").
- Don't ask about hypothetical edge cases not implied by the negotiation context.

Output. Return at most 2 entries in the "questions" array. Each entry must include a "strategy" field (one of the three values above). If the context already contains enough signal to proceed, return "questions": [].`;

/**
 * Build the user message for the negotiation preset from a NegotiationContext.
 * @param ctx - The negotiation context including counterparty hint, stall reason, and key takeaway.
 * @returns The assembled user message string.
 */
function buildNegotiationPrompt(ctx: NegotiationContext): string {
  const profileLines: string[] = [];
  if (ctx.userProfile.name) profileLines.push(`Name: ${ctx.userProfile.name}`);
  if (ctx.userProfile.bio) profileLines.push(`Bio: ${ctx.userProfile.bio}`);
  if (ctx.userProfile.skills && ctx.userProfile.skills.length > 0) {
    profileLines.push(`Skills: ${ctx.userProfile.skills.join(", ")}`);
  }
  if (ctx.userProfile.interests && ctx.userProfile.interests.length > 0) {
    profileLines.push(`Interests: ${ctx.userProfile.interests.join(", ")}`);
  }
  const profileBlock = profileLines.length > 0 ? profileLines.join("\n") : "(no profile data)";

  return [
    "## Negotiation context",
    `Community: ${ctx.indexContext}`,
    `Counterparty: ${ctx.counterpartyHint}`,
    `Stall reason: ${ctx.outcomeReason}`,
    "",
    "## Key takeaway",
    ctx.keyTake,
    "",
    "## User profile",
    profileBlock,
    "",
    "## Your task",
    "Identify the minimum set of questions the user must answer to unblock the next discovery attempt.",
    "Apply every rule from your system prompt before outputting.",
    "Return an empty `questions` array if the context already contains enough signal to proceed.",
  ].join("\n");
}

const presets: Record<QuestionMode, QuestionerPreset> = {
  discovery: {
    systemPrompt: DISCOVERY_SYSTEM_PROMPT,
    buildPrompt: (context: unknown) =>
      buildDiscoveryPrompt(context as Parameters<typeof buildDiscoveryPrompt>[0]),
  },
  intent: {
    systemPrompt: INTENT_SYSTEM_PROMPT,
    buildPrompt: (context: unknown) => buildIntentPrompt(context as IntentContext),
  },
  profile: {
    systemPrompt: PROFILE_SYSTEM_PROMPT,
    buildPrompt: (context: unknown) => buildProfilePrompt(context as ProfileContext),
  },
  negotiation: {
    systemPrompt: NEGOTIATION_SYSTEM_PROMPT,
    buildPrompt: (context: unknown) => buildNegotiationPrompt(context as NegotiationContext),
  },
};

/**
 * Retrieve the preset for the given mode.
 * @param mode - The question mode to look up.
 * @returns The matching preset with systemPrompt and buildPrompt.
 * @throws Error if the mode's preset is not yet implemented.
 */
export function getPreset(mode: QuestionMode): QuestionerPreset {
  const preset = presets[mode];
  if (!preset) {
    throw new Error(`QuestionerAgent preset "${mode}" is not implemented yet`);
  }
  return preset;
}
