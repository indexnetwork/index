/**
 * The opportunity presentation cluster.
 *
 * One file for the whole path from a persisted opportunity to the copy a user
 * reads: the cache-key builders and the LLM presenter itself. All user-facing
 * copy comes from the presenter; there is no deterministic fallback.
 *
 * Sections, in dependency order:
 *   1. Presentation cache keys
 *   2. OpportunityPresenter (LLM card and chat copy)
 */

import type { Runnable } from "@langchain/core/runnables";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { Timed } from "../shared/observability/performance.js";
import { createStructuredModel } from "../shared/agent/model.config.js";
import type { Opportunity } from "../../platform/database.js";
import type { CompositeDatabase } from "../../platform/database.js";
import type { NegotiationContext } from "./negotiation-context.loader.js";

export interface UserInfo {
  id: string;
  name: string;
  avatar: string | null;
}


// ──────────────────────────────────────────────────────────────────────
// ── 1. Presentation cache keys ──
// ──────────────────────────────────────────────────────────────────────

/** Cache namespace for opportunity presentation copy. Bump to invalidate copy safety changes. */
export const OPPORTUNITY_PRESENTATION_CACHE_VERSION = "v2";

export function buildOpportunityCardCacheKey(
  opportunityId: string,
  viewerId: string,
  focusedViewerIntentId?: string,
): string {
  const scope = focusedViewerIntentId ? `:intent:${focusedViewerIntentId}` : "";
  return `card:${opportunityId}:${viewerId}${scope}`;
}

export function buildApiChatCardPresentationCacheKey(
  opportunityId: string,
  viewerId: string,
): string {
  return `chat:${OPPORTUNITY_PRESENTATION_CACHE_VERSION}:card:${opportunityId}:${viewerId}`;
}


// ──────────────────────────────────────────────────────────────────────
// ── 2. OpportunityPresenter ──
// ──────────────────────────────────────────────────────────────────────

/**
 * Opportunity Presenter Agent
 *
 * Generates personalized, second-person explanations of why an opportunity
 * matters to the viewing user. Uses full opportunity data (interpretation,
 * actors, profiles, intents, network) to produce headline, personalizedSummary,
 * and suggestedAction for user-facing surfaces.
 */

/**
 * Minimal database interface required by gatherPresenterContext.
 * Any database adapter that implements these three methods can be passed.
 */
export type PresenterDatabase = Pick<
  CompositeDatabase,
  "getProfile" | "getActiveIntents" | "getNetwork"
>;

const LLM_TIMEOUT_MS = 20_000;


const GREETING_DESCRIPTION =
  "A 2-4 sentence first-person message the viewer could send to the counterpart, in the viewer's voice, referencing what they have in common. Plain prose only — no markdown, no greeting prefix like 'Hey {Name},'. Example body: 'Saw we're both working on regenerative coordination tooling — your post on consent flows resonated. Would love to compare notes if you have time this week.'";

// ──────────────────────────────────────────────────────────────
// SCHEMA & TYPES
// ──────────────────────────────────────────────────────────────

const PresentationSchema = z.object({
  headline: z
    .string()
    .describe(
      "Short, compelling headline for this opportunity (e.g., 'A React expert who needs your design skills')",
    ),
  personalizedSummary: z
    .string()
    .describe(
      "2-3 sentence explanation using 'you' language, explaining why this opportunity is specifically valuable for the viewer based on their intents and profile",
    ),
  suggestedAction: z.string().describe("Brief suggested next step"),
  greeting: z.string().max(500).describe(GREETING_DESCRIPTION),
});

const responseFormat = z.object({
  presentation: PresentationSchema,
});

export type OpportunityPresentationResult = z.infer<typeof PresentationSchema>;

/** Input for card presenter call; extends PresenterInput with optional mutual intent count. */
export interface CardPresenterInput extends PresenterInput {
  /** Number of overlapping intents (for generating mutualIntentsLabel). */
  mutualIntentCount?: number;
  /**
   * Snapshot of the opportunity's negotiation, if one exists. When status is
   * `negotiating`, the presenter returns a templated chip without invoking
   * the LLM. For `pending`/`accepted`/`rejected`, the full
   * transcript and outcome ground the LLM's explanation.
   */
  negotiationContext?: NegotiationContext;
}

/** LLM-generated fields for card presentation (buttons are hardcoded by callers, not LLM-generated). */
export const CardLLMSchema = z.object({
  headline: z
    .string()
    .describe("Short, compelling headline for this opportunity"),
  personalizedSummary: z
    .string()
    .describe(
      "2-3 sentence explanation in 'you' language for the main card body",
    ),
  suggestedAction: z
    .string()
    .describe("Brief suggested next step (e.g. CTA line)"),
  narratorRemark: z
    .string()
    .max(80)
    .describe(
      "One short sentence for the narrator chip, max ~80 chars (e.g. who is suggesting and why)",
    ),
  mutualIntentsLabel: z
    .string()
    .max(48)
    .describe(
      "Short line for the subtitle under the other party name (e.g. '3 mutual intents', 'Shared interests', 'Aligned goals'). NEVER output '0 mutual intents' — use a qualitative phrase like 'Shared interests' when no numeric count is available.",
    ),
  greeting: z.string().max(500).describe(GREETING_DESCRIPTION),
});

/** LLM-generated result from presentCard (callers append button labels from opportunity.constants). */
export type CardLLMResult = z.infer<typeof CardLLMSchema>;

/** Full card display contract including hardcoded button labels (assembled by callers). */
export type CardPresentationResult = CardLLMResult & {
  primaryActionLabel: string;
  secondaryActionLabel: string;
};

const homeCardResponseFormat = z.object({
  presentation: CardLLMSchema,
});

/** Input for a single presenter call (all context pre-assembled). */
export interface PresenterInput {
  viewerContext: string;
  otherPartyContext: string;
  matchReasoning: string;
  category: string;
  confidence: number;
  signalsSummary: string;
  networkName: string;
  viewerRole: string;
  opportunityStatus?: string;
}

// ──────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

const systemPrompt = `
You are an expert at presenting connection opportunities to users in a way that feels personal and compelling.

Your goal: Given raw context about the viewer (their profile, intents), the other person(s), and why the system matched them, produce a short headline, a personalized summary, and a suggested action.

Rules:
1. Address the VIEWER directly using "you" and "your". This is for them.
2. Be concise and compelling — not analytical or third-party. No "The source user" or "The candidate"; use names or "they" where needed.
3. Do not leak private or confidential details. Use only the context provided.
4. Vary user-facing nouns naturally. Do not repeatedly use the same label in one response.
5. If possible, avoid repeating "opportunity" in both headline and summary. Prefer alternatives like "connection", "thought partner", "mutual fit", "valuable conversation", or "peer".
6. Prefer first names in user-facing copy. Do not repeatedly use full names unless needed to disambiguate.
7. Network assignment, network title/type, and network/event metadata are retrieval context only. They are NEVER proof that a person attended or will attend, belongs to a group, resides in a place, knows anyone from the network, or shared a session, time, place, or location with anyone. Do not make co-attendance, membership, residence, shared-session, or same-place/same-time claims from network co-membership.
8. Match reasoning may describe the viewer in third person; always write from the viewer's perspective.
9. Never output internal IDs.


**Role-Specific Presentation:**


**If viewer is "patient" or "party":**
- Reference their specific intents, skills, or interests that align with this opportunity.
- If this is an introduction: mention who introduced them and frame it as a personal recommendation.
- Headline: one short line that hooks (e.g., "[Name] thinks you should meet [Other]" or "A React expert who needs your design skills").
- Personalized summary: 2-3 sentences. Why is this opportunity for *them*? If introduced, lead with the introduction.
- Suggested action: encourage action ("Send a message to start the conversation" or "Share this intro").

**If viewer is "agent":**
- They are seeing this because someone already reached out.
- If this is an introduction: mention who made the introduction.
- Reference their skills/expertise that make them a match.
- Headline: what the other person needs that they can provide.
- Personalized summary: 2-3 sentences. Why someone reached out to them.
- Suggested action: "Someone is interested in connecting — check their message" or "Review and respond".

**If viewer is "peer":**
- Mutual opportunity. Reference shared or complementary interests.
- If this is an introduction: mention who connected them.
- Headline: the mutual connection angle.
- Personalized summary: 2-3 sentences. Why this is mutually valuable.
- Suggested action: "Send an intro to connect" or "Start a conversation".
`;

const homeCardSystemPrompt = `
You are an expert at presenting connection opportunities for an opportunity card.

Given context about the viewer, the other person, and why they were matched, produce:
1. headline: one short hook line.
2. personalizedSummary: 2-3 sentences in "you" language (main body text).
3. suggestedAction: one brief suggested next step.
4. narratorRemark: one short sentence for the narrator chip (who is suggesting and why; max ~80 chars).
5. greeting: a 2-4 sentence first-person message the viewer could send to the counterpart. Plain prose, no greeting prefix, no markdown.
7. mutualIntentsLabel: short subtitle under the other party's name. Examples: "3 mutual intents", "Shared interests", "Aligned goals" — keep it brief. NEVER output "0 mutual intents" or any zero-count label; use a qualitative phrase instead.

Rules:
- Address the viewer with "you"/"your". Be concise and compelling.
- narratorRemark should feel like a single sentence from the narrator (Index or a person), not meta-commentary.
- narratorRemark is displayed with the narrator name prepended (e.g. "Index: …" or "Alice: …"). Do NOT start narratorRemark with the narrator's name or repeat it; write only the remark (e.g. "Based on your overlapping intents" or "introduced you two, sensing a valuable connection").
- Vary wording for the match itself. Do not repeat "opportunity" across headline, summary, and narratorRemark when alternatives fit.
- Prefer first names in user-facing copy. Avoid repeated full names unless disambiguation is necessary.
- Network assignment, network title/type, and network/event metadata are retrieval context only. They are NEVER proof that a person attended or will attend, belongs to a group, resides in a place, knows anyone from the network, or shared a session, time, place, or location with anyone. Do not make co-attendance, membership, residence, shared-session, or same-place/same-time claims from network co-membership.
- Match reasoning may describe the viewer in third person; always write from the viewer's perspective.
- Never output internal IDs.
- If you cannot fit every detail, choose one clear reason and stop. Do not rely on downstream truncation.

**Negotiation-grounded explanations (ONLY when NEGOTIATION CONTEXT is provided):**
When NEGOTIATION CONTEXT is provided, this opportunity passed through an agent-to-agent negotiation. Use the transcript to ground your explanation in the concrete reasoning the agents exchanged.
- Personalize the summary with *why* the negotiation produced this match — reference the roles the agents agreed on, the specific concerns raised, and how they were resolved.
- For status "accepted": the agents agreed; the card should confidently explain *why* they agreed.
- For status "rejected": the agents declined. The card should explain the reason briefly so the user understands — not dwell on it.
- Do NOT invent turn content. Only reference what is in the NEGOTIATION CONTEXT block.

`;

// ──────────────────────────────────────────────────────────────
// CLASS
// ──────────────────────────────────────────────────────────────

export class OpportunityPresenter {
  private model: Runnable;
  private homeCardModel: Runnable;

  constructor() {
    this.model = createStructuredModel("opportunityPresenter", responseFormat, {
      name: "opportunity_presenter",
    });
    this.homeCardModel = createStructuredModel("opportunityPresenter", homeCardResponseFormat, {
      name: "opportunity_presenter_home_card",
    });
  }

  private async invokeWithTimeout(
    targetModel: Runnable,
    messages: (SystemMessage | HumanMessage)[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeoutReason = `LLM invoke timed out after ${LLM_TIMEOUT_MS}ms`;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const invokePromise = targetModel.invoke(messages, { signal: combinedSignal });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort(timeoutReason);
        reject(new Error(timeoutReason));
      }, LLM_TIMEOUT_MS);
    });

    try {
      return await Promise.race([invokePromise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Generate personalized presentation for a single opportunity.
   *
   * @param input - Pre-assembled presenter context.
   * @param options - Optional abort signal.
   * @returns The LLM-generated presentation.
   * @throws When the LLM call fails, times out, or returns invalid output.
   */
  @Timed()
  public async present(
    input: PresenterInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<OpportunityPresentationResult> {
    const humanContent = `
VIEWER (the person seeing this opportunity):
${input.viewerContext}

OTHER PARTY:
${input.otherPartyContext}

MATCH CONTEXT:
- Category: ${input.category}
- Confidence: ${input.confidence}
- Why we matched: ${input.matchReasoning}
- Signals: ${input.signalsSummary}
COMMUNITY: ${input.networkName}
Viewer's role in this opportunity: ${input.viewerRole}

Produce headline, personalizedSummary (2-3 sentences in "you" language), suggestedAction, and greeting.
`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(humanContent),
    ];
    const result = await this.invokeWithTimeout(this.model, messages, options.signal);
    return responseFormat.parse(result).presentation;
  }

  /**
   * Generate LLM-powered card content (headline, body, narrator remark, mutual-intent label).
   * Callers append button labels from opportunity.constants.
   *
   * When `negotiationContext.status === 'negotiating'`, returns a templated
   * chip synchronously without invoking the LLM — the card just reflects
   * "negotiation in progress" at that point.
   *
   * @param input - Pre-assembled card presenter context.
   * @returns The LLM-generated card copy.
   * @throws When the LLM call fails, times out, or returns invalid output.
   */
  @Timed()
  public async presentCard(
    input: CardPresenterInput,
  ): Promise<CardLLMResult> {
    if (input.negotiationContext?.status === 'negotiating') {
      return buildNegotiatingChip(input);
    }

    const mutualHint =
      input.mutualIntentCount != null && input.mutualIntentCount > 0
        ? `There are ${input.mutualIntentCount} overlapping intent(s) between viewer and other party.`
        : "Match is based on profile and intent alignment. Do not cite a numeric intent count.";
    const negotiationBlock = buildNegotiationPromptBlock(input.negotiationContext);
    // When negotiation context exists, lead with it — these cards exist
    // *because* the negotiation happened. Trailing the block lets weaker
    // models lean on surface signals and ignore the transcript entirely.
    const negotiationDirective = negotiationBlock
      ? `\nIMPORTANT: This opportunity surfaced because the agents negotiated and converged. Your personalizedSummary MUST reference at least one specific signal from the NEGOTIATION CONTEXT block below — what concern was raised, what was confirmed, what the agents agreed on. It must communicate *why this specific match* surfaced now (the negotiation that led to it), not a generic skill-complementarity line. Do not produce the generic summary every card looked like before this negotiation happened.\n`
      : "";
    const humanContent = `
${negotiationBlock}${negotiationDirective}
VIEWER (the person seeing this opportunity):
${input.viewerContext}

OTHER PARTY:
${input.otherPartyContext}

MATCH CONTEXT:
- Category: ${input.category}
- Confidence: ${input.confidence}
- Why we matched: ${input.matchReasoning}
- Signals: ${input.signalsSummary}
- ${mutualHint}
COMMUNITY: ${input.networkName}
Viewer's role in this opportunity: ${input.viewerRole}
Opportunity status: ${input.opportunityStatus ?? "pending"}

Produce headline, personalizedSummary, suggestedAction, narratorRemark, greeting, and mutualIntentsLabel.
`;

    const messages = [
      new SystemMessage(homeCardSystemPrompt),
      new HumanMessage(humanContent),
    ];
    const result = await this.invokeWithTimeout(this.homeCardModel, messages);
    return homeCardResponseFormat.parse(result).presentation;
  }

  /**
   * Process multiple opportunities in parallel with bounded concurrency.
   */
  @Timed()
  public async presentBatch(
    inputs: PresenterInput[],
    options?: { concurrency?: number },
  ): Promise<OpportunityPresentationResult[]> {
    const concurrency = options?.concurrency ?? 5;
    const results: OpportunityPresentationResult[] = [];
    for (let i = 0; i < inputs.length; i += concurrency) {
      const chunk = inputs.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map((inp) => this.present(inp)),
      );
      results.push(...chunkResults);
    }
    return results;
  }

  /**
   * Process multiple opportunities as cards in parallel with bounded concurrency.
   * Returns full card display contracts (headline, body, narrator remark, action labels, mutual-intent label).
   */
  @Timed()
  public async presentCardBatch(
    inputs: CardPresenterInput[],
    options?: { concurrency?: number },
  ): Promise<CardLLMResult[]> {
    const concurrency = options?.concurrency ?? 5;
    const results: CardLLMResult[] = [];
    for (let i = 0; i < inputs.length; i += concurrency) {
      const chunk = inputs.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map((inp) => this.presentCard(inp)),
      );
      results.push(...chunkResults);
    }
    return results;
  }
}

// ──────────────────────────────────────────────────────────────
// NEGOTIATION CONTEXT HELPERS
// ──────────────────────────────────────────────────────────────

/**
 * Builds a "NEGOTIATION CONTEXT:" block for the card prompt. Returns an
 * empty string when the opportunity has no meaningful negotiation context
 * (draft/latent) or when the opportunity is still negotiating (handled via
 * the templated chip, not the LLM).
 */
function buildNegotiationPromptBlock(context: NegotiationContext | undefined): string {
  if (!context || context.status === 'negotiating') return "";

  const outcomeLabel = context.outcome === 'agreed'
    ? "the agents agreed"
    : context.outcome === 'declined'
      ? "one agent declined"
      : context.outcome === 'closed'
        ? "the negotiation was closed before it settled"
        : undefined;

  const turnLines = context.turns.map((turn, index) =>
    `Turn ${index + 1} (${turn.action}, ${turn.own ? "your agent" : "their agent"}): "${turn.message}"`);

  return `
NEGOTIATION CONTEXT:
- Negotiation status: ${context.status}${outcomeLabel ? ` (${outcomeLabel})` : ""}
- Turns exchanged: ${context.turnCount}
- Transcript:
${turnLines.length > 0 ? turnLines.map((l) => `  ${l}`).join("\n") : "  (no turns recorded)"}
`;
}

/**
 * Builds a templated card result for an opportunity whose negotiation
 * is still in progress. Bypasses the LLM so users see a stable "currently
 * negotiating" chip while turns are still being exchanged.
 */
function buildNegotiatingChip(input: CardPresenterInput): CardLLMResult {
  const turnCount = input.negotiationContext?.turnCount ?? 0;
  const narratorRemark = `Currently negotiating · turn ${turnCount}`;

  return {
    headline: "Negotiation in progress",
    personalizedSummary: "Your agent is still talking with theirs to see if this connection makes sense. We'll surface the full match as soon as they converge.",
    suggestedAction: "Check back shortly — no action needed yet.",
    narratorRemark,
    mutualIntentsLabel: input.mutualIntentCount && input.mutualIntentCount > 0
      ? `${input.mutualIntentCount} mutual intent${input.mutualIntentCount !== 1 ? "s" : ""}`
      : "Shared interests",
    greeting: "",
  };
}

// ──────────────────────────────────────────────────────────────
// CONTEXT GATHERER
// ──────────────────────────────────────────────────────────────

/**
 * Build the LLM-facing signal summary while excluding pool adjustments. Pool
 * disposition is rendered deterministically by the card chip; asking the
 * presenter to interpret it could turn a demotion into a positive rationale.
 */
export function summarizeSignalsForPresenter(
  signals: Opportunity['interpretation']['signals'],
): string {
  const safeSignals = signals?.filter((signal) => signal.type !== 'pool_discriminator') ?? [];
  if (safeSignals.length === 0) return 'Match based on profile and intent alignment.';
  return safeSignals.map((signal) => `${signal.type}: ${signal.detail ?? signal.type}`).join('; ');
}

/**
 * Gather all context needed for the presenter from the database.
 * Fetches viewer profile, viewer intents, other party profile(s), and network in parallel.
 *
 * @param displayCounterpartUserId - When set (e.g. for an opportunity card), only this counterpart is included in otherPartyContext so the presenter writes about the person on the card.
 * @param focusedViewerIntentId - When set, include only that active intent in viewer context.
 */
export async function gatherPresenterContext(
  database: PresenterDatabase,
  opportunity: Opportunity,
  viewerId: string,
  displayCounterpartUserId?: string,
  focusedViewerIntentId?: string,
): Promise<PresenterInput> {
  const myActor = opportunity.actors.find((a) => a.userId === viewerId);
  if (!myActor) {
    throw new Error("Viewer is not an actor in this opportunity");
  }

  const otherActors = opportunity.actors.filter((a) => a.userId !== viewerId);
  let otherPartyIds = [...new Set(otherActors.map((a) => a.userId))];
  if (displayCounterpartUserId && otherPartyIds.includes(displayCounterpartUserId)) {
    otherPartyIds = [displayCounterpartUserId];
  }

  const contextNetworkId = opportunity.context?.networkId;

  // Viewer's profile + intents, plus the other party's profile.
  const [viewerProfile, networkRecord, ...otherProfiles] = await Promise.all([
    database.getProfile(viewerId),
    contextNetworkId ? database.getNetwork(contextNetworkId) : Promise.resolve(null),
    ...otherPartyIds.map((uid) => database.getProfile(uid)),
  ]);

  let viewerIntents:
    | Awaited<ReturnType<typeof database.getActiveIntents>>
    | undefined;

  viewerIntents = await database.getActiveIntents(viewerId);
  if (focusedViewerIntentId) {
    viewerIntents = viewerIntents.filter((intent) => intent.id === focusedViewerIntentId);
  }

  let viewerContext: string;
  let otherPartyContext: string;

  {
    const viewerContextLines = [
      "Profile:",
      `Name: ${viewerProfile?.identity?.name ?? "Unknown"}`,
      `Bio: ${viewerProfile?.identity?.bio ?? ""}`,
      `Location: ${viewerProfile?.identity?.location ?? ""}`,
      `Context: ${viewerProfile?.context ?? ""}`,
      "Active intents:",
      ...(viewerIntents?.length
        ? viewerIntents.map(
            (i) => `- ${i.payload}${i.summary ? ` (${i.summary})` : ""}`,
          )
        : ["(none listed)"]),
    ];
    viewerContext = viewerContextLines.join("\n");

    const otherParts = otherPartyIds.map((uid, idx) => {
      const profile = otherProfiles[idx] as Awaited<
        ReturnType<typeof database.getProfile>
      >;
      const name = profile?.identity?.name ?? "Unknown";
      const bio = profile?.identity?.bio ?? "";
      return `${name}: ${bio}`;
    });
    otherPartyContext =
      otherParts.join("\n\n") || "Other party (details not available).";
  }

  const interp = opportunity.interpretation;

  const result: PresenterInput = {
    viewerContext,
    otherPartyContext,
    matchReasoning: interp.reasoning,
    category: interp.category ?? "connection",
    confidence:
      typeof interp.confidence === "number"
        ? interp.confidence
        : parseFloat(String(interp.confidence ?? 0)) || 0,
    signalsSummary: summarizeSignalsForPresenter(interp.signals),
    networkName: networkRecord?.title ?? contextNetworkId ?? "",
    viewerRole: myActor.role ?? "party",
  };

  return result;
}
