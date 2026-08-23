/**
 * The IntentAgent's judgment: one model turn per event
 * (docs/plans/2026-08-21-holistic-intent-agent.md, "The loop").
 *
 * The model is shown the assembled context — the waiting negotiations and
 * dossier entries as NUMBERED lists — and returns a short list of acts
 * referring to them strictly by number. It never sees or emits an id, so it
 * cannot mint a ref that would resume the wrong negotiation or retire the
 * wrong fact; an act naming a number outside the lists rejects the whole
 * round trip. Fail-closed in the routing direction, exactly as the retired
 * answer router was: validate → retry once → throw, and the inbox queue's
 * retry policy covers a transient model outage.
 *
 * Model/config defaults to the negotiator persona chat's
 * (`getModelName('chat')`), per the direction: this is the same agent the
 * client talks to, holding the same judgment.
 */
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

import { getModelName } from '@indexnetwork/protocol';

import { isSafeQuestionMessageProse } from '../question/negotiation-question.contract';
import { INTENT_AGENT_REPLY_INSTRUCTION, buildIntentAgentSystemPrompt } from './intent-agent.prompt';
import type { IntentAgentTurnContext } from './intent-agent.context';
import type { IntentAgentDecidedAct, IntentAgentExecutedAct } from './intent-agent.types';
import { log } from '../log';

const logger = log.lib.from('intent-agent.turn');

const MAX_TURN_CHARS = 500;
const MAX_TRANSCRIPT_TURNS = 6;
const MAX_DM_CHARS = 1000;
const MAX_OPTION_CHARS = 60;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

/**
 * Canned replies, normalized. Options are a shortcut for typing and nothing
 * more, so a malformed set is DROPPED rather than rejected: the question
 * still reads fine as prose, and refusing the whole round trip over chip
 * wording would trade a convenience for a lost turn. Blank, over-long,
 * duplicate and leak-tripping candidates go — a chip is delivered prose and
 * passes the same identifier gate the message does; fewer than two survivors
 * means no chips at all (one chip is not a choice), and more than four are
 * cut to the first four.
 *
 * @param raw - Whatever the model emitted for `options`
 * @returns 2-4 distinct short strings, or undefined for "no chips"
 */
export function normalizeMessageOptions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const options: string[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== 'string') continue;
    const text = candidate.trim();
    if (!text || text.length > MAX_OPTION_CHARS) continue;
    if (!isSafeQuestionMessageProse(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(text);
    if (options.length === MAX_OPTIONS) break;
  }
  return options.length >= MIN_OPTIONS ? options : undefined;
}

// Optional fields are `.nullable().optional()`: the OpenAI structured-output
// schema translation refuses optional-without-nullable, and the validator
// below treats null and absent alike.
const DecidedActsSchema = z.object({
  acts: z.array(z.object({
    act: z.enum(['message_user', 'answer_negotiation', 'accept_opportunity', 'reject_opportunity', 'note_dossier', 'retire_dossier', 'wait']),
    /** message_user: the message. note_dossier: the fact. */
    text: z.string().max(4000).nullable().optional(),
    /** message_user: 2-4 short canned replies, when the message asks. */
    options: z.array(z.string().max(MAX_OPTION_CHARS)).max(8).nullable().optional(),
    /** answer_negotiation: 1-based number from the waiting list. */
    negotiation: z.number().int().min(1).nullable().optional(),
    /** answer_negotiation: the answer, restated so it stands alone. */
    answer: z.string().max(4000).nullable().optional(),
    /** accept/reject_opportunity: 1-based number from the matches list. */
    opportunity: z.number().int().min(1).nullable().optional(),
    /** retire_dossier: 1-based number from the dossier list. */
    entry: z.number().int().min(1).nullable().optional(),
    /** wait: why nothing needs doing. accept/reject: the client's words. */
    reason: z.string().max(500).nullable().optional(),
  })).min(1).max(6),
});

/**
 * The reply stage's shape (phase 2 + options): the prose plus, when the reply
 * asks the client something, the same 2-4 canned replies the acts stage may
 * attach. Structured rather than plain text ONLY so the chips can travel with
 * the words that earned them — `reply` is the delivered prose, unchanged.
 */
const ReplySchema = z.object({
  reply: z.string().max(4000),
  options: z.array(z.string().max(MAX_OPTION_CHARS)).max(8).nullable().optional(),
});

/** A composed reply: the prose the client reads, plus optional chips. */
export interface IntentAgentReply {
  text: string;
  options?: string[];
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function renderParked(context: IntentAgentTurnContext): string {
  if (context.parked.length === 0) return 'Waiting negotiations: none.';
  const lines = context.parked.map((parked, index) => {
    const parts = [`${index + 1}. Parked ${parked.kind === 'mid_flight' ? 'mid-negotiation' : 'after stalling'}`];
    if (parked.dimension) parts.push(`   Stuck on: ${parked.dimension}`);
    if (parked.reason) parts.push(`   Pause category: ${parked.reason}`);
    if (parked.question) parts.push(`   What it needs from your client: [${parked.question.title}] ${parked.question.prompt}`);
    if (parked.answerhood) parts.push(`   Resolves when: ${parked.answerhood.ok_when} / conflicts when: ${parked.answerhood.conflict_when}`);
    const tail = parked.transcript.slice(-MAX_TRANSCRIPT_TURNS);
    if (tail.length > 0) {
      parts.push('   How it got here (your side of the table):');
      tail.forEach((turn) => {
        parts.push(`   - ${turn.action}: ${truncate(turn.reasoning, MAX_TURN_CHARS)}${turn.message ? ` — said: ${truncate(turn.message, MAX_TURN_CHARS)}` : ''}`);
      });
    }
    return parts.join('\n');
  });
  return `Waiting negotiations (refer to them by number):\n${lines.join('\n')}`;
}

function renderDossier(context: IntentAgentTurnContext): string {
  if (context.dossier.length === 0) return 'Dossier: empty.';
  const lines = context.dossier.map((entry, index) =>
    `${index + 1}. (${entry.source}, ${entry.createdAt.toISOString().slice(0, 10)}) ${truncate(entry.text, MAX_TURN_CHARS)}`);
  return `Dossier — the facts you may use at the negotiation table (refer by number):\n${lines.join('\n')}`;
}

function renderOpportunities(context: IntentAgentTurnContext): string {
  if (context.opportunities.length === 0) return 'Active matches on this signal: none right now.';
  const lines = context.opportunities.map((opportunity, index) =>
    `${index + 1}. ${opportunity.label}`);
  return `Your client's active matches on this signal (refer by number; a verdict acts on exactly one of these):
${lines.join('\n')}`;
}

function renderLedger(context: IntentAgentTurnContext): string {
  if (context.recentActs.length === 0) return '';
  const lines = context.recentActs.slice(0, 10).map((row) => {
    const tool = typeof row.act.tool === 'string' ? row.act.tool : 'unknown';
    const detail = typeof row.act.text === 'string'
      ? truncate(row.act.text, 200)
      : typeof row.act.answer === 'string'
        ? truncate(row.act.answer, 200)
        : '';
    return `- ${row.createdAt.toISOString()} ${tool}${detail ? `: ${detail}` : ''}`;
  });
  return `\nYour own recent acts on this signal (newest first):\n${lines.join('\n')}`;
}

function renderDm(context: IntentAgentTurnContext): string {
  if (context.recentDm.length === 0) return 'The conversation with your client is empty so far.';
  const lines = context.recentDm.map((message) =>
    `- ${message.role === 'user' ? 'Client' : 'You'}: ${truncate(message.content, MAX_DM_CHARS)}`);
  return `Your conversation with your client about this signal (most recent last):\n${lines.join('\n')}`;
}

function renderEvent(context: IntentAgentTurnContext): string {
  const { event } = context;
  if (event.kind === 'user_message') {
    return `THE EVENT: your client just wrote to you:\n"${truncate(event.text, 4000)}"\n\nDecide what to do with it. If it answers something a negotiation is waiting on, resolve that negotiation with it. If it explicitly renders a verdict on a listed match, execute the verdict — and remember the verdict law: a hedge is not a verdict. If it states a fact worth keeping, note it. If none of your tools apply, wait — your reply to your client is composed in a separate step after these acts, so do not use message_user here.`;
  }
  const position = context.parked.findIndex((parked) => parked.opportunityId === event.opportunityId);
  const which = position >= 0
    ? `negotiation ${position + 1} in the waiting list`
    : 'a negotiation that has since moved on (it is no longer in the waiting list — do not act for it)';
  return `THE EVENT: ${which} just paused because it needs your client's input.\n\nDecide: if the dossier or the conversation already contains what it needs, answer it directly without asking. Otherwise ask your client in your own words. If it is no longer waiting, wait.`;
}

/**
 * The law this turn runs under, bound to the agent's own name. Both stages
 * of a turn build it from the SAME context, so the acts stage and the reply
 * stage are unmistakably the same agent to the client.
 */
function systemPrompt(context: IntentAgentTurnContext): string {
  return buildIntentAgentSystemPrompt(context.agentName ? { agentName: context.agentName } : {});
}

/** What judgment sees, rendered; exported for the live eval's transparency. */
export function renderIntentAgentTurn(context: IntentAgentTurnContext): string {
  return [
    context.signalText ? `Your client's signal: ${truncate(context.signalText, 800)}` : 'Your client\'s signal text is unavailable.',
    '',
    renderParked(context),
    '',
    renderOpportunities(context),
    '',
    renderDossier(context),
    renderLedger(context),
    '',
    renderDm(context),
    '',
    renderEvent(context),
  ].join('\n');
}

/** Compact prose record of the acts the turn just executed, for the reply. */
function renderExecutedAct(act: IntentAgentExecutedAct): string {
  switch (act.tool) {
    case 'message_user':
      return `- You sent your client a message: ${act.text}`;
    case 'answer_negotiation':
      return `- You resolved a waiting negotiation with the answer "${act.answer}" (outcome: ${act.outcome}).`;
    case 'accept_opportunity':
    case 'reject_opportunity': {
      const verb = act.tool === 'accept_opportunity' ? 'ACCEPTED' : 'REJECTED';
      return act.outcome === 'executed'
        ? `- You executed your client's verdict: ${verb} ${act.counterparty ?? 'the match'}.`
        : `- You tried to execute your client's verdict (${verb.toLowerCase()}) but it did not land: ${act.outcome === 'already_decided' ? 'they had already committed on this match — it is the other side\'s move now' : act.outcome === 'unknown_counterparty' || act.outcome === 'none_actionable' ? 'that match is no longer open to a verdict' : 'the write failed'}. Tell your client honestly.`;
    }
    case 'note_dossier':
      return `- You noted a fact for the negotiation table: ${act.text}`;
    case 'retire_dossier':
      return act.retired ? '- You retired an outdated dossier entry.' : '- You tried to retire a dossier entry that was already gone.';
    case 'wait':
      return `- You decided nothing needed doing${act.reason ? ` (${act.reason})` : ''}.`;
  }
}

/** What the reply stage sees, rendered; exported for the live eval's transparency. */
export function renderIntentAgentReplyStage(
  context: IntentAgentTurnContext,
  executed: IntentAgentExecutedAct[],
): string {
  const acts = executed.length === 0
    ? 'You executed no acts this turn.'
    : `The acts you just executed for this turn:\n${executed.map(renderExecutedAct).join('\n')}`;
  // A client message that judged to `wait` alone executed literally nothing —
  // no message sent, no one contacted, no negotiation moved — and the reply
  // stage has been observed fabricating exactly that ("I've reached out to
  // ... to get more specific details") when the client's own words read like
  // an answer to something. Spelled out here, in context, rather than trusted
  // to the general reply law alone: this is the one shape where the model has
  // its own client's message right in front of it inviting that story.
  const waitedOnClientMessage = context.event.kind === 'user_message'
    && executed.length === 1 && executed[0]!.tool === 'wait';
  const waitNotice = waitedOnClientMessage
    ? `\n\nYour client just wrote to you and you decided nothing needed doing this turn. You sent NOTHING, contacted NO ONE, and moved NO negotiation forward. If their message reads as an answer to a question, it is NOT resolved — whatever it might have answered stands exactly as it did before they wrote. Tell your client the truth about what did and did not happen; never say you reached out to someone or made progress you did not make.`
    : '';
  return `${renderIntentAgentTurn(context)}\n\n${acts}${waitNotice}\n\nNow write your reply to your client.`;
}

export interface IntentAgentTurnConfig {
  /** Model override; defaults to the negotiator persona chat's model. */
  model?: string;
}

export class IntentAgentTurn {
  private readonly modelName: string;

  constructor(config?: IntentAgentTurnConfig) {
    this.modelName = config?.model ?? getModelName('chat');
  }

  /**
   * One judgment: context in, decided acts out (indices already resolved to
   * ids). Validate → retry once → throw; the caller's queue retry covers a
   * transient outage, and a turn that cannot be judged must not be guessed.
   */
  async decide(context: IntentAgentTurnContext): Promise<IntentAgentDecidedAct[]> {
    const userMessage = renderIntentAgentTurn(context);
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.callModel([
        { role: 'system', content: systemPrompt(context) },
        { role: 'user', content: userMessage },
      ]);
      const decided = this.validate(raw, context);
      if (decided) return decided;
      logger.warn('intent_agent_turn_output_rejected', { attempt: attempt + 1, event: context.event.kind });
    }
    throw new Error('IntentAgent turn produced no valid act list');
  }

  /**
   * Schema + reference validation of one round trip. Everything here refuses
   * the impossible — numbers outside the lists, contradictory wait, prose
   * that trips the identifier-leak gate — and nothing here re-decides.
   */
  private validate(raw: unknown, context: IntentAgentTurnContext): IntentAgentDecidedAct[] | null {
    const parsed = DecidedActsSchema.safeParse(raw);
    if (!parsed.success) return null;

    const acts = parsed.data.acts;
    // wait is "nothing needs doing" — it cannot coexist with doing something.
    if (acts.some((act) => act.act === 'wait') && acts.length > 1) return null;

    const answered = new Set<number>();
    const judged = new Set<number>();
    const decided: IntentAgentDecidedAct[] = [];
    for (const act of acts) {
      switch (act.act) {
        case 'message_user': {
          // Phase 2: when the client themselves wrote, the reply is the
          // dedicated streaming stage's — an acts-stage message would race
          // it and double-speak. Structural, not judgment: rejected here so
          // the retry re-decides without it.
          if (context.event.kind === 'user_message') return null;
          const text = act.text?.trim();
          if (!text || !isSafeQuestionMessageProse(text)) return null;
          const options = normalizeMessageOptions(act.options);
          decided.push({ tool: 'message_user', text, ...(options ? { options } : {}) });
          break;
        }
        case 'accept_opportunity':
        case 'reject_opportunity': {
          // A verdict exists only as the client's explicit word — an event
          // with no client message cannot carry one. Whether the word WAS
          // explicit is the prompt's law (pinned by the live eval); this
          // only refuses the structurally impossible.
          if (context.event.kind !== 'user_message') return null;
          if (!act.opportunity || act.opportunity > context.opportunities.length) return null;
          if (judged.has(act.opportunity)) return null;
          judged.add(act.opportunity);
          decided.push({
            tool: act.act,
            opportunityId: context.opportunities[act.opportunity - 1]!.opportunityId,
            ...(act.reason?.trim() ? { reason: act.reason.trim() } : {}),
          });
          break;
        }
        case 'answer_negotiation': {
          const answer = act.answer?.trim();
          if (!answer || !act.negotiation) return null;
          if (act.negotiation > context.parked.length || answered.has(act.negotiation)) return null;
          answered.add(act.negotiation);
          decided.push({
            tool: 'answer_negotiation',
            opportunityId: context.parked[act.negotiation - 1]!.opportunityId,
            answer,
          });
          break;
        }
        case 'note_dossier': {
          const text = act.text?.trim();
          if (!text) return null;
          decided.push({ tool: 'note_dossier', text });
          break;
        }
        case 'retire_dossier': {
          if (!act.entry || act.entry > context.dossier.length) return null;
          decided.push({ tool: 'retire_dossier', entryId: context.dossier[act.entry - 1]!.id });
          break;
        }
        case 'wait':
          decided.push({ tool: 'wait', ...(act.reason?.trim() ? { reason: act.reason.trim() } : {}) });
          break;
      }
    }
    return decided;
  }

  /**
   * The reply stage (phase 2): the streaming conversational reply for a
   * client-message turn, composed AFTER the acts executed. One plain-text
   * call under the same law plus the reply instruction; the returned prose
   * must pass the identifier-leak gate before anyone sees it — fail → one
   * retry → null, and the caller delivers the fixed fallback copy. This is
   * the honest resolution of the streaming tension: the check runs on the
   * COMPLETED reply, and the transport streams it only afterwards
   * (check-then-stream) — no unchecked token ever leaves the host.
   *
   * Model errors propagate — the caller distinguishes a provider outage
   * (fallback, reason 'model_error') from refused prose.
   */
  async reply(context: IntentAgentTurnContext, executed: IntentAgentExecutedAct[]): Promise<IntentAgentReply | null> {
    const userMessage = renderIntentAgentReplyStage(context, executed);
    const system = `${systemPrompt(context)}\n\n${INTENT_AGENT_REPLY_INSTRUCTION}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = ReplySchema.safeParse(await this.callReplyModel([
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ]));
      if (parsed.success) {
        const text = parsed.data.reply.trim();
        if (text && isSafeQuestionMessageProse(text)) {
          const options = normalizeMessageOptions(parsed.data.options);
          return { text, ...(options ? { options } : {}) };
        }
      }
      logger.warn('intent_agent_reply_rejected', { attempt: attempt + 1, malformed: !parsed.success });
    }
    return null;
  }

  /**
   * Raw structured-model round trip. A seam so tests drive the
   * validate → retry loop without a live provider — the model is constructed
   * here, not in the constructor, so tests never need a key.
   */
  protected async callModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return this.buildModel()
      .withStructuredOutput(DecidedActsSchema, { name: 'intent_agent_acts' })
      .invoke(messages);
  }

  /** Raw round trip for the reply stage; same seam discipline. */
  protected async callReplyModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    return this.buildModel()
      .withStructuredOutput(ReplySchema, { name: 'intent_agent_reply' })
      .invoke(messages);
  }

  private buildModel(): ChatOpenAI {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey?.trim()) throw new Error('IntentAgentTurn: OPENROUTER_API_KEY is required');
    return new ChatOpenAI({
      model: this.modelName,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
      },
      temperature: 0.2,
      maxTokens: 4096,
      timeout: 60_000,
      maxRetries: 1,
    });
  }
}
