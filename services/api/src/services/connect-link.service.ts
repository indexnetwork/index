import { and, desc, eq, gt, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { connectLinks, opportunities } from '../schemas/database.schema';

export type ConnectLinkKind = 'connect' | 'approve_introduction' | 'outreach' | 'send_direct';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 10;
const TTL_DAYS = 30;

const TERMINAL_STATUSES = new Set(['expired', 'rejected']);

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function canUserSeeConnectOpportunity(
  actors: Array<{ userId: string; role: string }>,
  status: string,
  userId: string,
): boolean {
  const hasIntroducer = actors.some((a) => a.role === 'introducer');
  const userRoles = actors.filter((a) => a.userId === userId).map((a) => a.role);
  if (userRoles.length === 0) return false;

  return userRoles.some((role) => {
    if (role === 'introducer') return true;
    if (role === 'peer') return true;
    if (role === 'patient' || role === 'party') return status !== 'latent' || !hasIntroducer;
    if (role === 'agent') {
      return (
        ['accepted', 'rejected', 'expired'].includes(status) ||
        (status !== 'latent' && !hasIntroducer)
      );
    }
    return false;
  });
}

/**
 * Compose the short connect-link URL surfaced to chat clients.
 *
 * `?link_preview=false` is the rendering hint chat-gateway runtimes (e.g.
 * OpenClaw's Telegram delivery) use to suppress the link-preview card.
 * Pinning the suffix here lets the URL shape evolve in one place and lets
 * tests assert the contract directly.
 */
export function buildConnectShortUrl(apiBaseUrl: string, code: string): string {
  return `${apiBaseUrl}/c/${code}?link_preview=false`;
}

export interface MintArgs {
  userId: string;
  opportunityId: string;
  kind: ConnectLinkKind;
  greeting?: string | null;
  preferredSurface?: 'telegram' | 'web' | null;
}

/**
 * Idempotent mint: if a non-expired link exists for (opportunityId, userId, kind),
 * return it. Otherwise insert a fresh row. Greeting is snapshotted at first mint
 * and preserved across re-mints until expiry. `preferredSurface`, by contrast,
 * is refreshed on reuse when the caller supplies one: the surface should
 * reflect where the link was most recently delivered, and this also self-heals
 * rows that were mis-stamped by a caller that omitted its surface.
 *
 * @param args - Recipient/opportunity/kind tuple plus optional greeting snapshot.
 * @returns The short code and stored greeting (null if none was supplied at mint).
 * @throws If three consecutive insert attempts fail without a racing row to reuse.
 */
export async function mintConnectLink({
  userId,
  opportunityId,
  kind,
  greeting,
  preferredSurface,
}: MintArgs): Promise<{ code: string; greeting: string | null }> {
  const now = new Date();

  // Look up any existing row for this recipient — fresh OR expired. The
  // unique index (opportunityId, userId, kind) doesn't filter on expiresAt,
  // so an expired row would block fresh inserts. Reuse if fresh; rotate
  // (UPDATE code + expiresAt + greeting) if expired.
  const [existing] = await db
    .select()
    .from(connectLinks)
    .where(
      and(
        eq(connectLinks.opportunityId, opportunityId),
        eq(connectLinks.userId, userId),
        eq(connectLinks.kind, kind),
      ),
    )
    .limit(1);

  if (existing && existing.expiresAt > now) {
    // Reuse the fresh row, but let the latest delivery surface win so the
    // click-time redirect matches where the link was actually sent. Only
    // update when the caller declares a surface — omission keeps the stamp.
    if (preferredSurface && existing.preferredSurface !== preferredSurface) {
      await db
        .update(connectLinks)
        .set({ preferredSurface })
        .where(eq(connectLinks.code, existing.code));
    }
    return { code: existing.code, greeting: existing.greeting };
  }

  const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);

  if (existing) {
    // Expired row — rotate code + greeting + preferredSurface + expiresAt in place.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateCode();
      try {
        const [row] = await db
          .update(connectLinks)
          .set({
            code,
            greeting: greeting ?? null,
            preferredSurface: preferredSurface ?? null,
            expiresAt,
          })
          .where(
            and(
              eq(connectLinks.opportunityId, opportunityId),
              eq(connectLinks.userId, userId),
              eq(connectLinks.kind, kind),
            ),
          )
          .returning();
        return { code: row.code, greeting: row.greeting };
      } catch (err) {
        // Possible PK collision on the rotated `code`. Retry with a fresh code.
        if (attempt === 2) throw err;
      }
    }
    throw new Error('mintConnectLink: exhausted code-rotation retries');
  }

  // No prior row — fresh insert.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    try {
      const [row] = await db
        .insert(connectLinks)
        .values({
          code,
          userId,
          opportunityId,
          kind,
          greeting: greeting ?? null,
          preferredSurface: preferredSurface ?? null,
          expiresAt,
        })
        .returning();
      return { code: row.code, greeting: row.greeting };
    } catch (err) {
      // PK collision (vanishingly unlikely) or unique-violation on (opp,user,kind)
      // due to a concurrent mint. Re-query and reuse if a racing fresh row exists.
      const [racing] = await db
        .select()
        .from(connectLinks)
        .where(
          and(
            eq(connectLinks.opportunityId, opportunityId),
            eq(connectLinks.userId, userId),
            eq(connectLinks.kind, kind),
            gt(connectLinks.expiresAt, now),
          ),
        )
        .limit(1);
      if (racing) return { code: racing.code, greeting: racing.greeting };
      if (attempt === 2) throw err;
    }
  }
  throw new Error('mintConnectLink: exhausted retries');
}

export interface ResolvedLink {
  code: string;
  userId: string;
  opportunityId: string;
  kind: ConnectLinkKind;
  greeting: string | null;
  preferredSurface: 'telegram' | 'web' | null;
}

function toResolvedLink(row: typeof connectLinks.$inferSelect, opportunityId: string = row.opportunityId): ResolvedLink {
  return {
    code: row.code,
    userId: row.userId,
    opportunityId,
    kind: row.kind as ConnectLinkKind,
    greeting: row.greeting,
    preferredSurface:
      row.preferredSurface === 'telegram' || row.preferredSurface === 'web'
        ? row.preferredSurface
        : null,
  };
}

async function resolveOpportunityForLink(
  opportunityId: string,
  userId: string,
): Promise<{ id: string; status: typeof opportunities.$inferSelect.status } | null> {
  const seenIds = new Set<string>();
  let currentId = opportunityId;
  let current: { id: string; status: typeof opportunities.$inferSelect.status } | null = null;

  for (let depth = 0; depth < 5; depth++) {
    if (seenIds.has(currentId)) break;
    seenIds.add(currentId);

    const [opp] = await db
      .select({ id: opportunities.id, status: opportunities.status, actors: opportunities.actors })
      .from(opportunities)
      .where(eq(opportunities.id, currentId))
      .limit(1);
    if (!opp) return current;
    current = { id: opp.id, status: opp.status };

    if (opp.status !== 'expired') return current;

    const replacements = await db
      .select({ id: opportunities.id, status: opportunities.status, actors: opportunities.actors })
      .from(opportunities)
      .where(
        sql`${opportunities.detection} @> ${JSON.stringify({ enrichedFrom: [opp.id] })}::jsonb`,
      )
      .orderBy(desc(opportunities.createdAt));
    const visibleReplacement = replacements.find((replacement) => {
      if (seenIds.has(replacement.id)) return false;
      return canUserSeeConnectOpportunity(replacement.actors, replacement.status, userId);
    });

    if (!visibleReplacement) return current;
    currentId = visibleReplacement.id;
  }

  return current;
}

/**
 * Resolve a short code to its row. Returns null for terminal-status opportunities
 * regardless of link freshness. Self-heals stale codes by extending TTL when
 * the underlying opportunity is still actionable.
 *
 * @param code - The 10-char base62 short code.
 * @returns The resolved link row, or `null` for unknown codes or codes
 *   whose opportunity has reached a terminal status.
 */
export async function resolveConnectLink(code: string): Promise<ResolvedLink | null> {
  const [row] = await db
    .select()
    .from(connectLinks)
    .where(eq(connectLinks.code, code))
    .limit(1);
  if (!row) return null;

  const now = new Date();
  const opp = await resolveOpportunityForLink(row.opportunityId, row.userId);
  if (!opp) return null;

  if (TERMINAL_STATUSES.has(opp.status)) return null;

  const resolvedLink = toResolvedLink(row, opp.id);
  if (row.expiresAt > now) {
    return resolvedLink;
  }

  // Extend TTL.
  const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);
  await db
    .update(connectLinks)
    .set({ expiresAt })
    .where(eq(connectLinks.code, code));

  return resolvedLink;
}

/**
 * Resolve a short code for a specific authenticated recipient.
 *
 * This filters by `userId` before expired-opportunity replacement lookup or TTL
 * extension, so wrong-account callers cannot mutate `connect_links` rows merely
 * by probing another user's code.
 *
 * @param code - The 10-char base62 short code.
 * @param userId - Authenticated recipient id that must own the link row.
 * @returns The resolved link row, or `null` for unknown, wrong-recipient,
 *   expired-terminal, or otherwise unavailable links.
 */
export async function resolveConnectLinkForUser(
  code: string,
  userId: string,
): Promise<ResolvedLink | null> {
  const [row] = await db
    .select()
    .from(connectLinks)
    .where(and(eq(connectLinks.code, code), eq(connectLinks.userId, userId)))
    .limit(1);
  if (!row) return null;

  const now = new Date();
  const opp = await resolveOpportunityForLink(row.opportunityId, userId);
  if (!opp) return null;

  if (TERMINAL_STATUSES.has(opp.status)) return null;

  const resolvedLink = toResolvedLink(row, opp.id);
  if (row.expiresAt > now) {
    return resolvedLink;
  }

  // Extend TTL only after the authenticated recipient has matched the row.
  const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);
  await db
    .update(connectLinks)
    .set({ expiresAt })
    .where(and(eq(connectLinks.code, code), eq(connectLinks.userId, userId)));

  return resolvedLink;
}

