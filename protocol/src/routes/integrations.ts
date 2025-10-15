import { Router, Response } from 'express';
import { log } from '../lib/log';
import { body, param, query, validationResult } from 'express-validator';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import db from '../lib/db';
import { userIntegrations, indexes, indexMembers } from '../lib/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { runSync } from '../lib/sync';
import { INTEGRATIONS } from '../lib/integrations/config';
import { getClient } from '../lib/integrations/composio';

const router = Router();

// Use centralized integration config
const INTEGRATION_MAPPINGS = Object.fromEntries(
  Object.entries(INTEGRATIONS).map(([key, config]) => [
    key, 
    { toolkit: config.toolkit, name: config.displayName }
  ])
);

// Get user's integrations status
router.get('/',
  authenticatePrivy,
  [
    query('indexId').optional().isUUID().withMessage('Index ID must be a valid UUID')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const indexId = req.query.indexId as string | undefined;

      // Build where conditions
      const whereConditions = [
        eq(userIntegrations.userId, userId),
        isNull(userIntegrations.deletedAt)
      ];

      // Add indexId filter if provided
      if (indexId) {
        whereConditions.push(eq(userIntegrations.indexId, indexId));
      }

      // Get user's current integrations from database
      const integrations = await db.select()
        .from(userIntegrations)
        .where(and(...whereConditions));

      // Return actual integration records with proper IDs
      const connectedIntegrations = integrations.map(integration => ({
        id: integration.id, // integrationId as the main ID
        type: integration.integrationType, // integration type (slack, discord, etc.)
        name: INTEGRATION_MAPPINGS[integration.integrationType as keyof typeof INTEGRATION_MAPPINGS]?.name || integration.integrationType,
        connected: true,
        connectedAt: integration.connectedAt,
        lastSyncAt: integration.lastSyncAt,
        indexId: integration.indexId,
        status: integration.status
      }));

      // Also return available integration types for frontend
      const availableTypes = Object.entries(INTEGRATION_MAPPINGS).map(([key, config]) => ({
        type: key,
        name: config.name,
        toolkit: config.toolkit
      }));

      return res.json({ 
        integrations: connectedIntegrations,
        availableTypes 
      });
    } catch (error) {
      log.error('Get integrations error', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to fetch integrations' });
    }
  }
);

// Initiate OAuth flow for an integration
router.post('/connect/:integrationType',
  authenticatePrivy,
  [
    param('integrationType').isIn(Object.keys(INTEGRATION_MAPPINGS)).withMessage('Invalid integration type'),
    body('indexId').isUUID().withMessage('Index ID is required and must be valid UUID')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const integrationType = req.params.integrationType;
      const indexId = req.body.indexId;
      const integrationConfig = INTEGRATIONS[integrationType as keyof typeof INTEGRATIONS];

      // Validate indexId access
      const indexExists = await db.select({ id: indexes.id })
        .from(indexes)
        .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
        .where(and(
          eq(indexes.id, indexId),
          eq(indexMembers.userId, userId),
          isNull(indexes.deletedAt)
        ))
        .limit(1);

      if (indexExists.length === 0) {
        return res.status(404).json({ error: 'Index not found or access denied' });
      }

      // Check if already connected for this index
      const existing = await db.select()
        .from(userIntegrations)
        .where(and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.integrationType, integrationType),
          eq(userIntegrations.indexId, indexId),
          isNull(userIntegrations.deletedAt)
        ))
        .limit(1);

      if (existing.length > 0) {
        return res.status(409).json({ error: 'Integration already connected for this index' });
      }

      // Initiate OAuth connection with Composio
      const composioClient = await getClient();
      if (!integrationConfig.toolkit) {
        return res.status(400).json({ error: 'Integration toolkit not configured' });
      }
      const connection = await composioClient.toolkits.authorize(
        userId, 
        integrationConfig.toolkit,
        integrationConfig.authConfigId
      );

      // Store integration record in database
      const [integrationRecord] = await db.insert(userIntegrations).values({
        userId,
        integrationType,
        indexId,
        connectedAccountId: connection.id,
        redirectUrl: connection.redirectUrl,
        status: 'pending'
      }).returning();

      return res.json({ 
        redirectUrl: connection.redirectUrl,
        integrationId: integrationRecord.id
      });
    } catch (error) {
      log.error('Connect integration error', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to initiate connection' });
    }
  }
);

// Check integration status using integrationId
router.get('/:integrationId/status',
  authenticatePrivy,
  [
    param('integrationId').isUUID().withMessage('Integration ID must be a valid UUID')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const integrationId = req.params.integrationId;

      // Get integration record
      const integration = await db.select()
        .from(userIntegrations)
        .where(and(
          eq(userIntegrations.id, integrationId),
          eq(userIntegrations.userId, userId),
          isNull(userIntegrations.deletedAt)
        ))
        .limit(1);

      if (integration.length === 0) {
        return res.status(404).json({ error: 'Integration not found' });
      }

      const integrationRecord = integration[0];

      if (integrationRecord.status === 'connected') {
        return res.json({ 
          status: 'connected',
          connectedAt: integrationRecord.connectedAt,
        });
      }

      // Check connection status with Composio if pending
      if (integrationRecord.status === 'pending' && integrationRecord.connectedAccountId) {
        try {
          const composio = await getClient();
          
          // Check the specific connected account status
          const connectedAccounts = await composio.connectedAccounts.list({
            userIds: [userId]
          });
          
          // Find the specific connected account by ID
          const connectionStatus = connectedAccounts?.items?.find(
            (acc: any) => acc.id === integrationRecord.connectedAccountId
          );
          if (connectionStatus && connectionStatus.status === 'ACTIVE') {
            // This connection is now active
            await db.update(userIntegrations)
              .set({
                status: 'connected',
                connectedAt: new Date()
              })
              .where(eq(userIntegrations.id, integrationId));

            // Trigger first sync automatically (fire and forget)
            try {
              const syncParams = { integrationId };
              runSync(integrationRecord.integrationType as any, userId, syncParams);
              log.info('First sync triggered for new integration', { 
                integrationId,
                integrationType: integrationRecord.integrationType
              });
            } catch (syncError) {
              log.error('Failed to trigger first sync', { 
                integrationId,
                integrationType: integrationRecord.integrationType,
                error: syncError instanceof Error ? syncError.message : String(syncError)
              });
            }

            return res.json({ 
              status: 'connected',
              connectedAt: new Date(),
            });
          }
        } catch (error) {
          log.error('Error checking Composio connection', { error: error instanceof Error ? error.message : String(error) });
        }
      }

      return res.json({ status: 'pending' });
    } catch (error) {
      log.error('Integration status error', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to check integration status' });
    }
  }
);

// Disconnect integration using integrationId
router.delete('/:integrationId',
  authenticatePrivy,
  [
    param('integrationId').isUUID().withMessage('Integration ID must be a valid UUID')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const integrationId = req.params.integrationId;

      // Get the integration record
      const integration = await db.select()
        .from(userIntegrations)
        .where(and(
          eq(userIntegrations.id, integrationId),
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.status, 'connected'),
          isNull(userIntegrations.deletedAt)
        ))
        .limit(1);

      if (integration.length === 0) {
        return res.status(404).json({ error: 'Integration not found or not connected' });
      }

      const integrationRecord = integration[0];

      // Disconnect from Composio using the stored connectedAccountId
      if (integrationRecord.connectedAccountId) {
        try {
          const composioClient = await getClient();
          await composioClient.connectedAccounts.delete(integrationRecord.connectedAccountId);
          log.info('Disconnected from Composio', { 
            integrationId,
            integrationType: integrationRecord.integrationType,
            connectedAccountId: integrationRecord.connectedAccountId 
          });
        } catch (composioError) {
          console.error('Error disconnecting from Composio:', composioError);
          // Continue with local disconnection even if Composio fails
        }
      }

      // Update our database
      await db.update(userIntegrations)
        .set({
          deletedAt: new Date(),
          status: 'disconnected'
        })
        .where(eq(userIntegrations.id, integrationId));

      return res.json({ success: true });
    } catch (error) {
      console.error('Disconnect integration error:', error);
      return res.status(500).json({ error: 'Failed to disconnect integration' });
    }
  }
);

export default router;
