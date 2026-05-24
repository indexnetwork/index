import { log } from '../lib/log';
import { PremiseGraphFactory } from '@indexnetwork/protocol';
import type { PremiseGraphDatabase } from '@indexnetwork/protocol';

import { chatDatabaseAdapter } from '../adapters/database.adapter';
import { embedderAdapter } from '../adapters/embedder.adapter';

const logger = log.service.from("PremiseService");

/**
 * PremiseService — manages the lifecycle of user premises (self-descriptive propositions).
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
      chatDatabaseAdapter as unknown as PremiseGraphDatabase,
      embedderAdapter,
    );
  }

  /**
   * Create a new premise by running the premise graph in 'create' mode.
   * The graph analyzes, embeds, persists, and indexes the assertion.
   *
   * @param userId - The user who owns the premise
   * @param assertionText - The raw assertion text
   * @param tier - 'assertive' for stable identity claims, 'contextual' for temporal
   * @param options - Optional validity and volatility overrides
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
  ) {
    logger.verbose('[PremiseService] Creating premise', { userId, tier });

    const graph = this.factory.createGraph();
    return graph.invoke({
      userId,
      assertionText,
      tier,
      operationMode: 'create' as const,
      ...options,
    });
  }

  /**
   * Read all active premises for a user via the premise graph query mode.
   * @param userId - The user whose premises to fetch
   */
  async readPremises(userId: string) {
    logger.verbose('[PremiseService] Reading premises', { userId });

    const graph = this.factory.createGraph();
    return graph.invoke({
      userId,
      operationMode: 'query' as const,
    });
  }

  /**
   * Retract a premise — marks it as no longer true.
   * @param premiseId - The premise UUID to retract
   * @param userId - The requesting user — must own the premise
   * @throws Error if not found or ownership mismatch
   */
  async retractPremise(premiseId: string, userId: string): Promise<void> {
    logger.verbose('[PremiseService] Retracting premise', { premiseId, userId });

    const premise = await chatDatabaseAdapter.getPremise(premiseId);
    if (!premise) throw new Error(`Premise ${premiseId} not found`);
    if (premise.userId !== userId) throw new Error(`Premise ${premiseId} does not belong to user ${userId}`);

    await chatDatabaseAdapter.updatePremise(premiseId, {
      status: 'RETRACTED',
      retractedAt: new Date(),
    });
  }
}

export const premiseService = new PremiseService();
