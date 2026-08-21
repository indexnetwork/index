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
import { INTENT_AGENT_SYSTEM_PROMPT } from './intent-agent.prompt';
import type { IntentAgentTurnContext } from './intent-agent.context';
import type { IntentAgentDecidedAct } from './intent-agent.types';
import { log } from '../log';

const logger = log.lib.from('intent-agent.turn');

const MAX_TURN_CHARS = 500;
const MAX_TRANSCRIPT_TURNS = 6;
const MAX_DM_CHARS = 1000;

// Optional fields are `.nullable().optional()`: the OpenAI structured-output
// schema translation refuses optional-without-nullable, and the validator
// below treats null and absent alike.
const DecidedActsSchema = z.object({
  acts: z.array(z.object({
    act: z.enum(['message_user', 'answer_negotiation', 'note_dossier', 'retire_dossier', 'wait']),
    /** message_user: the message. note_dossier: the fact. */
    text: z.string().max(4000).nullable().optional(),
    /** answer_negotiation: 1-based number from the waiting list. */
    negotiation: z.number().int().min(1).nullable().optional(),
    /** answer_negotiation: the answer, restated so it stands alone. */
    answer: z.string().max(4000).nullable().optional(),
    /** retire_dossier: 1-based number from the dossier list. */
    entry: z.number().int().min(1).nullable().optional(),
    /** wait: why nothing needs doing. */
    reason: z.string().max(500).nullable().optional(),
  })).min(1).max(6),
});

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
    return `THE EVENT: your client just wrote to you:\n"${truncate(event.text, 4000)}"\n\nDecide what to do with it. If it answers something a negotiation is waiting on, resolve that negotiation with it. Either way, reply to your client.`;
  }
  const position = context.parked.findIndex((parked) => parked.opportunityId === event.opportunityId);
  const which = position >= 0
    ? `negotiation ${position + 1} in the waiting list`
    : 'a negotiation that has since moved on (it is no longer in the waiting list — do not act for it)';
  return `THE EVENT: ${which} just paused because it needs your client's input.\n\nDecide: if the dossier or the conversation already contains what it needs, answer it directly without asking. Otherwise ask your client in your own words. If it is no longer waiting, wait.`;
}

/** What judgment sees, rendered; exported for the live eval's transparency. */
export function renderIntentAgentTurn(context: IntentAgentTurnContext): string {
  return [
    context.signalText ? `Your client's signal: ${truncate(context.signalText, 800)}` : 'Your client\'s signal text is unavailable.',
    '',
    renderParked(context),
    '',
    renderDossier(context),
    renderLedger(context),
    '',
    renderDm(context),
    '',
    renderEvent(context),
  ].join('\n');
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
        { role: 'system', content: INTENT_AGENT_SYSTEM_PROMPT },
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
    const decided: IntentAgentDecidedAct[] = [];
    for (const act of acts) {
      switch (act.act) {
        case 'message_user': {
          const text = act.text?.trim();
          if (!text || !isSafeQuestionMessageProse(text)) return null;
          decided.push({ tool: 'message_user', text });
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
   * Raw structured-model round trip. A seam so tests drive the
   * validate → retry loop without a live provider — the model is constructed
   * here, not in the constructor, so tests never need a key.
   */
  protected async callModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey?.trim()) throw new Error('IntentAgentTurn: OPENROUTER_API_KEY is required');
    const timeoutEnv = Number.parseInt(process.env.OPENROUTER_REQUEST_TIMEOUT_MS ?? '', 10);
    const model = new ChatOpenAI({
      model: this.modelName,
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
        apiKey,
      },
      temperature: 0.2,
      maxTokens: 4096,
      timeout: Number.isFinite(timeoutEnv) && timeoutEnv > 0 ? timeoutEnv : 60_000,
      maxRetries: 1,
    });
    return model
      .withStructuredOutput(DecidedActsSchema, { name: 'intent_agent_acts' })
      .invoke(messages);
  }
}
