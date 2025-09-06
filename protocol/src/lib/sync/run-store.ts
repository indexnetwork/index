/**
 * Run Store
 *
 * Responsibility: persist SyncRun state (id, status, progress, stats) so
 * HTTP clients and the CLI can query progress and survive restarts.
 *
 * Modes:
 * - DB-backed (default): uses run-store.db.ts (Drizzle) when SYNC_USE_DB_STORE != '0'
 * - In-memory fallback: useful in local dev or tests
 */
import { SyncRun } from './types';
import crypto from 'crypto';

function id(): string {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

class InMemoryRunStore {
  private runs = new Map<string, SyncRun>();

  async create(initial: Omit<SyncRun, 'id' | 'createdAt' | 'status'> & Partial<Pick<SyncRun, 'status'>>): Promise<SyncRun> {
    const run: SyncRun = {
      id: id(),
      createdAt: Date.now(),
      status: initial.status ?? 'queued',
      ...initial,
    } as SyncRun;
    this.runs.set(run.id, run);
    return run;
  }

  async update(runId: string, patch: Partial<SyncRun>): Promise<SyncRun | null> {
    const curr = this.runs.get(runId);
    if (!curr) return null;
    const next = { ...curr, ...patch } as SyncRun;
    this.runs.set(runId, next);
    return next;
  }

  async get(runId: string): Promise<SyncRun | null> {
    return this.runs.get(runId) ?? null;
  }
}

let store: any;
try {
  // Default to DB store unless explicitly disabled
  if (process.env.SYNC_USE_DB_STORE !== '0') {
    const { DBRunStore } = require('./run-store.db');
    store = new DBRunStore();
  }
} catch {
  // fall back to memory
}
export const runStore = store || new InMemoryRunStore();
