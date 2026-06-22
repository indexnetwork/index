import { LinkRow, and, db, eq, links } from './database.shared';

export class LinkDatabaseAdapter {
  async listLinks(userId: string): Promise<LinkRow[]> {
    return db.select({
      id: links.id,
      url: links.url,
      createdAt: links.createdAt,
      lastSyncAt: links.lastSyncAt,
      lastStatus: links.lastStatus,
      lastError: links.lastError,
    })
      .from(links)
      .where(eq(links.userId, userId));
  }

  async createLink(userId: string, url: string): Promise<LinkRow> {
    const [inserted] = await db.insert(links)
      .values({ userId, url })
      .returning({
        id: links.id,
        url: links.url,
        createdAt: links.createdAt,
        lastSyncAt: links.lastSyncAt,
        lastStatus: links.lastStatus,
        lastError: links.lastError,
      });
    return inserted;
  }

  async deleteLink(linkId: string, userId: string): Promise<boolean> {
    const result = await db.delete(links)
      .where(and(eq(links.id, linkId), eq(links.userId, userId)))
      .returning({ id: links.id });
    return result.length > 0;
  }

  async getLinkContent(linkId: string, userId: string): Promise<{ id: string; url: string; lastSyncAt: Date | null; lastStatus: string | null } | null> {
    const rows = await db.select({
      id: links.id,
      url: links.url,
      lastSyncAt: links.lastSyncAt,
      lastStatus: links.lastStatus,
    })
      .from(links)
      .where(and(eq(links.id, linkId), eq(links.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton Exports
// ═══════════════════════════════════════════════════════════════════════════════

