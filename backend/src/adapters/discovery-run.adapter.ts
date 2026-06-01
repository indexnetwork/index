import { and, desc, eq, inArray } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { opportunityDiscoveryRuns } from '../schemas/database.schema';

const DEFAULT_DISCOVERY_RUN_TTL_MS = 24 * 60 * 60 * 1000;

type DiscoveryRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface DiscoveryRunInput {
  continueFrom?: string;
  searchQuery?: string;
  networkId?: string;
  intentId?: string;
  targetUserId?: string;
  introTargetUserId?: string;
  partyUserIds?: string[];
  entities?: Array<{
    userId: string;
    profile?: {
      name?: string;
      bio?: string;
      location?: string;
      interests?: string[];
      skills?: string[];
      context?: string;
    };
    intents?: Array<{
      intentId: string;
      payload: string;
      summary?: string;
    }>;
    networkId: string;
  }>;
  hint?: string;
}

interface DiscoveryRunContext {
  userId: string;
  userName: string;
  userEmail: string;
  networkId?: string;
  indexName?: string;
  indexScope: string[];
  sessionId?: string;
  agentId?: string;
  clientSurface?: 'telegram' | 'web';
}

interface DiscoveryRunRecord {
  id: string;
  userId: string;
  agentId?: string | null;
  status: DiscoveryRunStatus;
  input: DiscoveryRunInput;
  context: DiscoveryRunContext;
  progress?: Record<string, unknown> | null;
  result?: unknown;
  error?: string | null;
  cancelRequestedAt?: Date | null;
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  expiresAt?: Date | null;
}

interface CreateDiscoveryRunInput {
  userId: string;
  agentId?: string | null;
  input: DiscoveryRunInput;
  context: DiscoveryRunContext;
  expiresAt?: Date;
}

interface DiscoveryRunStore {
  create(input: CreateDiscoveryRunInput): Promise<DiscoveryRunRecord>;
  get(runId: string, userId: string): Promise<DiscoveryRunRecord | null>;
  markRunning(runId: string): Promise<DiscoveryRunRecord | null>;
  updateProgress(runId: string, progress: Record<string, unknown>): Promise<void>;
  markSucceeded(runId: string, result: unknown): Promise<void>;
  markFailed(runId: string, error: string): Promise<void>;
  requestCancel(runId: string, userId: string): Promise<DiscoveryRunRecord | null>;
  markCancelled(runId: string, reason?: string): Promise<void>;
  isCancelRequested(runId: string): Promise<boolean>;
  listActive(userId: string, limit?: number): Promise<DiscoveryRunRecord[]>;
}

function mapRow(row: typeof opportunityDiscoveryRuns.$inferSelect): DiscoveryRunRecord {
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    status: row.status as DiscoveryRunStatus,
    input: row.input as unknown as DiscoveryRunRecord['input'],
    context: row.context as unknown as DiscoveryRunRecord['context'],
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

export class DiscoveryRunAdapter implements DiscoveryRunStore {
  async create(input: CreateDiscoveryRunInput): Promise<DiscoveryRunRecord> {
    const expiresAt = input.expiresAt ?? new Date(Date.now() + DEFAULT_DISCOVERY_RUN_TTL_MS);
    const [row] = await db.insert(opportunityDiscoveryRuns).values({
      userId: input.userId,
      agentId: input.agentId ?? null,
      input: input.input as unknown as Record<string, unknown>,
      context: input.context as unknown as Record<string, unknown>,
      status: 'queued',
      progress: { stage: 'queued' },
      expiresAt,
    }).returning();
    return mapRow(row);
  }

  async get(runId: string, userId: string): Promise<DiscoveryRunRecord | null> {
    const [row] = await db.select().from(opportunityDiscoveryRuns).where(and(
      eq(opportunityDiscoveryRuns.id, runId),
      eq(opportunityDiscoveryRuns.userId, userId),
    )).limit(1);
    return row ? mapRow(row) : null;
  }

  async markRunning(runId: string): Promise<DiscoveryRunRecord | null> {
    const [row] = await db.update(opportunityDiscoveryRuns).set({
      status: 'running',
      startedAt: new Date(),
      progress: { stage: 'running' },
    }).where(and(
      eq(opportunityDiscoveryRuns.id, runId),
      inArray(opportunityDiscoveryRuns.status, ['queued', 'running']),
    )).returning();
    return row ? mapRow(row) : null;
  }

  async updateProgress(runId: string, progress: Record<string, unknown>): Promise<void> {
    await db.update(opportunityDiscoveryRuns).set({ progress }).where(eq(opportunityDiscoveryRuns.id, runId));
  }

  async markSucceeded(runId: string, result: unknown): Promise<void> {
    await db.update(opportunityDiscoveryRuns).set({
      status: 'succeeded',
      result,
      progress: { stage: 'succeeded' },
      completedAt: new Date(),
    }).where(eq(opportunityDiscoveryRuns.id, runId));
  }

  async markFailed(runId: string, error: string): Promise<void> {
    await db.update(opportunityDiscoveryRuns).set({
      status: 'failed',
      error,
      progress: { stage: 'failed' },
      completedAt: new Date(),
    }).where(eq(opportunityDiscoveryRuns.id, runId));
  }

  async requestCancel(runId: string, userId: string): Promise<DiscoveryRunRecord | null> {
    const [row] = await db.update(opportunityDiscoveryRuns).set({
      cancelRequestedAt: new Date(),
      progress: { stage: 'cancellation_requested' },
    }).where(and(
      eq(opportunityDiscoveryRuns.id, runId),
      eq(opportunityDiscoveryRuns.userId, userId),
      inArray(opportunityDiscoveryRuns.status, ['queued', 'running']),
    )).returning();
    return row ? mapRow(row) : null;
  }

  async markCancelled(runId: string, reason?: string): Promise<void> {
    await db.update(opportunityDiscoveryRuns).set({
      status: 'cancelled',
      error: reason ?? null,
      progress: { stage: 'cancelled' },
      completedAt: new Date(),
    }).where(eq(opportunityDiscoveryRuns.id, runId));
  }

  async isCancelRequested(runId: string): Promise<boolean> {
    const [row] = await db.select({ cancelRequestedAt: opportunityDiscoveryRuns.cancelRequestedAt, status: opportunityDiscoveryRuns.status })
      .from(opportunityDiscoveryRuns)
      .where(eq(opportunityDiscoveryRuns.id, runId))
      .limit(1);
    return !!row?.cancelRequestedAt || row?.status === 'cancelled';
  }

  async listActive(userId: string, limit = 20): Promise<DiscoveryRunRecord[]> {
    const rows = await db.select().from(opportunityDiscoveryRuns).where(and(
      eq(opportunityDiscoveryRuns.userId, userId),
      inArray(opportunityDiscoveryRuns.status, ['queued', 'running']),
    )).orderBy(desc(opportunityDiscoveryRuns.createdAt)).limit(limit);
    return rows.map(mapRow);
  }
}

export const discoveryRunAdapter = new DiscoveryRunAdapter();
