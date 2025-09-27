import db from './db';
import { intents, indexes, indexMembers } from './schema';
import { eq, and, isNull } from 'drizzle-orm';
import { 
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
    console.log(`🎯 Intent created: ${event.intentId}`);
    
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
      const queuePromises = eligibleIndexes.map(({ id: indexId }) =>
        addIndexIntentJob({
          intentId: event.intentId,
          indexId,
          triggerBrokers: true // New intents need broker processing
        }, 8)
      );
      
      await Promise.all(queuePromises);
      
      console.log(`✅ Queued ${eligibleIndexes.length} intent-index pairs for ${event.intentId}`);
    } catch (error) {
      console.error(`❌ Failed to queue intent indexing ${event.intentId}:`, error);
    }
  }
  
  /**
   * Triggered when an intent is updated
   */
  static async onUpdated(event: IntentEvent): Promise<void> {
    console.log(`🎯 Intent updated: ${event.intentId}`);
    
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
      const queuePromises = eligibleIndexes.map(({ id: indexId }) =>
        addIndexIntentJob({
          intentId: event.intentId,
          indexId,
          triggerBrokers: true // Updated intents need broker processing
        }, 8)
      );
      
      await Promise.all(queuePromises);
      
      console.log(`✅ Queued ${eligibleIndexes.length} intent-index pairs for ${event.intentId}`);
    } catch (error) {
      console.error(`❌ Failed to queue intent indexing ${event.intentId}:`, error);
    }
  }
  
  /**
   * Triggered when an intent is archived
   */
  static async onArchived(event: IntentEvent): Promise<void> {
    console.log(`🎯 Intent archived: ${event.intentId}`);
    
    try {
      await triggerBrokersOnIntentArchived(event.intentId);
      console.log(`✅ Intent archived processed: ${event.intentId}`);
    } catch (error) {
      console.error(`❌ Failed to process archived intent ${event.intentId}:`, error);
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
    console.log(`🎯 Index prompt updated: ${event.indexId}`);
    
    try {
      // Get all intents from members of this index and queue them individually
      const memberIntents = await db.select({ 
        intentId: intents.id 
      })
        .from(intents)
        .innerJoin(indexMembers, eq(intents.userId, indexMembers.userId))
        .where(and(
          eq(indexMembers.indexId, event.indexId),
          eq(indexMembers.autoAssign, true),
          isNull(intents.archivedAt)
        ));
      
      const queuePromises = memberIntents.map(({ intentId }) => 
        addIndexIntentJob({
          intentId,
          indexId: event.indexId,
          triggerBrokers: false // Just re-indexing, no broker processing
        }, 4) // Highest priority
      );
      
      await Promise.all(queuePromises);
      
      console.log(`✅ Queued ${memberIntents.length} intents for re-indexing from index ${event.indexId}`);
    } catch (error) {
      console.error(`❌ Failed to queue index intents ${event.indexId}:`, error);
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
    console.log(`🎯 Member settings updated: user ${event.userId} in index ${event.indexId}`);
    
    try {
      if (event.promptChanged || event.autoAssignChanged) {
        // Get all user's intents and queue them individually
        const userIntents = await db.select({ id: intents.id })
          .from(intents)
          .where(and(
            eq(intents.userId, event.userId),
            isNull(intents.archivedAt)
          ));
        
        const queuePromises = userIntents.map(({ id: intentId }) => 
          addIndexIntentJob({
            intentId,
            indexId: event.indexId,
            triggerBrokers: false // Just re-indexing, no broker processing
          }, 6)
        );
        
        await Promise.all(queuePromises);
        
        console.log(`✅ Queued ${userIntents.length} intents for re-indexing from user ${event.userId}`);
      }
    } catch (error) {
      console.error(`❌ Failed to queue member intents ${event.userId}/${event.indexId}:`, error);
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
