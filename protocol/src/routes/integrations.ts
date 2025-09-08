import { Router, Response } from 'express';
import { log } from '../lib/log';
import { body, param, query, validationResult } from 'express-validator';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import db from '../lib/db';
import { userIntegrations } from '../lib/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { syncIntegration } from '../lib/integrations/core/integration-sync';

const router = Router();

// Initialize Composio SDK dynamically
let composio: any;
const initComposio = async () => {
  if (!composio) {
    const { Composio } = await import('@composio/core');
    composio = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY
    });
  }
  return composio;
};

// Supported integrations mapping
const INTEGRATION_MAPPINGS = {
  notion: { toolkit: 'NOTION', name: 'Notion' },
  slack: { toolkit: 'SLACK', name: 'Slack' },
  discord: { toolkit: 'DISCORDBOT', name: 'Discord' },
  gmail: { toolkit: 'GMAIL', name: 'Gmail' },
  calendar: { toolkit: 'GOOGLECALENDAR', name: 'Google Calendar' },
  linkedin: { toolkit: 'LINKEDIN', name: 'LinkedIn' }
};

// Get user's integrations status
router.get('/',
  authenticatePrivy,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      // Get user's current integrations from database
      const integrations = await db.select()
        .from(userIntegrations)
        .where(and(
          eq(userIntegrations.userId, userId),
          isNull(userIntegrations.deletedAt)
        ));

      // Map to include status for each supported integration
      const integrationsStatus = Object.entries(INTEGRATION_MAPPINGS).map(([key, config]) => {
        const integration = integrations.find(i => i.integrationType === key);
        return {
          id: key,
          name: config.name,
          connected: !!integration,
          connectedAt: integration?.connectedAt,
          lastSyncAt: integration?.lastSyncAt,
        };
      });

      return res.json({ integrations: integrationsStatus });
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
    param('integrationType').isIn(Object.keys(INTEGRATION_MAPPINGS)).withMessage('Invalid integration type')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const integrationType = req.params.integrationType;
      const integrationConfig = INTEGRATION_MAPPINGS[integrationType as keyof typeof INTEGRATION_MAPPINGS];

      // Check if already connected
      const existing = await db.select()
        .from(userIntegrations)
        .where(and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.integrationType, integrationType),
          isNull(userIntegrations.deletedAt)
        ))
        .limit(1);

      if (existing.length > 0) {
        return res.status(409).json({ error: 'Integration already connected' });
      }

      // Initiate OAuth connection with Composio
      const composioClient = await initComposio();
      const connectionRequest = await composioClient.toolkits.authorize(userId, integrationConfig.toolkit);

      // Store connection request in database
      await db.insert(userIntegrations).values({
        userId,
        integrationType,
        connectionRequestId: connectionRequest.id,
        status: 'pending',
        redirectUrl: connectionRequest.redirectUrl
      });

      return res.json({
        redirectUrl: connectionRequest.redirectUrl,
        connectionRequestId: connectionRequest.id
      });
    } catch (error) {
      log.error('Connect integration error', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to initiate connection' });
    }
  }
);

// Check connection status
router.get('/status/:connectionRequestId',
  authenticatePrivy,
  [
    param('connectionRequestId').notEmpty().withMessage('Connection request ID is required')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const connectionRequestId = req.params.connectionRequestId;

      // Get integration record
      const integration = await db.select()
        .from(userIntegrations)
        .where(and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.connectionRequestId, connectionRequestId),
          isNull(userIntegrations.deletedAt)
        ))
        .limit(1);

      if (integration.length === 0) {
        return res.status(404).json({ error: 'Connection request not found' });
      }

      const integrationRecord = integration[0];

      // If already connected, return success
      if (integrationRecord.status === 'connected') {
        return res.json({ 
          status: 'connected',
          connectedAt: integrationRecord.connectedAt
        });
      }

      try {
        // Check with Composio if the connection is actually established
        const composioClient = await initComposio();
        const integrationConfig = INTEGRATION_MAPPINGS[integrationRecord.integrationType as keyof typeof INTEGRATION_MAPPINGS];
        // Check connection
        // Check if user has connected accounts for this toolkit
        const connectedAccounts = await composioClient.connectedAccounts.list({
          userIds: [userId],
          toolkitSlugs: [integrationConfig.toolkit.toLowerCase()]
        });

        if (connectedAccounts && connectedAccounts.items && connectedAccounts.items.length > 0) {
          // Check if any account has an active/connected status
          const activeAccount = connectedAccounts.items.find((account: any) => 
            account.status === 'ACTIVE' || account.status === 'CONNECTED'
          );
          
          if (activeAccount) {
            log.info('Integration connected', { userId, integration: integrationRecord.integrationType });
            // Connection verified, update database
            await db.update(userIntegrations)
              .set({
                status: 'connected',
                connectedAt: new Date()
              })
              .where(eq(userIntegrations.id, integrationRecord.id));

            return res.json({ 
              status: 'connected',
              connectedAt: new Date(),
            });
          } else {
            const accountStatuses = connectedAccounts.items.map((acc: any) => acc.status).join(', ');
            return res.json({ status: 'pending' });
          }
        } else {
          // Connection not established yet
          return res.json({ status: 'pending' });
        }
      } catch (error) {
        log.error('Error checking Composio connection', { error: error instanceof Error ? error.message : String(error) });
        // Connection not ready yet or error occurred
        return res.json({ status: 'pending' });
      }
    } catch (error) {
      log.error('Check connection status error', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to check connection status' });
    }
  }
);

// Disconnect an integration
router.delete('/:integrationType',
  authenticatePrivy,
  [
    param('integrationType').isIn(Object.keys(INTEGRATION_MAPPINGS)).withMessage('Invalid integration type')
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const integrationType = req.params.integrationType;
      const integrationConfig = INTEGRATION_MAPPINGS[integrationType as keyof typeof INTEGRATION_MAPPINGS];

      try {
        // First, disconnect from Composio
        const composioClient = await initComposio();
        
        // Get connected accounts for this toolkit
        const connectedAccounts = await composioClient.connectedAccounts.list({
          userIds: [userId],
          toolkitSlugs: [integrationConfig.toolkit.toLowerCase()]
        });

        // Delete each connected account from Composio
        if (connectedAccounts && connectedAccounts.items) {
          for (const account of connectedAccounts.items) {
            await composioClient.connectedAccounts.delete(account.id);
          }
          log.info('Disconnected accounts', { integrationType, count: connectedAccounts.items.length });
        }
      } catch (composioError) {
        console.error('Error disconnecting from Composio:', composioError);
        // Continue with local disconnection even if Composio fails
      }

      // Update our database
      const result = await db.update(userIntegrations)
        .set({
          deletedAt: new Date(),
          status: 'disconnected'
        })
        .where(and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.integrationType, integrationType),
          isNull(userIntegrations.deletedAt)
        ));

      return res.json({ success: true });
    } catch (error) {
      console.error('Disconnect integration error:', error);
      return res.status(500).json({ error: 'Failed to disconnect integration' });
    }
  }
);

// Sync specific integration
router.post('/sync/:integrationType',
  authenticatePrivy,
  [
    param('integrationType').isIn(Object.keys(INTEGRATION_MAPPINGS)).withMessage('Invalid integration type'),
    body('indexId').optional().isUUID()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const integrationType = req.params.integrationType;
      const { indexId } = req.body;

      const result = await syncIntegration(userId, integrationType, indexId);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      return res.json(result);
    } catch (error) {
      log.error('Sync integration error', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Failed to sync integration' });
    }
  }
);


export default router; 
