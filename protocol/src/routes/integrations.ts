import { Router, Response } from 'express';
import { log } from '../lib/log';
import { body, param, query, validationResult } from 'express-validator';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import db from '../lib/db';
import { userIntegrations, indexes, indexMembers } from '../lib/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { runSync } from '../lib/sync';
import { INTEGRATIONS } from '../lib/integrations/config';
import { getClient } from '../lib/integrations/composio';
import { checkIndexOwnership } from '../lib/index-access';
import { getIntegrationById } from '../lib/integrations/integration-utils';
import { airtableDirectoryProvider } from '../lib/integrations/providers/airtable-directory';
import { notionDirectoryProvider } from '../lib/integrations/providers/notion-directory';
import { googledocsDirectoryProvider } from '../lib/integrations/providers/googledocs-directory';
import { syncDirectoryMembers } from '../lib/integrations/directory-sync';
import { DirectorySyncConfig, IntegrationResponse, AvailableIntegrationType, ConnectIntegrationRequest, ConnectIntegrationResponse, IntegrationStatusResponse } from '../types';

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

      // Check owner permission if indexId provided
      if (indexId) {
        const ownershipCheck = await checkIndexOwnership(indexId, userId);
        if (!ownershipCheck.hasAccess) {
          return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
        }
      }

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

      // Filter available types based on context
      // If indexId provided: show only index integrations
      // If no indexId: show only user integrations
      const availableTypes = Object.entries(INTEGRATIONS)
        .filter(([key, config]) => {
          if (!config.enabled) return false;
          if (indexId) {
            return config.capabilities.indexIntegration;
          } else {
            return config.capabilities.userIntegration;
          }
        })
        .map(([key, config]) => ({
          type: key,
          name: config.displayName,
          toolkit: config.toolkit,
          capabilities: config.capabilities
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
    body('indexId').optional().isUUID().withMessage('Index ID must be valid UUID'),
    body('enableUserAttribution').optional().isBoolean().withMessage('enableUserAttribution must be a boolean')
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
      const requestedEnableUserAttribution = req.body.enableUserAttribution;
      const integrationConfig = INTEGRATIONS[integrationType as keyof typeof INTEGRATIONS];

      if (!integrationConfig) {
        return res.status(400).json({ error: 'Invalid integration type' });
      }

      if (!integrationConfig.enabled) {
        return res.status(400).json({ error: 'Integration is disabled' });
      }

      const requiresAttribution = integrationConfig.capabilities.indexSyncModes && 'attribution' in integrationConfig.capabilities.indexSyncModes && integrationConfig.capabilities.indexSyncModes.attribution === true;
      const enableUserAttribution = requiresAttribution
        ? true
        : (requestedEnableUserAttribution ?? false); // Default to false when not forced

      // Validate integration is appropriate for context
      if (indexId) {
        // Index integration: must support indexIntegration
        if (!integrationConfig.capabilities.indexIntegration) {
          return res.status(400).json({ error: 'This integration does not support index integrations' });
        }
      } else {
        // User integration: must support userIntegration
        if (!integrationConfig.capabilities.userIntegration) {
          return res.status(400).json({ error: 'This integration does not support user integrations' });
        }
      }

      // Validate: if attribution enabled, indexId is required
      if (enableUserAttribution && !indexId) {
        return res.status(400).json({ error: 'Index ID is required when user attribution is enabled' });
      }

      // Validate indexId access if provided - must be owner
      if (indexId) {
        const ownershipCheck = await checkIndexOwnership(indexId, userId);
        if (!ownershipCheck.hasAccess) {
          return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
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
          // If there's a connected integration, block the request
          if (existing[0].status === 'connected') {
            return res.status(409).json({ error: 'Integration already connected for this index' });
          }
          // If there's a pending integration, clean it up before creating a new one
          await db.update(userIntegrations)
            .set({ deletedAt: new Date() })
            .where(eq(userIntegrations.id, existing[0].id));
        }
      } else {
        // No indexId - check if user has any user integration (no indexId) of this type
        // Allow separate index and user integrations to coexist
        const existing = await db.select()
          .from(userIntegrations)
          .where(and(
            eq(userIntegrations.userId, userId),
            eq(userIntegrations.integrationType, integrationType),
            isNull(userIntegrations.indexId), // Only check user integrations (no indexId)
            isNull(userIntegrations.deletedAt)
          ))
          .limit(1);

        if (existing.length > 0) {
          // If there's a connected integration, block the request
          if (existing[0].status === 'connected') {
            return res.status(409).json({ error: 'User integration already connected' });
          }
          // If there's a pending integration, clean it up before creating a new one
          await db.update(userIntegrations)
            .set({ deletedAt: new Date() })
            .where(eq(userIntegrations.id, existing[0].id));
        }
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
        indexId: indexId || null, // Store null if not provided
        connectedAccountId: connection.id,
        redirectUrl: connection.redirectUrl,
        status: 'pending',
        enableUserAttribution
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

      // Check ownership if integration is connected to an index
      if (integrationRecord.indexId) {
        const ownershipCheck = await checkIndexOwnership(integrationRecord.indexId, userId);
        if (!ownershipCheck.hasAccess) {
          return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
        }
      }

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
      return res.status(500).json({ error: 'Failed to disconnect integration' });
    }
  }
);

// Directory sync endpoints

// Get directory sync sources (bases/databases/spreadsheets)
router.get('/:integrationId/directory/sources',
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

      const integration = await getIntegrationById(integrationId);
      if (!integration) {
        return res.status(404).json({ error: 'Integration not found' });
      }

      if (integration.userId !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (!integration.indexId) {
        return res.status(400).json({ error: 'Directory sync requires an index integration' });
      }

      // Check ownership
      const ownershipCheck = await checkIndexOwnership(integration.indexId, userId);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Get provider
      let provider;
      switch (integration.integrationType) {
        case 'airtable':
          provider = airtableDirectoryProvider;
          break;
        case 'notion':
          provider = notionDirectoryProvider;
          break;
        case 'googledocs':
          provider = googledocsDirectoryProvider;
          break;
        default:
          return res.status(400).json({ error: 'Integration does not support directory sync' });
      }

      const sources = await provider.listSources(integrationId);
      return res.json({ sources });
    } catch (error) {
      log.error('Get directory sources error', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to fetch directory sources' });
    }
  }
);

// Get source schema (columns)
router.get('/:integrationId/directory/sources/:sourceId/schema',
  authenticatePrivy,
  [
    param('integrationId').isUUID().withMessage('Integration ID must be a valid UUID'),
    param('sourceId').notEmpty().withMessage('Source ID is required'),
    query('subSourceId').optional().notEmpty().withMessage('Sub-source ID must not be empty')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const integrationId = req.params.integrationId;
      const sourceId = req.params.sourceId;
      const subSourceId = req.query.subSourceId as string | undefined;

      const integration = await getIntegrationById(integrationId);
      if (!integration) {
        return res.status(404).json({ error: 'Integration not found' });
      }

      if (integration.userId !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (!integration.indexId) {
        return res.status(400).json({ error: 'Directory sync requires an index integration' });
      }

      // Check ownership
      const ownershipCheck = await checkIndexOwnership(integration.indexId, userId);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Get provider
      let provider;
      switch (integration.integrationType) {
        case 'airtable':
          provider = airtableDirectoryProvider;
          break;
        case 'notion':
          provider = notionDirectoryProvider;
          break;
        case 'googledocs':
          provider = googledocsDirectoryProvider;
          break;
        default:
          return res.status(400).json({ error: 'Integration does not support directory sync' });
      }

      const columns = await provider.getSourceSchema(integrationId, sourceId, subSourceId);
      return res.json({ columns });
    } catch (error) {
      log.error('Get directory source schema error', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to fetch source schema' });
    }
  }
);

// Get directory sync configuration
router.get('/:integrationId/directory/config',
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

      const integration = await getIntegrationById(integrationId);
      if (!integration) {
        return res.status(404).json({ error: 'Integration not found' });
      }

      if (integration.userId !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (!integration.indexId) {
        return res.status(400).json({ error: 'Directory sync requires an index integration' });
      }

      // Check ownership
      const ownershipCheck = await checkIndexOwnership(integration.indexId, userId);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      return res.json({ config: integration.config?.directorySync || null });
    } catch (error) {
      log.error('Get directory config error', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to fetch directory config' });
    }
  }
);

// Save directory sync configuration
router.post('/:integrationId/directory/config',
  authenticatePrivy,
  [
    param('integrationId').isUUID().withMessage('Integration ID must be a valid UUID'),
    body('config').isObject().withMessage('Config must be an object'),
    body('config.source').isObject().withMessage('Source is required'),
    body('config.source.id').notEmpty().withMessage('Source ID is required'),
    body('config.source.name').notEmpty().withMessage('Source name is required'),
    body('config.columnMappings').isObject().withMessage('Column mappings are required'),
    body('config.columnMappings.email').notEmpty().withMessage('Email column mapping is required')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const integrationId = req.params.integrationId;
      const config = req.body.config as DirectorySyncConfig;

      const integration = await getIntegrationById(integrationId);
      if (!integration) {
        return res.status(404).json({ error: 'Integration not found' });
      }

      if (integration.userId !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (!integration.indexId) {
        return res.status(400).json({ error: 'Directory sync requires an index integration' });
      }

      // Check ownership
      const ownershipCheck = await checkIndexOwnership(integration.indexId, userId);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      // Validate integration supports directory sync
      const integrationConfig = INTEGRATIONS[integration.integrationType as keyof typeof INTEGRATIONS];
      const hasDirectorySync = integrationConfig?.capabilities.indexSyncModes && 'directorySync' in integrationConfig.capabilities.indexSyncModes && integrationConfig.capabilities.indexSyncModes.directorySync;
      if (!hasDirectorySync) {
        return res.status(400).json({ error: 'Integration does not support directory sync' });
      }

      // Update integration config
      const updatedConfig = {
        ...integration.config,
        directorySync: {
          ...config,
          enabled: true
        }
      };

      await db.update(userIntegrations)
        .set({
          config: updatedConfig,
          updatedAt: new Date()
        } as any)
        .where(eq(userIntegrations.id, integrationId));

      return res.json({ success: true, config: updatedConfig.directorySync });
    } catch (error) {
      log.error('Save directory config error', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to save directory config' });
    }
  }
);

// Trigger directory sync
router.post('/:integrationId/directory/sync',
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

      const integration = await getIntegrationById(integrationId);
      if (!integration) {
        return res.status(404).json({ error: 'Integration not found' });
      }

      if (integration.userId !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (!integration.indexId) {
        return res.status(400).json({ error: 'Directory sync requires an index integration' });
      }

      // Check ownership
      const ownershipCheck = await checkIndexOwnership(integration.indexId, userId);
      if (!ownershipCheck.hasAccess) {
        return res.status(ownershipCheck.status!).json({ error: ownershipCheck.error });
      }

      const config = integration.config?.directorySync;
      if (!config || !config.enabled) {
        return res.status(400).json({ error: 'Directory sync not configured' });
      }

      // Get provider
      let provider;
      switch (integration.integrationType) {
        case 'airtable':
          provider = airtableDirectoryProvider;
          break;
        case 'notion':
          provider = notionDirectoryProvider;
          break;
        case 'googledocs':
          provider = googledocsDirectoryProvider;
          break;
        default:
          return res.status(400).json({ error: 'Integration does not support directory sync' });
      }

      // Run sync
      const result = await syncDirectoryMembers(integrationId, provider);

      return res.json({
        success: result.success,
        membersAdded: result.membersAdded,
        errors: result.errors,
        status: result.status
      });
    } catch (error) {
      log.error('Directory sync error', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to sync directory' });
    }
  }
);

export default router;
