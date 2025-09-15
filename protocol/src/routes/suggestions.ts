import { Router, Response } from 'express';
import { param, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents, indexes, intentIndexes } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, desc, sql } from 'drizzle-orm';
import { recommendIntents } from '../agents/core/intent_recommender';
import { checkIndexAccess } from '../lib/index-access';

const router = Router({ mergeParams: true });

// Get intent suggestions based on index prompt and existing intents
router.get('/intents',
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

      // Get index details
      const indexDetails = await db.select({
        title: indexes.title,
        prompt: indexes.prompt
      }).from(indexes)
        .where(eq(indexes.id, indexId))
        .limit(1);

      if (indexDetails.length === 0) {
        return res.status(404).json({ error: 'Index not found' });
      }

      const indexPrompt = indexDetails[0].prompt;

      // Get existing intents in the index (for context)
      const existingIntentsResult = await db.select({
        payload: intents.payload
      }).from(intents)
        .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
        .where(eq(intentIndexes.indexId, indexId))
        .orderBy(desc(intents.createdAt))
        .limit(20); // Get more for better context

      const existingIntentPayloads = existingIntentsResult.map(i => i.payload);

      // Get user's intents that are NOT in this index
      const userIntentsNotInIndex = await db.select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary
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
        .limit(100); // Analyze up to 100 intents

      if (userIntentsNotInIndex.length === 0) {
        return res.json({ 
          intents: [],
          message: 'No additional intents available to suggest'
        });
      }

      // Use the intent recommender to find most relevant intents
      const recommendResult = await recommendIntents(
        userIntentsNotInIndex as Array<{ id: string; payload: string; summary?: string }>,
        indexPrompt,
        existingIntentPayloads,
        10 // Return up to 10 suggestions
      );

      if (!recommendResult.success) {
        console.error('Intent recommendation failed:', recommendResult.error);
        return res.status(500).json({ error: 'Failed to recommend intents' });
      }

      const suggestions = (recommendResult.recommendations || []).map(recommendation => ({
        id: recommendation.id,
        payload: recommendation.payload
      }));

      return res.json({ 
        intents: suggestions
      });

    } catch (error) {
      console.error('Get intent recommendations error:', error);
      return res.status(500).json({ error: 'Failed to generate intent recommendations' });
    }
  }
);

export default router; 
