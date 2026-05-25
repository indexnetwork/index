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

import type { IntentContext } from "./questioner.types.js";

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

const presets: Partial<Record<QuestionMode, QuestionerPreset>> = {
  discovery: {
    systemPrompt: DISCOVERY_SYSTEM_PROMPT,
    buildPrompt: (context: unknown) =>
      buildDiscoveryPrompt(context as Parameters<typeof buildDiscoveryPrompt>[0]),
  },
  intent: {
    systemPrompt: INTENT_SYSTEM_PROMPT,
    buildPrompt: (context: unknown) => buildIntentPrompt(context as IntentContext),
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
