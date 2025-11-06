import { eq, ne, sql, and, or } from 'drizzle-orm';
import db from './db';
import { users, intents, intentStakes, intentIndexes, userConnectionEvents, indexMembers } from './schema';
import { getUserAccessibleIndexIds } from './index-access';

export interface DiscoverFilters {
  authenticatedUserId: string;
  intentIds?: string[];
  userIds?: string[];
  indexIds?: string[];
  sources?: Array<{ type: 'file' | 'integration' | 'link' | 'discovery_form'; id: string }>;
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
    sources,
    excludeDiscovered = true,
    page = 1,
    limit = 50
  } = filters;

  // Get authenticated user's intents, filtered by intentIds, index and sources
  let authenticatedUserIntents;
  let targetIndexIds: string[] | undefined;
  
  // Build base conditions
  const baseConditions = [eq(intents.userId, authenticatedUserId)];
  
  // Add intentIds filtering if specified (post-filter - doesn't bypass index restrictions)
  if (intentIds && intentIds.length > 0) {
    baseConditions.push(
      sql`${intents.id} = ANY(ARRAY[${sql.join(intentIds.map((id: string) => sql`${id}`), sql`, `)}]::uuid[])`
    );
  }
  
  // Add source filtering if specified
  if (sources && sources.length > 0) {
    const sourceConditions = sources.map(source => 
      and(
        eq(intents.sourceType, source.type),
        eq(intents.sourceId, source.id)
      )
    );
    baseConditions.push(or(...sourceConditions)!);
  }
  
  // Determine which indexes to filter by
  targetIndexIds = indexIds;
  if (!targetIndexIds || targetIndexIds.length === 0) {
    // If no indexIds provided, default to user's accessible indexes
    targetIndexIds = await getUserAccessibleIndexIds(authenticatedUserId);
  }
  
  if (targetIndexIds && targetIndexIds.length > 0) {
    // Get intents in the specified indexes (or user's indexes if none specified)
    authenticatedUserIntents = await db
      .select({ intentId: intents.id })
      .from(intents)
      .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
      .where(
        and(
          ...baseConditions,
          sql`${intentIndexes.indexId} = ANY(ARRAY[${sql.join(targetIndexIds.map((id: string) => sql`${id}`), sql`, `)}]::uuid[])`
        )
      );
  } else {
    // Fallback: get all user's intents (if user has no accessible indexes)
    authenticatedUserIntents = await db
      .select({ intentId: intents.id })
      .from(intents)
      .where(and(...baseConditions));
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
      // Get the stake ID
      stakeId: intentStakes.id,
      stake: intentStakes.stake,
      reasoning: intentStakes.reasoning,
      // Collect all intent information from this stake
      intents: sql<any[]>`ARRAY_AGG(
        jsonb_build_object(
          'intentId', intentId.id,
          'userId', ${intents.userId},
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
    // Join with intents table to get intent details
    .innerJoin(intents, sql`intentId.id = ${intents.id}`)
    // Join with users table to get user details (will use later)
    .innerJoin(users, eq(users.id, intents.userId))
    
    .where(
      and(
        // Exclude single-intent confidence stakes
        sql`array_length(${intentStakes.intents}, 1) > 1`,
        
        // Only stakes that contain authenticated user's intents
        userIntentIds.length > 0 ? sql`${intentStakes.intents}::uuid[] && ARRAY[${sql.join(userIntentIds.map(id => sql`${id}`), sql`, `)}]::uuid[]` : sql`FALSE`,

        // Check if all intents in the stake exist in the same index (skip if using explicit intentIds)
        ...(targetIndexIds !== undefined ? [
          sql`EXISTS (
            SELECT 1
            FROM ${intentIndexes} ii1
            WHERE ii1.intent_id = ANY(${intentStakes.intents}::uuid[])
            ${targetIndexIds && targetIndexIds.length > 0
              ? sql`AND ii1.index_id = ANY(ARRAY[${sql.join(targetIndexIds.map((id: string) => sql`${id}`), sql`, `)}]::uuid[])`
              : sql``}
            GROUP BY ii1.index_id
            HAVING COUNT(*) = array_length(${intentStakes.intents}, 1)
          )`
        ] : []),

        // Ensure stake contains intents from users other than authenticated user
        sql`EXISTS (
          SELECT 1
          FROM UNNEST(${intentStakes.intents}::uuid[]) as check_intent_id
          JOIN ${intents} check_intent ON check_intent.id = check_intent_id
          WHERE check_intent.user_id != ${authenticatedUserId}
        )`
      )
    )
    // Group by stake to get all intents for each stake
    .groupBy(intentStakes.id, intentStakes.stake, intentStakes.reasoning)
    // Add pagination
    .limit(limit)
    .offset((page - 1) * limit);

  // This query finds stakes with the authenticated user's intents
  // Then we process them to find discovered users
  // It filters by:
  // - Stakes that contain authenticated user's intents
  // - Stakes that contain intents from other users (discovered users)
  // - Index coherence (all intents in stake exist in same index)
  // - Groups by stake to get all intents per stake
  // - Includes pagination

  const results = await mainQuery;

  // Process stakes to find discovered users
  // Map: userId -> user data with aggregated intents and stakes
  const userMap = new Map<string, {
    user: { id: string; name: string; email: string | null; avatar: string | null; intro: string | null };
    totalStake: number;
    intentMap: Map<string, {
      intent: { id: string; payload: string; summary?: string | null; createdAt: Date };
      totalStake: number;
      reasonings: string[];
    }>;
  }>();

  for (const stakeRow of results) {
    // Filter to get authenticated user's intents from this stake
    const authUserIntents = stakeRow.intents.filter((intentData: any) => 
      userIntentIds.includes(intentData.intentId) && intentData.userId === authenticatedUserId
    );

    // Find discovered users (users other than authenticated user who have intents in this stake)
    const discoveredUserIds = new Set(
      stakeRow.intents
        .filter((intentData: any) => intentData.userId !== authenticatedUserId)
        .map((intentData: any) => intentData.userId)
    );

    // For each discovered user, add the authenticated user's matched intents
    for (const discoveredUserId of discoveredUserIds) {
      // Apply user ID filter if specified
      if (userIds && userIds.length > 0 && !userIds.includes(discoveredUserId)) {
        continue;
      }

      // Check if this discovered user should be excluded (existing connection)
      if (excludeDiscovered) {
        const hasConnection = await db
          .select({ id: userConnectionEvents.id })
          .from(userConnectionEvents)
          .where(
            or(
              and(
                eq(userConnectionEvents.initiatorUserId, authenticatedUserId),
                eq(userConnectionEvents.receiverUserId, discoveredUserId)
              ),
              and(
                eq(userConnectionEvents.initiatorUserId, discoveredUserId),
                eq(userConnectionEvents.receiverUserId, authenticatedUserId)
              )
            )
          )
          .limit(1);

        if (hasConnection.length > 0) {
          continue;
        }
      }

      // Check if user is member of target indexes
      if (targetIndexIds && targetIndexIds.length > 0) {
        const isMember = await db
          .select({ indexId: indexMembers.indexId })
          .from(indexMembers)
          .where(
            and(
              eq(indexMembers.userId, discoveredUserId),
              sql`${indexMembers.indexId} = ANY(ARRAY[${sql.join(targetIndexIds.map((id: string) => sql`${id}`), sql`, `)}]::uuid[])`
            )
          )
          .limit(1);

        if (isMember.length === 0) {
          continue;
        }
      }

      // Get or create user entry in map
      if (!userMap.has(discoveredUserId)) {
        // Fetch user details
        const userDetails = await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            avatar: users.avatar,
            intro: users.intro
          })
          .from(users)
          .where(eq(users.id, discoveredUserId))
          .limit(1);

        if (userDetails.length === 0) continue;

        userMap.set(discoveredUserId, {
          user: userDetails[0],
          totalStake: 0,
          intentMap: new Map()
        });
      }

      const userData = userMap.get(discoveredUserId)!;
      userData.totalStake += Number(stakeRow.stake);

      // Add authenticated user's intents from this stake
      for (const authIntent of authUserIntents) {
        if (!userData.intentMap.has(authIntent.intent.id)) {
          userData.intentMap.set(authIntent.intent.id, {
            intent: authIntent.intent,
            totalStake: 0,
            reasonings: []
          });
        }

        const intentData = userData.intentMap.get(authIntent.intent.id)!;
        intentData.totalStake += Number(stakeRow.stake);
        if (stakeRow.reasoning && !intentData.reasonings.includes(stakeRow.reasoning)) {
          intentData.reasonings.push(stakeRow.reasoning);
        }
      }
    }
  }

  // Convert map to array and sort by total stake descending
  const formattedResults = Array.from(userMap.values()).map(userData => ({
    user: userData.user,
    totalStake: userData.totalStake,
    intents: Array.from(userData.intentMap.values()).map(intentData => ({
      intent: intentData.intent,
      totalStake: intentData.totalStake,
      reasonings: intentData.reasonings
    }))
  })).sort((a, b) => b.totalStake - a.totalStake);

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
