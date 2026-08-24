/**
 * The PersonalAgent's judgment: what it is shown, and what it may answer.
 *
 * The model is shown the assembled context — paused negotiations, matches and
 * dossier entries as NUMBERED lists — and returns acts referring to them
 * strictly by number. It never sees or emits an id, so it cannot mint a ref
 * that would end the wrong negotiation or retire the wrong fact; an act
 * naming a number outside the lists rejects the whole round trip. Fail-closed:
 * validate → retry once → throw, and the caller's queue retry covers a
 * transient model outage.
 *
 * `PersonalAgentModel` is the production implementation of the
 * `PersonalAgentJudgment` seam. Tests and evals script that seam instead of
 * subclassing this.
 */
import { z } from "zod";

import { createStructuredModel } from "../../shared/agent/model.config.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import { NegotiationAuthoredTurnSchema, NegotiationOpeningTurnSchema, type NegotiationAuthoredTurn, type NegotiationTurn } from "../../negotiations/negotiation.turn.js";
import { buildPersonalAgentSystemPrompt, isSafeAgentMessageProse, personalAgentEventInstruction, PERSONAL_AGENT_BRIEF_INSTRUCTION, PERSONAL_AGENT_NEGOTIATION_OPENING_PROMPT, PERSONAL_AGENT_NEGOTIATION_TURN_PROMPT, PERSONAL_AGENT_REPLY_INSTRUCTION, PERSONAL_AGENT_STRATEGY_INSTRUCTION } from "./agent.prompt.js";
import type { PersonalAgentBriefInput, PersonalAgentDecidedAct, PersonalAgentExecutedAct, PersonalAgentJudgment, PersonalAgentNegotiationTurnInput, PersonalAgentReply, PersonalAgentThreadEntry, PersonalAgentTurnContext } from "./agent.types.js";

const logger = protocolLogger("PersonalAgent:Judgment");

const MAX_TEXT_CHARS = 500;
const MAX_DM_CHARS = 1000;
const MAX_DM_MESSAGES = 20;
const MAX_THREAD_TURNS = 8;
const MAX_OPTION_CHARS = 60;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Canned replies, normalized. Options are a shortcut for typing and nothing
 * more, so a malformed set is DROPPED rather than rejected: the question
 * still reads fine as prose, and refusing the whole round trip over chip
 * wording would trade a convenience for a lost turn.
 */
export function normalizeMessageOptions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const options: string[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "string") continue;
    const text = candidate.trim();
    if (!text || text.length > MAX_OPTION_CHARS) continue;
    if (!isSafeAgentMessageProse(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(text);
    if (options.length === MAX_OPTIONS) break;
  }
  return options.length >= MIN_OPTIONS ? options : undefined;
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
    renderEvent(context),
  ].join("\n");
}

/** Compact prose record of the acts the turn just executed, for the reply. */
function renderExecutedAct(act: PersonalAgentExecutedAct): string {
  switch (act.tool) {
    case "message_user":
    case "ask":
      return `- You wrote to your client: ${act.text}`;
    case "kickoff":
      return `- You opened or re-opened ${act.opened} negotiation(s) for this signal: ${act.reasoning}`;
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
      return act.retired ? "- You retired an outdated dossier entry." : "- You tried to retire a dossier entry that was already gone.";
    case "accept_opportunity":
      return act.outcome === "executed"
        ? `- You executed your client's verdict: ACCEPTED ${act.counterparty ?? "the match"}.`
        : `- You tried to execute your client's accept and it did not land (${act.outcome}). Tell them honestly.`;
  }
}

/** What the reply stage sees, rendered; exported for the live eval's transparency. */
export function renderPersonalAgentReplyStage(
  context: PersonalAgentTurnContext,
  executed: PersonalAgentExecutedAct[],
): string {
  const acts = executed.length === 0
    ? "You executed no acts this turn."
    : `The acts you just executed for this turn:\n${executed.map(renderExecutedAct).join("\n")}`;
  // The reply stage has been observed fabricating outreach ("I've reached out
  // to ...") on a turn that executed nothing, when the client's own words read
  // like an answer. Spelled out in context rather than trusted to the general
  // reply law alone: this is the one shape that invites that story.
  const nothingHappened = executed.length === 0
    ? "\n\nYour client just wrote to you and you decided nothing needed doing this turn. You sent NOTHING, contacted NO ONE, and moved NO negotiation forward. If their message reads as an answer to a question, it is NOT resolved — whatever it might have answered stands exactly as it did before they wrote. Tell your client the truth about what did and did not happen."
    : "";
  return `${renderPersonalAgentTurn(context)}\n\n${acts}${nothingHappened}\n\nNow write your reply to your client.`;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

// Optional fields are `.nullable().optional()`: the structured-output schema
// translation refuses optional-without-nullable, and the validator below
// treats null and absent alike.
const DecidedActsSchema = z.object({
  acts: z.array(z.object({
    act: z.enum(["message_user", "ask", "kickoff", "promote", "reject", "note_dossier", "retire_dossier", "accept_opportunity"]),
    /** message_user / ask: the prose. note_dossier: the fact. */
    text: z.string().max(4000).nullable().optional(),
    /** message_user / ask: 2-4 short canned replies. */
    options: z.array(z.string().max(MAX_OPTION_CHARS)).max(8).nullable().optional(),
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
  })).max(8),
});

const ReplySchema = z.object({
  reply: z.string().max(4000),
  options: z.array(z.string().max(MAX_OPTION_CHARS)).max(8).nullable().optional(),
});

const ProseSchema = z.object({ text: z.string().min(1).max(4000) });

// ─── Production judgment ─────────────────────────────────────────────────────

export class PersonalAgentModel implements PersonalAgentJudgment {
  /**
   * One judgment: context in, decided acts out (numbers already resolved to
   * ids). Validate → retry once → throw; a turn that cannot be judged must
   * not be guessed.
   */
  async decide(context: PersonalAgentTurnContext): Promise<PersonalAgentDecidedAct[]> {
    const userMessage = renderPersonalAgentTurn(context);
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.callActsModel([
        { role: "system", content: this.systemPrompt(context) },
        { role: "user", content: userMessage },
      ]);
      const decided = validateDecidedActs(raw, context);
      if (decided) return decided;
      logger.warn("Personal-agent acts rejected", { attempt: attempt + 1, event: context.event });
    }
    throw new Error("PersonalAgent turn produced no valid act list");
  }

  /**
   * The reply stage: the conversational reply for a client-message turn,
   * composed AFTER the acts executed. The returned prose must pass the
   * identifier-leak gate before anyone sees it — fail → one retry → null, and
   * the caller delivers the fixed fallback copy. Check-then-stream: the
   * transport only sees a completed, checked reply.
   */
  async reply(context: PersonalAgentTurnContext, executed: PersonalAgentExecutedAct[]): Promise<PersonalAgentReply | null> {
    const userMessage = renderPersonalAgentReplyStage(context, executed);
    const system = `${this.systemPrompt(context)}\n\n${PERSONAL_AGENT_REPLY_INSTRUCTION}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = ReplySchema.safeParse(await this.callReplyModel([
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ]));
      if (parsed.success) {
        const text = parsed.data.reply.trim();
        if (text && isSafeAgentMessageProse(text)) {
          const options = normalizeMessageOptions(parsed.data.options);
          return { text, ...(options ? { options } : {}) };
        }
      }
      logger.warn("Personal-agent reply rejected", { attempt: attempt + 1, malformed: !parsed.success });
    }
    return null;
  }

  async strategy(context: PersonalAgentTurnContext): Promise<string> {
    const parsed = ProseSchema.safeParse(await this.callProseModel("personal_agent_strategy", [
      { role: "system", content: `${this.systemPrompt(context)}\n\n${PERSONAL_AGENT_STRATEGY_INSTRUCTION}` },
      { role: "user", content: renderPersonalAgentTurn(context) },
    ]));
    const text = parsed.success ? parsed.data.text.trim() : "";
    if (!text || !isSafeAgentMessageProse(text)) {
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

  async negotiationTurn(input: PersonalAgentNegotiationTurnInput): Promise<NegotiationAuthoredTurn> {
    if (input.isOpening) {
      return NegotiationOpeningTurnSchema.parse(await this.callOpeningTurnModel([
        { role: "system", content: PERSONAL_AGENT_NEGOTIATION_OPENING_PROMPT },
        { role: "user", content: `BRIEF:\n${input.brief}\n\nWrite your opening outreach.` },
      ]));
    }
    return NegotiationAuthoredTurnSchema.parse(await this.callTurnModel([
      { role: "system", content: PERSONAL_AGENT_NEGOTIATION_TURN_PROMPT },
      { role: "user", content: `BRIEF:\n${input.brief}\n\nTHREAD SO FAR:\n${renderThread(input.thread)}\n\nChoose your move.` },
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
    return createStructuredModel("chat", DecidedActsSchema, { name: "personal_agent_acts" }).invoke(messages);
  }

  protected async callReplyModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return createStructuredModel("chat", ReplySchema, { name: "personal_agent_reply" }).invoke(messages);
  }

  protected async callProseModel(name: string, messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return createStructuredModel("chat", ProseSchema, { name }).invoke(messages);
  }

  protected async callOpeningTurnModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return createStructuredModel("negotiator", NegotiationOpeningTurnSchema, { name: "negotiation_opening" }).invoke(messages);
  }

  protected async callTurnModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return createStructuredModel(
      "negotiator",
      NegotiationAuthoredTurnSchema as unknown as z.ZodType<Record<string, unknown>>,
      { name: "negotiation_turn" },
    ).invoke(messages);
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Schema + reference validation of one round trip. Everything here refuses
 * the impossible — numbers outside the lists, prose that trips the
 * identifier-leak gate, a verdict on a turn that cannot carry one — and
 * nothing here re-decides.
 *
 * The ONE ordering rule the design demands lives here rather than in the
 * prompt: a turn that asks executes nothing, because the answer may change
 * what the right decision is.
 */
export function validateDecidedActs(
  raw: unknown,
  context: PersonalAgentTurnContext,
): PersonalAgentDecidedAct[] | null {
  const parsed = DecidedActsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const judged = new Set<number>();
  const decided: PersonalAgentDecidedAct[] = [];
  let kickedOff = false;
  let dropped = 0;
  // One impossible act DROPS, exactly as a malformed chip drops: refusing the
  // whole round trip over it would discard the client's real requests too, and
  // the retry sees an identical prompt with no feedback, so it usually makes
  // the same mistake twice and the turn dies. Only a list with nothing valid
  // left in it is worth re-deciding.
  const drop = (): void => { dropped += 1; };
  for (const act of parsed.data.acts) {
    switch (act.act) {
      case "message_user":
      case "ask": {
        // On a client-message turn the reply is the dedicated stage's — an
        // acts-stage message would race it and double-speak. Structural, not
        // judgment: dropped, and the reply stage says whatever it wanted to say.
        if (context.event === "user_message") { drop(); break; }
        const text = act.text?.trim();
        if (!text || !isSafeAgentMessageProse(text)) { drop(); break; }
        const options = normalizeMessageOptions(act.options);
        decided.push({ tool: act.act, text, ...(options ? { options } : {}) });
        break;
      }
      case "kickoff": {
        if (kickedOff) { drop(); break; }
        kickedOff = true;
        decided.push({ tool: "kickoff", reasoning: act.reasoning?.trim() || "Reaching out to this signal's matches." });
        break;
      }
      case "promote":
      case "reject": {
        if (!act.negotiation || act.negotiation > context.paused.length) { drop(); break; }
        if (judged.has(act.negotiation)) { drop(); break; }
        judged.add(act.negotiation);
        decided.push({
          tool: act.act,
          negotiationId: context.paused[act.negotiation - 1]!.negotiationId,
          reasoning: act.reasoning?.trim() || (act.act === "promote" ? "Worth surfacing." : "Not a match."),
        });
        break;
      }
      case "accept_opportunity": {
        // A verdict exists only as the client's explicit word — an event with
        // no client message cannot carry one. Whether the word WAS explicit
        // is the prompt's law; this refuses only the structurally impossible.
        if (context.event !== "user_message") { drop(); break; }
        if (!act.opportunity || act.opportunity > context.matches.length) { drop(); break; }
        decided.push({
          tool: "accept_opportunity",
          opportunityId: context.matches[act.opportunity - 1]!.opportunityId,
          ...(act.reason?.trim() ? { reason: act.reason.trim() } : {}),
        });
        break;
      }
      case "note_dossier": {
        const text = act.text?.trim();
        if (!text) { drop(); break; }
        decided.push({ tool: "note_dossier", text });
        break;
      }
      case "retire_dossier": {
        if (!act.entry || act.entry > context.dossier.length) { drop(); break; }
        decided.push({ tool: "retire_dossier", entryId: context.dossier[act.entry - 1]!.id });
        break;
      }
    }
  }

  // Nothing survived a list that asked for something: re-decide rather than
  // execute an empty turn the model never intended. A model that genuinely
  // decided nothing returns no acts at all, and that IS a valid answer.
  if (decided.length === 0 && parsed.data.acts.length > 0) return null;
  if (dropped > 0) {
    logger.warn("Personal-agent acts partially dropped", { event: context.event, dropped, kept: decided.length });
  }

  // Questions block acting. Ordering in code, not a prompt rule: an answer to
  // a knowledge question may change every verdict below it.
  if (decided.some((act) => act.tool === "ask")) {
    return decided.filter((act) => act.tool !== "kickoff" && act.tool !== "promote" && act.tool !== "reject");
  }
  return decided;
}

/** Re-exported for the graph's own thread rendering of a negotiator turn. */
export { renderThread };
export type { NegotiationTurn };
