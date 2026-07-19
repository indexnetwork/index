import { and, eq, isNull } from 'drizzle-orm';

import db, { type DrizzleDB } from '../lib/drizzle/drizzle';
import { frameDriftExecutionAttempts, type FrameDriftExecutionFailureCategory, type FrameDriftExecutionTerminalStatus } from '../schemas/database.schema';

export interface FrameDriftExecutionAttemptStart {
  queueName: string;
  schedulerId: string;
  jobId: string;
  jobName: string;
  scheduledAt: Date;
  bucketStart: Date;
  bucketEnd: Date;
  attempt: number;
  maxAttempts: number;
  startedAt: Date;
}

interface FrameDriftExecutionAttemptTerminalBase {
  jobId: string;
  attempt: number;
  completedAt: Date;
}

export type FrameDriftExecutionAttemptTerminal = FrameDriftExecutionAttemptTerminalBase & (
  | {
    terminalStatus: Exclude<FrameDriftExecutionTerminalStatus, 'failed'>;
    willRetry: false;
    failureCategory: null;
  }
  | {
    terminalStatus: 'failed';
    willRetry: boolean;
    failureCategory: FrameDriftExecutionFailureCategory;
  }
);

export interface FrameDriftExecutionAttemptStartResult {
  recordStatus: 'inserted' | 'replayed';
  terminalStatus: FrameDriftExecutionTerminalStatus | null;
}

export interface FrameDriftExecutionAttemptStore {
  recordStarted(attempt: FrameDriftExecutionAttemptStart): Promise<FrameDriftExecutionAttemptStartResult>;
  recordTerminal(attempt: FrameDriftExecutionAttemptTerminal): Promise<'updated' | 'replayed'>;
}

type PersistedAttemptIdentity = Pick<
  typeof frameDriftExecutionAttempts.$inferSelect,
  | 'queueName'
  | 'schedulerId'
  | 'jobId'
  | 'jobName'
  | 'scheduledAt'
  | 'bucketStart'
  | 'bucketEnd'
  | 'attempt'
  | 'maxAttempts'
  | 'terminalStatus'
>;

type PersistedAttemptTerminal = Pick<
  typeof frameDriftExecutionAttempts.$inferSelect,
  'completedAt' | 'terminalStatus' | 'willRetry' | 'failureCategory'
>;

function sameDate(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

function sameIdentity(
  existing: PersistedAttemptIdentity,
  incoming: FrameDriftExecutionAttemptStart,
): boolean {
  return existing.queueName === incoming.queueName
    && existing.schedulerId === incoming.schedulerId
    && existing.jobId === incoming.jobId
    && existing.jobName === incoming.jobName
    && sameDate(existing.scheduledAt, incoming.scheduledAt)
    && sameDate(existing.bucketStart, incoming.bucketStart)
    && sameDate(existing.bucketEnd, incoming.bucketEnd)
    && existing.attempt === incoming.attempt
    && existing.maxAttempts === incoming.maxAttempts;
}

function sameTerminal(
  existing: PersistedAttemptTerminal,
  incoming: FrameDriftExecutionAttemptTerminal,
): boolean {
  return existing.completedAt !== null
    && existing.terminalStatus === incoming.terminalStatus
    && existing.willRetry === incoming.willRetry
    && existing.failureCategory === incoming.failureCategory;
}

/** Database boundary for privacy-minimized frame-drift execution-attempt tracking. */
export class FrameDriftExecutionAttemptDatabaseAdapter implements FrameDriftExecutionAttemptStore {
  constructor(private readonly database: DrizzleDB = db) {}

  /**
   * Insert the started state once, retaining the first start timestamp on replay.
   *
   * @param attempt - Scheduler/job identity, daily bucket, and BullMQ attempt bounds.
   * @returns Insert/replay status and any terminal state already recorded.
   * @throws When the same job attempt already exists with conflicting identity.
   */
  async recordStarted(
    attempt: FrameDriftExecutionAttemptStart,
  ): Promise<FrameDriftExecutionAttemptStartResult> {
    const inserted = await this.database.insert(frameDriftExecutionAttempts)
      .values(attempt)
      .onConflictDoNothing()
      .returning({ id: frameDriftExecutionAttempts.id });
    if (inserted[0]) return { recordStatus: 'inserted', terminalStatus: null };

    const [existing] = await this.database.select({
      queueName: frameDriftExecutionAttempts.queueName,
      schedulerId: frameDriftExecutionAttempts.schedulerId,
      jobId: frameDriftExecutionAttempts.jobId,
      jobName: frameDriftExecutionAttempts.jobName,
      scheduledAt: frameDriftExecutionAttempts.scheduledAt,
      bucketStart: frameDriftExecutionAttempts.bucketStart,
      bucketEnd: frameDriftExecutionAttempts.bucketEnd,
      attempt: frameDriftExecutionAttempts.attempt,
      maxAttempts: frameDriftExecutionAttempts.maxAttempts,
      terminalStatus: frameDriftExecutionAttempts.terminalStatus,
    }).from(frameDriftExecutionAttempts).where(and(
      eq(frameDriftExecutionAttempts.jobId, attempt.jobId),
      eq(frameDriftExecutionAttempts.attempt, attempt.attempt),
    )).limit(1);
    if (!existing || !sameIdentity(existing, attempt)) {
      throw new Error('Conflicting frame-drift execution-attempt identity');
    }
    return { recordStatus: 'replayed', terminalStatus: existing.terminalStatus };
  }

  /**
   * Transition a started attempt to one terminal state exactly once.
   *
   * @param attempt - Existing attempt key and privacy-safe terminal outcome.
   * @returns Whether the terminal state was updated or semantically replayed; the first completion time wins.
   * @throws When the started row is missing or its terminal transition conflicts.
   */
  async recordTerminal(
    attempt: FrameDriftExecutionAttemptTerminal,
  ): Promise<'updated' | 'replayed'> {
    const updated = await this.database.update(frameDriftExecutionAttempts).set({
      completedAt: attempt.completedAt,
      terminalStatus: attempt.terminalStatus,
      willRetry: attempt.willRetry,
      failureCategory: attempt.failureCategory,
    }).where(and(
      eq(frameDriftExecutionAttempts.jobId, attempt.jobId),
      eq(frameDriftExecutionAttempts.attempt, attempt.attempt),
      isNull(frameDriftExecutionAttempts.terminalStatus),
    )).returning({ id: frameDriftExecutionAttempts.id });
    if (updated[0]) return 'updated';

    const [existing] = await this.database.select({
      completedAt: frameDriftExecutionAttempts.completedAt,
      terminalStatus: frameDriftExecutionAttempts.terminalStatus,
      willRetry: frameDriftExecutionAttempts.willRetry,
      failureCategory: frameDriftExecutionAttempts.failureCategory,
    }).from(frameDriftExecutionAttempts).where(and(
      eq(frameDriftExecutionAttempts.jobId, attempt.jobId),
      eq(frameDriftExecutionAttempts.attempt, attempt.attempt),
    )).limit(1);
    if (!existing) {
      throw new Error('Missing started frame-drift execution attempt');
    }
    if (!sameTerminal(existing, attempt)) {
      throw new Error('Conflicting frame-drift execution-attempt terminal transition');
    }
    return 'replayed';
  }
}

export const frameDriftExecutionAttemptDatabaseAdapter = new FrameDriftExecutionAttemptDatabaseAdapter();
