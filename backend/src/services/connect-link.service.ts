import { and, eq, gt } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { connectLinks } from '../schemas/database.schema';

export type ConnectLinkKind = 'connect' | 'approve_introduction' | 'outreach';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 10;
const TTL_DAYS = 30;

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

/**
 * Resolve a short code to its row, only if the row hasn't expired.
 *
 * @param code - The 10-char base62 short code.
 * @returns The resolved link row, or `null` for unknown or expired codes.
 */
export async function resolveConnectLink(code: string): Promise<ResolvedLink | null> {
  const [row] = await db
    .select()
    .from(connectLinks)
    .where(and(eq(connectLinks.code, code), gt(connectLinks.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return {
    code: row.code,
    userId: row.userId,
    opportunityId: row.opportunityId,
    kind: row.kind as ConnectLinkKind,
    greeting: row.greeting,
    preferredSurface: row.preferredSurface as 'telegram' | 'web' | null,
  };
}

/**
 * Build a public URL for a short connect link.
 *
 * @param apiBaseUrl - The backend API base URL (trailing slashes are stripped).
 * @param code - The 10-char short code.
 * @returns A URL of the form `<apiBaseUrl>/c/<code>`.
 */
export function buildConnectLinkUrl(apiBaseUrl: string, code: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/c/${code}`;
}
