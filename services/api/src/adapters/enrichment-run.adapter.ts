import { and, desc, eq, inArray } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { enrichmentToolRuns } from '../schemas/database.schema';

const DEFAULT_PROFILE_RUN_TTL_MS = 24 * 60 * 60 * 1000;

type EnrichmentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
// Canonical *_user_context operations (IND-371); legacy *_user_profile values
// retained so historical run rows still type-check.
type EnrichmentRunOperation =
  | 'preview_user_context'
  | 'update_user_context'
  | 'preview_user_profile'
  | 'update_user_profile';

type EnrichmentRunInput = {
  name?: string;
  location?: string;
  bioOrDescription?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  twitterUrl?: string;
  websites?: string[];
} | {
  profileId?: string;
  action?: string;
  details?: string;
  socials?: Record<string, string>;
};

interface EnrichmentRunContext {
  userId: string;
  userName: string;
  userEmail: string;
  scopeType?: 'network';
  scopeId?: string;
  indexName?: string;
  sessionId?: string;
  agentId?: string;
}

interface EnrichmentRunRecord {
  id: string;
  userId: string;
  agentId?: string | null;
  operation: EnrichmentRunOperation;
  status: EnrichmentRunStatus;
  input: EnrichmentRunInput;
  context: EnrichmentRunContext;
  progress?: Record<string, unknown> | null;
  result?: unknown;
  error?: string | null;
  cancelRequestedAt?: Date | null;
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  expiresAt?: Date | null;
}

interface CreateEnrichmentRunInput {
  userId: string;
  agentId?: string | null;
  operation: EnrichmentRunOperation;
  input: EnrichmentRunInput;
  context: EnrichmentRunContext;
  expiresAt?: Date;
}

interface EnrichmentRunStore {
  create(input: CreateEnrichmentRunInput): Promise<EnrichmentRunRecord>;
  get(runId: string, userId: string): Promise<EnrichmentRunRecord | null>;
  markRunning(runId: string): Promise<EnrichmentRunRecord | null>;
  updateProgress(runId: string, progress: Record<string, unknown>): Promise<void>;
  markSucceeded(runId: string, result: unknown): Promise<void>;
  markFailed(runId: string, error: string): Promise<void>;
  requestCancel(runId: string, userId: string): Promise<EnrichmentRunRecord | null>;
  markCancelled(runId: string, reason?: string): Promise<void>;
  isCancelRequested(runId: string): Promise<boolean>;
  listActive(userId: string, limit?: number): Promise<EnrichmentRunRecord[]>;
}

function mapRow(row: typeof enrichmentToolRuns.$inferSelect): EnrichmentRunRecord {
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    operation: row.operation as EnrichmentRunOperation,
    status: row.status as EnrichmentRunStatus,
    input: row.input as unknown as EnrichmentRunInput,
    context: row.context as unknown as EnrichmentRunContext,
    progress: row.progress,
    result: row.result,
    error: row.error,
    cancelRequestedAt: row.cancelRequestedAt,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
  };
}

export class EnrichmentRunAdapter implements EnrichmentRunStore {
  async create(input: CreateEnrichmentRunInput): Promise<EnrichmentRunRecord> {
    const expiresAt = input.expiresAt ?? new Date(Date.now() + DEFAULT_PROFILE_RUN_TTL_MS);
    const [row] = await db.insert(enrichmentToolRuns).values({
      userId: input.userId,
      agentId: input.agentId ?? null,
      operation: input.operation,
      input: input.input as unknown as Record<string, unknown>,
      context: input.context as unknown as Record<string, unknown>,
      status: 'queued',
      progress: { stage: 'queued' },
      expiresAt,
    }).returning();
    return mapRow(row);
  }

  async get(runId: string, userId: string): Promise<EnrichmentRunRecord | null> {
    const [row] = await db.select().from(enrichmentToolRuns).where(and(
      eq(enrichmentToolRuns.id, runId),
      eq(enrichmentToolRuns.userId, userId),
    )).limit(1);
    return row ? mapRow(row) : null;
  }

  async markRunning(runId: string): Promise<EnrichmentRunRecord | null> {
    const [row] = await db.update(enrichmentToolRuns).set({
      status: 'running',
      startedAt: new Date(),
      progress: { stage: 'running' },
    }).where(and(
      eq(enrichmentToolRuns.id, runId),
      inArray(enrichmentToolRuns.status, ['queued', 'running']),
    )).returning();
    return row ? mapRow(row) : null;
  }

  async updateProgress(runId: string, progress: Record<string, unknown>): Promise<void> {
    await db.update(enrichmentToolRuns).set({ progress }).where(eq(enrichmentToolRuns.id, runId));
  }

  async markSucceeded(runId: string, result: unknown): Promise<void> {
    await db.update(enrichmentToolRuns).set({
      status: 'succeeded',
      result,
      progress: { stage: 'succeeded' },
      completedAt: new Date(),
    }).where(eq(enrichmentToolRuns.id, runId));
  }

  async markFailed(runId: string, error: string): Promise<void> {
    await db.update(enrichmentToolRuns).set({
      status: 'failed',
      error,
      progress: { stage: 'failed' },
      completedAt: new Date(),
    }).where(eq(enrichmentToolRuns.id, runId));
  }

  async requestCancel(runId: string, userId: string): Promise<EnrichmentRunRecord | null> {
    const [row] = await db.update(enrichmentToolRuns).set({
      cancelRequestedAt: new Date(),
      progress: { stage: 'cancellation_requested' },
    }).where(and(
      eq(enrichmentToolRuns.id, runId),
      eq(enrichmentToolRuns.userId, userId),
      inArray(enrichmentToolRuns.status, ['queued', 'running']),
    )).returning();
    return row ? mapRow(row) : null;
  }

  async markCancelled(runId: string, reason?: string): Promise<void> {
    await db.update(enrichmentToolRuns).set({
      status: 'cancelled',
      error: reason ?? null,
      progress: { stage: 'cancelled' },
      completedAt: new Date(),
    }).where(eq(enrichmentToolRuns.id, runId));
  }

  async isCancelRequested(runId: string): Promise<boolean> {
    const [row] = await db.select({ cancelRequestedAt: enrichmentToolRuns.cancelRequestedAt, status: enrichmentToolRuns.status })
      .from(enrichmentToolRuns)
      .where(eq(enrichmentToolRuns.id, runId))
      .limit(1);
    return !!row?.cancelRequestedAt || row?.status === 'cancelled';
  }

  async listActive(userId: string, limit = 20): Promise<EnrichmentRunRecord[]> {
    const rows = await db.select().from(enrichmentToolRuns).where(and(
      eq(enrichmentToolRuns.userId, userId),
      inArray(enrichmentToolRuns.status, ['queued', 'running']),
    )).orderBy(desc(enrichmentToolRuns.createdAt)).limit(limit);
    return rows.map(mapRow);
  }
}

export const enrichmentRunAdapter = new EnrichmentRunAdapter();
