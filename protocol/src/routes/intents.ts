import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents, users, indexes, intentIndexes, intentStakes, agents } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, isNotNull, and, count, desc, or, ilike, sql } from 'drizzle-orm';
import { summarizeIntent } from '../agents/core/intent_summarizer';
import { 
  triggerBrokersOnIntentCreated, 
  triggerBrokersOnIntentUpdated, 
  triggerBrokersOnIntentArchived 
} from '../agents/context_brokers/connector';
import { BaseContextBroker } from '../agents/context_brokers/base';

const router = Router();

// Get all intents with pagination
router.get('/', 
  authenticatePrivy,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('archived').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      const showArchived = req.query.archived === 'true';

      const whereCondition = and(
        showArchived ? isNotNull(intents.archivedAt) : isNull(intents.archivedAt),
        eq(intents.userId, req.user!.id)
      );

      const [intentsResult, totalResult] = await Promise.all([
        db.select({
          id: intents.id,
          payload: intents.payload,
          summary: intents.summary,
          isPublic: intents.isPublic,
          createdAt: intents.createdAt,
          updatedAt: intents.updatedAt,
          archivedAt: intents.archivedAt,
          userId: intents.userId,
          userName: users.name,
          userEmail: users.email,
          userAvatar: users.avatar
        }).from(intents)
          .innerJoin(users, eq(intents.userId, users.id))
          .where(whereCondition)
          .orderBy(desc(intents.createdAt))
          .offset(skip)
          .limit(limit),

        db.select({ count: count() })
          .from(intents)
          .innerJoin(users, eq(intents.userId, users.id))
          .where(whereCondition)
      ]);

      // Get index counts and ensure summaries for each intent
      const intentsWithCounts = await Promise.all(
        intentsResult.map(async (intent) => {
          // Get count of indexes for this intent
          const indexCount = await db.select({ count: count() })
            .from(intentIndexes)
            .where(eq(intentIndexes.intentId, intent.id));

          return {
            id: intent.id,
            payload: intent.payload,
            summary: intent.summary,
            isPublic: intent.isPublic,
            createdAt: intent.createdAt,
            updatedAt: intent.updatedAt,
            archivedAt: intent.archivedAt,
            user: {
              id: intent.userId,
              name: intent.userName,
              email: intent.userEmail,
              avatar: intent.userAvatar
            },
            _count: {
              indexes: indexCount[0]?.count || 0
            }
          };
        })
      );

      return res.json({
        intents: intentsWithCounts,
        pagination: {
          current: page,
          total: Math.ceil(totalResult[0].count / limit),
          count: intentsResult.length,
          totalCount: totalResult[0].count
        }
      });
    } catch (error) {
      console.error('Get intents error:', error);
      return res.status(500).json({ error: 'Failed to fetch intents' });
    }
  }
);

// Get single intent by ID
router.get('/:id',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      const intent = await db.select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        isPublic: intents.isPublic,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        archivedAt: intents.archivedAt,
        userId: intents.userId,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatar
      }).from(intents)
        .innerJoin(users, eq(intents.userId, users.id))
        .where(eq(intents.id, id))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      // Check access permissions
      const intentData = intent[0];
      const hasAccess = intentData.userId === req.user!.id;

      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }



      const result = {
        id: intentData.id,
        payload: intentData.payload,
        summary: intentData.summary,
        isPublic: intentData.isPublic,
        createdAt: intentData.createdAt,
        updatedAt: intentData.updatedAt,
        archivedAt: intentData.archivedAt,
        user: {
          id: intentData.userId,
          name: intentData.userName,
          email: intentData.userEmail,
          avatar: intentData.userAvatar
        },
        _count: {
          indexes: 0 // TODO: Add actual count query
        }
      };

      return res.json({ intent: result });
    } catch (error) {
      console.error('Get intent error:', error);
      return res.status(500).json({ error: 'Failed to fetch intent' });
    }
  }
);

// Create new intent
router.post('/',
  authenticatePrivy,
  [
    body('payload').trim().isLength({ min: 1 }),
    body('isPublic').optional().isBoolean(),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { payload, isPublic = false, indexIds = [] } = req.body;

      // Verify index IDs exist and user has access to them
      if (indexIds.length > 0) {
        const validIndexes = await db.select({ id: indexes.id })
          .from(indexes)
          .where(and(
            isNull(indexes.deletedAt),
            eq(indexes.userId, req.user!.id)
          ));

        const validIndexIds = validIndexes.map(idx => idx.id);
        const invalidIds = indexIds.filter((id: string) => !validIndexIds.includes(id));

        if (invalidIds.length > 0) {
          return res.status(400).json({ 
            error: 'Some index IDs are invalid or you don\'t have access to them',
            invalidIds 
          });
        }
      }

      const summary = await summarizeIntent(payload);
      
      const newIntent = await db.insert(intents).values({
        payload,
        summary,
        isPublic,
        userId: req.user!.id,
      }).returning({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        isPublic: intents.isPublic,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        userId: intents.userId
      });

      // Associate with indexes if provided
      if (indexIds.length > 0) {
        await db.insert(intentIndexes).values(
          indexIds.map((indexId: string) => ({
            intentId: newIntent[0].id,
            indexId: indexId
          }))
        );
      }

      // Trigger context brokers for new intent
      triggerBrokersOnIntentCreated(newIntent[0].id);

      return res.status(201).json({
        message: 'Intent created successfully',
        intent: newIntent[0]
      });
    } catch (error) {
      console.error('Create intent error:', error);
      return res.status(500).json({ error: 'Failed to create intent' });
    }
  }
);

// Update intent
router.put('/:id',
  authenticatePrivy,
  [
    param('id').isUUID(),
    body('payload').optional().trim().isLength({ min: 1 }),
    body('isPublic').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { payload, isPublic } = req.body;

      // Check if intent exists and user owns it
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(and(eq(intents.id, id), isNull(intents.archivedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      if (intent[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const updateData: any = { updatedAt: new Date() };
      if (payload !== undefined) {
        updateData.payload = payload;
        const newSummary = await summarizeIntent(payload);
        if (newSummary) {
          updateData.summary = newSummary;
        }
      }
      if (isPublic !== undefined) updateData.isPublic = isPublic;

      const updatedIntent = await db.update(intents)
        .set(updateData)
        .where(eq(intents.id, id))
        .returning({
          id: intents.id,
          payload: intents.payload,
          summary: intents.summary,
          isPublic: intents.isPublic,
          createdAt: intents.createdAt,
          updatedAt: intents.updatedAt,
          userId: intents.userId
        });

      // Trigger context brokers for updated intent
      triggerBrokersOnIntentUpdated(updatedIntent[0].id);

      return res.json({
        message: 'Intent updated successfully',
        intent: updatedIntent[0]
      });
    } catch (error) {
      console.error('Update intent error:', error);
      return res.status(500).json({ error: 'Failed to update intent' });
    }
  }
);

// Archive intent
router.patch('/:id/archive',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      // Check if intent exists and user owns it
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(and(eq(intents.id, id), isNull(intents.archivedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Intent not found' });
      }

      if (intent[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await db.update(intents)
        .set({ 
          archivedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(intents.id, id));

      // Trigger context brokers for archived intent
      triggerBrokersOnIntentArchived(id);

      return res.json({ message: 'Intent archived successfully' });
    } catch (error) {
      console.error('Archive intent error:', error);
      return res.status(500).json({ error: 'Failed to archive intent' });
    }
  }
);

// Unarchive intent
router.patch('/:id/unarchive',
  authenticatePrivy,
  [param('id').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;

      // Check if intent exists and user owns it
      const intent = await db.select({ id: intents.id, userId: intents.userId })
        .from(intents)
        .where(and(eq(intents.id, id), isNotNull(intents.archivedAt)))
        .limit(1);

      if (intent.length === 0) {
        return res.status(404).json({ error: 'Archived intent not found' });
      }

      if (intent[0].userId !== req.user!.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await db.update(intents)
        .set({ 
          archivedAt: null,
          updatedAt: new Date()
        })
        .where(eq(intents.id, id));

      return res.json({ message: 'Intent unarchived successfully' });
    } catch (error) {
      console.error('Unarchive intent error:', error);
      return res.status(500).json({ error: 'Failed to unarchive intent' });
    }
  }
);

// Create a debug broker class
class DebugBroker extends BaseContextBroker {
  async onIntentCreated() {}
  async onIntentUpdated() {}
  async onIntentArchived() {}

  async createDebugStake(params: {
    pair: string;
    stake: bigint;
    reasoning: string;
  }): Promise<void> {
    await this.stakeManager.createStake({
      ...params,
      agentId: this.agentId
    });
  }
}

// Debug endpoint to create stake between two intents
router.get('/:id/debug/stake',
  [
    param('id').isUUID(),
    query('otherIntentId').isUUID(),
    query('stake').isInt({ min: 0, max: 100 }).toInt(),
    query('reasoning').optional().isString(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const otherIntentId = req.query.otherIntentId as string;
      const stake = parseInt(req.query.stake as string, 10);
      const reasoning = (req.query.reasoning as string) || 'Debug stake';

      // Verify both intents exist
      const [intent1, intent2] = await Promise.all([
        db.select().from(intents).where(eq(intents.id, id)).limit(1),
        db.select().from(intents).where(eq(intents.id, otherIntentId)).limit(1)
      ]);

      if (!intent1.length || !intent2.length) {
        return res.status(404).json({ error: 'One or both intents not found' });
      }

      // Create ordered pair for the stake
      const pair = [id, otherIntentId].sort().join('-');

      // Create the stake using the debug broker
      const broker = new DebugBroker('028ef80e-9b1c-434b-9296-bb6130509482');
      await broker.createDebugStake({
        pair,
        stake: BigInt(stake),
        reasoning
      });

      return res.json({ 
        message: 'Stake created successfully',
        pair,
        stake,
        reasoning
      });
    } catch (error) {
      console.error('Create debug stake error:', error);
      return res.status(500).json({ error: 'Failed to create stake' });
    }
  }
);

// Get stakes grouped by user
router.get('/:id/stakes/by-user',
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

      // Get stakes with user and agent info
      const stakes = await db.select({
        stake: intentStakes.stake,
        reasoning: intentStakes.reasoning,
        userName: users.name,
        userAvatar: users.avatar,
        agentName: agents.name,
        agentAvatar: agents.avatar
      })
      .from(intentStakes)
      .innerJoin(agents, eq(intentStakes.agentId, agents.id))
      .innerJoin(intents, sql`${intentStakes.pair} LIKE ${'%' + id + '%'}`)
      .innerJoin(users, eq(intents.userId, users.id))
      .where(isNull(agents.deletedAt));

      // Group by user
      const userStakes = stakes.reduce((acc, stake) => {
        const userName = stake.userName;
        if (!acc[userName]) {
          acc[userName] = {
            user: {
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

export default router; 