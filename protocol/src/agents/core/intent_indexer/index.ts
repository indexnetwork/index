import db from '../../../lib/db';
import { intents, intentIndexes, indexes, indexMembers, users } from '../../../lib/schema';
import { eq, and, or, inArray, isNull } from 'drizzle-orm';
import { evaluateIntentRelevance } from './evaluator';

// Constants
const RELEVANCE_THRESHOLD = 0.7;
const BATCH_SIZE = 50;

export interface IntentIndexerResult {
  success: boolean;
  indexedCount: number;
  deIndexedCount: number;
  error?: string;
}

interface EligibleIndex {
  id: string;
  indexPrompt: string | null;
  memberPrompt: string | null;
}

export class IntentIndexer {
  /**
   * Process a single intent for auto-indexing
   */
  async processIntent(intentId: string): Promise<IntentIndexerResult> {
    try {
      console.log(`🔍 Processing intent ${intentId} for auto-indexing`);
      
      // Get intent details
      const intent = await db.select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId
      }).from(intents)
        .where(eq(intents.id, intentId))
        .limit(1);
        
      if (intent.length === 0) {
        return {
          success: false,
          indexedCount: 0,
          deIndexedCount: 0,
          error: 'Intent not found'
        };
      }
      
      const intentData = intent[0];
      
      // Get eligible indexes for this user (auto_assign = true)
      const eligibleIndexes = await this.getEligibleIndexes(intentData.userId);
      
      if (eligibleIndexes.length === 0) {
        console.log(`📭 No eligible indexes found for user ${intentData.userId}`);
        return {
          success: true,
          indexedCount: 0,
          deIndexedCount: 0
        };
      }
      
      // Get current assignments
      const currentIndexes = await this.getCurrentIndexes(intentId);
      
      let indexedCount = 0;
      let deIndexedCount = 0;
      
      // Analyze relevance for each eligible index
      for (const index of eligibleIndexes) {
        const relevanceScore = await evaluateIntentRelevance(
          intentData.payload,
          index.indexPrompt,
          index.memberPrompt
        );
        
        const shouldIndex = relevanceScore >= RELEVANCE_THRESHOLD;
        const isCurrentlyIndexed = currentIndexes.includes(index.id);
        
        console.log(`📊 Index ${index.id}: relevance=${relevanceScore.toFixed(3)}, shouldIndex=${shouldIndex}, isIndexed=${isCurrentlyIndexed}`);
        
        if (shouldIndex && !isCurrentlyIndexed) {
          await this.indexIntent(intentId, index.id);
          indexedCount++;
          console.log(`✅ Indexed intent ${intentId} to index ${index.id}`);
        } else if (!shouldIndex && isCurrentlyIndexed) {
          await this.deIndexIntent(intentId, index.id);
          deIndexedCount++;
          console.log(`❌ De-indexed intent ${intentId} from index ${index.id}`);
        }
      }
      
      console.log(`🎯 Intent ${intentId} processing complete: +${indexedCount} -${deIndexedCount}`);
      
      return {
        success: true,
        indexedCount,
        deIndexedCount
      };
      
    } catch (error) {
      console.error(`❌ Error processing intent ${intentId}:`, error);
      return {
        success: false,
        indexedCount: 0,
        deIndexedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Process multiple intents in batches
   */
  async processBulkIntents(intentIds: string[]): Promise<IntentIndexerResult> {
    console.log(`🔄 Processing ${intentIds.length} intents in bulk`);
    
    let totalIndexed = 0;
    let totalDeIndexed = 0;
    const errors: string[] = [];
    
    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < intentIds.length; i += BATCH_SIZE) {
      const batch = intentIds.slice(i, i + BATCH_SIZE);
      console.log(`📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(intentIds.length / BATCH_SIZE)}`);
      
      for (const intentId of batch) {
        const result = await this.processIntent(intentId);
        if (result.success) {
          totalIndexed += result.indexedCount;
          totalDeIndexed += result.deIndexedCount;
        } else {
          errors.push(`Intent ${intentId}: ${result.error}`);
        }
      }
    }
    
    console.log(`🎯 Bulk processing complete: +${totalIndexed} -${totalDeIndexed}, ${errors.length} errors`);
    
    return {
      success: errors.length === 0,
      indexedCount: totalIndexed,
      deIndexedCount: totalDeIndexed,
      error: errors.length > 0 ? errors.join('; ') : undefined
    };
  }
  
  /**
   * Reprocess all intents for a specific user in a specific index (when member settings change)
   */
  async reprocessUserIndexIntents(userId: string, indexId: string): Promise<IntentIndexerResult> {
    console.log(`👤 Reprocessing all intents for user ${userId} in index ${indexId}`);
    
    // Get all user's intents
    const userIntents = await db.select({ id: intents.id })
      .from(intents)
      .where(and(
        eq(intents.userId, userId),
        isNull(intents.archivedAt) // Only active intents
      ));
    
    const intentIds = userIntents.map((i: { id: string }) => i.id);
    console.log(`📋 Found ${intentIds.length} intents for user ${userId} in index ${indexId}`);
    
    return await this.processBulkIntents(intentIds);
  }
  
  /**
   * Reprocess all member intents for a specific index (when index prompt changes)
   */
  async reprocessIndexIntents(indexId: string): Promise<IntentIndexerResult> {
    console.log(`📁 Reprocessing all member intents for index ${indexId}`);
    
    // Get all intents from users who are members of this index with auto_assign enabled
    const memberIntents = await db.select({ 
      intentId: intents.id 
    })
      .from(intents)
      .innerJoin(indexMembers, eq(intents.userId, indexMembers.userId))
      .where(and(
        eq(indexMembers.indexId, indexId),
        eq(indexMembers.autoAssign, true),
        isNull(intents.archivedAt) // Only active intents
      ));
    
    const intentIds = memberIntents.map((i: { intentId: string }) => i.intentId);
    console.log(`📋 Found ${intentIds.length} intents from members of index ${indexId}`);
    
    return await this.processBulkIntents(intentIds);
  }
  
  /**
   * Add intent to index
   */
  private async indexIntent(intentId: string, indexId: string): Promise<void> {
    // Check if already exists to avoid duplicate key errors
    const existing = await db.select()
      .from(intentIndexes)
      .where(and(
        eq(intentIndexes.intentId, intentId),
        eq(intentIndexes.indexId, indexId)
      ))
      .limit(1);
    
    if (existing.length === 0) {
      await db.insert(intentIndexes).values({
        intentId,
        indexId
      });
    }
  }
  
  /**
   * Remove intent from index
   */
  private async deIndexIntent(intentId: string, indexId: string): Promise<void> {
    await db.delete(intentIndexes)
      .where(and(
        eq(intentIndexes.intentId, intentId),
        eq(intentIndexes.indexId, indexId)
      ));
  }
  
  /**
   * Get indexes where user is a member with auto_assign enabled
   */
  private async getEligibleIndexes(userId: string): Promise<EligibleIndex[]> {
    const eligibleIndexes = await db.select({
      id: indexes.id,
      indexPrompt: indexes.prompt,
      memberPrompt: indexMembers.prompt
    })
      .from(indexes)
      .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
      .where(and(
        eq(indexMembers.userId, userId),
        eq(indexMembers.autoAssign, true),
        isNull(indexes.deletedAt) // Only active indexes
      ));
    
    return eligibleIndexes;
  }
  
  /**
   * Get current index assignments for an intent
   */
  private async getCurrentIndexes(intentId: string): Promise<string[]> {
    const assignments = await db.select({ indexId: intentIndexes.indexId })
      .from(intentIndexes)
      .where(eq(intentIndexes.intentId, intentId));
    
    return assignments.map((a: { indexId: string }) => a.indexId);
  }
}

// Export singleton instance
export const intentIndexer = new IntentIndexer();
