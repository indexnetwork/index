import { Router, Response } from 'express';
import { param, query, validationResult } from 'express-validator';
import fs from 'fs';
import path from 'path';
import db from '../lib/db';
import { files } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, count } from 'drizzle-orm';
import { analyzeFolder } from '../agents/core/intent_inferrer';
import { processIntent } from '../agents/core/intent_enhancer';
import { checkIndexAccess } from '../lib/index-access';

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
        .where(and(eq(files.indexId, indexId), isNull(files.deletedAt)));
      
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
          .where(and(eq(files.indexId, indexId), isNull(files.deletedAt)));

        if (indexFiles.length === 0) {
          suggestions = [];
        } else {
          const baseUploadDir = path.join(__dirname, '../../uploads', indexId);
          const fileIds = indexFiles.map(file => file.id);

          // Use intent suggester to analyze files directly
          const result = await analyzeFolder(baseUploadDir, fileIds, { timeoutMs: 60000 });

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

export default router; 