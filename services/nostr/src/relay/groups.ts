/**
 * NIP-29 group state for Index networks.
 *
 * The relay is the authority: it applies membership requests and publishes
 * relay-signed state (39000 metadata, 39001 admins, 39002 members). Who may
 * read a network's intents is decided here.
 */
import type { Database } from 'bun:sqlite';
import { KIND, tagValue, tagValues, unixNow, type JoinPolicy, type Keypair } from '@indexnetwork/nostr';
import { finalizeEvent, type NostrEvent } from 'nostr-tools/pure';

const GROUP_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export interface Group {
  id: string;
  name: string;
  about: string;
  joinPolicy: JoinPolicy;
  createdBy: string;
  createdAt: number;
}

export type GroupResult = { ok: true; emitted: NostrEvent[] } | { ok: false; reason: string };

export class Groups {
  /** Last state timestamp per group, so successive replaceable state events always supersede each other. */
  private readonly stamps = new Map<string, number>();

  constructor(private readonly db: Database, private readonly relayKey: Keypair) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        about TEXT NOT NULL DEFAULT '',
        join_policy TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        pubkey TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        PRIMARY KEY (group_id, pubkey)
      );
    `);
  }

  get(id: string): Group | null {
    const row = this.db.query<{ id: string; name: string; about: string; join_policy: JoinPolicy; created_by: string; created_at: number }, [string]>(
      'SELECT * FROM groups WHERE id = ?',
    ).get(id);
    return row ? { id: row.id, name: row.name, about: row.about, joinPolicy: row.join_policy, createdBy: row.created_by, createdAt: row.created_at } : null;
  }

  list(): Group[] {
    return this.db.query<{ id: string }, []>('SELECT id FROM groups ORDER BY created_at').all().map((row) => this.get(row.id)!);
  }

  members(id: string): string[] {
    return this.db.query<{ pubkey: string }, [string]>('SELECT pubkey FROM group_members WHERE group_id = ? ORDER BY pubkey').all(id).map((row) => row.pubkey);
  }

  isMember(id: string, pubkey: string): boolean {
    return Boolean(this.db.query('SELECT 1 FROM group_members WHERE group_id = ? AND pubkey = ?').get(id, pubkey));
  }

  isAdmin(id: string, pubkey: string): boolean {
    return Boolean(this.db.query("SELECT 1 FROM group_members WHERE group_id = ? AND pubkey = ? AND role = 'admin'").get(id, pubkey));
  }

  /** Networks a person belongs to. */
  groupsOf(pubkey: string): string[] {
    return this.db.query<{ group_id: string }, [string]>('SELECT group_id FROM group_members WHERE pubkey = ?').all(pubkey).map((row) => row.group_id);
  }

  /**
   * Apply a NIP-29 moderation or membership event from `actor` (the
   * authenticated principal). Returns the relay-signed state to publish.
   */
  apply(event: NostrEvent, actor: string): GroupResult {
    const id = tagValue(event, 'h');
    if (!id || !GROUP_ID.test(id)) return { ok: false, reason: 'invalid: missing or malformed h tag' };
    switch (event.kind) {
      case KIND.GROUP_CREATE: {
        if (this.get(id)) return { ok: false, reason: 'duplicate: this network already exists' };
        const name = tagValue(event, 'name')?.trim();
        if (!name) return { ok: false, reason: 'invalid: a network needs a name tag' };
        const closed = event.tags.some((tag) => tag[0] === 'closed') || tagValue(event, 'visibility') === 'private';
        this.create({ id, name, about: tagValue(event, 'about') ?? '', joinPolicy: closed ? 'invite_only' : 'anyone', createdBy: actor, createdAt: event.created_at });
        // Like Buzz, a create may name its first members.
        for (const member of tagValues(event, 'p')) if (member !== actor) this.put(id, member, 'member');
        return { ok: true, emitted: this.state(id, true) };
      }
      case KIND.GROUP_JOIN_REQUEST: {
        const group = this.get(id);
        if (!group) return { ok: false, reason: 'invalid: no such network' };
        if (this.isMember(id, actor)) return { ok: false, reason: 'duplicate: already a member' };
        if (group.joinPolicy === 'invite_only') return { ok: false, reason: 'restricted: this network is invite-only' };
        this.put(id, actor, 'member');
        return { ok: true, emitted: this.state(id) };
      }
      case KIND.GROUP_LEAVE_REQUEST: {
        if (!this.isMember(id, actor)) return { ok: false, reason: 'invalid: not a member' };
        this.remove(id, actor);
        return { ok: true, emitted: this.state(id) };
      }
      case KIND.GROUP_PUT_USER:
      case KIND.GROUP_REMOVE_USER: {
        if (!this.get(id)) return { ok: false, reason: 'invalid: no such network' };
        if (!this.isAdmin(id, actor)) return { ok: false, reason: 'restricted: only network admins can change members' };
        const targets = tagValues(event, 'p');
        if (targets.length === 0) return { ok: false, reason: 'invalid: name at least one member with a p tag' };
        for (const target of targets) {
          if (event.kind === KIND.GROUP_PUT_USER) this.put(id, target, 'member');
          else if (target !== actor) this.remove(id, target);
        }
        return { ok: true, emitted: this.state(id) };
      }
      default:
        return { ok: false, reason: 'invalid: not a group event' };
    }
  }

  create(group: Group): void {
    this.db.query('INSERT INTO groups (id, name, about, join_policy, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(group.id, group.name, group.about, group.joinPolicy, group.createdBy, group.createdAt);
    this.put(group.id, group.createdBy, 'admin');
  }

  private put(id: string, pubkey: string, role: 'member' | 'admin'): void {
    this.db.query('INSERT INTO group_members (group_id, pubkey, role) VALUES (?, ?, ?) ON CONFLICT (group_id, pubkey) DO UPDATE SET role = CASE WHEN group_members.role = \'admin\' THEN \'admin\' ELSE excluded.role END')
      .run(id, pubkey, role);
  }

  private remove(id: string, pubkey: string): void {
    this.db.query('DELETE FROM group_members WHERE group_id = ? AND pubkey = ?').run(id, pubkey);
  }

  /**
   * Replace a network's members with `members` (the Buzz bridge uses this to
   * mirror a community). Admins stay. Creates the network if missing.
   */
  sync(id: string, members: string[], meta: { name: string; about?: string; createdBy: string }): { changed: boolean; emitted: NostrEvent[] } {
    let created = false;
    if (!this.get(id)) {
      this.create({ id, name: meta.name, about: meta.about ?? '', joinPolicy: 'invite_only', createdBy: meta.createdBy, createdAt: unixNow() });
      created = true;
    }
    const wanted = new Set(members);
    const current = new Set(this.members(id));
    let changed = created;
    for (const pubkey of wanted) if (!current.has(pubkey)) { this.put(id, pubkey, 'member'); changed = true; }
    for (const pubkey of current) if (!wanted.has(pubkey) && !this.isAdmin(id, pubkey)) { this.remove(id, pubkey); changed = true; }
    return { changed, emitted: changed ? this.state(id, created) : [] };
  }

  /** Relay-signed group state. Metadata and admins only on creation; members always. */
  state(id: string, full = false): NostrEvent[] {
    const group = this.get(id);
    if (!group) return [];
    const now = Math.max(unixNow(), (this.stamps.get(id) ?? 0) + 1);
    this.stamps.set(id, now);
    const sign = (kind: number, tags: string[][]) => finalizeEvent({ kind, created_at: now, tags: [['d', id], ...tags], content: '' }, this.relayKey.secretKey);
    const events: NostrEvent[] = [];
    if (full) {
      const metaTags: string[][] = [['name', group.name]];
      if (group.about) metaTags.push(['about', group.about]);
      metaTags.push(group.joinPolicy === 'invite_only' ? ['closed'] : ['open'], ['public']);
      events.push(sign(KIND.GROUP_METADATA, metaTags));
      const admins = this.db.query<{ pubkey: string }, [string]>("SELECT pubkey FROM group_members WHERE group_id = ? AND role = 'admin'").all(id);
      events.push(sign(KIND.GROUP_ADMINS, admins.map((row) => ['p', row.pubkey, 'admin'])));
    }
    events.push(sign(KIND.GROUP_MEMBERS, this.members(id).map((pubkey) => ['p', pubkey])));
    return events;
  }
}
