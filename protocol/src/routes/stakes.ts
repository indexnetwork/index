import { Router, Response } from 'express';
import { param, query, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents, users, intentStakes, agents, userConnectionEvents, indexes, intentIndexes } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, sql, or, notInArray } from 'drizzle-orm';
import { checkIndexAccessByCode } from '../lib/index-access';
import { generateUserSynthesis, type SynthesisUserContext } from '../lib/synthesis';

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
            agents: {}
          };
        }
        acc[userName].totalStake += stake.stake;

        const agentName = stake.agentName;
        if (!acc[userName].agents[agentName]) {
          acc[userName].agents[agentName] = {
            agent: {
              name: stake.agentName,
              avatar: stake.agentAvatar
            },
            stake: BigInt(0),
            reasoning: new Set()
          };
        }
        acc[userName].agents[agentName].stake += stake.stake;
        if (stake.reasoning) {
          acc[userName].agents[agentName].reasoning.add(stake.reasoning);
        }

        return acc;
      }, {} as Record<string, any>);

      // Get the intent data for synthesis
      const intentData = await db.select({
        summary: intents.summary,
        payload: intents.payload
      })
      .from(intents)
      .where(eq(intents.id, id))
      .limit(1);

      // Format results with synthesis summaries
      const result = (await Promise.all(Object.values(userStakes)
        .map(async user => {
          const userResult = {
            user: user.user,
            totalStake: user.totalStake.toString(),
            agents: Object.values(user.agents).map((agent: any) => ({
              agent: agent.agent,
              stake: agent.stake.toString(),
              reasoning: Array.from(agent.reasoning).join(' ')
            })),
            synthesis: ""
          };

          // Generate synthesis summary for this user (intent detail context)
          const synthesisContext: SynthesisUserContext = {
            user: user.user,
            intents: [{
              intent: { 
                id: id, 
                summary: intentData[0]?.summary || "", 
                payload: intentData[0]?.payload || "" 
              },
              agents: Object.values(user.agents)
            }]
          };
          userResult.synthesis = await generateUserSynthesis(
            synthesisContext,
            `${user.user.name} brings valuable expertise that could complement your work on this goal.`
          );

          return userResult;
        })
      )).sort((a, b) => Number(BigInt(b.totalStake) - BigInt(a.totalStake)));

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
  [
    query('includeDiscovered').optional().isBoolean()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const includeDiscovered = req.query.includeDiscovered === 'true';
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

      // Get users with existing connections (discovered users) if filtering is enabled
      let discoveredUserIds: string[] = [];
      if (!includeDiscovered) {
        const connectionEvents = await db.select({
          initiatorUserId: userConnectionEvents.initiatorUserId,
          receiverUserId: userConnectionEvents.receiverUserId,
        })
        .from(userConnectionEvents)
        .where(
          or(
            eq(userConnectionEvents.initiatorUserId, req.user!.id),
            eq(userConnectionEvents.receiverUserId, req.user!.id)
          )
        );

        discoveredUserIds = connectionEvents.map(event => 
          event.initiatorUserId === req.user!.id ? event.receiverUserId : event.initiatorUserId
        );
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
        sql`${users.id} != ${req.user!.id}`,
        ...(discoveredUserIds.length > 0 ? [notInArray(users.id, discoveredUserIds)] : [])
      ));

      // Group by user first
      const stakesByUser: Record<string, any> = {};

      for (const stake of stakes) {
        const userId = stake.userId;
        
        if (!stakesByUser[userId]) {
          stakesByUser[userId] = {
            user: {
              id: stake.userId,
              name: stake.userName,
              avatar: stake.userAvatar
            },
            totalStake: BigInt(0),
            intentGroups: {},
            allAgents: {}
          };
        }

        // Group intents within this user
        const sortedIntents = [...stake.stakeIntents].filter(intentId => 
          userIntentIds.includes(intentId)
        ).sort();
        const intentGroupKey = sortedIntents.join(',');
        
        if (!stakesByUser[userId].intentGroups[intentGroupKey]) {
          stakesByUser[userId].intentGroups[intentGroupKey] = {
            intentIds: sortedIntents,
            totalStake: BigInt(0),
            agents: {}
          };
        }

        stakesByUser[userId].totalStake += stake.stake;
        stakesByUser[userId].intentGroups[intentGroupKey].totalStake += stake.stake;

        // Track agents for this intent group
        const agentName = stake.agentName;
        if (!stakesByUser[userId].intentGroups[intentGroupKey].agents[agentName]) {
          stakesByUser[userId].intentGroups[intentGroupKey].agents[agentName] = {
            agent: {
              name: stake.agentName,
              avatar: stake.agentAvatar
            },
            stake: BigInt(0),
            reasoning: new Set()
          };
        }
        stakesByUser[userId].intentGroups[intentGroupKey].agents[agentName].stake += stake.stake;
        if (stake.reasoning) {
          stakesByUser[userId].intentGroups[intentGroupKey].agents[agentName].reasoning.add(stake.reasoning);
        }

        // Also track all agents for this user
        if (!stakesByUser[userId].allAgents[agentName]) {
          stakesByUser[userId].allAgents[agentName] = {
            agent: {
              name: stake.agentName,
              avatar: stake.agentAvatar
            },
            stake: BigInt(0)
          };
        }
        stakesByUser[userId].allAgents[agentName].stake += stake.stake;
      }

      // Convert to result format and order by total stake desc
      const result = await Promise.all(Object.values(stakesByUser)
        .sort((a: any, b: any) => Number(b.totalStake - a.totalStake))
        .map(async (userStakes: any) => {
          const intents = Object.values(userStakes.intentGroups).map((group: any) => {
            // Find the user's intent(s) in this group
            const userIntentsInGroup = userIntents.filter(intent => 
              group.intentIds.includes(intent.id)
            );

            // For each intent in the group, create an intent entry
            return userIntentsInGroup.map(userIntent => ({
              intent: userIntent,
              totalStake: group.totalStake.toString(),
              agents: Object.values(group.agents).map((agent: any) => ({
                agent: agent.agent,
                stake: agent.stake.toString(),
                reasoning: Array.from(agent.reasoning).join(' ')
              }))
            }));
          }).flat().sort((a, b) => Number(BigInt(b.totalStake) - BigInt(a.totalStake)));

          // Generate synthesis summary for this user
          const synthesisContext: SynthesisUserContext = {
            user: userStakes.user,
            intents: intents
          };
          const synthesis = await generateUserSynthesis(
            synthesisContext,
            `${userStakes.user.name} brings valuable expertise that could complement your work across multiple areas.`
          );

          return {
            user: userStakes.user,
            intents: intents,
            synthesis: synthesis
          };
        }));

      const filteredResult = result.filter(stake => stake.intents.length > 0);

      return res.json(filteredResult);
    } catch (error) {
      console.error('Get all stakes error:', error);
      return res.status(500).json({ error: 'Failed to fetch stakes' });
    }
  }
);

// Get stakes for users within a specific shared index, grouped by user
router.get('/index/:code/by-user',
  authenticatePrivy,
  [
    param('code').isUUID(),
    query('includeDiscovered').optional().isBoolean()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { code } = req.params;
      const includeDiscovered = req.query.includeDiscovered === 'true';

      // Check access to the shared index
      const accessCheck = await checkIndexAccessByCode(code);
      if (!accessCheck.hasAccess) {
        return res.status(accessCheck.status!).json({ error: accessCheck.error });
      }

      const sharedIndexData = accessCheck.indexData!;

      // Check if the shared index has can-match permission
      if (!accessCheck.memberPermissions?.includes('can-match')) {
        return res.status(403).json({ error: 'Shared index does not allow matching' });
      }

      // Get intents from the shared index
      const sharedIndexIntents = await db.select({
        intentId: intentIndexes.intentId
      })
      .from(intentIndexes)
      .where(eq(intentIndexes.indexId, sharedIndexData.id));

      const sharedIntentIds = sharedIndexIntents.map(item => item.intentId);

      if (sharedIntentIds.length === 0) {
        return res.json([]);
      }

      // Get users with existing connections (discovered users) if filtering is enabled
      let discoveredUserIds: string[] = [];
      if (!includeDiscovered) {
        const connectionEvents = await db.select({
          initiatorUserId: userConnectionEvents.initiatorUserId,
          receiverUserId: userConnectionEvents.receiverUserId,
        })
        .from(userConnectionEvents)
        .where(
          or(
            eq(userConnectionEvents.initiatorUserId, req.user!.id),
            eq(userConnectionEvents.receiverUserId, req.user!.id)
          )
        );

        discoveredUserIds = connectionEvents.map(event => 
          event.initiatorUserId === req.user!.id ? event.receiverUserId : event.initiatorUserId
        );
      }

      // Get stakes for shared index intents, excluding authenticated user and discovered users
      const stakes = await db.select({
        stake: intentStakes.stake,
        reasoning: intentStakes.reasoning,
        stakeIntents: intentStakes.intents,
        agentName: agents.name,
        agentAvatar: agents.avatar,
        userId: users.id,
        userName: users.name,
        userAvatar: users.avatar,
        intentId: intents.id,
        intentSummary: intents.summary,
        intentPayload: intents.payload,
        intentUpdatedAt: intents.updatedAt
      })
      .from(intentStakes)
      .innerJoin(agents, eq(intentStakes.agentId, agents.id))
      .innerJoin(intents, sql`${intents.id}::text = ANY(${intentStakes.intents})`)
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(
        isNull(agents.deletedAt),
        sql`EXISTS(
          SELECT 1 FROM unnest(${intentStakes.intents}) AS intent_id
          WHERE intent_id IN (${sql.join(sharedIntentIds.map(id => sql`${id}`), sql`, `)})
        )`,
        sql`${users.id} != ${req.user!.id}`,
        sql`${users.id} != ${sharedIndexData.userId}`,
        ...(discoveredUserIds.length > 0 ? [notInArray(users.id, discoveredUserIds)] : [])
      ));

      // Group by user first, then by intent group
      const stakesByUser: Record<string, any> = {};

      for (const stake of stakes) {
        // Filter to only include intents that are in the shared index
        const filteredIntents = stake.stakeIntents.filter(intentId => 
          sharedIntentIds.includes(intentId)
        );
        
        if (filteredIntents.length === 0) continue;

        const userId = stake.userId;
        
        if (!stakesByUser[userId]) {
          stakesByUser[userId] = {
            user: {
              id: stake.userId,
              name: stake.userName,
              avatar: stake.userAvatar
            },
            totalStake: BigInt(0),
            intentGroups: {},
            allIntents: new Map()
          };
        }

        const sortedIntents = [...filteredIntents].sort();
        const intentGroupKey = sortedIntents.join(',');
        
        if (!stakesByUser[userId].intentGroups[intentGroupKey]) {
          stakesByUser[userId].intentGroups[intentGroupKey] = {
            intentIds: sortedIntents,
            totalStake: BigInt(0),
            agents: {}
          };
        }

        stakesByUser[userId].totalStake += stake.stake;
        stakesByUser[userId].intentGroups[intentGroupKey].totalStake += stake.stake;

        // Track agents for this intent group
        const agentName = stake.agentName;
        if (!stakesByUser[userId].intentGroups[intentGroupKey].agents[agentName]) {
          stakesByUser[userId].intentGroups[intentGroupKey].agents[agentName] = {
            agent: {
              name: stake.agentName,
              avatar: stake.agentAvatar
            },
            stake: BigInt(0),
            reasoning: new Set()
          };
        }
        stakesByUser[userId].intentGroups[intentGroupKey].agents[agentName].stake += stake.stake;
        if (stake.reasoning) {
          stakesByUser[userId].intentGroups[intentGroupKey].agents[agentName].reasoning.add(stake.reasoning);
        }

        // Store intent details
        if (sharedIntentIds.includes(stake.intentId)) {
          stakesByUser[userId].allIntents.set(stake.intentId, {
            id: stake.intentId,
            summary: stake.intentSummary,
            payload: stake.intentPayload,
            updatedAt: stake.intentUpdatedAt
          });
        }
      }

      // Format results grouped by user
      const result = (await Promise.all(Object.values(stakesByUser)
        .sort((a: any, b: any) => Number(b.totalStake - a.totalStake))
        .map(async (userStakes: any) => {
          const intents = Object.values(userStakes.intentGroups).map((group: any) => {
            const intentsInGroup = Array.from(userStakes.allIntents.values()).filter((intent: any) =>
              group.intentIds.includes(intent.id)
            );

            return intentsInGroup.map((intent: any) => ({
              intent: intent,
              totalStake: group.totalStake.toString(),
              agents: Object.values(group.agents).map((agent: any) => ({
                agent: agent.agent,
                stake: agent.stake.toString(),
                reasoning: Array.from(agent.reasoning).join(' ')
              }))
            }));
          }).flat().sort((a, b) => Number(BigInt(b.totalStake) - BigInt(a.totalStake)));

          // Generate synthesis summary for this user
          const synthesisContext: SynthesisUserContext = {
            user: userStakes.user,
            intents: intents
          };
          const synthesis = await generateUserSynthesis(
            synthesisContext,
            `${userStakes.user.name} brings valuable expertise that could complement your work in this shared context.`
          );

          return {
            user: userStakes.user,
            intents: intents,
            synthesis: synthesis
          };
        })
      )).filter(stake => stake.intents.length > 0);

      return res.json(result);
    } catch (error) {
      console.error('Get index stakes by user error:', error);
      return res.status(500).json({ error: 'Failed to fetch index stakes by user' });
    }
  }
);



export default router;