import db from '../db';
import { syncRuns } from '../schema';
import { eq } from 'drizzle-orm';
import type { SyncRun as ModelSyncRun } from '../schema';
import type { SyncRun } from './types';

function mapToSyncRun(m: ModelSyncRun): SyncRun {
  return {
    id: m.id,
    userId: m.userId,
    provider: m.provider as any,
    status: (m.status as any),
    createdAt: m.createdAt?.getTime?.() || Date.now(),
    startedAt: m.startedAt?.getTime?.(),
    finishedAt: m.finishedAt?.getTime?.(),
    params: (m as any).params || {},
    progress: (m as any).progress || undefined,
    stats: (m as any).stats || undefined,
    error: (m as any).error || null,
  };
}

export class DBRunStore {
  async create(initial: Omit<SyncRun, 'id' | 'createdAt' | 'status'> & Partial<Pick<SyncRun, 'status'>>): Promise<SyncRun> {
    const rows = await db.insert(syncRuns).values({
      userId: initial.userId,
      provider: initial.provider,
      status: initial.status ?? 'queued',
      params: initial.params || {},
      progress: initial.progress || null,
      stats: initial.stats || null,
      error: initial.error || null,
    }).returning();
    return mapToSyncRun(rows[0]);
  }

  async update(runId: string, patch: Partial<SyncRun>): Promise<SyncRun | null> {
    const current = await this.get(runId);
    if (!current) return null;
    const next: Partial<ModelSyncRun> = {
      status: (patch.status as any) ?? (current.status as any),
      startedAt: patch.startedAt ? new Date(patch.startedAt) : (current.startedAt ? new Date(current.startedAt) : null) as any,
      finishedAt: patch.finishedAt ? new Date(patch.finishedAt) : (current.finishedAt ? new Date(current.finishedAt) : null) as any,
      error: patch.error ?? current.error ?? null,
      params: patch.params ? { ...(current.params || {}), ...patch.params } : current.params || {},
      progress: patch.progress ? { ...(current.progress || {}), ...patch.progress } : (current.progress || null) as any,
      stats: patch.stats ? { ...(current.stats || {}), ...patch.stats } : (current.stats || null) as any,
    } as any;
    const rows = await db.update(syncRuns).set(next).where(eq(syncRuns.id, runId)).returning();
    return rows.length ? mapToSyncRun(rows[0]) : null;
  }

  async get(runId: string): Promise<SyncRun | null> {
    const rows = await db.select().from(syncRuns).where(eq(syncRuns.id, runId)).limit(1);
    if (!rows.length) return null;
    return mapToSyncRun(rows[0]);
  }
}

