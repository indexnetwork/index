import { log } from '../lib/log';
import { PremiseGraphFactory } from '@indexnetwork/protocol';
import type { PremiseGraphDatabase } from '@indexnetwork/protocol';

import { chatDatabaseAdapter, linkDatabaseAdapter } from '../adapters/database.adapter';
import { embedderAdapter } from '../adapters/embedder.adapter';

const logger = log.service.from("PremiseService");

/**
 * Builds a PremiseGraphDatabase-compatible object by combining the premise CRUD
 * methods from LinkDatabaseAdapter with the network/user methods from ChatDatabaseAdapter.
 */
function buildPremiseDatabase(): PremiseGraphDatabase {
  return {
    // Premise CRUD — lives on LinkDatabaseAdapter
    createPremise: linkDatabaseAdapter.createPremise.bind(linkDatabaseAdapter),
    getPremise: linkDatabaseAdapter.getPremise.bind(linkDatabaseAdapter),
    getPremisesForUser: linkDatabaseAdapter.getPremisesForUser.bind(linkDatabaseAdapter),
    updatePremise: linkDatabaseAdapter.updatePremise.bind(linkDatabaseAdapter),
    assignPremiseToNetwork: linkDatabaseAdapter.assignPremiseToNetwork.bind(linkDatabaseAdapter),
    getPremiseNetworks: linkDatabaseAdapter.getPremiseNetworks.bind(linkDatabaseAdapter),
    // Network / user context — lives on ChatDatabaseAdapter
    getUserIndexIds: chatDatabaseAdapter.getUserIndexIds.bind(chatDatabaseAdapter),
    getNetwork: chatDatabaseAdapter.getNetwork.bind(chatDatabaseAdapter),
    getNetworkMemberContext: chatDatabaseAdapter.getNetworkMemberContext.bind(chatDatabaseAdapter),
  };
}

/**
 * PremiseService
 *
 * Manages the lifecycle of user premises (belief assertions).
 * Uses LinkDatabaseAdapter for premise CRUD and ChatDatabaseAdapter for network context.
 * Uses PremiseGraphFactory for graph-based create and query operations.
 *
 * RESPONSIBILITIES:
 * - Create premises through the Premise Graph (analyze + embed + persist + index)
 * - Read active premises for a user
 * - Retract (soft-delete) premises with ownership verification
 */
export class PremiseService {
  private factory: PremiseGraphFactory;

  constructor() {
    this.factory = new PremiseGraphFactory(
      buildPremiseDatabase(),
      embedderAdapter,
    );
  }

  /**
   * Create a new premise for a user by running the premise graph in 'create' mode.
   * The graph analyzes, embeds, persists, and indexes the assertion.
   *
   * @param userId - The user who owns the premise
   * @param assertionText - The raw assertion text to persist as a premise
   * @param tier - Assertion tier: 'assertive' (strong claim) or 'contextual' (background info)
   * @param options - Optional validity and volatility overrides
   * @returns Graph execution result containing the created premise
   */
  async createPremise(
    userId: string,
    assertionText: string,
    tier: 'assertive' | 'contextual',
    options?: {
      validFrom?: string;
      validUntil?: string;
      volatile?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    logger.verbose('[PremiseService] Creating premise', { userId, tier });

    const graph = this.factory.createGraph();
    const result = await graph.invoke({
      userId,
      assertionText,
      tier,
      operationMode: 'create',
      ...options,
    });

    return result;
  }

  /**
   * Read all active premises for a user by running the premise graph in 'query' mode.
   *
   * @param userId - The user whose premises to fetch
   * @returns Graph execution result containing the list of active premises
   */
  async readPremises(userId: string): Promise<Record<string, unknown>> {
    logger.verbose('[PremiseService] Reading premises', { userId });

    const graph = this.factory.createGraph();
    const result = await graph.invoke({
      userId,
      operationMode: 'query',
    });

    return result;
  }

  /**
   * Retract a premise by marking it RETRACTED after verifying ownership.
   *
   * @param premiseId - The premise UUID to retract
   * @param userId - The requesting user — must own the premise
   * @throws Error if the premise is not found or does not belong to userId
   */
  async retractPremise(premiseId: string, userId: string): Promise<void> {
    logger.verbose('[PremiseService] Retracting premise', { premiseId, userId });

    const premise = await linkDatabaseAdapter.getPremise(premiseId);

    if (!premise) {
      throw new Error(`Premise ${premiseId} not found`);
    }

    if (premise.userId !== userId) {
      throw new Error(`Premise ${premiseId} does not belong to user ${userId}`);
    }

    await linkDatabaseAdapter.updatePremise(premiseId, {
      status: 'RETRACTED',
      retractedAt: new Date(),
    });
  }
}

export const premiseService = new PremiseService();
