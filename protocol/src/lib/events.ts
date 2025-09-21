import { intentIndexer } from '../agents/core/intent_indexer';
import { 
  triggerBrokersOnIntentCreated, 
  triggerBrokersOnIntentUpdated, 
  triggerBrokersOnIntentArchived 
} from '../agents/context_brokers/connector';

/**
 * Centralized event management system for database operations
 * Manages all triggers for intents, indexes, and related operations
 */

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
    console.log(`🎯 Intent created event: ${event.intentId}`);
    
    try {
      // 1. Run intent indexer first (auto-assignment)
      await intentIndexer.processIntent(event.intentId);
      
      // 2. Then run context brokers
      await triggerBrokersOnIntentCreated(event.intentId);
      
      console.log(`✅ Intent created event processed: ${event.intentId}`);
    } catch (error) {
      console.error(`❌ Error processing intent created event ${event.intentId}:`, error);
      // Don't throw - we don't want to break the main operation
    }
  }
  
  /**
   * Triggered when an intent is updated
   */
  static async onUpdated(event: IntentEvent): Promise<void> {
    console.log(`🎯 Intent updated event: ${event.intentId}`);
    
    try {
      // 1. Run intent indexer first (re-evaluate assignments)
      await intentIndexer.processIntent(event.intentId);
      
      // 2. Then run context brokers
      await triggerBrokersOnIntentUpdated(event.intentId, event.previousStatus);
      
      console.log(`✅ Intent updated event processed: ${event.intentId}`);
    } catch (error) {
      console.error(`❌ Error processing intent updated event ${event.intentId}:`, error);
    }
  }
  
  /**
   * Triggered when an intent is archived
   */
  static async onArchived(event: IntentEvent): Promise<void> {
    console.log(`🎯 Intent archived event: ${event.intentId}`);
    
    try {
      // Run context brokers for archived intent
      await triggerBrokersOnIntentArchived(event.intentId);
      
      console.log(`✅ Intent archived event processed: ${event.intentId}`);
    } catch (error) {
      console.error(`❌ Error processing intent archived event ${event.intentId}:`, error);
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
    console.log(`🎯 Index prompt updated event: ${event.indexId}`);
    
    try {
      // Reprocess all member intents for this index
      await intentIndexer.reprocessIndexIntents(event.indexId);
      
      console.log(`✅ Index prompt updated event processed: ${event.indexId}`);
    } catch (error) {
      console.error(`❌ Error processing index prompt updated event ${event.indexId}:`, error);
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
    console.log(`🎯 Member settings updated event: user ${event.userId} in index ${event.indexId}`);
    
    try {
      // Only reprocess if prompt or auto-assign changed
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (event.promptChanged || event.autoAssignChanged) {
        intentIndexer.reprocessUserIndexIntents(event.userId, event.indexId);
      }
      
      console.log(`✅ Member settings updated event processed: user ${event.userId} in index ${event.indexId}`);
    } catch (error) {
      console.error(`❌ Error processing member settings updated event ${event.userId}/${event.indexId}:`, error);
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
