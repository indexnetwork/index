import { Router, Response, Request } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { intents, users, indexes, intentIndexes, intentStakes, agents, files, indexLinks, userIntegrations } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, isNotNull, and, count, desc, or, ilike, sql, inArray } from 'drizzle-orm';
import { summarizeIntent } from '../agents/core/intent_summarizer';
import { 
  triggerBrokersOnIntentCreated, 
  triggerBrokersOnIntentUpdated, 
  triggerBrokersOnIntentArchived 
} from '../agents/context_brokers/connector';
import { checkMultipleIndexesIntentWriteAccess } from '../lib/index-access';
import { validateAndGetAccessibleIndexIds } from '../lib/index-access';

const router = Router();

// Get all intents with pagination
router.post('/list', 
  authenticatePrivy,
  [
    body('page').optional().isInt({ min: 1 }).toInt(),
    body('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    body('archived').optional().isBoolean(),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { page = 1, limit = 10, archived, indexIds } = req.body;
      const skip = (page - 1) * limit;
      const showArchived = archived === true;

      // Use generic validation function
      const { validIndexIds, error } = await validateAndGetAccessibleIndexIds(req.user!.id, indexIds);
      if (error) {
        return res.status(error.status).json({ 
          error: error.message,
          invalidIds: error.invalidIds 
        });
      }

      // If user has no accessible indexes, return empty results
      if (validIndexIds.length === 0) {
        return res.json({
          intents: [],
          pagination: { current: page, total: 0, count: 0, totalCount: 0 }
        });
      }

      // Build base conditions
      const baseCondition = and(
        showArchived ? isNotNull(intents.archivedAt) : isNull(intents.archivedAt),
        eq(intents.userId, req.user!.id)
      );

      const selectFields = {
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        isIncognito: intents.isIncognito,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        archivedAt: intents.archivedAt,
        userId: intents.userId,
        userName: users.name,
        userEmail: users.email,
        userAvatar: users.avatar
      };

      // Build queries - always filtered by accessible indexes
      const [intentsResult, totalResult] = await Promise.all([
        db.select(selectFields).from(intents)
          .innerJoin(users, eq(intents.userId, users.id))
          .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
          .where(and(baseCondition, inArray(intentIndexes.indexId, validIndexIds)))
          .orderBy(desc(intents.createdAt))
          .offset(skip)
          .limit(limit),
        
        db.select({ count: count() }).from(intents)
          .innerJoin(users, eq(intents.userId, users.id))
          .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
          .where(and(baseCondition, inArray(intentIndexes.indexId, validIndexIds)))
      ]);

      // Add index counts
      const intentsWithCounts = await Promise.all(
        intentsResult.map(async (intent) => {
          const indexCount = await db.select({ count: count() })
            .from(intentIndexes)
            .where(eq(intentIndexes.intentId, intent.id));

          return {
            ...intent,
            user: {
              id: intent.userId,
              name: intent.userName,
              email: intent.userEmail,
              avatar: intent.userAvatar
            },
            _count: { indexes: indexCount[0]?.count || 0 }
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

// Get intents generated from library sources (files, links, integrations)
router.get('/library',
  authenticatePrivy,
  async (req: AuthRequest, res: Response) => {
    try {
      const rows = await db.select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        createdAt: intents.createdAt,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId,
        fileName: files.name,
        linkUrl: indexLinks.url,
        integrationType: userIntegrations.integrationType,
        integrationLastSyncAt: userIntegrations.lastSyncAt,
      }).from(intents)
        .leftJoin(files, and(
          eq(intents.sourceType, 'file'),
          eq(intents.sourceId, files.id)
        ))
        .leftJoin(indexLinks, and(
          eq(intents.sourceType, 'link'),
          eq(intents.sourceId, indexLinks.id)
        ))
        .leftJoin(userIntegrations, and(
          eq(intents.sourceType, 'integration'),
          eq(intents.sourceId, userIntegrations.id)
        ))
        .where(and(
          eq(intents.userId, req.user!.id),
          isNull(intents.archivedAt),
          isNotNull(intents.sourceType),
          isNotNull(intents.sourceId)
        ))
        .orderBy(desc(intents.createdAt));

      const friendlyIntegrationName = (integrationType?: string | null): string => {
        if (!integrationType) return 'Integration';
        const map: Record<string, string> = {
          notion: 'Notion',
          slack: 'Slack',
          discord: 'Discord',
          gmail: 'Gmail',
          'google-calendar': 'Google Calendar',
        };
        return map[integrationType] || integrationType
          .split('-')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');
      };

      const intentsBySource = rows.flatMap(row => {
        if (!row.sourceType || !row.sourceId) return [];
        const sourceType = row.sourceType as 'file' | 'link' | 'integration';
        let sourceName = '';
        let sourceValue: string | null = null;
        let sourceMeta: string | null = null;

        if (sourceType === 'file') {
          sourceName = row.fileName || 'File';
          sourceValue = row.fileName || null;
        } else if (sourceType === 'link') {
          sourceValue = row.linkUrl || null;
          if (row.linkUrl) {
            try {
              const url = new URL(row.linkUrl);
              sourceName = url.hostname || row.linkUrl;
            } catch {
              sourceName = row.linkUrl;
            }
          } else {
            sourceName = 'Link';
          }
        } else {
          const friendly = friendlyIntegrationName(row.integrationType);
          sourceName = friendly;
          sourceValue = row.integrationType || null;
          sourceMeta = row.integrationLastSyncAt ? row.integrationLastSyncAt.toISOString() : null;
        }

        return [{
          id: row.id,
          payload: row.payload,
          summary: row.summary,
          createdAt: row.createdAt,
          sourceType,
          sourceId: row.sourceId,
          sourceName,
          sourceValue,
          sourceMeta,
        }];
      });

      return res.json({ intents: intentsBySource });
    } catch (error) {
      console.error('Get library intents error:', error);
      return res.status(500).json({ error: 'Failed to fetch library intents' });
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
        isIncognito: intents.isIncognito,
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

      console.log('hasAccess', hasAccess, intentData.userId, req.user!.id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get intent's associated indexes
      const associatedIndexes = await db.select({
        indexId: intentIndexes.indexId,
        indexTitle: indexes.title
      }).from(intentIndexes)
        .innerJoin(indexes, eq(intentIndexes.indexId, indexes.id))
        .where(eq(intentIndexes.intentId, id));

      const result = {
        id: intentData.id,
        payload: intentData.payload,
        summary: intentData.summary,
        isIncognito: intentData.isIncognito,
        createdAt: intentData.createdAt,
        updatedAt: intentData.updatedAt,
        archivedAt: intentData.archivedAt,
        user: {
          id: intentData.userId,
          name: intentData.userName,
          email: intentData.userEmail,
          avatar: intentData.userAvatar
        },
        indexes: associatedIndexes,
        _count: {
          indexes: associatedIndexes.length
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
    body('isIncognito').optional().isBoolean(),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { payload, isIncognito = false, indexIds = [] } = req.body;

      // Verify index IDs exist and user has intent write access to them
      if (indexIds.length > 0) {
        const accessCheck = await checkMultipleIndexesIntentWriteAccess(indexIds, req.user!.id);
        
        if (!accessCheck.hasAccess) {
          return res.status(400).json({ 
            error: accessCheck.error,
            invalidIds: accessCheck.invalidIds 
          });
        }
      }

      const summary = await summarizeIntent(payload);
      
      const newIntent = await db.insert(intents).values({
        payload,
        summary,
        isIncognito,
        userId: req.user!.id,
              }).returning({
          id: intents.id,
          payload: intents.payload,
          summary: intents.summary,
          isIncognito: intents.isIncognito,
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
    body('isIncognito').optional().isBoolean(),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { payload, isIncognito, indexIds } = req.body;

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

      // Verify index IDs exist and user has intent write access to them if indexIds is provided
      if (indexIds !== undefined && indexIds.length > 0) {
        const accessCheck = await checkMultipleIndexesIntentWriteAccess(indexIds, req.user!.id);
        
        if (!accessCheck.hasAccess) {
          return res.status(400).json({ 
            error: accessCheck.error,
            invalidIds: accessCheck.invalidIds 
          });
        }
      }

      const updateData: any = { updatedAt: new Date() };
      if (payload !== undefined) {
        updateData.payload = payload;
        const newSummary = await summarizeIntent(payload);
        if (newSummary) {
          updateData.summary = newSummary;
        }
      }
      if (isIncognito !== undefined) updateData.isIncognito = isIncognito;

      const updatedIntent = await db.update(intents)
        .set(updateData)
        .where(eq(intents.id, id))
        .returning({
          id: intents.id,
          payload: intents.payload,
          summary: intents.summary,
          isIncognito: intents.isIncognito,
          createdAt: intents.createdAt,
          updatedAt: intents.updatedAt,
          userId: intents.userId
        });

      // Update intent-index associations if indexIds is provided
      if (indexIds !== undefined) {
        // Delete existing associations
        await db.delete(intentIndexes)
          .where(eq(intentIndexes.intentId, id));

        // Insert new associations if any provided
        if (indexIds.length > 0) {
          await db.insert(intentIndexes).values(
            indexIds.map((indexId: string) => ({
              intentId: id,
              indexId: indexId
            }))
          );
        }
      }

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

export default router; 
