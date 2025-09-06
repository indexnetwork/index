import { Router, Response } from 'express';
import { eq, ne, sql, and, isNull, inArray } from 'drizzle-orm';
import db from '../lib/db';
import { users, intents, intentStakes, intentIndexes, indexes, indexMembers } from '../lib/schema';
import { getAccessibleIntents } from '../lib/intent-access';
import { getIndexWithPermissions, EVERYONE_USER_ID } from '../lib/index-access';

const router = Router();

// Constant userId for debugging

// 🚀 Route: Get paired users' staked intents
router.get("/paired-stakes", async (req, res: Response) => {
  try {

    const DEBUG_USER_ID = req.query.userId as string;

    
    // external user-id filter for vibecheck
    // external intent-id filter (must be authenticated user's intents)
    // external index-id filter (must be authenticated user's indexes)
    // future: search 
    // pagination

    const authenticatedUserIntents = db
  .select({ intentId: intents.id })
  .from(intents)
  .innerJoin(users, eq(intents.userId, users.id))
 // .innerJoin(intentIndexes, eq(intentIndexes.intentId, intents.id))
  .where(eq(intents.userId, DEBUG_USER_ID));

  

//  const externalUserIntents = await db
//  .select({ intentId: intents.id })
//  .from(intents)
//  .innerJoin(users, eq(intents.userId, users.id))
//  .innerJoin(intentIndexes, eq(intentIndexes.intentId, intents.id))
//  .where(ne(intents.userId, DEBUG_USER_ID));


   const externalUserIntents = false;
// --- Step 2: aggregate stakes per user (through intent.userId)
// Query to get aggregated stake data for users who have staked on authenticated user's intents
const results = await db
  .select({
    // Get the user ID who has staked
    userId: intents.userId,
    // Sum up all stake amounts for this user
    totalStake: sql<number>`SUM(${intentStakes.stake})`,
    // Collect all reasoning strings into an array
    reasonings: sql<string[]>`ARRAY_AGG(${intentStakes.reasoning})`,
    // Collect all individual stake amounts into an array
    stakeAmounts: sql<number[]>`ARRAY_AGG(${intentStakes.stake})`,
  })
  .from(intentStakes)
  // Explode the stake.intents array into individual rows for filtering
  // This allows us to match each intent ID separately
  .innerJoin(
    sql`UNNEST(${intentStakes.intents}) as intentId`,
    sql`TRUE`
  )
  // Join with intents table to get user info
  .innerJoin(intents, sql`intentId::uuid = ${intents.id}`)
  // Join with users table to get user details
  .innerJoin(users, eq(users.id, intents.userId)) // intent → user
  
  .where(
    and(
      //Only stakes that contain authenticated user's intents
      sql`${intentStakes.intents}::uuid[] && ARRAY(${authenticatedUserIntents})`,

      //...(externalUserIntents!! ? [sql`${intentStakes.intents}::uuid[] && ARRAY(${externalUserIntents})`] : []),

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
  .having(ne(intents.userId, DEBUG_USER_ID));
    


    return res.json(
        {
      debugUserId: DEBUG_USER_ID,
      pairedStakes: results,
    });
  } catch (err) {
    console.error("[DEBUG] Error:", err);
    return res.status(500).json({ error: "Failed to fetch paired stakes" });
  }
});

export default router;
