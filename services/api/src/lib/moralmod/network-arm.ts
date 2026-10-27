/**
 * Study scope by network membership: every member of the configured network
 * (edgecity-goa) is ON; everyone else passes through untouched. Membership is
 * cached briefly so a turn never adds a lookup storm.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Arm } from '@indexnetwork/moralmod';

import db from '../drizzle/drizzle';
import { networkMembers, networks } from '../../schemas/database.schema';
import { log } from '../log';

const logger = log.lib.from('moralmod');

const CACHE_TTL_MS = 60_000;
const memberCache = new Map<string, { arm: Arm | null; until: number }>();
let network: { id: string | null; until: number } = { id: null, until: 0 };

async function networkId(key: string): Promise<string | null> {
  if (network.until > Date.now()) return network.id;
  const [row] = await db.select({ id: networks.id })
    .from(networks)
    .where(and(eq(networks.key, key), isNull(networks.deletedAt)))
    .limit(1);
  network = { id: row?.id ?? null, until: Date.now() + CACHE_TTL_MS * 5 };
  if (!network.id) logger.warn('MoralMod network not found; every turn passes through', { key });
  return network.id;
}

/** @param key - The network key (e.g. `edgecity-goa`). @returns An arm resolver for the hook. */
export function networkArm(key: string): (userId: string) => Promise<Arm | null> {
  return async (userId: string) => {
    const cached = memberCache.get(userId);
    if (cached && cached.until > Date.now()) return cached.arm;
    const id = await networkId(key);
    let arm: Arm | null = null;
    if (id) {
      const [member] = await db.select({ userId: networkMembers.userId })
        .from(networkMembers)
        .where(and(eq(networkMembers.networkId, id), eq(networkMembers.userId, userId), isNull(networkMembers.deletedAt)))
        .limit(1);
      arm = member ? 'on' : null;
    }
    memberCache.set(userId, { arm, until: Date.now() + CACHE_TTL_MS });
    return arm;
  };
}

/** Drop cached memberships (tests). */
export function resetNetworkArmCache(): void {
  memberCache.clear();
  network = { id: null, until: 0 };
}
