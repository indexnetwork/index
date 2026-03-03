import { log } from '../lib/log';
import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { eq, and, or, desc, inArray } from 'drizzle-orm';
import type { Id } from '../types/common.types';
import type {
  NegotiationParticipant,
  NegotiationTrigger,
  NegotiationTurn,
  NegotiationResolution,
  NegotiationStatus,
  NegotiationOutcome,
} from '../types/negotiation.types';
import { negotiationQueue } from '../queues/negotiation.queue';
import { NegotiationGraphFactory } from '../lib/protocol/graphs/negotiation.graph';
import { negotiationDatabaseAdapter } from '../adapters/negotiation.database.adapter';

const logger = log.service.from("NegotiationService");

/**
 * Enrich participants with user names from the database.
 */
async function enrichParticipantsWithNames(
  participants: NegotiationParticipant[]
): Promise<NegotiationParticipant[]> {
  const userIds = participants.map(p => p.userId);
  if (userIds.length === 0) return participants;

  const users = await db.select({
    id: schema.users.id,
    name: schema.users.name,
  })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));

  const nameMap = new Map(users.map(u => [u.id, u.name]));

  return participants.map(p => ({
    ...p,
    name: nameMap.get(p.userId) ?? undefined,
  }));
}

/** Negotiation list item for API responses */
export interface NegotiationListItem {
  id: string;
  status: NegotiationStatus;
  outcome: NegotiationOutcome | null;
  participants: NegotiationParticipant[];
  trigger: NegotiationTrigger;
  currentTurn: number;
  maxTurns: number;
  opportunityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Negotiation detail with turns */
export interface NegotiationDetail extends NegotiationListItem {
  turns: NegotiationTurn[];
  resolution: NegotiationResolution | null;
}

/** Options for listing negotiations */
export interface ListNegotiationsOptions {
  userId?: string;
  status?: NegotiationStatus | NegotiationStatus[];
  limit?: number;
  offset?: number;
}

/** Input for initiating a negotiation */
export interface InitiateNegotiationInput {
  initiatorUserId: string;
  responderUserId: string;
  trigger: NegotiationTrigger;
  indexId?: string;
}

/**
 * NegotiationService manages agent-to-agent negotiation operations.
 * 
 * Provides methods for listing, retrieving, and initiating negotiations.
 * Supports both synchronous (graph) and asynchronous (queue) execution modes.
 * 
 * @remarks
 * Uses the negotiation queue for async processing and the negotiation graph for sync execution.
 * All database operations go through the appropriate adapters.
 */
export class NegotiationService {
  /**
   * List negotiations for a user.
   * @param options - Filtering and pagination options
   * @returns Array of negotiation list items
   */
  async listNegotiations(options: ListNegotiationsOptions = {}): Promise<NegotiationListItem[]> {
    const { userId, status, limit = 20, offset = 0 } = options;

    try {
      // Build query with optional status filter
      const statuses = status ? (Array.isArray(status) ? status : [status]) : null;
      
      const result = statuses && statuses.length === 1
        ? await db.select({
            id: schema.negotiations.id,
            status: schema.negotiations.status,
            outcome: schema.negotiations.outcome,
            participants: schema.negotiations.participants,
            trigger: schema.negotiations.trigger,
            currentTurn: schema.negotiations.currentTurn,
            maxTurns: schema.negotiations.maxTurns,
            opportunityId: schema.negotiations.opportunityId,
            createdAt: schema.negotiations.createdAt,
            updatedAt: schema.negotiations.updatedAt,
          })
            .from(schema.negotiations)
            .where(eq(schema.negotiations.status, statuses[0]))
            .orderBy(desc(schema.negotiations.createdAt))
            .limit(limit)
            .offset(offset)
        : await db.select({
            id: schema.negotiations.id,
            status: schema.negotiations.status,
            outcome: schema.negotiations.outcome,
            participants: schema.negotiations.participants,
            trigger: schema.negotiations.trigger,
            currentTurn: schema.negotiations.currentTurn,
            maxTurns: schema.negotiations.maxTurns,
            opportunityId: schema.negotiations.opportunityId,
            createdAt: schema.negotiations.createdAt,
            updatedAt: schema.negotiations.updatedAt,
          })
            .from(schema.negotiations)
            .orderBy(desc(schema.negotiations.createdAt))
            .limit(limit)
            .offset(offset);

      // Filter by userId (participant check) - must be done post-query due to JSONB
      let filtered = result;
      if (userId) {
        filtered = result.filter(n => {
          const participants = n.participants as NegotiationParticipant[];
          return participants.some(p => p.userId === userId);
        });
      }

      // Filter by multiple statuses if provided
      if (statuses && statuses.length > 1) {
        filtered = filtered.filter(n => statuses.includes(n.status as NegotiationStatus));
      }

      // Collect all participant userIds for batch lookup
      const allParticipants = filtered.flatMap(n => n.participants as NegotiationParticipant[]);
      const enrichedParticipantsMap = new Map<string, NegotiationParticipant>();
      
      const enriched = await enrichParticipantsWithNames(allParticipants);
      for (const p of enriched) {
        enrichedParticipantsMap.set(`${p.userId}-${p.role}`, p);
      }

      return filtered.map(n => {
        const participants = (n.participants as NegotiationParticipant[]).map(p => 
          enrichedParticipantsMap.get(`${p.userId}-${p.role}`) ?? p
        );
        return {
          id: n.id,
          status: n.status as NegotiationStatus,
          outcome: n.outcome as NegotiationOutcome | null,
          participants,
          trigger: n.trigger as NegotiationTrigger,
          currentTurn: n.currentTurn,
          maxTurns: n.maxTurns,
          opportunityId: n.opportunityId,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        };
      });
    } catch (error) {
      logger.error('[ListNegotiations] Error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get a negotiation by ID with full turn history.
   * @param negotiationId - The negotiation ID to retrieve
   * @returns Negotiation detail with turns, or null if not found
   */
  async getNegotiation(negotiationId: string): Promise<NegotiationDetail | null> {
    try {
      const [result] = await db.select()
        .from(schema.negotiations)
        .where(eq(schema.negotiations.id, negotiationId))
        .limit(1);

      if (!result) return null;

      const participants = await enrichParticipantsWithNames(
        result.participants as NegotiationParticipant[]
      );

      // Build a name map for turns
      const nameMap = new Map(participants.map(p => [p.userId, p.name]));

      // Enrich turns with participant names
      const turns = (result.turns as NegotiationTurn[]).map(turn => ({
        ...turn,
        participantName: nameMap.get(turn.participantUserId as string),
      }));

      return {
        id: result.id,
        status: result.status as NegotiationStatus,
        outcome: result.outcome as NegotiationOutcome | null,
        participants,
        trigger: result.trigger as NegotiationTrigger,
        turns,
        resolution: result.resolution as NegotiationResolution | null,
        currentTurn: result.currentTurn,
        maxTurns: result.maxTurns,
        opportunityId: result.opportunityId,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      };
    } catch (error) {
      logger.error('[GetNegotiation] Error', {
        negotiationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get negotiations between two specific users.
   * @param userIdA - First user ID
   * @param userIdB - Second user ID
   * @returns Array of negotiations involving both users
   */
  async getNegotiationsBetweenUsers(
    userIdA: string,
    userIdB: string
  ): Promise<NegotiationListItem[]> {
    try {
      const result = await db.select({
        id: schema.negotiations.id,
        status: schema.negotiations.status,
        outcome: schema.negotiations.outcome,
        participants: schema.negotiations.participants,
        trigger: schema.negotiations.trigger,
        currentTurn: schema.negotiations.currentTurn,
        maxTurns: schema.negotiations.maxTurns,
        opportunityId: schema.negotiations.opportunityId,
        createdAt: schema.negotiations.createdAt,
        updatedAt: schema.negotiations.updatedAt,
      })
        .from(schema.negotiations)
        .orderBy(desc(schema.negotiations.createdAt));

      // Filter for negotiations involving both users
      const filtered = result.filter(n => {
        const participants = n.participants as NegotiationParticipant[];
        const userIds = participants.map(p => p.userId);
        return userIds.includes(userIdA as Id<'users'>) && userIds.includes(userIdB as Id<'users'>);
      });

      return filtered.map(n => ({
        id: n.id,
        status: n.status as NegotiationStatus,
        outcome: n.outcome as NegotiationOutcome | null,
        participants: n.participants as NegotiationParticipant[],
        trigger: n.trigger as NegotiationTrigger,
        currentTurn: n.currentTurn,
        maxTurns: n.maxTurns,
        opportunityId: n.opportunityId,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }));
    } catch (error) {
      logger.error('[GetNegotiationsBetweenUsers] Error', {
        userIdA,
        userIdB,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Initiate a negotiation asynchronously via the queue.
   * Returns immediately after enqueueing the job.
   * @param input - Negotiation initiation parameters
   * @returns Object containing the job ID
   */
  async initiateNegotiationAsync(input: InitiateNegotiationInput): Promise<{ jobId: string }> {
    const job = await negotiationQueue.addInitiateJob({
      initiatorUserId: input.initiatorUserId,
      responderUserId: input.responderUserId,
      trigger: input.trigger,
      indexId: input.indexId,
    });

    logger.info('[InitiateNegotiationAsync] Job enqueued', {
      jobId: job.id,
      initiatorUserId: input.initiatorUserId,
      responderUserId: input.responderUserId,
    });

    return { jobId: job.id ?? '' };
  }

  /**
   * Initiate a negotiation synchronously via the graph.
   * Blocks until negotiation completes and returns the result.
   * @param input - Negotiation initiation parameters
   * @returns Negotiation detail if successful, null otherwise
   */
  async initiateNegotiationSync(input: InitiateNegotiationInput): Promise<NegotiationDetail | null> {
    const factory = new NegotiationGraphFactory(negotiationDatabaseAdapter);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      initiatorUserId: input.initiatorUserId as Id<'users'>,
      responderUserId: input.responderUserId as Id<'users'>,
      trigger: input.trigger,
      options: {
        maxTurns: 3,
        indexId: input.indexId as Id<'indexes'> | undefined,
      },
      operationMode: 'negotiate',
    });

    const negotiationId = result.createdNegotiationId;
    if (!negotiationId) {
      logger.warn('[InitiateNegotiationSync] No negotiation created');
      return null;
    }

    return this.getNegotiation(negotiationId);
  }

  /**
   * Get negotiation statistics for a user.
   * @param userId - User ID to get stats for
   * @returns Object with counts by status and outcome
   */
  async getUserNegotiationStats(userId: string): Promise<{
    total: number;
    inProgress: number;
    resolved: number;
    accepted: number;
    declined: number;
    deferred: number;
  }> {
    try {
      const negotiations = await this.listNegotiations({ userId, limit: 1000 });

      const stats = {
        total: negotiations.length,
        inProgress: negotiations.filter(n => n.status === 'in_progress').length,
        resolved: negotiations.filter(n => n.status === 'resolved').length,
        accepted: negotiations.filter(n => n.outcome === 'opportunity').length,
        declined: negotiations.filter(n => n.outcome === 'disengaged').length,
        deferred: negotiations.filter(n => n.outcome === 'deferred').length,
      };

      return stats;
    } catch (error) {
      logger.error('[GetUserNegotiationStats] Error', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        total: 0,
        inProgress: 0,
        resolved: 0,
        accepted: 0,
        declined: 0,
        deferred: 0,
      };
    }
  }
}

/** Singleton negotiation service instance */
export const negotiationService = new NegotiationService();
