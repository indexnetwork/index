import db from '../db';
import { userIntegrations } from '../schema';
import { eq, and, isNull } from 'drizzle-orm';
import { log } from '../log';

export interface IntegrationDetails {
  id: string;
  userId: string;
  indexId: string;
  integrationType: string;
  connectedAccountId: string | null;
  lastSyncAt: Date | null;
}

/**
 * Get integration details by integration ID
 */
export async function getIntegrationById(integrationId: string): Promise<IntegrationDetails | null> {
  try {
    const integration = await db.select({
      id: userIntegrations.id,
      userId: userIntegrations.userId,
      indexId: userIntegrations.indexId,
      integrationType: userIntegrations.integrationType,
      connectedAccountId: userIntegrations.connectedAccountId,
      lastSyncAt: userIntegrations.lastSyncAt
    })
    .from(userIntegrations)
    .where(and(
      eq(userIntegrations.id, integrationId),
      eq(userIntegrations.status, 'connected'),
      isNull(userIntegrations.deletedAt)
    ))
    .limit(1);

    if (integration.length === 0) {
      log.warn('Integration not found or not connected', { integrationId });
      return null;
    }

    return integration[0];
  } catch (error) {
    log.error('Failed to get integration details', { 
      integrationId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return null;
  }
}
