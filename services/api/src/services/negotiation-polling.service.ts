/**
 * NegotiationPollingService (rewrite, #1494).
 *
 * The negotiation-graph rewrite deletes pickup/claim, owner consultation,
 * and every out-of-graph "persist turn → finalize" implementation this
 * service used to hold (see docs/plans/2026-08-23-personal-agent-and-
 * negotiation-graphs.md, "What is deleted"). A negotiation can no longer be
 * claimed under the new working-only lifecycle, so there is nothing left to
 * poll for; the pickup route above this service is deleted entirely
 * (agent.controller.ts).
 *
 * What remains is the one thing an external agent (a plain agent-bound
 * caller, or the dedicated Hermes bridge) still does: submit a turn. Every
 * submitted turn is validated against the caller's seat — the same
 * `expectedNegotiationSpeaker` check the graph's own `apply` node uses
 * internally — then applied through the single `NegotiationGraph` write
 * path. There is no more separate outbox/replay/atomic-mutation-authority
 * machinery; the graph's `apply` node is already the one sink for every
 * turn regardless of source, so this service does not need to be.
 */
import type { HermesNegotiationResponse, NegotiationGraphLike, NegotiationTurn } from '@indexnetwork/protocol';
import { buildHermesNegotiationTurn } from '@indexnetwork/protocol';

import { conversationDatabaseAdapter } from '../adapters/database.adapter';
import { log } from '../lib/log';
import { NegotiationPollingAuthorization } from '../lib/agent/negotiation-polling-authorization';
import { expectedNegotiationSpeaker } from '../lib/negotiation/expected-speaker';
import { negotiationGraph } from '../lib/negotiation/negotiation-graph';
import type { NegotiationCredentialPrincipal } from '../lib/agent/hermes-credential';

const logger = log.service.from('NegotiationPollingService');

// ─────────────────────────────────────────────────────────────────────────────
// Error classes
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when a referenced resource does not exist. Maps to HTTP 404. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Thrown when a state conflict prevents the operation. Maps to HTTP 409. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Thrown when the caller is not authorized for the requested agent. Maps to HTTP 403. */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Thrown when a submitted turn is outside the caller's seat — it is not
 * this user's turn to speak in the negotiation. Maps to HTTP 400.
 */
export class SeatViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeatViolationError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class NegotiationPollingService {
  constructor(
    private readonly authorization: NegotiationPollingAuthorization = negotiationPollingAuthorization,
    private readonly database: Pick<typeof conversationDatabaseAdapter, 'getNegotiationTask' | 'getNegotiationMessages'> = conversationDatabaseAdapter,
    private readonly graph: NegotiationGraphLike = negotiationGraph,
  ) {}

  /**
   * Submits a plain agent-bound turn for a negotiation.
   *
   * @throws {UnauthorizedError} If the caller is not the selected negotiation executor.
   * @throws {NotFoundError} If the negotiation does not exist or the caller is not a participant.
   * @throws {SeatViolationError} If it is not this caller's turn to speak.
   * @throws {ConflictError} If the graph could not apply the turn.
   */
  async respond(
    agentId: string,
    userId: string,
    negotiationId: string,
    turn: NegotiationTurn,
    _principal: NegotiationCredentialPrincipal,
  ): Promise<{ success: true }> {
    if (!await this.authorization.authorizeRespond(agentId, userId)) {
      throw new UnauthorizedError(`Agent ${agentId} is not the selected negotiation executor`);
    }
    await this.applyTurn(userId, negotiationId, turn);
    return { success: true };
  }

  /**
   * Submits a Hermes-bridge turn, converting its closed action vocabulary
   * into the same turn shape `respond` applies. No model-authored prose
   * crosses this boundary — see `buildHermesNegotiationTurn`.
   */
  async respondHermes(
    agentId: string,
    userId: string,
    negotiationId: string,
    input: HermesNegotiationResponse,
    _principal: NegotiationCredentialPrincipal,
  ): Promise<{ success: true }> {
    if (!await this.authorization.authorizeRespond(agentId, userId)) {
      throw new UnauthorizedError(`Agent ${agentId} is not the selected negotiation executor`);
    }
    await this.applyTurn(userId, negotiationId, buildHermesNegotiationTurn(input));
    return { success: true };
  }

  private async applyTurn(userId: string, negotiationId: string, turn: NegotiationTurn): Promise<void> {
    const task = await this.database.getNegotiationTask(negotiationId);
    if (!task) throw new NotFoundError(`Negotiation ${negotiationId} not found`);
    const meta = task.metadata;
    if (meta.sourceUserId !== userId && meta.candidateUserId !== userId) {
      throw new NotFoundError(`Negotiation ${negotiationId} not found`);
    }

    const messages = await this.database.getNegotiationMessages(task.id);
    if (expectedNegotiationSpeaker(meta, messages) !== userId) {
      throw new SeatViolationError('It is not this owner\'s turn to respond in the negotiation');
    }

    const result = await this.graph.invoke({ negotiationId, turn, byUserId: userId });
    if (result.status === 'error') {
      throw new ConflictError(result.error ?? `Negotiation ${negotiationId} turn could not be applied`);
    }
    logger.info('Negotiation turn applied', { negotiationId, status: result.status });
  }
}

const negotiationPollingAuthorization = new NegotiationPollingAuthorization({
  async getAgentWithRelations(agentId) {
    const { agentDatabaseAdapter } = await import('../adapters/agent.database.adapter');
    return agentDatabaseAdapter.getAgentWithRelations(agentId);
  },
});

/** Singleton negotiation polling service instance. */
export const negotiationPollingService = new NegotiationPollingService();
