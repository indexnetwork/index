/**
 * The one construction site for the two graphs that run the signal cycle.
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
 * A shared module (rather than inlining this in main.ts) exists only so every
 * importer gets it at their own module-eval time without a circular import
 * back into main.ts — the same reason `chatFactory` lives in mcp.controller.ts.
 */
import { NegotiationGraphFactory, PersonalAgentGraphFactory } from '@indexnetwork/protocol';
import type { MatchesReadyFn, PersonalAgentGraphLike } from '@indexnetwork/protocol';

import { conversationDatabaseAdapter } from '../../adapters/database.adapter';
import { intentAgentLedgerAdapter } from '../../adapters/intent-agent-ledger.adapter';
import { intentDossierAdapter } from '../../adapters/intent-dossier.adapter';
import { agentService } from '../../services/agent.service';
import { AgentDispatcherImpl } from '../../services/agent-dispatcher.service';
import { chatSessionService } from '../../services/chat.service';
import { PERSONAL_AGENT_MATCH_STATUSES, passVerdictOnOpportunity, readActionableCounterparties } from '../agent/negotiator-verdict.host';
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
    readMatches: async (userId, intentId) => (
      await readActionableCounterparties(userId, intentId, undefined, PERSONAL_AGENT_MATCH_STATUSES)
    ).map((match) => ({ opportunityId: match.opportunityId, label: match.label, status: match.status })),
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
 */
export const matchesReady: MatchesReadyFn = async ({ userId, intentId }) => {
  const { personalAgentQueue } = await import('../../queues/personal-agent.queue');
  await personalAgentQueue.addMatchesReadyEvent({ userId, intentId });
};
