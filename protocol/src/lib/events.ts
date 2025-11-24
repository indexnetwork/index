import db from './db';
import { intents, indexes, indexMembers } from './schema';
import { eq, and, isNull } from 'drizzle-orm';
import { 
  triggerBrokersOnIntentCreated,
  triggerBrokersOnIntentUpdated,
  triggerBrokersOnIntentArchived 
} from '../agents/context_brokers/connector';
import { addIndexIntentJob } from './queue/llm-queue';


export interface IntentEvent {
  intentId: string;
  userId: string;
  payload?: string;
  previousStatus?: string;
}

export interface IndexEvent {
  indexId: string;
  userId?: string;
  promptChanged?: boolean;
}

export interface MemberEvent {
  userId: string;
  indexId: string;
  promptChanged?: boolean;
  autoAssignChanged?: boolean;
}

/**
 * Intent-related events
 */
export class IntentEvents {
  /**
   * Triggered when a new intent is created
   */
  static async onCreated(event: IntentEvent): Promise<void> {
    try {
      // Get all eligible indexes for this user
      const eligibleIndexes = await db.select({
        id: indexes.id
      })
        .from(indexes)
        .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
        .where(and(
          eq(indexMembers.userId, event.userId),
          eq(indexMembers.autoAssign, true),
          isNull(indexes.deletedAt)
        ));
      
      // Queue individual intent-index pairs
      // Priority 8: New intents - HIGHEST priority (user just created intent)
      // These are time-sensitive user actions that should be processed immediately
      const indexingPromises = eligibleIndexes.map(({ id: indexId }) =>
        addIndexIntentJob({
          intentId: event.intentId,
          indexId,
          userId: event.userId, // Include userId for per-user queuing
        }, 8)
      );
      
      await Promise.all(indexingPromises);
      
      // Trigger context brokers - they decide if they want to use queue or not
      await triggerBrokersOnIntentCreated(event.intentId);
    } catch (error) {
      // Failed to queue intent indexing
    }
  }
  
  /**
   * Triggered when an intent is updated
   */
  static async onUpdated(event: IntentEvent): Promise<void> {
    try {
      // Get all eligible indexes for this user
      const eligibleIndexes = await db.select({
        id: indexes.id
      })
        .from(indexes)
        .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
        .where(and(
          eq(indexMembers.userId, event.userId),
          eq(indexMembers.autoAssign, true),
          isNull(indexes.deletedAt)
        ));
      
      // Queue individual intent-index pairs
      // Priority 8: Updated intents - HIGHEST priority (user just modified intent)
      // These are time-sensitive user actions that should be processed immediately
      const indexingPromises = eligibleIndexes.map(({ id: indexId }) =>
        addIndexIntentJob({
          intentId: event.intentId,
          indexId,
          userId: event.userId, // Include userId for per-user queuing
        }, 8)
      );
      
      await Promise.all(indexingPromises);
      
      // Trigger context brokers - they decide if they want to use queue or not
      await triggerBrokersOnIntentUpdated(event.intentId, event.previousStatus);
    } catch (error) {
      // Failed to queue intent indexing
    }
  }
  
  /**
   * Triggered when an intent is archived
   */
  static async onArchived(event: IntentEvent): Promise<void> {
    try {
      await triggerBrokersOnIntentArchived(event.intentId);
    } catch (error) {
      // Failed to process archived intent
    }
  }
}

/**
 * Index-related events
 */
export class IndexEvents {
  /**
   * Triggered when index prompt is updated
   */
  static async onPromptUpdated(event: IndexEvent): Promise<void> {
    try {
      // Get all intents from members of this index and queue them individually
      const memberIntents = await db.select({ 
        intentId: intents.id,
        userId: intents.userId
      })
        .from(intents)
        .innerJoin(indexMembers, eq(intents.userId, indexMembers.userId))
        .where(and(
          eq(indexMembers.indexId, event.indexId),
          eq(indexMembers.autoAssign, true),
          isNull(intents.archivedAt)
        ));
      
      // Priority 4: Index prompt updates - LOWEST priority (background maintenance)
      // When an index prompt changes, re-indexing can happen in background
      // Less urgent than direct user actions (creating/updating intents)
      const queuePromises = memberIntents.map(({ intentId, userId }) => 
        addIndexIntentJob({
          intentId,
          indexId: event.indexId,
          userId, // Include userId for per-user queuing
        }, 4) // Highest priority
      );
      
      await Promise.all(queuePromises);
    } catch (error) {
      // Failed to queue index intents
    }
  }
}

/**
 * Member-related events  
 */
export class MemberEvents {
  /**
   * Triggered when member settings are updated
   */
  static async onSettingsUpdated(event: MemberEvent): Promise<void> {
    try {
      if (event.promptChanged || event.autoAssignChanged) {
        // Get all user's intents and queue them individually
        const userIntents = await db.select({ id: intents.id })
          .from(intents)
          .where(and(
            eq(intents.userId, event.userId),
            isNull(intents.archivedAt)
          ));
        
        // Priority 6: Member settings updates - MEDIUM priority
        // When a member's auto-assign changes, their intents need re-indexing
        // Less urgent than user intent actions but more important than background tasks
        const queuePromises = userIntents.map(({ id: intentId }) => 
          addIndexIntentJob({
            intentId,
            indexId: event.indexId,
            userId: event.userId!, // Include userId for per-user queuing
          }, 6)
        );
        
        await Promise.all(queuePromises);
      }
    } catch (error) {
      // Failed to queue member intents
    }
  }
}

/**
 * Centralized event dispatcher
 */
export const Events = {
  Intent: IntentEvents,
  Index: IndexEvents,
  Member: MemberEvents
};
