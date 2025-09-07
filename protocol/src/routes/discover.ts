import { Router, Response } from 'express';
import { eq, ne, sql, and, or } from 'drizzle-orm';
import { body, validationResult } from 'express-validator';
import db from '../lib/db';
import { users, intents, intentStakes, intentIndexes, userConnectionEvents } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';

const router = Router();

/*
Request:{
    "userIds": [
        "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4" // seref's intents limited with userIds
    ],
    "indexIds": [
        "5a338a89-4fc4-48d7-999e-2069ef9ee267" // seref's intents in indexIds
    ],
    "intentIds": [
        "0a31709f-4120-46c5-9a30-aa94891aa378" // seref's specific intents
    ],
    "excludeDiscovered": true,  // exclude users with existing connections (default: true)
    "page" : 1,
    "limit": 50
}
Response:{
    "debugUserId": "7c3ca3cf-048f-43e9-bf47-65f03a6333d8",
    "results": [
        {
            "userId": "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4",
            "totalStake": "100",
            "reasonings": [
                "These two intents are related because they are identical, both expressing a desire to collaborate with UX designers and researchers to explore the implications of AI-driven user interfaces on user experience design."
            ],
            "stakeAmounts": [
                "100"
            ],
            "userIntents": [
                "0a31709f-4120-46c5-9a30-aa94891aa378"
            ]
        }
    ],
    "pagination": {
        "page": 1,
        "limit": 50,
        "hasNext": false,
        "hasPrev": false
    },
    "filters": {
        "intentIds": [
            "0a31709f-4120-46c5-9a30-aa94891aa378"
        ],
        "userIds": [
            "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4"
        ],
        "indexIds": [
            "5a338a89-4fc4-48d7-999e-2069ef9ee267"
        ]
    }
}    
*/

// 🚀 Route: Get paired users' staked intents
router.post("/filter", 
  authenticatePrivy,
  [
    body('intentIds').optional().isArray(),
    body('intentIds.*').optional().isUUID(),
    body('userIds').optional().isArray(),
    body('userIds.*').optional().isUUID(),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID(),
    body('excludeDiscovered').optional().isBoolean(),
    body('page').optional().isInt({ min: 1 }).toInt(),
    body('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      // Extract filters from request body
      const {
        intentIds,
        userIds,
        indexIds,
        excludeDiscovered = true, // Default to true
        page = 1,
        limit = 50
      } = req.body;

      const authenticatedUserId = req.user!.id;


    // Get authenticated user's intents for filtering
    const authenticatedUserIntents = await db
      .select({ intentId: intents.id })
      .from(intents)
      .where(eq(intents.userId, authenticatedUserId));

    // Extract the intent IDs for easier use in the main query
    const userIntentIds = authenticatedUserIntents.map(row => row.intentId);

  const mainQuery = db
  .select({
    // Get the user ID who has staked
    userId: intents.userId,
    // Sum up all stake amounts for this user
    totalStake: sql<number>`SUM(${intentStakes.stake})`,
    // Collect all stake information
    stakes: sql<any[]>`ARRAY_AGG(
      jsonb_build_object(
        'reasoning', ${intentStakes.reasoning},
        'stake', ${intentStakes.stake},
        'intentId', intentId.id,
        'intent', jsonb_build_object(
          'id', ${intents.id},
          'payload', ${intents.payload},
          'summary', ${intents.summary},
          'createdAt', ${intents.createdAt}
        )
      )
    )`,
  })
  .from(intentStakes)
  // Explode the stake.intents array into individual rows for filtering
  // This allows us to match each intent ID separately
  .innerJoin(
    sql`UNNEST(${intentStakes.intents}::uuid[]) as intentId(id)`,
    sql`TRUE`
  )
  // Join with intents table to get user info
  .innerJoin(intents, sql`intentId.id = ${intents.id}`)
  // Join with users table to get user details
  .innerJoin(users, eq(users.id, intents.userId))
  
  .where(
    and(
      // Only stakes that contain authenticated user's intents
      userIntentIds.length > 0 ? sql`${intentStakes.intents}::uuid[] && ARRAY[${sql.join(userIntentIds.map(id => sql`${id}`), sql`, `)}]::uuid[]` : sql`FALSE`,

      // External intent-ids filter (must be authenticated user's intents if provided)
      ...(intentIds && intentIds.length > 0 ? [
        sql`${intentStakes.intents}::uuid[] && ARRAY[${sql.join(intentIds.map((id: string) => sql`${id}`), sql`, `)}]::uuid[]`
      ] : []),

      // External user-ids filter (for vibecheck)
      ...(userIds && userIds.length > 0 ? [
        sql`${intents.userId} = ANY(ARRAY[${sql.join(userIds.map((id: string) => sql`${id}`), sql`, `)}]::uuid[])`
      ] : []),

      // External index-ids filter (must be authenticated user's indexes)
      ...(indexIds && indexIds.length > 0 ? [
        sql`EXISTS (
          SELECT 1
          FROM ${intentIndexes} ii_filter
          WHERE ii_filter.intent_id = ANY(${intentStakes.intents}::uuid[])
          AND ii_filter.index_id = ANY(ARRAY[${sql.join(indexIds.map((id: string) => sql`${id}`), sql`, `)}]::uuid[])
        )`
      ] : []),

      // Exclude users with existing connections if excludeDiscovered is true
      ...(excludeDiscovered ? [
        sql`NOT EXISTS (
          SELECT 1
          FROM ${userConnectionEvents} uce
          WHERE (
            (uce.initiator_user_id = ${authenticatedUserId} AND uce.receiver_user_id = ${intents.userId})
            OR
            (uce.initiator_user_id = ${intents.userId} AND uce.receiver_user_id = ${authenticatedUserId})
          )
        )`
      ] : []),

      // Check if all intents in the stake exist in the same index
      sql`EXISTS (
        SELECT 1 
        FROM ${intentIndexes} ii1
        WHERE ii1.intent_id = ANY(${intentStakes.intents}::uuid[])
        GROUP BY ii1.index_id
        HAVING COUNT(*) = array_length(${intentStakes.intents}, 1)
      )`
    )
  )
  // Group results by user to get per-user totals
  .groupBy(intents.userId)
  // Exclude the authenticated user from results
  .having(ne(intents.userId, authenticatedUserId))
  // Add pagination
  .limit(limit)
  .offset((page - 1) * limit);

    const results = await mainQuery;

    // Format the results to match the expected structure
    const formattedResults = await Promise.all(results.map(async (row) => {
      // Get user details
      const userDetails = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatar: users.avatar
      }).from(users)
        .where(eq(users.id, row.userId))
        .limit(1);

      const user = userDetails[0];

      // Process stakes to filter only those that involve authenticated user's intents
      const relevantStakes = row.stakes.filter((stake: any) => 
        userIntentIds.includes(stake.intentId)
      );

      // Get unique intents that are staked
      const intentMap = new Map();
      relevantStakes.forEach((stake: any) => {
        if (!intentMap.has(stake.intent.id)) {
          intentMap.set(stake.intent.id, {
            intent: stake.intent,
            totalStake: 0,
            reasonings: []
          });
        }
        const intentData = intentMap.get(stake.intent.id);
        intentData.totalStake += parseInt(stake.stake);
        if (stake.reasoning) {
          intentData.reasonings.push(stake.reasoning);
        }
      });

      return {
        user,
        totalStake: row.totalStake,
        intents: Array.from(intentMap.values()).map(intentData => ({
          intent: intentData.intent,
          totalStake: intentData.totalStake,
          reasonings: [...new Set(intentData.reasonings)] // Remove duplicate reasonings
        }))
      };
    }));

    return res.json({
      results: formattedResults,
      pagination: {
        page: page,
        limit: limit,
        hasNext: results.length === limit,
        hasPrev: page > 1
      },
      filters: {
        intentIds: intentIds || null,
        userIds: userIds || null,
        indexIds: indexIds || null,
        excludeDiscovered: excludeDiscovered
      }
    });
  } catch (err) {
    console.error("Discover filter error:", err);
    return res.status(500).json({ error: "Failed to fetch discovery data" });
  }
});

export default router;
