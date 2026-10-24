import { and, eq, isNull, sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { networkMembers, networks } from '../schemas/database.schema';

/** What GET /auth/me reports while a member still owes a flagged network. */
export interface PendingConsent {
  networkId: string;
  networkTitle: string;
  version: string;
}

const ACTIVE_ROLE = sql`${networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`;

/**
 * Memberships of networks flagged with `metadata.consent.version` whose
 * recorded participation version is missing or different. Bumping the
 * network's version re-prompts everyone.
 */
async function pending(userId: string): Promise<PendingConsent[]> {
  const rows = await db
    .select({
      networkId: networks.id,
      networkTitle: networks.title,
      version: sql<string>`${networks.metadata}->'consent'->>'version'`,
    })
    .from(networkMembers)
    .innerJoin(networks, eq(networkMembers.networkId, networks.id))
    .where(and(
      eq(networkMembers.userId, userId),
      isNull(networkMembers.deletedAt),
      isNull(networks.deletedAt),
      ACTIVE_ROLE,
      sql`${networks.metadata}->'consent'->>'version' is not null`,
      sql`coalesce(${networkMembers.metadata}->'consent'->'participation'->>'version', '') is distinct from ${networks.metadata}->'consent'->>'version'`,
    ));

  return rows.map((row) => ({
    networkId: row.networkId,
    networkTitle: row.networkTitle,
    version: row.version,
  }));
}

/**
 * Records privacy-policy and participation consent on the membership row.
 * Both are written together; the typed signature is the participation signature.
 */
async function record(
  userId: string,
  networkId: string,
  signature: string,
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  const name = signature.trim();
  if (!name) throw new Error('A signature is required');

  const [row] = await db
    .select({
      metadata: networkMembers.metadata,
      version: sql<string | null>`${networks.metadata}->'consent'->>'version'`,
    })
    .from(networkMembers)
    .innerJoin(networks, eq(networkMembers.networkId, networks.id))
    .where(and(
      eq(networkMembers.userId, userId),
      eq(networkMembers.networkId, networkId),
      isNull(networkMembers.deletedAt),
      isNull(networks.deletedAt),
      ACTIVE_ROLE,
    ))
    .limit(1);

  if (!row) throw new Error('Not a member of this network');
  if (!row.version) throw new Error('Consent is not required for this network');

  const at = new Date().toISOString();
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  await db
    .update(networkMembers)
    .set({
      metadata: {
        ...metadata,
        consent: {
          privacyPolicyAt: at,
          participation: {
            version: row.version,
            signature: name,
            at,
            ip,
            userAgent,
          },
        },
      },
      updatedAt: new Date(),
    })
    .where(and(eq(networkMembers.userId, userId), eq(networkMembers.networkId, networkId)));
}

export const consentService = { pending, record };
