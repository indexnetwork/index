/**
 * The IntentAgent's hands: act execution and the turn loop
 * (docs/plans/2026-08-21-holistic-intent-agent.md).
 *
 * Judgment happened upstream (intent-agent.turn.ts); everything here is
 * effects, and every effect leaves a ledger row. The negotiation spine is
 * REUSED, never reimplemented: `answer_negotiation` drives the same
 * `resumeParkedNegotiation` → settle → claim → resume path the card answer
 * and the DM answer always used, through the production consumption ports.
 *
 * The disclosure boundary is enforced structurally in ONE place: the answer
 * executor writes the answer as a dossier entry (source 'answer') and feeds
 * the resume from that entry's text. Raw transcript never reaches the
 * negotiation table through code; the prompt carries the rule everywhere
 * structure would be too expensive.
 */
import { resumeParkedNegotiation } from '@indexnetwork/protocol';
import type { NegotiationAnswerConsumptionPorts } from '@indexnetwork/protocol';

import { assembleIntentAgentContext } from './intent-agent.context';
import type { IntentAgentContextDeps, IntentAgentTurnContext } from './intent-agent.context';
import { IntentAgentTurn } from './intent-agent.turn';
import type { IntentAgentDecidedAct, IntentAgentEvent, IntentAgentExecutedAct, IntentAgentInboxEvent, IntentAgentTurnResult } from './intent-agent.types';
import { log } from '../log';

const logger = log.lib.from('intent-agent.host');

/**
 * Whether the signal's IntentAgent owns a DM turn: true while a negotiation
 * is parked awaiting this client on this signal
 * (docs/plans/2026-08-21-holistic-intent-agent.md, "Answer side"). A cheap
 * honest read, not judgment — whether a message ANSWERS anything is the
 * agent's call, made inside its serialized turn. Never throws: an unreadable
 * parked set falls through to the persona, exactly as the retired
 * answer-precedence gate failed open.
 */
export async function intentAgentOwnsTurn(userId: string, intentId: string): Promise<boolean> {
  try {
    const { parkedNegotiationReaderAdapter } = await import('../../adapters/parked-negotiation.reader.adapter');
    const parked = await parkedNegotiationReaderAdapter.readParkedNegotiations(userId, intentId);
    return parked.length > 0;
  } catch (err) {
    logger.error('intent_agent_turn_ownership_read_failed; falling through to the persona', {
      userId,
      intentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

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
 * Backstop reply for the impossible case rule 8 forbids: the client spoke
 * and the agent's acts delivered nothing back. Code-owned copy — the prompt
 * carries the judgment; this only refuses silence.
 */
export const INTENT_AGENT_SILENT_TURN_REPLY =
  'Noted — I have taken that in. Nothing on this signal needs your attention right now.';

/** Structural slice of ChatSessionService the executor needs. */
export interface IntentAgentChatSessions {
  resolveNegotiatorIntentSession(userId: string, intentId: string): Promise<
    | { session: { id: string } }
    | { error: string; status: 400 | 403 | 404 | 500 }
  >;
  addMessage(params: { sessionId: string; role: 'user' | 'assistant' | 'system'; content: string }): Promise<string>;
}

/** Injectable seams; production resolves the real collaborators lazily. */
export interface IntentAgentHostDeps {
  context?: IntentAgentContextDeps;
  turn?: Pick<IntentAgentTurn, 'decide'>;
  chatSessions?: IntentAgentChatSessions;
  dossier?: {
    addEntry(input: { userId: string; intentId: string; text: string; source: 'user_message' | 'answer' | 'agent_note' }): Promise<string>;
    retireEntry(input: { userId: string; entryId: string }): Promise<boolean>;
  };
  ledger?: {
    append(input: { userId: string; intentId: string; event: Record<string, unknown>; act: Record<string, unknown> }): Promise<string>;
  };
  answerPorts?: NegotiationAnswerConsumptionPorts;
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

async function resolveAnswerPorts(deps?: IntentAgentHostDeps): Promise<NegotiationAnswerConsumptionPorts> {
  return deps?.answerPorts
    ?? (await import('../question/negotiation-answer.ports')).negotiationAnswerConsumptionPorts();
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
 * the existing spine, then the ledger row. Shared verbatim by the turn loop
 * and the tool lane (`answer_pending_question`, persona and MCP alike), so
 * there is exactly one place an answer can enter a negotiation from.
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

  const ports = await resolveAnswerPorts(deps);
  const outcome = await resumeParkedNegotiation(ports, {
    opportunityId: input.opportunityId,
    userId: event.userId,
    answerText: input.answer,
  });

  const act: Extract<IntentAgentExecutedAct, { tool: 'answer_negotiation' }> = {
    tool: 'answer_negotiation',
    opportunityId: input.opportunityId,
    answer: input.answer,
    dossierEntryId,
    outcome,
  };
  await appendLedger(event, act, deps);
  logger.info('intent_agent_answered_negotiation', {
    userId: event.userId,
    intentId: event.intentId,
    opportunityId: input.opportunityId,
    outcome,
    event: event.kind,
  });
  return act;
}

async function deliverMessage(
  event: IntentAgentInboxEvent,
  text: string,
  deps?: IntentAgentHostDeps,
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
        const delivered = await deliverMessage(event, act.text, deps);
        if (!delivered) break;
        const executed: IntentAgentExecutedAct = { tool: 'message_user', text: act.text, ...delivered };
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

  // Rule 8's backstop: the client spoke, so the client hears back. Code-owned
  // copy, not ledgered as an agent act — the agent's decision (whatever it
  // was) is already on the ledger above.
  if (event.kind === 'user_message' && result.messages.length === 0) {
    const delivered = await deliverMessage(event, INTENT_AGENT_SILENT_TURN_REPLY, deps);
    if (delivered) result.messages.push(INTENT_AGENT_SILENT_TURN_REPLY);
  }

  return result;
}

let defaultTurn: IntentAgentTurn | null = null;
function getDefaultTurn(): IntentAgentTurn {
  if (!defaultTurn) defaultTurn = new IntentAgentTurn();
  return defaultTurn;
}

/**
 * The loop, whole: event → assemble context → one judgment → execute the
 * acts. This is what the inbox worker runs, one event at a time per intent.
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
  return executeIntentAgentActs(event, decided, deps);
}
