import { Router, Response } from 'express';
import { eq, ne, sql, and } from 'drizzle-orm';
import db from '../lib/db';
import { users, intents, intentStakes, intentIndexes } from '../lib/schema';

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
    "userId": "7c3ca3cf-048f-43e9-bf47-65f03a6333d8",  // seref
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
router.post("/filter", async (req, res: Response) => {
  try {

    
    // Extract filters from request body
    const {
      intentIds,
      userIds,
      indexIds,
      userId,
      page = 1,
      limit = 50
    } = req.body;

    const DEBUG_USER_ID = userId;


    const authenticatedUserIntents = db
  .select({ intentId: intents.id })
  .from(intents)
  .innerJoin(users, eq(intents.userId, users.id))
 // .innerJoin(intentIndexes, eq(intentIndexes.intentId, intents.id))
  .where(eq(intents.userId, DEBUG_USER_ID));

    // Extract the intent IDs for easier use in the main query
    const userIntentIds = await authenticatedUserIntents;
    const intentIdArray = userIntentIds.map(row => row.intentId);

  const mainQuery = db
  .select({
    // Get the user ID who has staked
    userId: intents.userId,
    // Sum up all stake amounts for this user
    totalStake: sql<number>`SUM(${intentStakes.stake})`,
    // Collect all reasoning strings into an array
    stakes: sql<any[]>`ARRAY_AGG(
      jsonb_build_object(
        'reasoning', ${intentStakes.reasoning},
        'stake', ${intentStakes.stake},
        'intent', jsonb_build_object(
          'id', intentId.id,
          'payload', ${intents.payload},
          'createdAt', ${intents.createdAt}
        )
      )
    ) FILTER (WHERE ${intents.userId} = ${DEBUG_USER_ID})`,
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
  .innerJoin(users, eq(users.id, intents.userId)) // intent → user
  
  .where(
    and(
      //Only stakes that contain authenticated user's intents
      //intentIdArray.length > 0 ? sql`${intentStakes.intents}::uuid[] && ARRAY[${sql.join(intentIdArray.map(id => sql`${id}`), sql`, `)}]::uuid[]` : sql`FALSE`,

      // External intent-ids filter (must be authenticated user's intents)
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

      // Check if all given intents exist in the same index
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
  // Exclude the debug user from results
  .having(eq(intents.userId, DEBUG_USER_ID))
  // Add pagination
  .limit(limit)
  .offset((page - 1) * limit);

    console.log("mainQuery SQL:", mainQuery.toSQL());
    const results = await mainQuery;

    return res.json({
      debugUserId: DEBUG_USER_ID,
      results,
      pagination: {
        page: page,
        limit: limit,
        hasNext: results.length === limit,
        hasPrev: page > 1
      },
      filters: {
        intentIds: intentIds || null,
        userIds: userIds || null,
        indexIds: indexIds || null
      }
    });
  } catch (err) {
    console.error("[DEBUG] Error:", err);
    if (err && typeof err === 'object' && 'position' in err) {
      const pgErr = err as { position?: string; query?: string };
      const query = (pgErr.query || '');
      const position = parseInt(pgErr.position || '0', 10);
      const B = 20; // before
      const A = 20; // after
      const errorPos = Math.max(0, position - B);
      const errorEnd = Math.min(query.length, position + A);
      const line = query.substring(errorPos, errorEnd);
      const pointer = " ".repeat(position-errorPos-1) + "^";
      console.error(`Error near position ${position}:\n...${line}...\n...${pointer}...`);
    }
    return res.status(500).json({ error: "Failed to fetch paired stakes" });
  }
});

export default router;
