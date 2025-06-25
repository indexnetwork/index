import { Router, Response } from 'express';
import { param, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents, users, intentStakes, agents } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, sql } from 'drizzle-orm';

const router = Router();

// Get stakes for a specific intent grouped by user
router.get('/intent/:id/by-user',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      // Check if intent exists and user has access
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(eq(intents.id, id))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      if (intent[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get stakes with user info in a single query, excluding the intent owner
      const stakes = await db.select({
        stake: intentStakes.stake,
        reasoning: intentStakes.reasoning,
        stakeIntents: intentStakes.intents,
        agentName: agents.name,
        agentAvatar: agents.avatar,
        userId: users.id,
        userName: users.name,
        userAvatar: users.avatar
      })
      .from(intentStakes)
      .innerJoin(agents, eq(intentStakes.agentId, agents.id))
      .innerJoin(intents, sql`${intents.id}::text = ANY(${intentStakes.intents})`)
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(
        sql`${intentStakes.intents} @> ARRAY[${id}]::text[]`,
        isNull(agents.deletedAt),
        sql`${users.id} != ${req.user!.id}`
      ));

      // Group by user
      const userStakes = stakes.reduce((acc, stake) => {
        const userName = stake.userName;
        if (!acc[userName]) {
          acc[userName] = {
            user: {
              id: stake.userId,
              name: stake.userName,
              avatar: stake.userAvatar
            },
            totalStake: BigInt(0),
            aggregatedSummary: new Set(),
            agents: {}
          };
        }
        acc[userName].totalStake += stake.stake;
        if (stake.reasoning) {
          acc[userName].aggregatedSummary.add(stake.reasoning);
        }

        const agentName = stake.agentName;
        if (!acc[userName].agents[agentName]) {
          acc[userName].agents[agentName] = {
            agent: {
              name: stake.agentName,
              avatar: stake.agentAvatar
            },
            stake: BigInt(0)
          };
        }
        acc[userName].agents[agentName].stake += stake.stake;

        return acc;
      }, {} as Record<string, any>);

      // Format results
      const result = Object.values(userStakes)
        .map(user => ({
          user: user.user,
          totalStake: user.totalStake.toString(),
          aggregatedSummary: Array.from(user.aggregatedSummary).join(' '),
          agents: Object.values(user.agents).map((agent: any) => ({
            agent: agent.agent,
            stake: agent.stake.toString()
          }))
        }))
        .sort((a, b) => Number(BigInt(b.totalStake) - BigInt(a.totalStake)));

      return res.json(result);
    } catch (error) {
      console.error('Get intent stakes error:', error);
      return res.status(500).json({ error: 'Failed to fetch intent stakes' });
    }
  }
);

// Get all stakes related to user's intents
router.get('/by-user',
  authenticatePrivy,
  async (req: AuthRequest, res: Response) => {
    try {
      // First get all intents of the user
      const userIntents = await db.select({
        id: intents.id,
        summary: intents.summary,
        payload: intents.payload,
        updatedAt: intents.updatedAt
      })
      .from(intents)
      .where(eq(intents.userId, req.user!.id));

      const userIntentIds = userIntents.map(intent => intent.id);

      if (userIntentIds.length === 0) {
        return res.json([]);
      }

      // Then get stakes of those intents
      const stakes = await db.select({
        stake: intentStakes.stake,
        reasoning: intentStakes.reasoning,
        stakeIntents: intentStakes.intents,
        agentName: agents.name,
        agentAvatar: agents.avatar,
        userId: users.id,
        userName: users.name,
        userAvatar: users.avatar
      })
      .from(intentStakes)
      .innerJoin(agents, eq(intentStakes.agentId, agents.id))
      .innerJoin(intents, sql`${intents.id}::text = ANY(${intentStakes.intents})`)
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(
        isNull(agents.deletedAt),
        sql`EXISTS(
          SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
          WHERE intent_id IN (${sql.join(userIntentIds.map(id => sql`${id}`), sql`, `)})
        )`,
        sql`${users.id} != ${req.user!.id}`
      ));

      // Group by intents array variation
      const stakesByIntentGroup: Record<string, any> = {};

      for (const stake of stakes) {
        // Create a key from the sorted intents array
        const sortedIntents = [...stake.stakeIntents].sort();
        const intentGroupKey = sortedIntents.join(',');
        
        if (!stakesByIntentGroup[intentGroupKey]) {
          stakesByIntentGroup[intentGroupKey] = {
            intentIds: sortedIntents,
            totalStake: BigInt(0),
            aggregatedSummary: new Set(),
            usersByIntent: {},
            agents: {}
          };
        }

        stakesByIntentGroup[intentGroupKey].totalStake += stake.stake;
        if (stake.reasoning) {
          stakesByIntentGroup[intentGroupKey].aggregatedSummary.add(stake.reasoning);
        }

        // Track users by intent
        const userName = stake.userName;
        if (!stakesByIntentGroup[intentGroupKey].usersByIntent[userName]) {
          stakesByIntentGroup[intentGroupKey].usersByIntent[userName] = {
            id: stake.userId,
            name: stake.userName,
            avatar: stake.userAvatar
          };
        }

        // Track agents
        const agentName = stake.agentName;
        if (!stakesByIntentGroup[intentGroupKey].agents[agentName]) {
          stakesByIntentGroup[intentGroupKey].agents[agentName] = {
            agent: {
              name: stake.agentName,
              avatar: stake.agentAvatar
            },
            stake: BigInt(0)
          };
        }
        stakesByIntentGroup[intentGroupKey].agents[agentName].stake += stake.stake;
      }

      // Convert to result format and order by sum stake desc
      const result = Object.values(stakesByIntentGroup)
        .sort((a: any, b: any) => Number(b.totalStake - a.totalStake))
        .map((group: any) => {
          // Find the user's intent(s) in this group
          const userIntentsInGroup = userIntents.filter(intent => 
            group.intentIds.includes(intent.id)
          );

          // For format compatibility, use the first staked user as the primary user
          const primaryUser = Object.values(group.usersByIntent)[0] as any;

          return {
            user: primaryUser,
            intents: userIntentsInGroup.map(userIntent => ({
              intent: userIntent,
              totalStake: group.totalStake.toString(),
              aggregatedSummary: Array.from(group.aggregatedSummary).join(' '),
              agents: Object.values(group.agents).map((agent: any) => ({
                agent: agent.agent,
                stake: agent.stake.toString()
              }))
            }))
          };
        })
        .filter(stake => stake.intents.length > 0);

      return res.json(result);
    } catch (error) {
      console.error('Get all stakes error:', error);
      return res.status(500).json({ error: 'Failed to fetch stakes' });
    }
  }
);

export default router; 