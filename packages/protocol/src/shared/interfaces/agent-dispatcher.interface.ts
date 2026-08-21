/**
 * AgentDispatcher interface for the negotiation graph.
 *
 * The graph calls dispatch() per turn and receives a result.
 * It never knows about webhooks, MCP, transports, or agent resolution.
 * The concrete implementation lives in the host application.
 *
 * IND-548: these types are also accessible via agents/ports, which
 * re-exports from here. This file remains the authoritative source to avoid a
 * module cycle through the negotiation capability facade.
 */

import type { NegotiationTurn, UserNegotiationContext, SeedAssessment } from '../schemas/negotiation-state.schema.js';
import type { ChecklistDraftItem } from '../schemas/negotiation-checklist.schema.js';
import type { NegotiatorMemoryEntry } from '../../negotiations/negotiation.memory.js';
import type { AttributedPriorDialogue } from '../../negotiations/negotiation.attribution.js';
import type { NegotiationPrivateConsultation } from './database.interface.js';
import type { NegotiationContinuationTimeoutIdentity } from './negotiation-events.interface.js';

/** Payload sent to the dispatcher for each negotiation turn. */
export interface NegotiationTurnPayload {
  negotiationId: string;
  ownUser: UserNegotiationContext;
  otherUser: UserNegotiationContext;
  indexContext: { networkId: string; prompt?: string };
  seedAssessment: SeedAssessment;
  history: NegotiationTurn[];
  isFinalTurn: boolean;
  /** Whether ownUser is the party that initiated the discovery. */
  isDiscoverer: boolean;
  /** The explicit search query that triggered this discovery (if any). Takes priority over background intents. */
  discoveryQuery?: string;
  /** The acting user's seat under the v2 client-advocate protocol (`initiator` | `counterparty`). */
  seat?: string;
  /** Negotiation protocol version for this task (`v1` | `v2`). */
  protocolVersion?: string;
  /** Actions the acting seat may submit on this turn (seat + version + final-turn scoped). */
  allowedActions?: string[];
  /**
   * The acting user's OWN negotiator memories (P5.3 read path) — private
   * context for the dispatched agent. Never contains the counterparty's
   * memory; absent when nothing was retrieved.
   */
  negotiatorMemory?: NegotiatorMemoryEntry[];
  /**
   * The negotiation's checklist as it currently stands (checklist plan §2):
   * the frozen dimensions with their latest scores. Present only under the
   * stances that run the checklist protocol; empty on the turn that authors
   * it. A dispatched agent scores the same dimensions the in-process
   * negotiator does — the graph re-freezes whatever comes back, so this is
   * context, not an authority.
   */
  checklist?: ChecklistDraftItem[];
  /**
   * This principal's question budget for the negotiation: how many they have
   * already been asked, and how many they may be asked in total (the turn-0
   * pre-contact consult included).
   */
  questionBudget?: { spent: number; total: number };
  /** Checklist dimensions this principal has already been asked about. */
  askedDimensions?: string[];
  /** Recipient-private ask-user consultation, present only for that recipient's turn. */
  privateConsultation?: NegotiationPrivateConsultation;
  /**
   * Prior dialogue with this counterparty, grouped and labeled per opportunity
   * (IND-569). Present only on continuations; lets an external agent see which
   * prior turns belonged to already-concluded OTHER opportunities versus the
   * one under negotiation now. Absent → no attributed prior dialogue available.
   */
  priorDialogue?: AttributedPriorDialogue;
  /** Server-only continuation generation used to fence the delayed park timeout. */
  timeoutContinuation?: NegotiationContinuationTimeoutIdentity;
}

/** Result of a dispatch attempt. */
export type AgentDispatchResult =
  | { handled: true; turn: NegotiationTurn }
  | { handled: false; reason: 'no_agent' | 'timeout' }
  | { handled: false; reason: 'waiting'; resumeToken: string };

/**
 * Dispatches a negotiation turn to the appropriate agent.
 * Tries external (poller) agents first, falls back to system agent.
 */
export interface AgentDispatcher {
  /**
   * Attempt to dispatch a negotiation turn to an external (poller) agent.
   * @param userId - The user whose agent should handle this turn
   * @param scope - Permission scope for agent resolution
   * @param payload - Turn context (users, history, seed assessment)
   * @param options - Timeout configuration
   * @returns Handled result with turn, or unhandled result with reason
   */
  dispatch(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
    payload: NegotiationTurnPayload,
    options: { timeoutMs: number },
  ): Promise<AgentDispatchResult>;

  /**
   * Check whether a user has an authorized external (poller) agent for the given
   * scope. Used at init to determine scenario-based turn caps. Type-only by design
   * (no heartbeat freshness) — see IND-410.
   */
  hasExternalAgent(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
  ): Promise<boolean>;
}
