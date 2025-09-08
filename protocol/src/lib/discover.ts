import { eq, ne, sql, and, or } from 'drizzle-orm';
import db from './db';
import { users, intents, intentStakes, intentIndexes, userConnectionEvents } from './schema';

export interface DiscoverFilters {
  authenticatedUserId: string;
  intentIds?: string[];
  userIds?: string[];
  indexIds?: string[];
  excludeDiscovered?: boolean;
  page?: number;
  limit?: number;
}

export interface DiscoverResult {
  user: {
    id: string;
    name: string;
    email: string | null;
    avatar: string | null;
    intro: string | null;
  };
  totalStake: number;
  intents: Array<{
    intent: {
      id: string;
      payload: string;
      summary?: string | null;
      createdAt: Date;
    };
    totalStake: number;
    reasonings: string[];
  }>;
}

export async function discoverUsers(filters: DiscoverFilters): Promise<{
  results: DiscoverResult[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}> {
  const {
    authenticatedUserId,
    intentIds,
    userIds,
    indexIds,
    excludeDiscovered = true,
    page = 1,
    limit = 50
  } = filters;

  // Get authenticated user's intents, filtered by index if specified
  let authenticatedUserIntents;
  
  if (indexIds && indexIds.length > 0) {
    // If indexIds are specified, only get intents in those indexes
    authenticatedUserIntents = await db
      .select({ intentId: intents.id })
      .from(intents)
      .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
      .where(
        and(
          eq(intents.userId, authenticatedUserId),
          sql`${intentIndexes.indexId} = ANY(ARRAY[${sql.join(indexIds.map((id: string) => sql`${id}`), sql`, `)}]::uuid[])`
        )
      );
  } else {
    // Get all user's intents
    authenticatedUserIntents = await db
      .select({ intentId: intents.id })
      .from(intents)
      .where(eq(intents.userId, authenticatedUserId));
  }

  // Extract the intent IDs for easier use in the main query
  const userIntentIds = authenticatedUserIntents.map(row => row.intentId);

  // If user has no intents, return empty results
  if (userIntentIds.length === 0) {
    return {
      results: [],
      pagination: {
        page,
        limit,
        hasNext: false,
        hasPrev: false
      }
    };
  }

  // Main query to find users who have staked on authenticated user's intents
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

  // This query finds users who have stakes with the authenticated user's intents
  // It filters by:
  // - Optional intent IDs (must be authenticated user's intents)
  // - Optional index IDs (must be authenticated user's indexes) 
  // - Optional user IDs
  // - Can exclude users with existing connections
  // - Ensures intents in stakes exist in same index
  // - Groups by user to get totals
  // - Excludes authenticated user
  // - Includes pagination

  const results = await mainQuery;

  // Format the results to match the expected structure
  const formattedResults = await Promise.all(results.map(async (row) => {
    // Get user details
    const userDetails = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatar: users.avatar,
      intro: users.intro
    }).from(users)
      .where(eq(users.id, row.userId))
      .limit(1);

    const user = userDetails[0];

    // Process stakes to filter only those that involve authenticated user's intents
    const relevantStakes = row.stakes.filter((stake: any) => 
      userIntentIds.includes(stake.intentId)
    );

    // Get unique intents that are staked
    const intentMap = new Map<string, {
      intent: {
        id: string;
        payload: string;
        summary?: string | null;
        createdAt: Date;
      };
      totalStake: number;
      reasonings: string[];
    }>();
    
    relevantStakes.forEach((stake: any) => {
      if (!intentMap.has(stake.intent.id)) {
        intentMap.set(stake.intent.id, {
          intent: stake.intent,
          totalStake: 0,
          reasonings: []
        });
      }
      const intentData = intentMap.get(stake.intent.id)!;
      intentData.totalStake += parseInt(stake.stake);
      if (stake.reasoning) {
        intentData.reasonings.push(stake.reasoning);
      }
    });

    return {
      user,
      totalStake: Number(row.totalStake),
      intents: Array.from(intentMap.values()).map(intentData => ({
        intent: intentData.intent,
        totalStake: intentData.totalStake,
        reasonings: [...new Set(intentData.reasonings)]
      }))
    };
  }));

  return {
    results: formattedResults,
    pagination: {
      page,
      limit,
      hasNext: results.length === limit,
      hasPrev: page > 1
    }
  };
}
