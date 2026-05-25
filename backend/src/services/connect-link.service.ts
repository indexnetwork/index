import { and, eq, gt } from 'drizzle-orm';

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
 * and preserved across re-mints until expiry.
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

function toResolvedLink(row: typeof connectLinks.$inferSelect): ResolvedLink {
  return {
    code: row.code,
    userId: row.userId,
    opportunityId: row.opportunityId,
    kind: row.kind as ConnectLinkKind,
    greeting: row.greeting,
    preferredSurface:
      row.preferredSurface === 'telegram' || row.preferredSurface === 'web'
        ? row.preferredSurface
        : null,
  };
}

/**
 * Resolve a short code to its row. Self-heals expired codes by extending
 * TTL when the underlying opportunity is still actionable.
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

  if (row.expiresAt > now) {
    return toResolvedLink(row);
  }

  // Expired — check if the opportunity is still actionable.
  const [opp] = await db
    .select({ status: opportunities.status })
    .from(opportunities)
    .where(eq(opportunities.id, row.opportunityId))
    .limit(1);

  if (!opp || TERMINAL_STATUSES.has(opp.status)) return null;

  // Extend TTL.
  const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);
  await db
    .update(connectLinks)
    .set({ expiresAt })
    .where(eq(connectLinks.code, code));

  return toResolvedLink(row);
}

