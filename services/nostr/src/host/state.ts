/** The host's own tables, next to the relay's in the same SQLite file. */
import type { Database } from 'bun:sqlite';
import type { NostrEvent } from 'nostr-tools/pure';

export interface StoredOpportunity {
  id: string;
  negotiationId: string;
  networkId: string;
  parties: [string, string];
  status: 'pending' | 'declined' | 'connected';
  createdAt: number;
}

export class HostState {
  constructor(private readonly db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS host_intents (
        address TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        wrapped INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS host_negotiations (
        id TEXT PRIMARY KEY,
        pair TEXT NOT NULL UNIQUE,
        open_event TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS host_turns (
        negotiation_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        event TEXT NOT NULL,
        PRIMARY KEY (negotiation_id, idx)
      );
      CREATE TABLE IF NOT EXISTS host_opportunities (
        id TEXT PRIMARY KEY,
        negotiation_id TEXT NOT NULL UNIQUE,
        network_id TEXT NOT NULL,
        party_a TEXT NOT NULL,
        party_b TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS host_responses (
        opportunity_id TEXT NOT NULL,
        person TEXT NOT NULL,
        decision TEXT NOT NULL,
        event TEXT NOT NULL,
        PRIMARY KEY (opportunity_id, person)
      );
      CREATE TABLE IF NOT EXISTS host_seen_wraps (
        id TEXT PRIMARY KEY
      );
    `);
  }

  /** @returns False when this wrap was already processed. */
  markWrapSeen(id: string): boolean {
    return this.db.query('INSERT OR IGNORE INTO host_seen_wraps (id) VALUES (?)').run(id).changes > 0;
  }

  upsertIntent(address: string, event: NostrEvent, wrapped: boolean): void {
    this.db.query('INSERT INTO host_intents (address, event, wrapped, active) VALUES (?, ?, ?, 1) ON CONFLICT (address) DO UPDATE SET event = excluded.event, wrapped = excluded.wrapped, active = 1')
      .run(address, JSON.stringify(event), wrapped ? 1 : 0);
  }

  deactivateIntent(address: string): void {
    this.db.query('UPDATE host_intents SET active = 0 WHERE address = ?').run(address);
  }

  activeIntents(): { event: NostrEvent; wrapped: boolean }[] {
    return this.db.query<{ event: string; wrapped: number }, []>('SELECT event, wrapped FROM host_intents WHERE active = 1').all()
      .map((row) => ({ event: JSON.parse(row.event) as NostrEvent, wrapped: row.wrapped === 1 }));
  }

  isIntentActive(address: string): boolean {
    return Boolean(this.db.query('SELECT 1 FROM host_intents WHERE address = ? AND active = 1').get(address));
  }

  hasNegotiation(pair: string): boolean {
    return Boolean(this.db.query('SELECT 1 FROM host_negotiations WHERE pair = ?').get(pair));
  }

  saveNegotiation(id: string, pair: string, openEvent: NostrEvent): void {
    this.db.query('INSERT INTO host_negotiations (id, pair, open_event, created_at) VALUES (?, ?, ?, ?)').run(id, pair, JSON.stringify(openEvent), openEvent.created_at);
  }

  negotiations(): { id: string; openEvent: NostrEvent; turns: NostrEvent[] }[] {
    return this.db.query<{ id: string; open_event: string }, []>('SELECT id, open_event FROM host_negotiations ORDER BY created_at').all().map((row) => ({
      id: row.id,
      openEvent: JSON.parse(row.open_event) as NostrEvent,
      turns: this.db.query<{ event: string }, [string]>('SELECT event FROM host_turns WHERE negotiation_id = ? ORDER BY idx').all(row.id).map((turn) => JSON.parse(turn.event) as NostrEvent),
    }));
  }

  saveTurn(negotiationId: string, index: number, event: NostrEvent): void {
    this.db.query('INSERT OR IGNORE INTO host_turns (negotiation_id, idx, event) VALUES (?, ?, ?)').run(negotiationId, index, JSON.stringify(event));
  }

  saveOpportunity(opportunity: StoredOpportunity): void {
    this.db.query('INSERT INTO host_opportunities (id, negotiation_id, network_id, party_a, party_b, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(opportunity.id, opportunity.negotiationId, opportunity.networkId, opportunity.parties[0], opportunity.parties[1], opportunity.status, opportunity.createdAt);
  }

  opportunity(id: string): StoredOpportunity | null {
    const row = this.db.query<{ id: string; negotiation_id: string; network_id: string; party_a: string; party_b: string; status: StoredOpportunity['status']; created_at: number }, [string]>(
      'SELECT * FROM host_opportunities WHERE id = ?',
    ).get(id);
    return row ? { id: row.id, negotiationId: row.negotiation_id, networkId: row.network_id, parties: [row.party_a, row.party_b], status: row.status, createdAt: row.created_at } : null;
  }

  setOpportunityStatus(id: string, status: StoredOpportunity['status']): void {
    this.db.query('UPDATE host_opportunities SET status = ? WHERE id = ?').run(status, id);
  }

  saveResponse(opportunityId: string, person: string, decision: string, event: NostrEvent): void {
    this.db.query('INSERT OR REPLACE INTO host_responses (opportunity_id, person, decision, event) VALUES (?, ?, ?, ?)').run(opportunityId, person, decision, JSON.stringify(event));
  }

  responses(opportunityId: string): Map<string, string> {
    const rows = this.db.query<{ person: string; decision: string }, [string]>('SELECT person, decision FROM host_responses WHERE opportunity_id = ?').all(opportunityId);
    return new Map(rows.map((row) => [row.person, row.decision]));
  }

  counts(): Record<string, number> {
    const count = (table: string) => (this.db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0);
    return {
      intents: count('host_intents'),
      negotiations: count('host_negotiations'),
      turns: count('host_turns'),
      opportunities: count('host_opportunities'),
      connected: this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM host_opportunities WHERE status = 'connected'").get()?.n ?? 0,
    };
  }
}
