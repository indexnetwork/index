import { Router, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents, intentStakes, agents, users, intentIndexes } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, sql, inArray } from 'drizzle-orm';
import { synthesizeVibeCheck } from '../lib/synthesis';

const router = Router();

// Generate synthesis between two users
router.post('/vibecheck',
  authenticatePrivy,
  [
    body('targetUserId').isUUID().withMessage('Target user ID must be a valid UUID'),
    body('intentIds').optional().isArray().withMessage('Intent IDs must be an array'),
    body('intentIds.*').optional().isUUID().withMessage('Each intent ID must be a valid UUID'),
    body('indexIds').optional().isArray().withMessage('Index IDs must be an array'),
    body('indexIds.*').optional().isUUID().withMessage('Each index ID must be a valid UUID'),
    body('options').optional().isObject().withMessage('Options must be an object')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const contextUserId = req.user!.id;
      const { targetUserId, intentIds, indexIds, options } = req.body;

      // Prevent self-synthesis
      if (contextUserId === targetUserId) {
        return res.status(400).json({ error: 'Cannot generate synthesis for yourself' });
      }

      // Verify target user exists
      const targetUser = await db.select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, targetUserId), isNull(users.deletedAt)))
        .limit(1);

      if (targetUser.length === 0) {
        return res.status(404).json({ error: 'Target user not found' });
      }

      // Privacy check: Ensure there are staked intents connecting these users
      // Get context user's intents (either specified or all), filtered by indexes if provided
      let contextIntentIds: string[] = [];
      if (intentIds && intentIds.length > 0) {
        // Verify specified intents belong to context user and optionally filter by indexes
        const verifiedIntents = indexIds && indexIds.length > 0
          ? await db.select({ id: intents.id })
              .from(intents)
              .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
              .where(and(
                eq(intents.userId, contextUserId),
                inArray(intents.id, intentIds),
                inArray(intentIndexes.indexId, indexIds)
              ))
          : await db.select({ id: intents.id })
              .from(intents)
              .where(and(
                eq(intents.userId, contextUserId),
                inArray(intents.id, intentIds)
              ));
        
        contextIntentIds = verifiedIntents.map(i => i.id);
      } else {
        // Get all context user's intents, optionally filtered by indexes
        const allIntents = indexIds && indexIds.length > 0
          ? await db.select({ id: intents.id })
              .from(intents)
              .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
              .where(and(
                eq(intents.userId, contextUserId),
                inArray(intentIndexes.indexId, indexIds)
              ))
          : await db.select({ id: intents.id })
              .from(intents)
              .where(eq(intents.userId, contextUserId));
        
        contextIntentIds = allIntents.map(i => i.id);
      }

      if (contextIntentIds.length === 0) {
        return res.status(400).json({ error: 'No valid context intents found' });
      }

      // Get target user's intents, filtered by same indexes if provided
      const targetIntents = indexIds && indexIds.length > 0
        ? await db.select({ id: intents.id })
            .from(intents)
            .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
            .where(and(
              eq(intents.userId, targetUserId),
              inArray(intentIndexes.indexId, indexIds)
            ))
        : await db.select({ id: intents.id })
            .from(intents)
            .where(eq(intents.userId, targetUserId));
      
      const targetIntentIds = targetIntents.map(i => i.id);

      if (targetIntentIds.length === 0) {
        return res.status(400).json({ error: 'Target user has no intents' });
      }

      // Privacy check: Find stakes that connect both users' intents
      const connectingStakes = await db.select({
        id: intentStakes.id,
        stakeIntents: intentStakes.intents
      })
      .from(intentStakes)
      .innerJoin(agents, eq(intentStakes.agentId, agents.id))
      .where(and(
        isNull(agents.deletedAt),
        // Stakes must include at least one intent from context user
        sql`EXISTS(
          SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
          WHERE intent_id IN (${sql.join(contextIntentIds.map(id => sql`${id}`), sql`, `)})
        )`,
        // Stakes must also include at least one intent from target user
        sql`EXISTS(
          SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
          WHERE intent_id IN (${sql.join(targetIntentIds.map(id => sql`${id}`), sql`, `)})
        )`
      ));

      if (connectingStakes.length === 0) {
        return res.status(403).json({ 
          error: 'No connecting stakes found between users',
          message: 'Synthesis requires shared staked intents between users'
        });
      }

      // Generate synthesis
      const synthesis = await synthesizeVibeCheck({
        targetUserId,
        contextUserId,
        intentIds: contextIntentIds,
        options
      });

      return res.json({
        synthesis,
        targetUserId,
        contextUserId,
        connectingStakes: connectingStakes.length
      });

    } catch (error) {
      console.error('Synthesis vibecheck error:', error);
      return res.status(500).json({ error: 'Failed to generate synthesis' });
    }
  }
);

export default router; 