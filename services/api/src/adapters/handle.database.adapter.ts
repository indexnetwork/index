import { and, db, eq, isNull, logger, networks, users } from './database.shared';
import { generateUniqueKey, isUUID, validateKey } from '../lib/keys';

/** Who holds a handle at the root of the web app: a person or a network. */
export type HandleHolder =
  | { kind: 'user'; id: string }
  | { kind: 'network'; id: string; title: string; imageUrl: string | null; joinPolicy: 'anyone' | 'invite_only' };

/** Whose handle is being set, so keeping your own handle is not "taken". */
export type HandleOwner = { kind: 'user' | 'network'; id: string };

export type HandleCheck =
  | { kind: 'ok'; handle: string | null }
  | { kind: 'invalid'; error: string }
  | { kind: 'taken' };

/** Postgres unique-violation: a claim that raced another to the same handle. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/** Lowercase, trimmed, without a leading `@`; null when empty. */
export function normalizeHandle(raw: string | null | undefined): string | null {
  return raw?.trim().toLowerCase().replace(/^@/, '') || null;
}

/**
 * Usernames (`users.key`) and network keys (`networks.key`) share one
 * namespace, `index.network/<handle>`. Each table's unique index only covers
 * itself, so this is where the two are read together.
 */
export class HandleDatabaseAdapter {
  /**
   * The person or network holding a handle.
   *
   * @param handle - Lowercased handle.
   * @param options - `includeDeleted` counts deleted accounts and networks as
   *   holders, as their unique index still does.
   * @returns The holder, or null when the handle is free.
   */
  async findHolder(handle: string, options: { includeDeleted?: boolean } = {}): Promise<HandleHolder | null> {
    const [user] = await db.select({ id: users.id })
      .from(users)
      .where(options.includeDeleted ? eq(users.username, handle) : and(eq(users.username, handle), isNull(users.deletedAt)))
      .limit(1);
    if (user) return { kind: 'user', id: user.id };

    const [network] = await db.select({ id: networks.id, title: networks.title, imageUrl: networks.imageUrl, permissions: networks.permissions })
      .from(networks)
      .where(options.includeDeleted ? eq(networks.key, handle) : and(eq(networks.key, handle), isNull(networks.deletedAt)))
      .limit(1);
    if (network) {
      return {
        kind: 'network',
        id: network.id,
        title: network.title,
        imageUrl: network.imageUrl,
        joinPolicy: network.permissions?.joinPolicy === 'anyone' ? 'anyone' : 'invite_only',
      };
    }
    return null;
  }

  /**
   * Set a network's key, but only where it has none, so a backfill or a
   * creation retry never overwrites one an owner chose.
   *
   * @returns Whether the key was written.
   */
  async setNetworkKeyIfUnset(networkId: string, key: string): Promise<boolean> {
    const rows = await db.update(networks)
      .set({ key })
      .where(and(eq(networks.id, networkId), isNull(networks.key)))
      .returning({ id: networks.id });
    return rows.length > 0;
  }

  /** Set (or clear) a network's key. */
  async setNetworkKey(networkId: string, key: string | null): Promise<void> {
    await db.update(networks).set({ key, updatedAt: new Date() }).where(eq(networks.id, networkId));
  }
  /**
   * Normalize and check a handle someone wants.
   *
   * @param raw - Requested handle; empty or null means clear it.
   * @param owner - Who is claiming it.
   * @param noun - What the handle is called in error messages.
   * @returns The normalized handle, or why it can't be had.
   */
  async check(raw: string | null, owner: HandleOwner, noun: string): Promise<HandleCheck> {
    const handle = normalizeHandle(raw);
    if (!handle) return { kind: 'ok', handle: null };
    const valid = validateKey(handle, noun);
    if (!valid.valid) return { kind: 'invalid', error: valid.error ?? `Invalid ${noun.toLowerCase()}` };
    // The root reads a UUID as an id, so a UUID-shaped handle would be unreachable.
    if (isUUID(handle)) return { kind: 'invalid', error: `${noun} cannot look like an id` };
    const holder = await this.findHolder(handle, { includeDeleted: true });
    if (holder && !(holder.kind === owner.kind && holder.id === owner.id)) return { kind: 'taken' };
    return { kind: 'ok', handle };
  }
  /**
   * Set or clear a network's key, checked against usernames too.
   *
   * @param networkId - The network; the caller has already checked ownership.
   * @param raw - Requested key; empty or null clears it.
   */
  async claimNetworkKey(networkId: string, raw: string | null): Promise<HandleCheck> {
    const checked = await this.check(raw, { kind: 'network', id: networkId }, 'Link name');
    if (checked.kind !== 'ok') return checked;
    try {
      await this.setNetworkKey(networkId, checked.handle);
    } catch (error) {
      if (isUniqueViolation(error)) return { kind: 'taken' };
      throw error;
    }
    return checked;
  }
  /**
   * Give a network without a key one made from its title (`Index Early Birds`
   * becomes `index-early-birds`, then `-2`, `-3` when taken). Best effort: a
   * network can live without a key, so failures are logged, not thrown.
   *
   * @param networkId - The network.
   * @param title - Its title.
   * @returns The key it now has, or null.
   */
  async assignNetworkKey(networkId: string, title: string): Promise<string | null> {
    // Too-short titles ("AI") still deserve a link.
    const seed = title.trim().length >= 3 ? title : `${title} network`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const key = await generateUniqueKey(seed, async (candidate) => !!(await this.findHolder(candidate, { includeDeleted: true })));
        if (!key || isUUID(key)) return null;
        return (await this.setNetworkKeyIfUnset(networkId, key)) ? key : null;
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        logger.error('[HandleDatabaseAdapter] Failed to assign network key', { networkId, error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    }
    return null;
  }

}

export const handleDatabaseAdapter = new HandleDatabaseAdapter();
