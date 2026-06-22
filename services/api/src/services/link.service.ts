import { log } from '../lib/log';
import { linkDatabaseAdapter, type LinkRow } from '../adapters/database.adapter';

const logger = log.service.from("LinkService");

/**
 * LinkService
 * 
 * Manages link operations including creation, retrieval, and deletion.
 * Uses LinkDatabaseAdapter for all database operations.
 * 
 * RESPONSIBILITIES:
 * - Link CRUD operations
 * - Link content retrieval
 * - Link status tracking
 */
export class LinkService {
  constructor(private db = linkDatabaseAdapter) {}

  /**
   * List all links for a user.
   * 
   * @param userId - The user ID
   * @returns Array of link records
   */
  async listLinks(userId: string): Promise<LinkRow[]> {
    logger.verbose('[LinkService] Listing links', { userId });
    
    return this.db.listLinks(userId);
  }

  /**
   * Create a new link.
   * 
   * @param userId - The user ID
   * @param url - The URL to create a link for
   * @returns The created link record
   */
  async createLink(userId: string, url: string): Promise<LinkRow> {
    logger.verbose('[LinkService] Creating link', { userId, url });
    
    return this.db.createLink(userId, url);
  }

  /**
   * Delete a link.
   * 
   * @param linkId - The link ID
   * @param userId - The user ID (for ownership verification)
   * @returns True if deleted, false if not found or unauthorized
   */
  async deleteLink(linkId: string, userId: string): Promise<boolean> {
    logger.verbose('[LinkService] Deleting link', { linkId, userId });
    
    return this.db.deleteLink(linkId, userId);
  }

  /**
   * Get link content (metadata).
   * 
   * @param linkId - The link ID
   * @param userId - The user ID (for ownership verification)
   * @returns Link metadata or null if not found or unauthorized
   */
  async getLinkContent(linkId: string, userId: string): Promise<{
    id: string;
    url: string;
    lastSyncAt: Date | null;
    lastStatus: string | null;
  } | null> {
    logger.verbose('[LinkService] Getting link content', { linkId, userId });
    
    return this.db.getLinkContent(linkId, userId);
  }
}

export const linkService = new LinkService();
