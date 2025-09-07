import { Router, Response } from 'express';
import { param, query, body, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents, users, intentStakes, userConnectionEvents, indexes, intentIndexes } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, sql, or, notInArray } from 'drizzle-orm';
import {getIndexWithPermissions } from '../lib/index-access';
import { validateAndGetAccessibleIndexIds } from '../lib/index-access';
import { getAccessibleIntents } from '../lib/intent-access';

const router = Router();


// Get stakes for users within a specific shared index, grouped by user
router.get('/index/share/:code/by-user',
  authenticatePrivy,
  [param('code').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { code } = req.params;

      // Check access to the shared index
      const accessCheck = await getIndexWithPermissions({ code });
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      const sharedIndexData = accessCheck.indexData!;

      // Check if the shared index has can-discover permission
      if (!accessCheck.memberPermissions?.includes('can-discover')) {
        return res.status(403).json({ error: 'Shared index does not allow discovery' });
      }


      // Get user's intents in this specific shared index using generic function
      const userIntentsResult = await getAccessibleIntents(req.user!.id, {
        indexIds: [sharedIndexData.id],
        includeOwnIntents: false
      });

      const userIntentIds = userIntentsResult.intents.map(intent => intent.id);

      // If user has no non-archived intents in this index, return empty result
      if (userIntentIds.length === 0) {
        return res.json([]);
      }

      // Get stakes for intents in this index that:
      // 1. Match the user's intent IDs
      // 2. Are associated with the shared index
      // Join with intents, intent indexes and users tables to get all needed data
      const query = db.select({
        stake: intentStakes.stake,
        reasoning: intentStakes.reasoning,
        stakeIntents: intentStakes.intents,
        userId: users.id,
        userName: users.name,
        userAvatar: users.avatar,
        userIntro: users.intro,
        intentArchivedAt: intents.archivedAt,
        intentPayload: intents.payload
      })
      .from(intentStakes)
      .innerJoin(intents, sql`${intents.id}::text = ANY(${intentStakes.intents})`)
      .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(
        eq(intentIndexes.indexId, sharedIndexData.id),
        sql`EXISTS (
          SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
          WHERE intent_id NOT IN (${sql.join(userIntentIds.map(id => sql`${id}`), sql`, `)})
        )`,
        sql`${users.id} != ${req.user!.id}`,
        isNull(intents.archivedAt)
      ));

      console.log('Executing query:', query.toSQL());
      
      const stakes = await query;

      console.log("aaaa",stakes);

      // Group by user
      const userStakes = stakes.reduce((acc, stake) => {
        const userName = stake.userName;
        if (!acc[userName]) {
          acc[userName] = {
            user: {
              id: stake.userId,
              name: stake.userName,
              avatar: stake.userAvatar,
              intro: stake.userIntro
            },
            totalStake: BigInt(0),
            reasoning: new Set()
          };
        }
        acc[userName].totalStake += stake.stake;

        if (stake.reasoning) {
          acc[userName].reasoning.add(stake.reasoning);
        }

        return acc;
      }, {} as Record<string, any>);

      // Format results without synthesis (synthesis moved to separate endpoint)
      const result = Object.values(userStakes)
        .map(user => ({
          user: user.user,
          totalStake: user.totalStake.toString(),
          reasoning: Array.from(user.reasoning).join(' ')
        }))
        .sort((a, b) => Number(BigInt(b.totalStake) - BigInt(a.totalStake)));

      return res.json(result);
    } catch (error) {
      console.error('Get index stakes by user error:', error);
      return res.status(500).json({ error: 'Failed to fetch index stakes by user' });
    }
  }
);

export default router;