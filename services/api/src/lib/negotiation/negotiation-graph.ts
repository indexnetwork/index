/**
 * The host composition root and one construction site for the two graphs that
 * run the signal cycle.
 *
 * `negotiationGraph` owns every write to a negotiation; `personalAgentGraph`
 * is the one PersonalAgent, in whichever scope its input names. They are
 * mutually dependent by design and wired that way here: the negotiation
 * graph's turn author IS the PersonalAgent in negotiation scope, and every
 * negotiation effect the agent decides (kickoff, resume, verdict) goes back
 * through the negotiation graph. The cycle is closed lazily — `authorTurn`
 * runs long after module evaluation — so neither needs a setter.
 *
 * The host ports live here as thin bindings onto the services and adapters
 * that already own each concern: the signal DM (`chatSessionService`), the
 * dossier and the act ledger (their adapters), the owner's untouched accept
 * path (`negotiator-verdict.host`), the reply transport, and the agent's own
 * name. Nothing here holds business logic.
 *
 * This shared module, rather than `main.ts`, lets queues, controllers, and
 * services consume the same compiled graphs without a circular import back
 * into process startup.
 */
import { NegotiationGraphFactory, PersonalAgentGraphFactory } from '@indexnetwork/protocol';
import type { MatchesReadyFn, PersonalAgentGraphLike } from '@indexnetwork/protocol';

import { conversationDatabaseAdapter } from '../../adapters/database.adapter';
import { log } from '../log';
import { intentAgentLedgerAdapter } from '../../adapters/intent-agent-ledger.adapter';
import { intentDossierAdapter } from '../../adapters/intent-dossier.adapter';
import { agentService } from '../../services/agent.service';
import { AgentDispatcherImpl } from '../../services/agent-dispatcher.service';
import { chatSessionService } from '../../services/chat.service';
import { PERSONAL_AGENT_MATCH_STATUSES, passVerdictOnOpportunity, readSignalMatches } from '../agent/negotiator-verdict.host';
import { publishPersonalAgentReplyChunk } from '../agent/personal-agent-reply.stream';

/**
 * `agentDispatcher` is exported separately: it is no longer part of the
 * negotiation graph's own deps (external-agent dispatch is offline, #1494
 * round-3 Option A), but the opportunity graph still uses `hasExternalAgent`
 * for the unlimited-maxTurns rule (IND-410).
 */
export const agentDispatcher = new AgentDispatcherImpl(agentService);

export const negotiationGraph = new NegotiationGraphFactory({
  database: conversationDatabaseAdapter,
  // All-paused → reflect: the trigger is gated on the round's size stamp, so
  // this fires exactly once per round, when kickoff's opens have all settled.
  reflectEnqueue: async (job) => {
    const { personalAgentQueue } = await import('../../queues/personal-agent.queue');
    await personalAgentQueue.addAllPausedEvent(job);
  },
  // The seat's own agent plays its turn. `personalAgentGraph` is referenced
  // lazily, inside the call, so the two constructions below can be ordered.
  author: {
    authorTurn: async ({ negotiationId, userId, intentId }) => {
      const result = await personalAgentGraph.invoke({ userId, intentId, negotiationId });
      if (!result.turn) throw new Error(result.error ?? 'PersonalAgent produced no negotiation turn');
      return result.turn;
    },
  },
}).createGraph();

export const personalAgentGraph: PersonalAgentGraphLike = new PersonalAgentGraphFactory({
  negotiations: negotiationGraph,
  negotiationDatabase: conversationDatabaseAdapter,
  conversation: {
    findSession: (userId, intentId) => chatSessionService.findNegotiatorIntentSession(userId, intentId),
    resolveSession: (userId, intentId) => chatSessionService.resolveNegotiatorIntentSession(userId, intentId),
    getMessages: (sessionId) => chatSessionService.getSessionMessages(sessionId),
    addMessage: (input) => chatSessionService.addMessage(input),
  },
  dossier: intentDossierAdapter,
  ledger: intentAgentLedgerAdapter,
  opportunities: {
    // `readSignalMatches`, NOT the degrading `readActionableCounterparties`:
    // every one of the agent's turns is about this list, and a read that
    // failed must fail the turn. Swallowed to `[]` it becomes a reflect that
    // saw no negotiations, decided nothing, succeeded — and burned the round's
    // one retained reflect job.
    readMatches: async (userId, intentId) => (
      await readSignalMatches(userId, intentId, undefined, PERSONAL_AGENT_MATCH_STATUSES)
    ).map((match) => ({
      opportunityId: match.opportunityId,
      label: match.label,
      status: match.status,
      ...(match.awaitingIntroducerApproval ? { awaitingIntroducerApproval: true } : {}),
    })),
    // The owner's own verdict, through the untouched owner path — the SAME
    // `updateOpportunityStatus` the Radar's accept calls.
    accept: async (userId, input) => {
      const outcome = await passVerdictOnOpportunity(userId, input, 'accepted', undefined);
      return { status: outcome.status, ...('counterparty' in outcome ? { counterparty: outcome.counterparty } : {}) };
    },
  },
  identity: {
    readAgentName: async (userId) => (await agentService.getNegotiatorAgent(userId))?.name ?? null,
  },
  replyStream: { publish: publishPersonalAgentReplyChunk },
  reflectEnqueue: async (job) => {
    const { personalAgentQueue } = await import('../../queues/personal-agent.queue');
    await personalAgentQueue.addAllPausedEvent(job);
  },
  // A discovery batch that landed while a kickoff turn was running was read
  // past; the agent wakes itself again rather than losing it.
  wakeForMatches: async (input) => {
    const { personalAgentQueue } = await import('../../queues/personal-agent.queue');
    await personalAgentQueue.addMatchesReadyEvent(input);
  },
}).createGraph();

/**
 * Discovery's post-persist hand-off: one event per signal that got matches.
 * Discovery never opens a negotiation — the signal's agent decides.
 *
 * THROWS on failure, which is the point: the discovery queues retry, and a
 * batch that persisted with nobody woken for it is not a successful
 * discovery. Only wire this where a retry actually exists.
 */
export const matchesReady: MatchesReadyFn = async ({ userId, intentId }) => {
  const { personalAgentQueue } = await import('../../queues/personal-agent.queue');
  await personalAgentQueue.addMatchesReadyEvent({ userId, intentId });
};

/** How many times a tool-path wake is retried before the loss is recorded. */
const TOOL_PATH_WAKE_ATTEMPTS = 3;
const TOOL_PATH_WAKE_RETRY_MS = 100;

/**
 * The same hand-off for the surfaces with NOTHING behind them to retry: the
 * chat and MCP tool graphs, where the caller is a user waiting on a
 * `discover_opportunities` answer.
 *
 * Throwing there would turn a discovery that genuinely persisted matches into
 * a failed tool call, losing the user's results over a transport blip. So it
 * retries, and if the wake is still lost it RECORDS that at error level with
 * the ids needed to replay it, and lets the matches through. Not silent, and
 * not at the user's expense.
 */
export const matchesReadyBestEffort: MatchesReadyFn = async ({ userId, intentId }) => {
  const { personalAgentQueue } = await import('../../queues/personal-agent.queue');
  for (let attempt = 0; attempt < TOOL_PATH_WAKE_ATTEMPTS; attempt++) {
    try {
      await personalAgentQueue.addMatchesReadyEvent({ userId, intentId });
      return;
    } catch (err) {
      if (attempt === TOOL_PATH_WAKE_ATTEMPTS - 1) {
        log.lib.from('negotiation-graph').error('matches_ready_wake_lost', {
          userId,
          intentId,
          note: 'Matches persisted but the signal\'s agent was not woken; replay by re-running discovery for this signal.',
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, TOOL_PATH_WAKE_RETRY_MS * (attempt + 1)));
    }
  }
};
