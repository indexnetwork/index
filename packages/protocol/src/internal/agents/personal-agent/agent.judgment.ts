/**
 * The PersonalAgent's judgment: what it is shown, and what it may answer.
 *
 * The model is shown the assembled context — paused negotiations, matches and
 * dossier entries as NUMBERED lists — and returns acts referring to them
 * strictly by number. It never sees or emits an id, so it cannot mint a ref
 * that would end the wrong negotiation or retire the wrong fact; an act
 * naming a number outside the lists is DROPPED. Output that does not parse at
 * all is retried once and then throws, and the caller's queue retry covers a
 * transient model outage.
 *
 * `PersonalAgentModel` is the production implementation of the
 * `PersonalAgentJudgment` seam. Tests and evals script that seam instead of
 * subclassing this.
 */
import { z } from "zod";

import { createStructuredModel } from "../../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../../shared/agent/model-signal.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import { NegotiationAuthoredTurnSchema, NegotiationOpeningTurnSchema, type NegotiationAuthoredTurn, type NegotiationTurn } from "../../negotiations/negotiation.turn.js";
import { QuestionSchema, type Question } from "../../../protocol/question.js";
import { buildPersonalAgentSystemPrompt, isSafeAgentMessageProse, personalAgentEventInstruction, PERSONAL_AGENT_BRIEF_INSTRUCTION, PERSONAL_AGENT_NEGOTIATION_OPENING_PROMPT, PERSONAL_AGENT_NEGOTIATION_TURN_PROMPT, PERSONAL_AGENT_SEAT_BRIEF_INSTRUCTION, PERSONAL_AGENT_STRATEGY_INSTRUCTION } from "./agent.prompt.js";
import type { PersonalAgentBriefInput, PersonalAgentSeatBriefInput, PersonalAgentDecidedAct, PersonalAgentExecutedAct, PersonalAgentJudgment, PersonalAgentNegotiationTurnInput, PersonalAgentNonDurableObservation, PersonalAgentThreadEntry, PersonalAgentTurnContext } from "./agent.types.js";
import { matchRefId } from "./agent.types.js";

const logger = protocolLogger("PersonalAgent:Judgment");

/**
 * A negotiator turn's own deadline. Kickoff self-plays every match in
 * parallel and a negotiation runs several turns inside one invoke, so without
 * a bound here the model layer's own 60s x retry budget stacks far past the
 * chat controller's 90s wait and the principal sees a timeout for a turn that
 * is still running.
 */
export const NEGOTIATION_TURN_TIMEOUT_MS = 20_000;
export const PERSONAL_AGENT_MODEL_TIMEOUT_MS = 15_000;

const MAX_TEXT_CHARS = 500;
const MAX_DM_CHARS = 1000;
const MAX_DM_MESSAGES = 20;
const MAX_THREAD_TURNS = 8;
const MAX_QUESTIONS = 3;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Structured questions, normalized through the canonical renderer schema and
 * the same prose leak gate used for chat copy. One malformed question is
 * dropped without losing the other safe questions in the response.
 */
export function normalizeMessageQuestions(raw: unknown): Question[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const questions: Question[] = [];
  for (const candidate of raw) {
    const parsed = QuestionSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const question = parsed.data;
    const prose = [
      question.title,
      question.prompt,
      question.evidence,
      ...question.options.flatMap((option) => [option.label, option.description]),
    ].filter((value): value is string => typeof value === "string");
    if (!prose.every(isSafeAgentMessageProse)) continue;
    const key = question.prompt.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(question);
    if (questions.length === MAX_QUESTIONS) break;
  }
  return questions.length > 0 ? questions : undefined;
}

function canonicalCounterpartyPauseProse(
  reason: PersonalAgentTurnContext["paused"][number]["reason"],
): string {
  switch (reason) {
    case "ready_for_verdict":
      return "The other side is deciding.";
    case "needs_principal":
      return "The other side is waiting on its principal.";
    case "counterparty_silent":
      return "The other side is waiting for a response.";
    case "turn_cap":
      return "The negotiation reached its turn limit.";
    case "open_failed":
      return "The negotiation could not be opened.";
    default:
      return "The other side is paused.";
  }
}

/** The complete server-owned narration for every public counterpart pause. */
export function canonicalCounterpartyStatusProse(context: PersonalAgentTurnContext): string | null {
  const statuses = [...new Set(context.paused
    .filter((paused) => !paused.pausedByUs)
    .map((paused) => canonicalCounterpartyPauseProse(paused.reason)))];
  return statuses.length > 0 ? statuses.join(" ") : null;
}

/** Counterparty state is server-owned, never inferred from model vocabulary. */
export function isSupportedPersonalAgentStatusProse(
  text: string,
  context: PersonalAgentTurnContext,
): boolean {
  const canonical = canonicalCounterpartyStatusProse(context);
  return canonical === null || text.trim() === canonical;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderThread(thread: PersonalAgentThreadEntry[], indent = ""): string {
  if (thread.length === 0) return `${indent}(nothing said yet)`;
  return thread.slice(-MAX_THREAD_TURNS).map((entry, index) => {
    const who = entry.speaker === "own" ? "your seat" : "their agent";
    const turn = entry.turn as { verb: string; message?: string; reason?: string };
    if (turn.verb === "pause") return `${indent}[${index}] ${who} paused (${turn.reason})`;
    return `${indent}[${index}] ${who} (${turn.verb}): ${truncate(turn.message ?? "", MAX_TEXT_CHARS)}`;
  }).join("\n");
}

function renderPaused(context: PersonalAgentTurnContext): string {
  if (context.paused.length === 0) return "Paused negotiations: none.";
  const lines = context.paused.map((paused, index) => {
    if (!paused.pausedByUs) {
      return `${index + 1}. ${canonicalCounterpartyPauseProse(paused.reason)}`;
    }
    const parts = [`${index + 1}. Paused (${paused.reason}) by ${paused.pausedByUs ? "your own seat" : "their agent"}`];
    const payload = paused.payload as { question?: string; recommendation?: string; reasoning?: string } | undefined;
    if (payload?.question) parts.push(`   Needs from your client: ${truncate(payload.question, MAX_TEXT_CHARS)}`);
    if (payload?.recommendation) {
      parts.push(`   Recommends: ${payload.recommendation}${payload.reasoning ? ` — ${truncate(payload.reasoning, MAX_TEXT_CHARS)}` : ""}`);
    }
    parts.push("   How it got here:");
    parts.push(renderThread(paused.thread, "   "));
    return parts.join("\n");
  });
  return `Paused negotiations (refer to them by number; promote and reject act on exactly one of these):\n${lines.join("\n")}`;
}

function renderMatches(context: PersonalAgentTurnContext): string {
  if (context.matches.length === 0) return "Matches on this signal: none right now.";
  const lines = context.matches.map((match, index) => `${index + 1}. ${match.label} (${match.status})`);
  return `Your client's matches on this signal (refer by number; accept_opportunity acts on exactly one of these):\n${lines.join("\n")}`;
}

function renderDossier(context: PersonalAgentTurnContext): string {
  if (context.dossier.length === 0) return "Dossier: empty.";
  const lines = context.dossier.map((entry, index) =>
    `${index + 1}. (${entry.source}, ${entry.createdAt.toISOString().slice(0, 10)}) ${truncate(entry.text, MAX_TEXT_CHARS)}`);
  return `Dossier — the facts you may use at the negotiation table (refer by number):\n${lines.join("\n")}`;
}

function renderLedger(context: PersonalAgentTurnContext): string {
  if (context.recentActs.length === 0) return "";
  const lines = context.recentActs.slice(0, 10).map((row) => {
    const tool = typeof row.act.tool === "string" ? row.act.tool : "unknown";
    const detail = typeof row.act.text === "string"
      ? truncate(row.act.text, 200)
      : typeof row.act.reasoning === "string" ? truncate(row.act.reasoning, 200) : "";
    return `- ${row.createdAt.toISOString()} ${tool}${detail ? `: ${detail}` : ""}`;
  });
  return `\nYour own recent acts on this signal (newest first):\n${lines.join("\n")}`;
}

function renderDm(context: PersonalAgentTurnContext): string {
  if (context.recentDm.length === 0) return "Your conversation with your client is empty so far.";
  const lines = context.recentDm.slice(-MAX_DM_MESSAGES).map((message) =>
    `- ${message.role === "user" ? "Client" : "You"}: ${truncate(message.content, MAX_DM_CHARS)}`);
  return `Your conversation with your client about this signal (most recent last):\n${lines.join("\n")}`;
}

function renderEvent(context: PersonalAgentTurnContext): string {
  if (context.event === "user_message") {
    return `THE EVENT: your client just wrote to you:\n"${truncate(context.message?.text ?? "", 4000)}"\n\n${personalAgentEventInstruction("user_message")}`;
  }
  return personalAgentEventInstruction(context.event);
}

/** What judgment sees, rendered; exported for the live eval's transparency. */
export function renderPersonalAgentTurn(context: PersonalAgentTurnContext): string {
  const canonicalCounterpartyStatus = canonicalCounterpartyStatusProse(context);
  return [
    context.signalText ? `Your client's signal: ${truncate(context.signalText, 800)}` : "Your client's signal text is unavailable.",
    "",
    renderPaused(context),
    "",
    renderMatches(context),
    "",
    renderDossier(context),
    renderLedger(context),
    "",
    renderDm(context),
    "",
    canonicalCounterpartyStatus
      ? `CANONICAL COUNTERPART STATUS RESPONSE:\n${canonicalCounterpartyStatus}\nBecause counterpart status is present, message_user text must be exactly this server-owned response. Put any questions in the structured questions field.`
      : "",
    "",
    renderEvent(context),
  ].join("\n");
}

/** Compact prose record of the acts the agent just executed, for its next choice. */
function renderExecutedAct(act: PersonalAgentExecutedAct): string {
  switch (act.tool) {
    case "message_user":
      return `- You wrote to your client: ${act.text}`;
    case "kickoff":
      return act.failed > 0
        ? `- You attempted to open or re-open ${act.attempted} match(es); ${act.failed} failed to open. The round settled with ${act.opened} negotiation task(s): ${act.reasoning}`
        : `- You attempted to open or re-open ${act.attempted} match(es); none failed to open. The round settled with ${act.opened} negotiation task(s): ${act.reasoning}`;
    case "promote":
      return act.outcome === "resolved"
        ? `- You ended a negotiation and put the match in your client's decision queue: ${act.reasoning}`
        : "- You tried to surface a match to your client and the write failed. Tell them honestly.";
    case "reject":
      return act.outcome === "resolved"
        ? `- You ended a negotiation and dismissed the match: ${act.reasoning}`
        : "- You tried to dismiss a match and the write failed. Tell your client honestly.";
    case "note_dossier":
      return `- You noted a fact for the negotiation table: ${act.text}`;
    case "retire_dossier":
      return act.retired
        ? "- You retired an outdated dossier entry."
        : "- You tried to retire a dossier entry, but it was not available in this turn and no entry changed.";
    case "accept_opportunity":
      return act.outcome === "executed"
        ? `- You executed your client's verdict: ACCEPTED ${act.counterparty ?? "the match"}.`
        : `- You tried to execute your client's accept and it did not land (${act.outcome}). Tell them honestly.`;
  }
}

function renderNonDurableObservations(
  context: PersonalAgentTurnContext,
  observations: PersonalAgentNonDurableObservation[],
): string {
  if (observations.length === 0) return "";
  const lines = observations.map((observation) => {
    if (observation.kind === "terminal_message_refused") return `- Refused message_user: ${observation.reason}`;
    if (observation.tool === "kickoff") return `- Refused kickoff: ${observation.reason}`;
    if (observation.tool === "accept_opportunity") {
      const position = context.matches.findIndex((match) => matchRefId(match) === observation.opportunityId);
      const match = position >= 0 ? `match ${position + 1}` : "a match";
      return `- Refused accept_opportunity for ${match}: ${observation.reason}`;
    }
    const position = context.paused.findIndex((paused) => paused.negotiationId === observation.negotiationId);
    const negotiation = position >= 0 ? `negotiation ${position + 1}` : "a negotiation";
    return `- Refused ${observation.tool} for ${negotiation}: ${observation.reason}`;
  });
  return `\n\nNON-DURABLE REFUSALS (these calls did not execute and changed no state):\n${lines.join("\n")}`;
}

function renderExecutedResults(
  context: PersonalAgentTurnContext,
  executed: PersonalAgentExecutedAct[],
  nonDurable: PersonalAgentNonDurableObservation[],
): string {
  const acts = executed.length === 0
    ? "You executed no acts this turn."
    : `The acts you just executed for this turn:\n${executed.map(renderExecutedAct).join("\n")}`;
  // A client message that caused no action can invite fabricated outreach.
  // State the constraint only for that event: a background wake has no client
  // message, so claiming one would give the model false context.
  const nothingHappened = executed.length === 0 && context.event === "user_message"
    ? "\n\nYour client just wrote to you and you decided nothing needed doing this turn. You sent NOTHING, contacted NO ONE, and moved NO negotiation forward. If their message reads as an answer to a question, it is NOT resolved — whatever it might have answered stands exactly as it did before they wrote. Tell your client the truth about what did and did not happen."
    : "";
  return `${renderPersonalAgentTurn(context)}\n\n${acts}${nothingHappened}${renderNonDurableObservations(context, nonDurable)}\n\nChoose the next single tool call. If the conversation is complete for now, use message_user for your natural reply.`;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

// Optional fields are `.nullable().optional()`: the structured-output schema
// translation refuses optional-without-nullable, and the validator below
// treats null and absent alike.
const DecidedActSchema = z.object({
    act: z.enum(["message_user", "kickoff", "promote", "reject", "note_dossier", "retire_dossier", "accept_opportunity"]),
    /** message_user: the prose. note_dossier: the fact. */
    text: z.string().max(4000).nullable().optional(),
    /** message_user: renderer-ready questions; all asking lives here, not in text. */
    questions: z.array(QuestionSchema).max(MAX_QUESTIONS).nullable().optional(),
    /** promote / reject: 1-based number from the paused list. */
    negotiation: z.number().int().min(1).nullable().optional(),
    /** accept_opportunity: 1-based number from the match list. */
    opportunity: z.number().int().min(1).nullable().optional(),
    /** retire_dossier: 1-based number from the dossier list. */
    entry: z.number().int().min(1).nullable().optional(),
    /** kickoff / promote / reject: why. Recorded, never shown to a counterparty. */
    reasoning: z.string().max(2000).nullable().optional(),
    /** accept_opportunity: the client's own words. */
    reason: z.string().max(500).nullable().optional(),
});

const ProseSchema = z.object({ text: z.string().min(1).max(4000) });

// ─── Production judgment ─────────────────────────────────────────────────────

export class PersonalAgentModel implements PersonalAgentJudgment {
  /** One ReAct-style choice: results and refused calls are visible before the next call. */
  async next(
    context: PersonalAgentTurnContext,
    executed: PersonalAgentExecutedAct[],
    nonDurable: PersonalAgentNonDurableObservation[] = [],
  ): Promise<PersonalAgentDecidedAct> {
    const userMessage = renderExecutedResults(context, executed, nonDurable);
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.callActsModel([
        { role: "system", content: this.systemPrompt(context) },
        { role: "user", content: userMessage },
      ]);
      const decided = validateDecidedAct(raw, context);
      if (decided) return decided;
      logger.warn("Personal-agent choice rejected", { attempt: attempt + 1, event: context.event });
    }
    throw new Error("PersonalAgent turn produced no valid tool choice");
  }

  async strategy(context: PersonalAgentTurnContext): Promise<string> {
    const parsed = ProseSchema.safeParse(await this.callProseModel("personal_agent_strategy", [
      { role: "system", content: `${this.systemPrompt(context)}\n\n${PERSONAL_AGENT_STRATEGY_INSTRUCTION}` },
      { role: "user", content: renderPersonalAgentTurn(context) },
    ]));
    const text = parsed.success ? parsed.data.text.trim() : "";
    if (!text || !isSafeAgentMessageProse(text) || !isSupportedPersonalAgentStatusProse(text, context)) {
      throw new Error("PersonalAgent produced no usable strategy");
    }
    return text;
  }

  async brief(context: PersonalAgentTurnContext, input: PersonalAgentBriefInput): Promise<string> {
    const thread = input.thread.length > 0
      ? `\n\nWhat has already been said at this table:\n${renderThread(input.thread)}`
      : "";
    const parsed = ProseSchema.safeParse(await this.callProseModel("personal_agent_brief", [
      { role: "system", content: `${this.systemPrompt(context)}\n\n${PERSONAL_AGENT_BRIEF_INSTRUCTION}` },
      {
        role: "user",
        content: `${renderPersonalAgentTurn(context)}\n\nYOUR STRATEGY FOR THIS ROUND:\n${input.strategy}\n\nTHE MATCH THIS BRIEF IS FOR:\n${input.match.label}${thread}\n\nWrite the brief.`,
      },
    ]));
    const text = parsed.success ? parsed.data.text.trim() : "";
    if (!text || !isSafeAgentMessageProse(text)) {
      throw new Error("PersonalAgent produced no usable brief");
    }
    return text;
  }

  /**
   * A brief for a seat that has none — written from what THIS side can see,
   * and explicitly told to say so where it cannot see anything. There is no
   * system prompt identity here on purpose: the counterparty's own agent name
   * is not resolvable from a negotiation, and a brief is not addressed to the
   * principal anyway.
   */
  async seatBrief(input: PersonalAgentSeatBriefInput): Promise<string> {
    const known = [
      `YOUR CLIENT'S ACTUAL INTENT:\n${input.intent.payload}`,
      `NEGOTIATION CONTEXT:\nThis table is ${input.negotiation.state}; ${input.negotiation.metadata.initiatorUserId === input.intent.userId ? "your seat opened it" : "the counterparty opened it"}.`,
      `WHAT HAS BEEN SAID SO FAR:\n${renderThread(input.thread)}`,
    ].join("\n\n");
    const parsed = ProseSchema.safeParse(await this.callNegotiationBriefModel([
      { role: "system", content: PERSONAL_AGENT_SEAT_BRIEF_INSTRUCTION },
      { role: "user", content: `${known}\n\nWrite the brief.` },
    ]));
    const text = parsed.success ? parsed.data.text.trim() : "";
    if (!text || !isSafeAgentMessageProse(text)) {
      throw new Error("PersonalAgent produced no usable seat brief");
    }
    return text;
  }

  async negotiationTurn(input: PersonalAgentNegotiationTurnInput): Promise<NegotiationAuthoredTurn> {
    const context = `YOUR CLIENT'S ACTUAL INTENT:\n${input.intent.payload}\n\nNEGOTIATION CONTEXT:\nThis table is ${input.negotiation.state}; ${input.negotiation.metadata.initiatorUserId === input.intent.userId ? "your seat opened it" : "the counterparty opened it"}.\n\nBRIEF (A COMPACT DERIVED STANCE):\n${input.brief}\n\nTHREAD SO FAR:\n${renderThread(input.thread)}`;
    if (input.isOpening) {
      return NegotiationOpeningTurnSchema.parse(await this.callOpeningTurnModel([
        { role: "system", content: PERSONAL_AGENT_NEGOTIATION_OPENING_PROMPT },
        { role: "user", content: `${context}\n\nWrite your opening outreach.` },
      ]));
    }
    return NegotiationAuthoredTurnSchema.parse(await this.callTurnModel([
      { role: "system", content: PERSONAL_AGENT_NEGOTIATION_TURN_PROMPT },
      { role: "user", content: `${context}\n\nChoose your move.` },
    ]));
  }

  private systemPrompt(context: PersonalAgentTurnContext): string {
    return buildPersonalAgentSystemPrompt(context.agentName ? { agentName: context.agentName } : {});
  }

  /**
   * Raw round trips, one seam each. The models are constructed here rather
   * than in the constructor so a host that never takes a model turn never
   * needs a provider key.
   */
  protected async callActsModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return invokeWithAbortSignal(
      this.createChoiceModel(),
      messages,
      AbortSignal.timeout(PERSONAL_AGENT_MODEL_TIMEOUT_MS),
    );
  }

  protected async callProseModel(name: string, messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return invokeWithAbortSignal(
      this.createProseModel(name),
      messages,
      AbortSignal.timeout(PERSONAL_AGENT_MODEL_TIMEOUT_MS),
    );
  }

  /** A counterparty brief is part of opening a live negotiation, not ordinary DM prose. */
  protected async callNegotiationBriefModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return invokeWithAbortSignal(
      this.createProseModel("personal_agent_seat_brief"),
      messages,
      AbortSignal.timeout(NEGOTIATION_TURN_TIMEOUT_MS),
    );
  }

  protected createChoiceModel(): ReturnType<typeof createStructuredModel> {
    return createStructuredModel("chat", DecidedActSchema, { name: "personal_agent_choice" });
  }

  protected createProseModel(name: string): ReturnType<typeof createStructuredModel> {
    return createStructuredModel("chat", ProseSchema, { name });
  }

  protected async callOpeningTurnModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return invokeWithAbortSignal(
      createStructuredModel("negotiator", NegotiationOpeningTurnSchema, { name: "negotiation_opening" }),
      messages,
      AbortSignal.timeout(NEGOTIATION_TURN_TIMEOUT_MS),
    );
  }

  protected async callTurnModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return invokeWithAbortSignal(
      createStructuredModel(
        "negotiator",
        NegotiationAuthoredTurnSchema as unknown as z.ZodType<Record<string, unknown>>,
        { name: "negotiation_turn" },
      ),
      messages,
      AbortSignal.timeout(NEGOTIATION_TURN_TIMEOUT_MS),
    );
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Schema + reference validation of one round trip. Everything here refuses
 * the impossible — numbers outside the lists, prose that trips the
 * identifier-leak gate, a verdict on a turn that cannot carry one — and
 * nothing here re-decides.
 *
 * Sequencing is conversational: the graph supplies each executed result to
 * the next model choice, while this validator keeps references bounded.
 */
export function validateDecidedAct(
  raw: unknown,
  context: PersonalAgentTurnContext,
): PersonalAgentDecidedAct | null {
  const parsed = DecidedActSchema.safeParse(raw);
  if (!parsed.success) return null;
  const act = parsed.data;
  // This is a single-choice loop: an impossible choice returns null and gets
  // one model retry; valid choices pass through without being re-decided.
    switch (act.act) {
      case "message_user":
      {
        const text = act.text?.trim();
        if (!text || !isSafeAgentMessageProse(text)) return null;
        if (!isSupportedPersonalAgentStatusProse(text, context)) return null;
        const questions = normalizeMessageQuestions(act.questions);
        // Questions belong in the structured field. Keeping them out of prose
        // prevents the same ask rendering twice and guarantees widget delivery.
        if (text.includes("?")) return null;
        if (Array.isArray(act.questions) && act.questions.length > 0 && !questions) return null;
        return { tool: "message_user", text, ...(questions ? { questions } : {}) };
      }
      case "kickoff": {
        return { tool: "kickoff", reasoning: act.reasoning?.trim() || "Reaching out to this signal's matches." };
      }
      case "promote":
      case "reject": {
        if (!act.negotiation || act.negotiation > context.paused.length) return null;
        const paused = context.paused[act.negotiation - 1]!;
        if (!paused.pausedByUs || paused.reason !== "ready_for_verdict") return null;
        return {
          tool: act.act,
          negotiationId: paused.negotiationId,
          reasoning: act.reasoning?.trim() || (act.act === "promote" ? "Worth surfacing." : "Not a match."),
        };
      }
      case "accept_opportunity": {
        // A verdict exists only as the client's explicit word — an event with
        // no client message cannot carry one. Whether the word WAS explicit
        // is the prompt's law; this refuses only the structurally impossible.
        if (context.event !== "user_message") return null;
        if (!act.opportunity || act.opportunity > context.matches.length) return null;
        return {
          tool: "accept_opportunity",
          opportunityId: matchRefId(context.matches[act.opportunity - 1]!),
          ...(act.reason?.trim() ? { reason: act.reason.trim() } : {}),
        };
      }
      case "note_dossier": {
        const text = act.text?.trim();
        if (!text) return null;
        return { tool: "note_dossier", text };
      }
      case "retire_dossier": {
        if (!act.entry || act.entry > context.dossier.length) return null;
        return { tool: "retire_dossier", entryId: context.dossier[act.entry - 1]!.id };
      }
    }
}

/** Re-exported for the graph's own thread rendering of a negotiator turn. */
export { renderThread };
export type { NegotiationTurn };
