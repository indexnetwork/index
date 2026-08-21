/**
 * IntentAgent context assembly (docs/plans/2026-08-21-holistic-intent-agent.md).
 *
 * Assembled fresh for every turn, all from honest reads: the parked set is
 * the open/waiting state (the parked negotiation remains the only durable
 * record of an information need), the dossier is the disclosure boundary,
 * the DM transcript is the agent's memory, and the ledger is its own recent
 * conduct. Nothing here is cached or carried between turns.
 */
import type { ParkedNegotiation } from '../../adapters/parked-negotiation.reader.adapter';
import type { ActionableCounterparty } from '../agent/negotiator-verdict.host';
import type { IntentDossierEntryRow } from '../../adapters/intent-dossier.adapter';
import type { IntentAgentLedgerRow } from '../../adapters/intent-agent-ledger.adapter';
import type { IntentAgentInboxEvent } from './intent-agent.types';

/** How much conversation memory a turn reads. */
const MAX_DM_MESSAGES = 20;
const MAX_LEDGER_ACTS = 20;
/**
 * How many active matches a turn sees. Bounded so a prolific signal cannot
 * flood the prompt; the newest matches are kept because they are the ones a
 * verdict or a status question is most likely about, and what is dropped is
 * logged so the truncation is never silent.
 */
const MAX_OPPORTUNITIES = 12;

export interface IntentAgentTurnContext {
  event: IntentAgentInboxEvent;
  /** The signal's own text; null when unreadable. */
  signalText: string | null;
  /** The waiting negotiations, oldest park first — the numbered list. */
  parked: ParkedNegotiation[];
  /** Active dossier entries, oldest first — the numbered list. */
  dossier: IntentDossierEntryRow[];
  /**
   * This signal's active matches (statuses a verdict can still land on),
   * oldest first — the numbered list verdict acts refer to. Served by the
   * SAME reader the #1471 verdict tools use, so the state the agent reasons
   * over is the state the verdict host would act on. Bounded to
   * MAX_OPPORTUNITIES, keeping the newest.
   */
  opportunities: ActionableCounterparty[];
  /** Recent DM transcript, oldest first. */
  recentDm: Array<{ role: string; content: string }>;
  /** The agent's own recent acts, newest first. */
  recentActs: IntentAgentLedgerRow[];
}

/** Injectable seams; production resolves the real collaborators lazily. */
export interface IntentAgentContextDeps {
  readParkedNegotiations?: (userId: string, intentId: string) => Promise<ParkedNegotiation[]>;
  readDossier?: (userId: string, intentId: string) => Promise<IntentDossierEntryRow[]>;
  readOpportunities?: (userId: string, intentId: string) => Promise<ActionableCounterparty[]>;
  readLedger?: (userId: string, intentId: string, limit: number) => Promise<IntentAgentLedgerRow[]>;
  findSession?: (userId: string, intentId: string) => Promise<{ id: string } | null>;
  getSessionMessages?: (sessionId: string) => Promise<Array<{ role: string; content: string }>>;
  getIntentText?: (intentId: string) => Promise<string | null>;
}

export async function assembleIntentAgentContext(
  event: IntentAgentInboxEvent,
  deps?: IntentAgentContextDeps,
): Promise<IntentAgentTurnContext> {
  const { userId, intentId } = event;

  const readParked = deps?.readParkedNegotiations
    ?? (async (id: string, intent: string) => (await import('../../adapters/parked-negotiation.reader.adapter'))
      .parkedNegotiationReaderAdapter.readParkedNegotiations(id, intent));
  const readDossier = deps?.readDossier
    ?? (async (id: string, intent: string) => (await import('../../adapters/intent-dossier.adapter'))
      .intentDossierAdapter.readActiveEntries(id, intent));
  // The verdict reader never throws (an unreadable list reads as "no
  // verdicts to offer") — the same degradation the persona prompt used.
  const readOpportunities = deps?.readOpportunities
    ?? (async (id: string, intent: string) => (await import('../agent/negotiator-verdict.host'))
      .readActionableCounterparties(id, intent));
  const readLedger = deps?.readLedger
    ?? (async (id: string, intent: string, limit: number) => (await import('../../adapters/intent-agent-ledger.adapter'))
      .intentAgentLedgerAdapter.readRecent(id, intent, limit));
  const getIntentText = deps?.getIntentText ?? (async (id: string) => {
    const { chatDatabaseAdapter } = await import('../../adapters/database.adapter');
    const intent = await chatDatabaseAdapter.getIntentForIndexing(id);
    return intent?.payload ?? null;
  });

  const [parked, dossier, allOpportunities, recentActs, signalText] = await Promise.all([
    readParked(userId, intentId),
    readDossier(userId, intentId),
    readOpportunities(userId, intentId),
    readLedger(userId, intentId, MAX_LEDGER_ACTS),
    getIntentText(intentId).catch(() => null),
  ]);

  // Bounded, keeping the newest (the reader lists oldest first). The agent's
  // numbers are context-relative — its validator resolves them to ids — so
  // truncation renumbers nothing anywhere else.
  const opportunities = allOpportunities.slice(-MAX_OPPORTUNITIES);
  if (allOpportunities.length > opportunities.length) {
    const { log } = await import('../log');
    log.lib.from('intent-agent.context').warn('intent_agent_context_opportunities_truncated', {
      userId,
      intentId,
      total: allOpportunities.length,
      kept: opportunities.length,
    });
  }

  // The DM may not exist yet (a park can fire before the client ever opened
  // this signal's conversation). The transcript read degrades to empty; the
  // executor resolves-or-creates the session only when the agent actually
  // speaks.
  const recentDm = await (async () => {
    try {
      const sessionId = event.kind === 'user_message'
        ? event.sessionId
        : await (async () => {
          const findSession = deps?.findSession
            ?? (async (id: string, intent: string) => (await import('../../services/chat.service'))
              .chatSessionService.findNegotiatorIntentSession(id, intent));
          return (await findSession(userId, intentId))?.id ?? null;
        })();
      if (!sessionId) return [];
      const getSessionMessages = deps?.getSessionMessages
        ?? (async (id: string) => (await import('../../services/chat.service'))
          .chatSessionService.getSessionMessages(id));
      const messages = await getSessionMessages(sessionId);
      return messages.slice(-MAX_DM_MESSAGES).map((message) => ({ role: message.role, content: message.content }));
    } catch {
      return [];
    }
  })();

  return { event, signalText, parked: [...parked], dossier, opportunities, recentDm, recentActs };
}
