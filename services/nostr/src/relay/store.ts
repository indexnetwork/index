/**
 * SQLite event store with NIP-01 replaceable/addressable semantics, NIP-09
 * deletion and NIP-40 expiry. One file, one writer: enough for a preview and
 * for a single-node relay. A production relay would put this behind Postgres.
 */
import { Database } from 'bun:sqlite';
import { KIND, tagValue, unixNow } from '@indexnetwork/nostr';
import type { Filter } from 'nostr-tools/filter';
import type { NostrEvent } from 'nostr-tools/pure';

export const MAX_LIMIT = 500;

export type SaveResult = { stored: true } | { stored: false; reason: 'duplicate' | 'replaced' | 'ephemeral' | 'deleted' };

export const isReplaceable = (kind: number) => kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
export const isEphemeral = (kind: number) => kind >= 20000 && kind < 30000;
export const isAddressable = (kind: number) => kind >= 30000 && kind < 40000;

export class EventStore {
  readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        kind INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL,
        sig TEXT NOT NULL,
        d_tag TEXT,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS events_kind_time ON events (kind, created_at DESC);
      CREATE INDEX IF NOT EXISTS events_author_time ON events (pubkey, created_at DESC);
      CREATE TABLE IF NOT EXISTS event_tags (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS event_tags_lookup ON event_tags (name, value);
      CREATE INDEX IF NOT EXISTS event_tags_event ON event_tags (event_id);
      CREATE TABLE IF NOT EXISTS deletions (
        target TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        until INTEGER NOT NULL
      );
    `);
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  /** Store an event, applying replacement and deletion rules. */
  save(event: NostrEvent): SaveResult {
    if (isEphemeral(event.kind)) return { stored: false, reason: 'ephemeral' };
    if (this.db.query('SELECT 1 FROM events WHERE id = ?').get(event.id)) return { stored: false, reason: 'duplicate' };
    if (this.isDeleted(event)) return { stored: false, reason: 'deleted' };
    const dTag = isAddressable(event.kind) ? (tagValue(event, 'd') ?? '') : null;
    const insert = this.db.transaction(() => {
      if (isReplaceable(event.kind) || isAddressable(event.kind)) {
        const existing = this.db.query<{ id: string; created_at: number }, [string, number, string | null]>(
          'SELECT id, created_at FROM events WHERE pubkey = ? AND kind = ? AND d_tag IS ?',
        ).all(event.pubkey, event.kind, dTag);
        for (const row of existing) {
          if (row.created_at > event.created_at || (row.created_at === event.created_at && row.id < event.id)) return false;
        }
        for (const row of existing) this.db.query('DELETE FROM events WHERE id = ?').run(row.id);
      }
      const expiration = tagValue(event, 'expiration');
      this.db.query('INSERT INTO events (id, pubkey, kind, created_at, content, tags, sig, d_tag, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(event.id, event.pubkey, event.kind, event.created_at, event.content, JSON.stringify(event.tags), event.sig, dTag,
          expiration && /^[0-9]+$/.test(expiration) ? Number(expiration) : null);
      const tagInsert = this.db.query('INSERT INTO event_tags (event_id, name, value) VALUES (?, ?, ?)');
      for (const tag of event.tags) {
        if (tag[0] && tag[0].length === 1 && typeof tag[1] === 'string') tagInsert.run(event.id, tag[0], tag[1]);
      }
      if (event.kind === KIND.DELETION) this.applyDeletion(event);
      return true;
    });
    return insert() ? { stored: true } : { stored: false, reason: 'replaced' };
  }

  private isDeleted(event: NostrEvent): boolean {
    const byId = this.db.query<{ pubkey: string }, [string]>('SELECT pubkey FROM deletions WHERE target = ?').get(event.id);
    if (byId && byId.pubkey === event.pubkey) return true;
    if (isAddressable(event.kind)) {
      const address = `${event.kind}:${event.pubkey}:${tagValue(event, 'd') ?? ''}`;
      const byAddress = this.db.query<{ until: number }, [string]>('SELECT until FROM deletions WHERE target = ?').get(address);
      if (byAddress && byAddress.until >= event.created_at) return true;
    }
    return false;
  }

  /** NIP-09: an author may delete their own events by id (`e`) or address (`a`). */
  private applyDeletion(deletion: NostrEvent): void {
    for (const tag of deletion.tags) {
      if (tag[0] === 'e' && tag[1]) {
        this.db.query('INSERT OR REPLACE INTO deletions (target, pubkey, until) VALUES (?, ?, ?)').run(tag[1], deletion.pubkey, deletion.created_at);
        this.db.query('DELETE FROM events WHERE id = ? AND pubkey = ? AND kind != ?').run(tag[1], deletion.pubkey, KIND.DELETION);
      } else if (tag[0] === 'a' && tag[1]) {
        const [kind, pubkey, d] = tag[1].split(':');
        if (pubkey !== deletion.pubkey || !kind) continue;
        this.db.query('INSERT OR REPLACE INTO deletions (target, pubkey, until) VALUES (?, ?, ?)').run(tag[1], deletion.pubkey, deletion.created_at);
        this.db.query('DELETE FROM events WHERE kind = ? AND pubkey = ? AND d_tag IS ? AND created_at <= ?').run(Number(kind), pubkey, d ?? '', deletion.created_at);
      }
    }
  }

  /** Events matching one NIP-01 filter, newest first. Expired events are left out. */
  query(filter: Filter): NostrEvent[] {
    const where: string[] = ['(expires_at IS NULL OR expires_at > ?)'];
    const params: (string | number)[] = [unixNow()];
    const list = (column: string, values: (string | number)[]) => {
      where.push(`${column} IN (${values.map(() => '?').join(',')})`);
      params.push(...values);
    };
    if (filter.ids) { if (filter.ids.length === 0) return []; list('id', filter.ids); }
    if (filter.authors) { if (filter.authors.length === 0) return []; list('pubkey', filter.authors); }
    if (filter.kinds) { if (filter.kinds.length === 0) return []; list('kind', filter.kinds); }
    if (filter.since !== undefined) { where.push('created_at >= ?'); params.push(filter.since); }
    if (filter.until !== undefined) { where.push('created_at <= ?'); params.push(filter.until); }
    for (const [key, values] of Object.entries(filter)) {
      if (!key.startsWith('#') || key.length !== 2 || !Array.isArray(values)) continue;
      if (values.length === 0) return [];
      where.push(`id IN (SELECT event_id FROM event_tags WHERE name = ? AND value IN (${values.map(() => '?').join(',')}))`);
      params.push(key.slice(1), ...(values as string[]));
    }
    const limit = Math.min(filter.limit ?? MAX_LIMIT, MAX_LIMIT);
    const rows = this.db.query<{ id: string; pubkey: string; kind: number; created_at: number; content: string; tags: string; sig: string }, (string | number)[]>(
      `SELECT id, pubkey, kind, created_at, content, tags, sig FROM events WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id ASC LIMIT ${limit}`,
    ).all(...params);
    return rows.map((row) => ({ ...row, tags: JSON.parse(row.tags) as string[][] }));
  }

  close(): void {
    this.db.close();
  }
}
