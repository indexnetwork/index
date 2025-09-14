import { Router, Response } from 'express';
import { param, query, validationResult } from 'express-validator';
import path from 'path';
import db from '../lib/db';
import { files, intents, indexes, intentIndexes } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, count, desc, sql } from 'drizzle-orm';
import { analyzeFolder } from '../agents/core/intent_inferrer';
import { processIntent } from '../agents/core/intent_enhancer';
import { checkIndexAccess } from '../lib/index-access';
import { getUploadsPath } from '../lib/paths';

// Simple L1 cache for suggestions
interface CacheEntry {
  suggestions: { payload: string; confidence: number }[];
  fileCount: number;
  timestamp: Date;
}

class SuggestionsCache {
  private cache = new Map<string, CacheEntry>();
  
  get(indexId: string): { payload: string; confidence: number }[] | null {
    const entry = this.cache.get(indexId);
    return entry?.suggestions || null;
  }
  
  set(indexId: string, suggestions: { payload: string; confidence: number }[], fileCount: number) {
    this.cache.set(indexId, {
      suggestions,
      fileCount,
      timestamp: new Date()
    });
    console.log(`📄 Cached ${suggestions.length} suggestions for index ${indexId}`);
  }
  
  invalidate(indexId: string) {
    const existed = this.cache.has(indexId);
    this.cache.delete(indexId);
    if (existed) {
      console.log(`🗑️ Invalidated suggestions cache for index ${indexId}`);
    }
  }
  
  shouldInvalidate(indexId: string, currentFileCount: number): boolean {
    const entry = this.cache.get(indexId);
    return !entry || entry.fileCount !== currentFileCount;
  }
  
  // New method to update cache with a single new suggestion
  replaceSuggestion(indexId: string, oldSuggestion: string, newSuggestion: { payload: string; confidence: number }, fileCount: number) {
    const entry = this.cache.get(indexId);
    if (entry) {
      const suggestionIndex = entry.suggestions.findIndex(s => s.payload === oldSuggestion);
      if (suggestionIndex !== -1) {
        entry.suggestions[suggestionIndex] = newSuggestion;
        entry.fileCount = fileCount;
        entry.timestamp = new Date();
        console.log(`🔄 Replaced suggestion in cache for index ${indexId}`);
      }
    }
  }
}

// Global cache instance
const suggestionsCache = new SuggestionsCache();

// Cache invalidation helper
export const invalidateIndexCache = (indexId: string) => {
  suggestionsCache.invalidate(indexId);
};



const router = Router({ mergeParams: true });

// Get suggested intents for an index based on files
router.get('/',
  authenticatePrivy,
  [param('indexId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    console.log(req.params)
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { indexId } = req.params;

      // Check access
      const accessCheck = await checkIndexAccess(indexId, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      // Get current file count for cache validation
      const fileCountResult = await db.select({ count: count() })
        .from(files)
        .where(and(eq(files.userId, req.user!.id), isNull(files.deletedAt)));
      
      const currentFileCount = fileCountResult[0].count;

      // Check if cache should be invalidated
      if (suggestionsCache.shouldInvalidate(indexId, currentFileCount)) {
        suggestionsCache.invalidate(indexId);
      }

      // Try to get from cache first
      let suggestions = suggestionsCache.get(indexId);
      let fromCache = true;
      let processingTime = 0;

      if (!suggestions) {
        // Generate suggestions synchronously
        const startTime = Date.now();
        fromCache = false;

        console.log(`🔄 Generating suggestions for index ${indexId} (${currentFileCount} files)`);

        // Get files in the index
        const indexFiles = await db.select({
          id: files.id,
          name: files.name
        }).from(files)
          .where(and(eq(files.userId, req.user!.id), isNull(files.deletedAt)));

        if (indexFiles.length === 0) {
          suggestions = [];
        } else {
          // Get existing intents for this index
          const existingIntentsResult = await db.select({
            payload: intents.payload
          }).from(intents)
            .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
            .where(eq(intentIndexes.indexId, indexId))
            .orderBy(desc(intents.createdAt));

          const existingIntents = existingIntentsResult.map(i => i.payload);

          const baseUploadDir = getUploadsPath('files', req.user!.id);
          const fileIds = indexFiles.map(file => file.id);

          // Use intent suggester to analyze files directly with existing intents context
          const result = await analyzeFolder(
            baseUploadDir, 
            fileIds, 
            undefined, // textInstruction
            existingIntents, // existingIntents
            [], // existingSuggestions (empty for initial generation)
            5, // count (maximum 5 suggested intents)
            60000 // timeoutMs
          );

          if (result.success) {
            suggestions = result.intents.map((intent: any) => ({
              payload: intent.payload,
              confidence: intent.confidence
            }));
          } else {
            console.error('Intent inference failed');
            return res.status(500).json({ error: 'Failed to generate intents' });
          }
        }

        processingTime = Date.now() - startTime;
        console.log(`✅ Generated ${suggestions.length} suggestions for index ${indexId} in ${processingTime}ms`);

        // Cache the results
        suggestionsCache.set(indexId, suggestions, currentFileCount);
      } else {
        console.log(`⚡ Serving cached suggestions for index ${indexId} (${suggestions.length} suggestions)`);
      }

      return res.json({
        intents: suggestions,
        fromCache,
        processingTime: fromCache ? undefined : processingTime
      });

    } catch (error) {
      console.error('Get suggested intents error:', error);
      return res.status(500).json({ error: 'Failed to generate suggested intents' });
    }
  }
);

// New endpoint to replace a single suggestion
router.post('/replace',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    query('removedSuggestion').trim().isLength({ min: 1 })
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { indexId } = req.params;
      const { removedSuggestion } = req.query;

      // Check access
      const accessCheck = await checkIndexAccess(indexId, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      // Get current file count
      const fileCountResult = await db.select({ count: count() })
        .from(files)
        .where(and(eq(files.userId, req.user!.id), isNull(files.deletedAt)));
      
      const currentFileCount = fileCountResult[0].count;

      // Get current suggestions from cache
      const currentSuggestions = suggestionsCache.get(indexId) || [];
      
      // Get existing intents for this index
      const existingIntentsResult = await db.select({
        payload: intents.payload
      }).from(intents)
        .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
        .where(eq(intentIndexes.indexId, indexId))
        .orderBy(desc(intents.createdAt));

      const existingIntents = existingIntentsResult.map(i => i.payload);

      // Build existing suggestions list (excluding the one being removed)
      const existingSuggestions = currentSuggestions
        .filter(s => s.payload !== removedSuggestion)
        .map(s => s.payload);

      // Get files in the index
      const indexFiles = await db.select({
        id: files.id,
        name: files.name
      }).from(files)
        .where(and(eq(files.userId, req.user!.id), isNull(files.deletedAt)));

      if (indexFiles.length === 0) {
        return res.status(400).json({ error: 'No files found in index' });
      }

      const baseUploadDir = getUploadsPath('files', req.user!.id);
      const fileIds = indexFiles.map(file => file.id);

      // Generate a single new suggestion
      const result = await analyzeFolder(
        baseUploadDir, 
        fileIds, 
        undefined, // textInstruction
        existingIntents, // existingIntents
        existingSuggestions, // existingSuggestions
        1, // count (just one replacement)
        30000 // timeoutMs (shorter for single generation)
      );

      if (result.success && result.intents.length > 0) {
        const newSuggestion = {
          payload: result.intents[0].payload,
          confidence: result.intents[0].confidence
        };

        // Update cache with the replacement
        suggestionsCache.replaceSuggestion(indexId, removedSuggestion as string, newSuggestion, currentFileCount);

        return res.json({
          newSuggestion
        });
      } else {
        console.error('Failed to generate replacement suggestion');
        return res.status(500).json({ error: 'Failed to generate replacement suggestion' });
      }

    } catch (error) {
      console.error('Replace suggestion error:', error);
      return res.status(500).json({ error: 'Failed to replace suggestion' });
    }
  }
);

// Get intent preview with contextual integrity processing
router.get('/preview',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    query('payload').trim().isLength({ min: 1 })
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { indexId } = req.params;
      const { payload } = req.query;

      // Check access
      const accessCheck = await checkIndexAccess(indexId, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      // Process intent with contextual integrity
      const result = await processIntent(payload as string, indexId);

      if (result.success) {
        return res.json({
          payload: result.payload
        });
      } else {
        console.error('Intent processing failed:', result.error);
        return res.status(500).json({ error: 'Failed to process intent' });
      }

    } catch (error) {
      console.error('Get intent preview error:', error);
      return res.status(500).json({ error: 'Failed to process intent preview' });
    }
  }
);

// Get member suggestions - returns user's intents not in the index
router.get('/member',
  authenticatePrivy,
  [param('indexId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { indexId } = req.params;

      // Check access
      const accessCheck = await checkIndexAccess(indexId, req.user!.id);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      // Get user's intents that are NOT in this index
      const userIntentsNotInIndex = await db.select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        createdAt: intents.createdAt,
        confidence: sql<number>`1.0`.as('confidence') // Add confidence field for compatibility
      }).from(intents)
        .where(and(
          eq(intents.userId, req.user!.id),
          isNull(intents.archivedAt),
          sql`NOT EXISTS (
            SELECT 1 FROM ${intentIndexes} 
            WHERE ${intentIndexes.intentId} = ${intents.id} 
            AND ${intentIndexes.indexId} = ${indexId}
          )`
        ))
        .orderBy(desc(intents.createdAt))
        .limit(50);

      return res.json({ 
        intents: userIntentsNotInIndex.map(intent => ({
          id: intent.id,
          payload: intent.payload,
          summary: intent.summary,
          createdAt: intent.createdAt,
          confidence: intent.confidence
        }))
      });
    } catch (error) {
      console.error('Get member suggestions error:', error);
      return res.status(500).json({ error: 'Failed to fetch member suggestions' });
    }
  }
);

export default router; 
