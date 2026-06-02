import { and, desc, eq, inArray } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { profileToolRuns } from '../schemas/database.schema';

const DEFAULT_PROFILE_RUN_TTL_MS = 24 * 60 * 60 * 1000;

type ProfileRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type ProfileRunOperation = 'preview_user_profile' | 'update_user_profile';

type ProfileRunInput = {
  name?: string;
  location?: string;
  bioOrDescription?: string;
  edgeosProfileText?: string;
  allowPublicLookup?: boolean;
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

interface ProfileRunContext {
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

interface ProfileRunRecord {
  id: string;
  userId: string;
  agentId?: string | null;
  operation: ProfileRunOperation;
  status: ProfileRunStatus;
  input: ProfileRunInput;
  context: ProfileRunContext;
  progress?: Record<string, unknown> | null;
  result?: unknown;
  error?: string | null;
  cancelRequestedAt?: Date | null;
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  expiresAt?: Date | null;
}

interface CreateProfileRunInput {
  userId: string;
  agentId?: string | null;
  operation: ProfileRunOperation;
  input: ProfileRunInput;
  context: ProfileRunContext;
  expiresAt?: Date;
}

interface ProfileRunStore {
  create(input: CreateProfileRunInput): Promise<ProfileRunRecord>;
  get(runId: string, userId: string): Promise<ProfileRunRecord | null>;
  markRunning(runId: string): Promise<ProfileRunRecord | null>;
  updateProgress(runId: string, progress: Record<string, unknown>): Promise<void>;
  markSucceeded(runId: string, result: unknown): Promise<void>;
  markFailed(runId: string, error: string): Promise<void>;
  requestCancel(runId: string, userId: string): Promise<ProfileRunRecord | null>;
  markCancelled(runId: string, reason?: string): Promise<void>;
  isCancelRequested(runId: string): Promise<boolean>;
  listActive(userId: string, limit?: number): Promise<ProfileRunRecord[]>;
}

function mapRow(row: typeof profileToolRuns.$inferSelect): ProfileRunRecord {
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    operation: row.operation as ProfileRunOperation,
    status: row.status as ProfileRunStatus,
    input: row.input as unknown as ProfileRunInput,
    context: row.context as unknown as ProfileRunContext,
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

export class ProfileRunAdapter implements ProfileRunStore {
  async create(input: CreateProfileRunInput): Promise<ProfileRunRecord> {
    const expiresAt = input.expiresAt ?? new Date(Date.now() + DEFAULT_PROFILE_RUN_TTL_MS);
    const [row] = await db.insert(profileToolRuns).values({
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

  async get(runId: string, userId: string): Promise<ProfileRunRecord | null> {
    const [row] = await db.select().from(profileToolRuns).where(and(
      eq(profileToolRuns.id, runId),
      eq(profileToolRuns.userId, userId),
    )).limit(1);
    return row ? mapRow(row) : null;
  }

  async markRunning(runId: string): Promise<ProfileRunRecord | null> {
    const [row] = await db.update(profileToolRuns).set({
      status: 'running',
      startedAt: new Date(),
      progress: { stage: 'running' },
    }).where(and(
      eq(profileToolRuns.id, runId),
      inArray(profileToolRuns.status, ['queued', 'running']),
    )).returning();
    return row ? mapRow(row) : null;
  }

  async updateProgress(runId: string, progress: Record<string, unknown>): Promise<void> {
    await db.update(profileToolRuns).set({ progress }).where(eq(profileToolRuns.id, runId));
  }

  async markSucceeded(runId: string, result: unknown): Promise<void> {
    await db.update(profileToolRuns).set({
      status: 'succeeded',
      result,
      progress: { stage: 'succeeded' },
      completedAt: new Date(),
    }).where(eq(profileToolRuns.id, runId));
  }

  async markFailed(runId: string, error: string): Promise<void> {
    await db.update(profileToolRuns).set({
      status: 'failed',
      error,
      progress: { stage: 'failed' },
      completedAt: new Date(),
    }).where(eq(profileToolRuns.id, runId));
  }

  async requestCancel(runId: string, userId: string): Promise<ProfileRunRecord | null> {
    const [row] = await db.update(profileToolRuns).set({
      cancelRequestedAt: new Date(),
      progress: { stage: 'cancellation_requested' },
    }).where(and(
      eq(profileToolRuns.id, runId),
      eq(profileToolRuns.userId, userId),
      inArray(profileToolRuns.status, ['queued', 'running']),
    )).returning();
    return row ? mapRow(row) : null;
  }

  async markCancelled(runId: string, reason?: string): Promise<void> {
    await db.update(profileToolRuns).set({
      status: 'cancelled',
      error: reason ?? null,
      progress: { stage: 'cancelled' },
      completedAt: new Date(),
    }).where(eq(profileToolRuns.id, runId));
  }

  async isCancelRequested(runId: string): Promise<boolean> {
    const [row] = await db.select({ cancelRequestedAt: profileToolRuns.cancelRequestedAt, status: profileToolRuns.status })
      .from(profileToolRuns)
      .where(eq(profileToolRuns.id, runId))
      .limit(1);
    return !!row?.cancelRequestedAt || row?.status === 'cancelled';
  }

  async listActive(userId: string, limit = 20): Promise<ProfileRunRecord[]> {
    const rows = await db.select().from(profileToolRuns).where(and(
      eq(profileToolRuns.userId, userId),
      inArray(profileToolRuns.status, ['queued', 'running']),
    )).orderBy(desc(profileToolRuns.createdAt)).limit(limit);
    return rows.map(mapRow);
  }
}

export const profileRunAdapter = new ProfileRunAdapter();
