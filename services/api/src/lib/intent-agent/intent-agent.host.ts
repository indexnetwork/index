/**
 * The IntentAgent's hands: act execution and the turn loop
 * (docs/plans/2026-08-21-holistic-intent-agent.md).
 *
 * Judgment happened upstream (intent-agent.turn.ts); everything here is
 * effects, and every effect leaves a ledger row.
 *
 * `answer_negotiation` is RETIRED, pending the AgentGraph step of the
 * negotiation-graph rewrite (docs/plans/2026-08-23-personal-agent-and-
 * negotiation-graphs.md). It used to drive `resumeParkedNegotiation` →
 * settle → claim → resume; that whole per-answer resume spine (and the
 * `needs_principal` pause payload it would resume from) no longer exists on
 * the protocol side. The design's replacement — `needs_principal` payloads
 * answered as ordinary DM messages judged by IS-A during reflect phase 1
 * (ASK) — is not built yet. Until then the executor still records the
 * answer as a dossier entry (never lost) and reports the honest state: not
 * resumed, nothing acted on automatically.
 *
 * The disclosure boundary is enforced structurally in ONE place: the answer
 * executor writes the answer as a dossier entry (source 'answer') before
 * anything else. Raw transcript never reaches the negotiation table through
 * code; the prompt carries the rule everywhere structure would be too
 * expensive.
 */
import { chunkReplyText, publishIntentAgentReplyChunk } from './intent-agent-reply.stream';
import type { NegotiatorVerdictResult } from '../agent/negotiator-verdict.host';
import { assembleIntentAgentContext } from './intent-agent.context';
import type { IntentAgentContextDeps, IntentAgentTurnContext } from './intent-agent.context';
import { IntentAgentTurn } from './intent-agent.turn';
import type { IntentAgentReply } from './intent-agent.turn';
import type { IntentAgentDecidedAct, IntentAgentEvent, IntentAgentExecutedAct, IntentAgentInboxEvent, IntentAgentReplyFallbackReason, IntentAgentTurnResult, IntentAgentUserMessageEvent, NegotiationAnswerOutcome } from './intent-agent.types';
import { log } from '../log';

const logger = log.lib.from('intent-agent.host');

/**
 * Fixed honest copy for an answer heard on a park whose negotiation cannot
 * continue (terminal opportunity / archived signal). Server-owned, never
 * model text: it tells the truth about why nothing resumed and PROPOSES the
 * next step — re-running discovery is offered, never performed.
 */
export const INTENT_AGENT_UNRESUMABLE_MESSAGE =
  'I recorded your answer, but that negotiation cannot pick up where it left off — '
  + 'the opportunity it was exploring has since closed, or the signal behind it is no longer active. '
  + 'Nothing happens automatically from here: if this still matters to you, tell me and '
  + 'I can propose re-running discovery under your updated signal.';

/**
 * Fixed honest copy delivered when the reply stage could not produce prose
 * that passes the safety gate (fail → one retry → this), or the reply model
 * call itself failed. Server-owned, never model text: the acts the turn
 * executed are durable either way, so the copy says that instead of
 * pretending nothing happened. The failure is ledgered on the act.
 */
export const INTENT_AGENT_REPLY_FALLBACK =
  'I acted on your message and everything I did is recorded, but I could not compose a clean reply just now. '
  + 'Ask me where things stand and I will lay it out.';

/** Structural slice of ChatSessionService the executor needs. */
export interface IntentAgentChatSessions {
  resolveNegotiatorIntentSession(userId: string, intentId: string): Promise<
    | { session: { id: string } }
    | { error: string; status: 400 | 403 | 404 | 500 }
  >;
  addMessage(params: { sessionId: string; role: 'user' | 'assistant' | 'system'; content: string; options?: string[] }): Promise<string>;
}

/** Injectable seams; production resolves the real collaborators lazily. */
export interface IntentAgentHostDeps {
  context?: IntentAgentContextDeps;
  turn?: Pick<IntentAgentTurn, 'decide'> & Partial<Pick<IntentAgentTurn, 'reply'>>;
  chatSessions?: IntentAgentChatSessions;
  /** The #1471 verdict lane, by opportunity id; production is the shared host. */
  verdict?: (
    userId: string,
    input: { intentId: string; opportunityId: string; reason?: string },
    target: 'accepted' | 'rejected',
  ) => Promise<NegotiatorVerdictResult>;
  /** Reply-chunk publisher; production is the Redis transport. */
  publishReplyChunk?: typeof publishIntentAgentReplyChunk;
  dossier?: {
    addEntry(input: { userId: string; intentId: string; text: string; source: 'user_message' | 'answer' | 'agent_note' }): Promise<string>;
    retireEntry(input: { userId: string; entryId: string }): Promise<boolean>;
  };
  ledger?: {
    append(input: { userId: string; intentId: string; event: Record<string, unknown>; act: Record<string, unknown> }): Promise<string>;
  };
}

async function resolveChatSessions(deps?: IntentAgentHostDeps): Promise<IntentAgentChatSessions> {
  return deps?.chatSessions ?? (await import('../../services/chat.service')).chatSessionService;
}

async function resolveDossier(deps?: IntentAgentHostDeps): Promise<NonNullable<IntentAgentHostDeps['dossier']>> {
  return deps?.dossier ?? (await import('../../adapters/intent-dossier.adapter')).intentDossierAdapter;
}

async function resolveLedger(deps?: IntentAgentHostDeps): Promise<NonNullable<IntentAgentHostDeps['ledger']>> {
  return deps?.ledger ?? (await import('../../adapters/intent-agent-ledger.adapter')).intentAgentLedgerAdapter;
}

async function appendLedger(
  event: IntentAgentEvent,
  act: IntentAgentExecutedAct,
  deps?: IntentAgentHostDeps,
): Promise<void> {
  const ledger = await resolveLedger(deps);
  await ledger.append({
    userId: event.userId,
    intentId: event.intentId,
    event: event as unknown as Record<string, unknown>,
    act: act as unknown as Record<string, unknown>,
  });
}

/**
 * Execute one `answer_negotiation`: dossier entry first (the boundary), then
 * the ledger row.
 *
 * RETIRED pending the AgentGraph step (see file header): there is no
 * `needs_principal` per-answer resume spine to drive any more. The answer is
 * still durably recorded as a dossier entry — nothing is lost — but nothing
 * resumes automatically. This is the same honest shape the old
 * `recorded_unresumable` outcome already gave callers, so the turn loop and
 * the tool lane need no further change: they deliver the fixed "cannot pick
 * up where it left off" copy either way.
 */
export async function executeAnswerNegotiation(
  event: IntentAgentEvent,
  input: { opportunityId: string; answer: string },
  deps?: IntentAgentHostDeps,
): Promise<Extract<IntentAgentExecutedAct, { tool: 'answer_negotiation' }>> {
  const dossier = await resolveDossier(deps);
  const dossierEntryId = await dossier.addEntry({
    userId: event.userId,
    intentId: event.intentId,
    text: input.answer,
    source: 'answer',
  });

  const outcome: NegotiationAnswerOutcome = 'recorded_unresumable';
  const act: Extract<IntentAgentExecutedAct, { tool: 'answer_negotiation' }> = {
    tool: 'answer_negotiation',
    opportunityId: input.opportunityId,
    answer: input.answer,
    dossierEntryId,
    outcome,
  };
  await appendLedger(event, act, deps);
  logger.info('intent_agent_answered_negotiation_stub', {
    userId: event.userId,
    intentId: event.intentId,
    opportunityId: input.opportunityId,
    outcome,
    event: event.kind,
    note: 'answer_negotiation retired pending AgentGraph reflect phase 1 (ASK) — see negotiation-graph-rewrite',
  });
  return act;
}

async function deliverMessage(
  event: IntentAgentInboxEvent,
  text: string,
  deps?: IntentAgentHostDeps,
  options?: string[],
): Promise<{ sessionId: string; messageId: string } | null> {
  const chatSessions = await resolveChatSessions(deps);
  const resolved = await chatSessions.resolveNegotiatorIntentSession(event.userId, event.intentId);
  if ('error' in resolved) {
    // 400/403/404 are permanent for this scope (archived or foreign intent);
    // there is no conversation to speak into and never will be. 500 retries.
    if (resolved.status === 500) throw new Error(`Negotiator session resolution failed: ${resolved.error}`);
    logger.warn('intent_agent_message_undeliverable', {
      userId: event.userId,
      intentId: event.intentId,
      status: resolved.status,
      error: resolved.error,
    });
    return null;
  }
  const messageId = await chatSessions.addMessage({
    sessionId: resolved.session.id,
    role: 'assistant',
    content: text,
    ...(options ? { options } : {}),
  });
  return { sessionId: resolved.session.id, messageId };
}

/**
 * Execute a decided act list in order. Every executed act is ledgered; a
 * failure mid-list throws so the inbox retry re-runs the turn (the spine
 * below `answer_negotiation` is settlement-keyed and idempotent; a repeated
 * `message_user` costs a duplicate line of chat, which is tolerable and
 * logged, never a duplicate resume).
 */
export async function executeIntentAgentActs(
  event: IntentAgentInboxEvent,
  decided: IntentAgentDecidedAct[],
  deps?: IntentAgentHostDeps,
): Promise<IntentAgentTurnResult> {
  const result: IntentAgentTurnResult = { acts: [], messages: [] };

  for (const act of decided) {
    switch (act.tool) {
      case 'message_user': {
        const delivered = await deliverMessage(event, act.text, deps, act.options);
        if (!delivered) break;
        const executed: IntentAgentExecutedAct = {
          tool: 'message_user',
          text: act.text,
          ...(act.options ? { options: act.options } : {}),
          ...delivered,
        };
        await appendLedger(event, executed, deps);
        result.acts.push(executed);
        result.messages.push(act.text);
        break;
      }
      case 'answer_negotiation': {
        const executed = await executeAnswerNegotiation(event, act, deps);
        if (executed.outcome === 'recorded_unresumable') {
          // The honest end: the answer is durably recorded, the negotiation
          // is over, and the client hears the truth plus a proposal — fixed
          // copy, never model text.
          const delivered = await deliverMessage(event, INTENT_AGENT_UNRESUMABLE_MESSAGE, deps);
          if (delivered) {
            executed.unresumableCopyMessageId = delivered.messageId;
            result.messages.push(INTENT_AGENT_UNRESUMABLE_MESSAGE);
          }
        }
        result.acts.push(executed);
        break;
      }
      case 'accept_opportunity':
      case 'reject_opportunity': {
        // The client's explicit word, executing through the SAME #1471 host
        // the persona tools and the MCP surface call — one write path, one
        // classification. Nothing here re-decides explicitness: that law is
        // the prompt's, pinned by the live eval.
        const verdict = deps?.verdict
          ?? (async (userId: string, input: { intentId: string; opportunityId: string; reason?: string }, target: 'accepted' | 'rejected') =>
            (await import('../agent/negotiator-verdict.host')).passVerdictOnOpportunity(userId, input, target, undefined));
        const outcome = await verdict(
          event.userId,
          { intentId: event.intentId, opportunityId: act.opportunityId, ...(act.reason ? { reason: act.reason } : {}) },
          act.tool === 'accept_opportunity' ? 'accepted' : 'rejected',
        );
        const executed: IntentAgentExecutedAct = {
          tool: act.tool,
          opportunityId: act.opportunityId,
          outcome: outcome.status,
          ...('counterparty' in outcome ? { counterparty: outcome.counterparty } : {}),
          ...(act.reason ? { reason: act.reason } : {}),
        };
        await appendLedger(event, executed, deps);
        result.acts.push(executed);
        break;
      }
      case 'note_dossier': {
        const dossier = await resolveDossier(deps);
        const entryId = await dossier.addEntry({
          userId: event.userId,
          intentId: event.intentId,
          text: act.text,
          source: 'agent_note',
        });
        const executed: IntentAgentExecutedAct = { tool: 'note_dossier', text: act.text, entryId };
        await appendLedger(event, executed, deps);
        result.acts.push(executed);
        break;
      }
      case 'retire_dossier': {
        const dossier = await resolveDossier(deps);
        const retired = await dossier.retireEntry({ userId: event.userId, entryId: act.entryId });
        const executed: IntentAgentExecutedAct = { tool: 'retire_dossier', entryId: act.entryId, retired };
        await appendLedger(event, executed, deps);
        result.acts.push(executed);
        break;
      }
      case 'wait': {
        const executed: IntentAgentExecutedAct = { tool: 'wait', ...(act.reason ? { reason: act.reason } : {}) };
        await appendLedger(event, executed, deps);
        result.acts.push(executed);
        break;
      }
    }
  }

  // Phase 2: a client message is always followed by the reply stage
  // (runIntentAgentTurn), which guarantees the client hears back — the old
  // rule-8 backstop's job, now owned by the stage that composes the reply.
  return result;
}

let defaultTurn: IntentAgentTurn | null = null;
function getDefaultTurn(): IntentAgentTurn {
  if (!defaultTurn) defaultTurn = new IntentAgentTurn();
  return defaultTurn;
}

/**
 * The reply stage (phase 2): a client-message turn always ends with the
 * agent's conversational reply — composed by a second model call over the
 * same context plus the just-executed acts, checked (isSafeQuestionMessage-
 * Prose, fail → one retry inside `reply`) BEFORE it is persisted or a single
 * chunk leaves the host. A reply the model could not produce safely becomes
 * the fixed fallback copy, and the failure is ledgered on the act — never a
 * thrown error: the acts already executed, and re-running them to retry
 * prose would trade a wording problem for duplicate effects.
 */
async function runReplyStage(
  event: IntentAgentUserMessageEvent,
  context: IntentAgentTurnContext,
  turn: NonNullable<IntentAgentHostDeps['turn']>,
  result: IntentAgentTurnResult,
  deps?: IntentAgentHostDeps,
): Promise<void> {
  let composed: IntentAgentReply | null = null;
  let fallback: IntentAgentReplyFallbackReason | undefined;
  if (!turn.reply) {
    // An injected judgment seam without a reply seam cannot compose one.
    fallback = 'model_error';
  } else {
    try {
      composed = await turn.reply(context, result.acts);
      if (composed === null) fallback = 'safety_check_failed';
    } catch (err) {
      logger.error('intent_agent_reply_stage_failed', {
        userId: event.userId,
        intentId: event.intentId,
        error: err instanceof Error ? err.message : String(err),
      });
      fallback = 'model_error';
    }
  }
  if (fallback) {
    logger.warn('intent_agent_reply_fell_back', {
      userId: event.userId,
      intentId: event.intentId,
      reason: fallback,
    });
  }

  const content = composed?.text ?? INTENT_AGENT_REPLY_FALLBACK;
  const options = composed?.options;
  const delivered = await deliverMessage(event, content, deps, options);
  if (!delivered) return;
  const executed: IntentAgentExecutedAct = {
    tool: 'message_user',
    text: content,
    ...(options ? { options } : {}),
    ...delivered,
    stage: 'reply',
    ...(fallback ? { fallback } : {}),
  };
  await appendLedger(event, executed, deps);
  result.acts.push(executed);
  result.messages.push(content);
}

/**
 * Stream a completed client-message turn's delivered messages to whichever
 * controller is waiting, as ordered chunks on the turn's channel. Runs only
 * AFTER everything is checked and persisted (check-then-stream); joining the
 * chunks reproduces `result.messages.join('\n\n')` exactly, so the
 * controller's fallback and the stream can never disagree about the text.
 */
async function publishTurnMessages(
  event: IntentAgentUserMessageEvent,
  result: IntentAgentTurnResult,
  deps?: IntentAgentHostDeps,
): Promise<void> {
  if (result.messages.length === 0) return;
  const publish = deps?.publishReplyChunk ?? publishIntentAgentReplyChunk;
  let seq = 0;
  for (const [index, message] of result.messages.entries()) {
    const prefixed = index > 0 ? `\n\n${message}` : message;
    for (const content of chunkReplyText(prefixed)) {
      seq += 1;
      await publish(event.messageId, { seq, content });
    }
  }
}

/**
 * The loop, whole: event → assemble context → one judgment → execute the
 * acts — and, for a client message, the streaming reply stage (phase 2).
 * Background events (`negotiation_needs_input`) skip the reply stage: no
 * client is waiting, and the acts stage keeps `message_user` for authoring
 * asks exactly as phase 1. This is what the inbox worker runs, one event at
 * a time per intent.
 */
export async function runIntentAgentTurn(
  event: IntentAgentInboxEvent,
  deps?: IntentAgentHostDeps,
): Promise<IntentAgentTurnResult> {
  const context: IntentAgentTurnContext = await assembleIntentAgentContext(event, deps?.context);
  const turn = deps?.turn ?? getDefaultTurn();
  const decided = await turn.decide(context);
  logger.info('intent_agent_turn_decided', {
    userId: event.userId,
    intentId: event.intentId,
    event: event.kind,
    acts: decided.map((act) => act.tool),
  });
  const result = await executeIntentAgentActs(event, decided, deps);
  if (event.kind === 'user_message') {
    await runReplyStage(event, context, turn, result, deps);
    await publishTurnMessages(event, result, deps);
  }
  return result;
}
