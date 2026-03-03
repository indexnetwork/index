/**
 * NegotiationDatabaseAdapter
 * 
 * Implements NegotiationGraphDatabase interface for production use.
 * Provides all database operations needed by the negotiation graph.
 */

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import type { NegotiationGraphDatabase } from '../lib/protocol/graphs/negotiation.graph';
import type {
  NegotiationParticipant,
  NegotiationTurn,
  NegotiationResolution,
  NegotiationOutcome,
  NegotiationTrigger,
} from '../types/negotiation.types';

/**
 * Production database adapter for the negotiation graph.
 * Implements all required database operations using Drizzle ORM.
 */
export class NegotiationDatabaseAdapter implements NegotiationGraphDatabase {
  /**
   * Get user profile data.
   */
  async getProfile(userId: string): Promise<{
    identity?: { name?: string; bio?: string; location?: string };
    narrative?: { context?: string };
    attributes?: { interests?: string[]; skills?: string[] };
  } | null> {
    const [profileResult] = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);

    if (!profileResult) return null;

    return {
      identity: profileResult.identity as { name?: string; bio?: string; location?: string } | undefined,
      narrative: profileResult.narrative as { context?: string } | undefined,
      attributes: profileResult.attributes as { interests?: string[]; skills?: string[] } | undefined,
    };
  }

  /**
   * Get active intents for a user.
   */
  async getActiveIntents(userId: string): Promise<Array<{
    id: string;
    payload: string;
    summary?: string;
  }>> {
    const intentsResult = await db.select({
      id: schema.intents.id,
      payload: schema.intents.payload,
      summary: schema.intents.summary,
    })
      .from(schema.intents)
      .where(and(
        eq(schema.intents.userId, userId),
        isNull(schema.intents.archivedAt)
      ))
      .orderBy(desc(schema.intents.createdAt))
      .limit(10);

    return intentsResult.map(i => ({
      id: i.id,
      payload: i.payload,
      summary: i.summary ?? undefined,
    }));
  }

  /**
   * Get user display name.
   */
  async getUserName(userId: string): Promise<string | null> {
    const [user] = await db.select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    return user?.name ?? null;
  }

  /**
   * Create a new negotiation record.
   */
  async createNegotiation(data: {
    status: string;
    participants: NegotiationParticipant[];
    trigger: NegotiationTrigger;
    turns: NegotiationTurn[];
    currentTurn: number;
    maxTurns: number;
  }): Promise<{ id: string }> {
    const [negotiation] = await db.insert(schema.negotiations)
      .values({
        status: data.status as 'initiated' | 'in_progress' | 'resolved' | 'expired',
        participants: data.participants,
        trigger: data.trigger,
        turns: data.turns,
        currentTurn: data.currentTurn,
        maxTurns: data.maxTurns,
      })
      .returning({ id: schema.negotiations.id });

    return { id: negotiation?.id ?? '' };
  }

  /**
   * Update an existing negotiation.
   */
  async updateNegotiation(id: string, data: {
    status?: string;
    outcome?: NegotiationOutcome;
    turns?: NegotiationTurn[];
    currentTurn?: number;
    maxTurns?: number;
    resolution?: NegotiationResolution;
    opportunityId?: string;
  }): Promise<void> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.status !== undefined) {
      updateData.status = data.status;
    }
    if (data.outcome !== undefined) {
      updateData.outcome = data.outcome;
    }
    if (data.turns !== undefined) {
      updateData.turns = data.turns;
    }
    if (data.currentTurn !== undefined) {
      updateData.currentTurn = data.currentTurn;
    }
    if (data.maxTurns !== undefined) {
      updateData.maxTurns = data.maxTurns;
    }
    if (data.resolution !== undefined) {
      updateData.resolution = data.resolution;
    }
    if (data.opportunityId !== undefined) {
      updateData.opportunityId = data.opportunityId;
    }

    await db.update(schema.negotiations)
      .set(updateData)
      .where(eq(schema.negotiations.id, id));
  }

  /**
   * Create an opportunity from a successful negotiation.
   */
  async createOpportunity(data: {
    detection: schema.OpportunityDetection;
    actors: schema.OpportunityActor[];
    interpretation: schema.OpportunityInterpretation;
    context: schema.OpportunityContext;
    confidence: string;
    status: string;
  }): Promise<{ id: string }> {
    const [opportunity] = await db.insert(schema.opportunities)
      .values({
        detection: data.detection,
        actors: data.actors,
        interpretation: data.interpretation,
        context: data.context,
        confidence: data.confidence,
        status: data.status as 'latent' | 'draft' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired',
      })
      .returning({ id: schema.opportunities.id });

    return { id: opportunity?.id ?? '' };
  }
}

/** Singleton instance of the negotiation database adapter */
export const negotiationDatabaseAdapter = new NegotiationDatabaseAdapter();
