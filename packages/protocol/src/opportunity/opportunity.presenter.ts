/**
 * Opportunity Presenter Agent
 *
 * Generates personalized, second-person explanations of why an opportunity
 * matters to the viewing user. Uses full opportunity data (interpretation,
 * actors, profiles, intents, index) to produce headline, personalizedSummary,
 * and suggestedAction for chat tools and user-facing surfaces.
 */

import type { Runnable } from "@langchain/core/runnables";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { Timed } from "../shared/observability/performance.js";

import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { createModel } from "../shared/agent/model.config.js";
import { viewerCentricCardSummary } from "./opportunity.presentation.js";
import type { Opportunity } from "../shared/interfaces/database.interface.js";
import type { ChatGraphCompositeDatabase } from "../shared/interfaces/database.interface.js";
import type { NegotiationContext } from "./negotiation-context.loader.js";
import { stripUuids, stripIntroducerMentions } from "./opportunity.presentation.js";

/**
 * Minimal database interface required by gatherPresenterContext.
 * Any database adapter that implements these three methods can be passed.
 */
export type PresenterDatabase = Pick<
  ChatGraphCompositeDatabase,
  "getProfile" | "getActiveIntents" | "getNetwork" | "getPremisesForUser"
>;

const logger = protocolLogger("OpportunityPresenter");
const LLM_TIMEOUT_MS = 20_000;

const model = createModel("opportunityPresenter");

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

/** Input for home-card presenter call; extends PresenterInput with optional mutual intent count. */
export interface HomeCardPresenterInput extends PresenterInput {
  /** Number of overlapping intents (for generating mutualIntentsLabel). */
  mutualIntentCount?: number;
  /**
   * Snapshot of the opportunity's negotiation, if one exists. When status is
   * `negotiating`, the presenter returns a templated chip without invoking
   * the LLM. For `pending`/`stalled`/`accepted`/`rejected`, the full
   * transcript and outcome ground the LLM's explanation.
   */
  negotiationContext?: NegotiationContext;
}

/** LLM-generated fields for home-card presentation (buttons are hardcoded by callers, not LLM-generated). */
export const HomeCardLLMSchema = z.object({
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

/** LLM-generated result from presentHomeCard (callers append button labels from opportunity.constants). */
export type HomeCardLLMResult = z.infer<typeof HomeCardLLMSchema>;

/** Full home-card display contract including hardcoded button labels (assembled by callers). */
export type HomeCardPresentationResult = HomeCardLLMResult & {
  primaryActionLabel: string;
  secondaryActionLabel: string;
};

const homeCardResponseFormat = z.object({
  presentation: HomeCardLLMSchema,
});

/** Input for a single presenter call (all context pre-assembled). */
export interface PresenterInput {
  viewerContext: string;
  otherPartyContext: string;
  matchReasoning: string;
  category: string;
  confidence: number;
  signalsSummary: string;
  indexName: string;
  viewerRole: string;
  opportunityStatus?: string;
  /** True when this opportunity was created via an explicit introduction (not automatic discovery). */
  isIntroduction?: boolean;
  /** Name of the person who made the introduction, if applicable. */
  introducerName?: string;
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

**Introduction-originated opportunities:**
When INTRODUCTION CONTEXT is provided, this opportunity was explicitly created by an introducer (a real person who saw value in this connection). This is NOT an automatic system discovery — someone made a deliberate judgment.
- For ALL roles: acknowledge the introducer's role naturally. E.g., "[Introducer name] thinks you should meet [other person]" or "[Introducer name] connected you because..."
- The introduction itself is a strong signal — treat it with the weight of a personal recommendation.
- If the parties' intents don't obviously overlap, that's fine — the introducer saw something worth connecting. Focus on what the introducer likely saw.

**Role-Specific Presentation:**

**If viewer is "introducer":**
- The viewer suggested this connection between two (or more) OTHER people. The opportunity is NOT about the viewer's own needs.
- Headline: describe the connection between the parties (e.g., "Connecting a React expert with a startup founder").
- Personalized summary: explain why the people YOU are introducing should meet. Reference THEIR profiles and intents, not yours. Frame it as "you're connecting X and Y because..." rather than "this matches your intent".
- Suggested action: guide sharing (e.g., "Share this with [name] to get things started").
- CRITICAL: Do NOT reference the introducer's own intents, skills, or needs. The introducer is the matchmaker, not a party.

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
You are an expert at presenting connection opportunities for a home feed card.

Given context about the viewer, the other person, and why they were matched, produce:
1. headline: one short hook line.
2. personalizedSummary: 2-3 sentences in "you" language (main body text).
3. suggestedAction: one brief suggested next step.
4. narratorRemark: one short sentence for the narrator chip (who is suggesting and why; max ~80 chars).
5. greeting: a 2-4 sentence first-person message the viewer could send to the counterpart. Plain prose, no greeting prefix, no markdown.
6. mutualIntentsLabel: short subtitle under the other party's name. Examples: "3 mutual intents", "Shared interests", "Aligned goals" — keep it brief. NEVER output "0 mutual intents" or any zero-count label; use a qualitative phrase instead.

Rules:
- Address the viewer with "you"/"your". Be concise and compelling.
- narratorRemark should feel like a single sentence from the narrator (Index or a person), not meta-commentary.
- narratorRemark is displayed with the narrator name prepended (e.g. "Index: …" or "Alice: …"). Do NOT start narratorRemark with the narrator's name or repeat it; write only the remark (e.g. "Based on your overlapping intents" or "introduced you two, sensing a valuable connection").
- Vary wording for the match itself. Do not repeat "opportunity" across headline, summary, and narratorRemark when alternatives fit.
- Prefer first names in user-facing copy. Avoid repeated full names unless disambiguation is necessary.

**Introduction-originated opportunities (ONLY when INTRODUCTION CONTEXT is provided):**
When INTRODUCTION CONTEXT is provided, this opportunity was explicitly created by an introducer. It was NOT automatically discovered.
- For parties/patients/agents/peers viewing an introduction: keep the introducer signal in narratorRemark (and narrator chip), not in personalizedSummary.
- For these introduced parties, personalizedSummary must focus ONLY on fit/value between viewer and counterpart. Do NOT mention the introducer there.
- narratorRemark should carry the introduction signal (e.g., "saw strong alignment between you two" or "thought this connection could be valuable"), without repeating the narrator name at the start.
- This is a personal recommendation, not an algorithm match. Frame it accordingly.

**CRITICAL: NEVER include introducer names in personalizedSummary. Examples:**
❌ WRONG: "Seref introduced you to Lucy, who is actively seeking a product co-founder..."
✅ CORRECT: "Lucy is actively seeking a product co-founder for a niche APAC marketplace. With your expertise in UX and AI, this could be an ideal collaboration."

❌ WRONG: "Bob thinks you should meet Alice because your React skills align with her needs."
✅ CORRECT: "Alice is building a React-based platform and needs frontend expertise. Your experience with component architecture makes you a strong fit."

❌ WRONG: "Jane connected you to Mark, who is looking for a designer."
✅ CORRECT: "Mark is building a consumer app and needs design expertise. Your background in user-centered design aligns well with what he's building."

Remember: The introducer's name goes ONLY in narratorRemark, NEVER in personalizedSummary.

**When INTRODUCTION CONTEXT is NOT provided (system-discovered match):**
- Do NOT use introducer-style wording. Do NOT say "you suggested", "this is an introduction you suggested", or "you suggested this connection". The system found this match; no human introducer was involved.
- Instead, narratorRemark should describe why the match is relevant (e.g. "Based on your overlapping intents", "Your skills align with what they need").

**Negotiation-grounded explanations (ONLY when NEGOTIATION CONTEXT is provided):**
When NEGOTIATION CONTEXT is provided, this opportunity passed through an agent-to-agent negotiation. Use the transcript to ground your explanation in the concrete reasoning the agents exchanged.
- Personalize the summary with *why* the negotiation produced this match — reference the roles the agents agreed on, the specific concerns raised, and how they were resolved.
- For status "stalled" with reason "turn_cap": the agents hit the turn limit without reaching agreement. Frame the card as a hedged possibility rather than a confident match; narratorRemark should signal "agents couldn't fully converge" without sounding negative.
- For status "stalled" with reason "timeout": one side went silent. Suggest the user re-engage if interested.
- For status "accepted": the agents agreed; the card should confidently explain *why* they agreed.
- For status "rejected": the agents declined. The card should explain the reason briefly so the user understands — not dwell on it.
- Do NOT invent turn content. Only reference what is in the NEGOTIATION CONTEXT block.

- Exception for connector/introducer: if viewer role is "introducer" (any status), this is a curation/connector card. Use:
  - suggestedAction: one short line about sharing the intro or confirming the match.
  - mutualIntentsLabel: a short connector label (e.g. "Connector match", "You can bridge this").
  - headline: describe the connection between the parties (e.g., "Connecting a PhD researcher with a translator"). Do NOT reference the introducer's own needs.
  - personalizedSummary: explain why the parties you're introducing should meet, referencing THEIR profiles and intents, not yours.

**CRITICAL for latent introducer cards (opportunity status is "latent"):**
When the viewer is the introducer and the opportunity status is "latent", the introducer has NOT yet approved this match. They are evaluating whether to make the introduction.
- narratorRemark MUST use evaluation/curation language (e.g. "Could be a strong match", "Worth introducing?", "Interesting overlap here").
- Do NOT say "you suggested", "you introduced", "you connected", or any past-tense language implying the introduction was already made.
- suggestedAction should encourage evaluation (e.g. "Approve if you see the fit").
- Exception for new-connection reveal: if viewer role is "agent", status is "accepted", and there is an introducer, this is the agent's first time seeing this opportunity. Use:
  - suggestedAction: a short line about joining the conversation.
`;

// ──────────────────────────────────────────────────────────────
// CLASS
// ──────────────────────────────────────────────────────────────

export class OpportunityPresenter {
  private model: Runnable;
  private homeCardModel: Runnable;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "opportunity_presenter",
    });
    this.homeCardModel = model.withStructuredOutput(homeCardResponseFormat, {
      name: "opportunity_presenter_home_card",
    });
  }

  private async invokeWithTimeout(
    targetModel: Runnable,
    messages: (SystemMessage | HumanMessage)[],
  ): Promise<unknown> {
    const timeoutReason = `LLM invoke timed out after ${LLM_TIMEOUT_MS}ms`;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const invokePromise = targetModel.invoke(messages, {
      signal: controller.signal,
    });

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
   */
  @Timed()
  public async present(
    input: PresenterInput,
  ): Promise<OpportunityPresentationResult> {
    const introContext = input.isIntroduction
      ? `\nINTRODUCTION CONTEXT: This opportunity was created by an explicit introduction from ${input.introducerName ?? "someone in the community"}. It was NOT discovered automatically — a real person made this connection.\n`
      : "";
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
${introContext}
COMMUNITY: ${input.indexName}
Viewer's role in this opportunity: ${input.viewerRole}

Produce headline, personalizedSummary (2-3 sentences in "you" language), suggestedAction, and greeting.
`;

    try {
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(humanContent),
      ];
      const result = await this.invokeWithTimeout(this.model, messages);
      const parsed = responseFormat.parse(result);
      parsed.presentation.personalizedSummary = stripUuids(parsed.presentation.personalizedSummary);
      return parsed.presentation;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const timeoutReason = message.includes("timed out") ? message : undefined;
      logger.warn(
        "[OpportunityPresenter.present] LLM failed, returning fallback",
        {
          message,
          timeoutReason,
        },
      );
      return {
        headline: "A promising connection",
        personalizedSummary: stripUuids(input.matchReasoning.slice(0, 300)),
        suggestedAction: "Take a look and decide whether to reach out.",
        greeting: "",
      };
    }
  }

  /**
   * Generate LLM-powered home-card content (headline, body, narrator remark, mutual-intent label).
   * Callers append button labels from opportunity.constants.
   *
   * When `negotiationContext.status === 'negotiating'`, returns a templated
   * chip synchronously without invoking the LLM — the card just reflects
   * "negotiation in progress" at that point.
   */
  @Timed()
  public async presentHomeCard(
    input: HomeCardPresenterInput,
  ): Promise<HomeCardLLMResult> {
    if (input.negotiationContext?.status === 'negotiating') {
      return buildNegotiatingChip(input);
    }

    const mutualHint =
      input.mutualIntentCount != null && input.mutualIntentCount > 0
        ? `There are ${input.mutualIntentCount} overlapping intent(s) between viewer and other party.`
        : "Match is based on profile and intent alignment. Do not cite a numeric intent count.";
    const introContext = input.isIntroduction
      ? `\nINTRODUCTION CONTEXT: This opportunity was created by an explicit introduction from ${input.introducerName ?? "someone in the community"}. It was NOT discovered automatically — a real person made this connection.\n`
      : "";
    const negotiationBlock = buildNegotiationPromptBlock(input.negotiationContext);
    // When negotiation context exists, lead with it — these cards exist
    // *because* the negotiation happened. Trailing the block lets weaker
    // models lean on surface signals and ignore the transcript entirely.
    const negotiationDirective = negotiationBlock
      ? `\nIMPORTANT: This opportunity surfaced because the agents negotiated and converged. Your personalizedSummary MUST reference at least one specific signal from the NEGOTIATION CONTEXT block below — what concern was raised, what was confirmed, what the agents agreed on. Do not produce a generic skill-complementarity summary; that's what every card looked like before this negotiation happened. Use the transcript to explain *why this specific match* surfaced now.\n`
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
${introContext}
COMMUNITY: ${input.indexName}
Viewer's role in this opportunity: ${input.viewerRole}
Opportunity status: ${input.opportunityStatus ?? "pending"}

Produce headline, personalizedSummary, suggestedAction, narratorRemark, greeting, and mutualIntentsLabel.
`;

    const isIntroducer = input.viewerRole === "introducer";

    try {
      const messages = [
        new SystemMessage(homeCardSystemPrompt),
        new HumanMessage(humanContent),
      ];
      const result = await this.invokeWithTimeout(this.homeCardModel, messages);
      const parsed = homeCardResponseFormat.parse(result);
      parsed.presentation.personalizedSummary = stripUuids(parsed.presentation.personalizedSummary);
      parsed.presentation.narratorRemark = stripUuids(parsed.presentation.narratorRemark);
      if (/^0\s+(mutual|overlapping)\s+intent/i.test(parsed.presentation.mutualIntentsLabel)) {
        parsed.presentation.mutualIntentsLabel = "Shared interests";
      }
      if (input.isIntroduction && input.introducerName) {
        parsed.presentation.personalizedSummary = stripIntroducerMentions(
          parsed.presentation.personalizedSummary,
          input.introducerName,
        );
      }
      return parsed.presentation;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const timeoutReason = message.includes("timed out") ? message : undefined;
      logger.warn(
        "[OpportunityPresenter.presentHomeCard] LLM failed, returning fallback",
        {
          message,
          timeoutReason,
        },
      );
      let fallbackSummary = stripUuids(input.matchReasoning.slice(0, 300));
      if (input.isIntroduction && input.introducerName) {
        fallbackSummary = stripIntroducerMentions(fallbackSummary, input.introducerName);
      }
      return {
        headline: "A promising connection",
        personalizedSummary: fallbackSummary,
        suggestedAction: isIntroducer
          ? "Share this introduction to get things started."
          : "Take a look and decide whether to reach out.",
        narratorRemark: "Worth a look.",
        mutualIntentsLabel: isIntroducer
          ? "Connector match"
          : input.mutualIntentCount != null && input.mutualIntentCount > 0
            ? `${input.mutualIntentCount} mutual intent${input.mutualIntentCount !== 1 ? "s" : ""}`
            : "Shared interests",
        greeting: "",
      };
    }
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
   * Process multiple opportunities as home cards in parallel with bounded concurrency.
   * Returns full home-card display contracts (headline, body, narrator remark, action labels, mutual-intent label).
   */
  @Timed()
  public async presentHomeCardBatch(
    inputs: HomeCardPresenterInput[],
    options?: { concurrency?: number },
  ): Promise<HomeCardLLMResult[]> {
    const concurrency = options?.concurrency ?? 5;
    const results: HomeCardLLMResult[] = [];
    for (let i = 0; i < inputs.length; i += concurrency) {
      const chunk = inputs.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map((inp) => this.presentHomeCard(inp)),
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
 * Builds a "NEGOTIATION CONTEXT:" block for the home-card prompt. Returns an
 * empty string when the opportunity has no meaningful negotiation context
 * (draft/latent) or when the opportunity is still negotiating (handled via
 * the templated chip, not the LLM).
 */
function buildNegotiationPromptBlock(context: NegotiationContext | undefined): string {
  if (!context || context.status === 'negotiating') return "";

  const turnCapLabel = context.turnCap > 0 ? `${context.turnCap}` : "unlimited";
  const reason = context.outcome?.reason;
  const reasonLabel = reason === 'turn_cap'
    ? "agents hit the turn cap without converging"
    : reason === 'timeout'
      ? "counterpart went silent before responding"
      : undefined;

  const turnLines = (context.turns ?? []).map((turn, index) => {
    const action = turn.action;
    const reasoning = turn.assessment?.reasoning ?? "(no reasoning)";
    const message = turn.message ? ` — said: "${turn.message}"` : "";
    return `Turn ${index + 1} (${action}): ${reasoning}${message}`;
  });

  const outcomeSummary = context.outcome
    ? `Final outcome: ${context.outcome.hasOpportunity ? "agreed" : "declined"} — ${context.outcome.reasoning}`
    : "Final outcome: not recorded.";

  return `
NEGOTIATION CONTEXT:
- Negotiation status: ${context.status}${reasonLabel ? ` (${reasonLabel})` : ""}
- Turns exchanged: ${context.turnCount} of ${turnCapLabel}
- Transcript:
${turnLines.length > 0 ? turnLines.map((l) => `  ${l}`).join("\n") : "  (no turns recorded)"}
- ${outcomeSummary}
`;
}

/**
 * Builds a templated home-card result for an opportunity whose negotiation
 * is still in progress. Bypasses the LLM so users see a stable "currently
 * negotiating" chip while turns are still being exchanged.
 */
function buildNegotiatingChip(input: HomeCardPresenterInput): HomeCardLLMResult {
  const ctx = input.negotiationContext;
  const turnCount = ctx?.turnCount ?? 0;
  const turnCap = ctx?.turnCap && ctx.turnCap > 0 ? ctx.turnCap : undefined;
  const narratorRemark = turnCap
    ? `Currently negotiating · turn ${turnCount} of ${turnCap}`
    : `Currently negotiating · turn ${turnCount}`;

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
// CONTEXT GATHERER (used by tools)
// ──────────────────────────────────────────────────────────────

/**
 * Gather all context needed for the presenter from the database.
 * Fetches viewer profile, viewer intents, other party profile(s), and index in parallel.
 *
 * @param displayCounterpartUserId - When set (e.g. for home card), only this counterpart is included in otherPartyContext so the presenter writes about the person on the card. Omitted for introducer view (card shows both parties).
 */
export async function gatherPresenterContext(
  database: PresenterDatabase,
  opportunity: Opportunity,
  viewerId: string,
  displayCounterpartUserId?: string,
): Promise<PresenterInput> {
  const myActor = opportunity.actors.find((a) => a.userId === viewerId);
  if (!myActor) {
    throw new Error("Viewer is not an actor in this opportunity");
  }

  const isIntroducer = myActor.role === "introducer";
  const otherActors = opportunity.actors.filter((a) => a.userId !== viewerId);
  let otherPartyIds = [...new Set(otherActors.map((a) => a.userId))];
  if (
    displayCounterpartUserId &&
    !isIntroducer &&
    otherPartyIds.includes(displayCounterpartUserId)
  ) {
    otherPartyIds = [displayCounterpartUserId];
  }

  const contextIndexId = opportunity.context?.networkId;

  // For introducers: fetch profiles + intents for both parties; skip introducer's own intents.
  // For other roles: fetch viewer's profile + intents and other party profiles.
  const [viewerProfile, indexRecord, ...otherProfiles] = await Promise.all([
    database.getProfile(viewerId),
    contextIndexId ? database.getNetwork(contextIndexId) : Promise.resolve(null),
    ...otherPartyIds.map((uid) => database.getProfile(uid)),
  ]);

  // Fetch intents: for introducer, fetch each party's intents; otherwise fetch viewer's intents.
  let viewerIntents:
    | Awaited<ReturnType<typeof database.getActiveIntents>>
    | undefined;
  let partyIntentsMap:
    | Map<string, Awaited<ReturnType<typeof database.getActiveIntents>>>
    | undefined;

  if (isIntroducer) {
    const partyIntentResults = await Promise.all(
      otherPartyIds.map(async (uid) => ({
        uid,
        intents: await database.getActiveIntents(uid),
      })),
    );
    partyIntentsMap = new Map(
      partyIntentResults.map((r) => [r.uid, r.intents]),
    );
  } else {
    viewerIntents = await database.getActiveIntents(viewerId);
  }

  // Fetch premises when any actor is premise-grounded
  const premiseGroundedActors = opportunity.actors.filter((a) => a.premise);
  let viewerPremiseContext = '';
  let otherPremiseContext = '';

  if (premiseGroundedActors.length > 0) {
    const [viewerPremises, ...otherPartiesPremises] = await Promise.all([
      database.getPremisesForUser(viewerId, 'ACTIVE'),
      ...otherPartyIds.map((uid) => database.getPremisesForUser(uid, 'ACTIVE')),
    ]);

    if (viewerPremises?.length) {
      viewerPremiseContext =
        '\nPremises (self-descriptions):\n' +
        viewerPremises
          .slice(0, 5)
          .map((p) => `- ${p.assertion.text}`)
          .join('\n');
    }

    const otherPremiseLines: string[] = [];
    for (let i = 0; i < otherPartyIds.length; i++) {
      const premises = otherPartiesPremises[i];
      if (premises?.length) {
        for (const p of premises.slice(0, 3)) {
          otherPremiseLines.push(`- ${p.assertion.text}`);
        }
      }
    }
    if (otherPremiseLines.length > 0) {
      otherPremiseContext = '\nPremises (self-descriptions):\n' + otherPremiseLines.join('\n');
    }
  }

  let viewerContext: string;
  let otherPartyContext: string;

  if (isIntroducer) {
    // Introducer view: minimal viewer context (just name + role), rich other-party context with intents
    const introducerApproved = opportunity.actors.find(a => a.role === 'introducer')?.approved === true;
    const hasApproved = introducerApproved || opportunity.status !== 'latent';
    viewerContext = [
      "Profile:",
      `Name: ${viewerProfile?.identity?.name ?? "Unknown"}`,
      hasApproved
        ? "Role: You are the introducer who suggested this connection."
        : "Role: You are being asked whether these two people would benefit from meeting. You have NOT yet approved this introduction.",
    ].join("\n");

    const otherParts = otherPartyIds.map((uid, idx) => {
      const profile = otherProfiles[idx] as Awaited<
        ReturnType<typeof database.getProfile>
      >;
      const name = profile?.identity?.name ?? "Unknown";
      const bio = profile?.identity?.bio ?? "";
      const location = profile?.identity?.location ?? "";
      const skills = profile?.attributes?.skills?.join(", ") ?? "";
      const interests = profile?.attributes?.interests?.join(", ") ?? "";
      const context = profile?.narrative?.context ?? "";
      const intents = partyIntentsMap?.get(uid);
      const intentLines = intents?.length
        ? intents
            .slice(0, 5)
            .map((i) => `  - ${i.payload}${i.summary ? ` (${i.summary})` : ""}`)
        : ["  (no active intents)"];
      return [
        `${name}:`,
        `  Bio: ${bio}`,
        location ? `  Location: ${location}` : null,
        skills ? `  Skills: ${skills}` : null,
        interests ? `  Interests: ${interests}` : null,
        context ? `  Context: ${context}` : null,
        `  Active intents:`,
        ...intentLines,
      ]
        .filter(Boolean)
        .join("\n");
    });
    otherPartyContext =
      otherParts.join("\n\n") || "Parties (details not available).";
  } else {
    // Non-introducer view: full viewer profile + intents, other party profiles
    const viewerContextLines = [
      "Profile:",
      `Name: ${viewerProfile?.identity?.name ?? "Unknown"}`,
      `Bio: ${viewerProfile?.identity?.bio ?? ""}`,
      `Location: ${viewerProfile?.identity?.location ?? ""}`,
      `Skills: ${viewerProfile?.attributes?.skills?.join(", ") ?? ""}`,
      `Interests: ${viewerProfile?.attributes?.interests?.join(", ") ?? ""}`,
      `Context: ${viewerProfile?.narrative?.context ?? ""}`,
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
      const skills = profile?.attributes?.skills?.join(", ") ?? "";
      const interests = profile?.attributes?.interests?.join(", ") ?? "";
      return `${name}: ${bio}. Skills: ${skills}. Interests: ${interests}`;
    });
    otherPartyContext =
      otherParts.join("\n\n") || "Other party (details not available).";
  }

  const interp = opportunity.interpretation;
  const signalsSummary =
    interp.signals?.map((s) => `${s.type}: ${s.detail ?? s.type}`).join("; ") ??
    "Match based on profile and intent alignment.";

  // Detect introduction-originated opportunities: only when there is an explicit introducer actor.
  // Do NOT use detection.source === "manual" alone — system-discovered opportunities can have manual source without an introducer.
  const introducerActor = opportunity.actors.find(
    (a) => a.role === "introducer",
  );
  const isIntroduction = !!introducerActor;
  let introducerName: string | undefined;
  if (introducerActor) {
    introducerName = opportunity.detection.createdByName;
    if (!introducerName) {
      const introducerProfile = await database.getProfile(
        introducerActor.userId,
      );
      introducerName = introducerProfile?.identity?.name ?? undefined;
    }
  }

  const counterpartName =
    otherPartyIds.length === 1 && otherProfiles[0]
      ? (otherProfiles[0] as { identity?: { name?: string } })?.identity?.name?.trim()
      : undefined;
  const viewerNameForFilter = viewerProfile?.identity?.name?.trim();
  const matchReasoning =
    counterpartName && interp.reasoning
      ? viewerCentricCardSummary(
          interp.reasoning,
          counterpartName,
          400,
          viewerNameForFilter,
          introducerName,
        )
      : stripUuids(interp.reasoning);

  if (viewerPremiseContext) {
    viewerContext += viewerPremiseContext;
  }
  if (otherPremiseContext) {
    otherPartyContext += otherPremiseContext;
  }

  const result: PresenterInput = {
    viewerContext,
    otherPartyContext,
    matchReasoning,
    category: interp.category ?? "connection",
    confidence:
      typeof interp.confidence === "number"
        ? interp.confidence
        : parseFloat(String(interp.confidence ?? 0)) || 0,
    signalsSummary,
    indexName: indexRecord?.title ?? contextIndexId ?? "",
    viewerRole: myActor.role ?? "party",
    isIntroduction,
    introducerName,
  };

  return result;
}
