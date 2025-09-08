import { Router, Response } from 'express';
import { param, query, body, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents, users, intentStakes, userConnectionEvents, indexes, intentIndexes } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, sql, or, notInArray } from 'drizzle-orm';
import {getIndexWithPermissions } from '../lib/index-access';
import { getAccessibleIntents } from '../lib/intent-access';
import { discoverUsers } from '../lib/discover';

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

      // Use the new discovery logic
      const { results } = await discoverUsers({
        authenticatedUserId: req.user!.id,
        userIntentIds,
        indexIds: [sharedIndexData.id],
        excludeDiscovered: false, // Include all users, not just undiscovered ones
        page: 1,
        limit: 100
      });

      // Format results to match the expected response structure
      const formattedResults = results.map(r => ({
        user: {
          id: r.user.id,
          name: r.user.name,
          avatar: r.user.avatar,
          intro: r.user.intro
        },
        totalStake: r.totalStake.toString(),
        reasoning: r.intents.flatMap(i => i.reasonings).filter(r => r).join(' ')
      }))
      .sort((a, b) => Number(BigInt(b.totalStake) - BigInt(a.totalStake)));

      return res.json(formattedResults);
    } catch (error) {
      console.error('Get index stakes by user error:', error);
      return res.status(500).json({ error: 'Failed to fetch index stakes by user' });
    }
  }
);

export default router;