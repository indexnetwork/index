import '../src/startup.env';

import { afterAll as bunAfterAll, describe, expect, it as bunIt } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { like, sql } from 'drizzle-orm';

import { FrameDriftExecutionAttemptDatabaseAdapter, type FrameDriftExecutionAttemptStart } from '../src/adapters/frame-drift-execution-attempt.database.adapter';
import db from '../src/lib/drizzle/drizzle';
import { frameDriftExecutionAttempts } from '../src/schemas/database.schema';
import { withMinimumDatabaseHookBudget, withMinimumDatabaseTestBudget } from '../src/lib/testing/database-test-budget';

const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 60_000);
const it = withMinimumDatabaseTestBudget(bunIt, 30_000);
const suffix = randomUUID();
const jobPrefix = `ind468-${suffix}`;
const BUCKET_START = new Date('2026-07-18T00:00:00.000Z');
const BUCKET_END = new Date('2026-07-19T00:00:00.000Z');
const SCHEDULED_AT = new Date('2026-07-19T00:15:00.000Z');
const STARTED_AT = new Date('2026-07-19T00:15:01.000Z');
const COMPLETED_AT = new Date('2026-07-19T00:15:02.000Z');

function started(jobSuffix: string, overrides: Partial<FrameDriftExecutionAttemptStart> = {}) {
  return {
    queueName: 'frame-drift-monitoring',
    schedulerId: 'frame-drift-monitoring-daily-v1',
    jobId: `${jobPrefix}-${jobSuffix}`,
    jobName: 'capture-daily-frame-drift',
    scheduledAt: SCHEDULED_AT,
    bucketStart: BUCKET_START,
    bucketEnd: BUCKET_END,
    attempt: 1,
    maxAttempts: 3,
    startedAt: STARTED_AT,
    ...overrides,
  } satisfies FrameDriftExecutionAttemptStart;
}

async function expectRejectedInsert(
  value: typeof frameDriftExecutionAttempts.$inferInsert,
): Promise<void> {
  const rejected = await db.insert(frameDriftExecutionAttempts).values(value).then(
    () => false,
    () => true,
  );
  expect(rejected).toBe(true);
}

describe('FrameDriftExecutionAttemptDatabaseAdapter', () => {
  const adapter = new FrameDriftExecutionAttemptDatabaseAdapter(db);

  afterAll(async () => {
    await db.delete(frameDriftExecutionAttempts).where(
      like(frameDriftExecutionAttempts.jobId, `${jobPrefix}%`),
    );
  });

  it('records started idempotently while retaining the first timestamp', async () => {
    const attempt = started('started-replay');

    expect(await adapter.recordStarted(attempt)).toEqual({
      recordStatus: 'inserted',
      terminalStatus: null,
    });
    expect(await adapter.recordStarted({
      ...attempt,
      startedAt: new Date(STARTED_AT.getTime() + 5000),
    })).toEqual({
      recordStatus: 'replayed',
      terminalStatus: null,
    });

    const [persisted] = await db.select().from(frameDriftExecutionAttempts).where(
      like(frameDriftExecutionAttempts.jobId, `${jobPrefix}-started-replay`),
    );
    expect(persisted.startedAt).toEqual(STARTED_AT);
  });

  it('rejects a conflicting identity for the same job attempt', async () => {
    const attempt = started('started-conflict');
    await adapter.recordStarted(attempt);

    await expect(adapter.recordStarted({
      ...attempt,
      schedulerId: 'different-scheduler',
    })).rejects.toThrow('Conflicting frame-drift execution-attempt identity');
  });

  it('records a terminal state idempotently and rejects conflicting or missing transitions', async () => {
    const attempt = started('terminal-replay');
    await adapter.recordStarted(attempt);
    const terminal = {
      jobId: attempt.jobId,
      attempt: attempt.attempt,
      completedAt: COMPLETED_AT,
      terminalStatus: 'inserted' as const,
      willRetry: false as const,
      failureCategory: null,
    };

    expect(await adapter.recordTerminal(terminal)).toBe('updated');
    expect(await adapter.recordStarted({
      ...attempt,
      startedAt: new Date(STARTED_AT.getTime() + 5000),
    })).toEqual({
      recordStatus: 'replayed',
      terminalStatus: 'inserted',
    });
    expect(await adapter.recordTerminal({
      ...terminal,
      completedAt: new Date(COMPLETED_AT.getTime() + 5000),
    })).toBe('replayed');
    const [persisted] = await db.select({
      completedAt: frameDriftExecutionAttempts.completedAt,
    }).from(frameDriftExecutionAttempts).where(
      like(frameDriftExecutionAttempts.jobId, `${jobPrefix}-terminal-replay`),
    );
    expect(persisted.completedAt).toEqual(COMPLETED_AT);
    await expect(adapter.recordTerminal({
      ...terminal,
      terminalStatus: 'duplicate',
    })).rejects.toThrow('Conflicting frame-drift execution-attempt terminal transition');
    await expect(adapter.recordTerminal({
      ...terminal,
      jobId: `${jobPrefix}-missing`,
    })).rejects.toThrow('Missing started frame-drift execution attempt');
  });

  it('enforces identity, daily bucket, attempt, and terminal-state constraints', async () => {
    await expectRejectedInsert({
      ...started('invalid-identity'),
      queueName: '   ',
    });
    await expectRejectedInsert({
      ...started('invalid-bucket'),
      bucketStart: new Date('2026-07-18T01:00:00.000Z'),
    });
    await expectRejectedInsert({
      ...started('invalid-scheduled-time'),
      scheduledAt: new Date('2026-07-20T00:00:00.000Z'),
    });
    await expectRejectedInsert({
      ...started('invalid-attempt'),
      attempt: 4,
      maxAttempts: 3,
    });
    await expectRejectedInsert({
      ...started('invalid-max-attempts'),
      maxAttempts: 101,
    });
    await expectRejectedInsert({
      ...started('invalid-terminal'),
      terminalStatus: 'inserted',
      completedAt: null,
      willRetry: false,
    });
    await expectRejectedInsert({
      ...started('invalid-terminal-retry'),
      terminalStatus: 'inserted',
      completedAt: COMPLETED_AT,
      willRetry: null,
    });
    await expectRejectedInsert({
      ...started('invalid-completion-order'),
      terminalStatus: 'inserted',
      completedAt: new Date(STARTED_AT.getTime() - 1),
      willRetry: false,
    });
    await expectRejectedInsert({
      ...started('invalid-success-category'),
      terminalStatus: 'inserted',
      completedAt: COMPLETED_AT,
      willRetry: false,
      failureCategory: 'measurement',
    } as unknown as typeof frameDriftExecutionAttempts.$inferInsert);
    await expectRejectedInsert({
      ...started('missing-failure-category'),
      terminalStatus: 'failed',
      completedAt: COMPLETED_AT,
      willRetry: false,
      failureCategory: null,
    } as unknown as typeof frameDriftExecutionAttempts.$inferInsert);
    await expectRejectedInsert({
      ...started('invalid-failure-category'),
      terminalStatus: 'failed',
      completedAt: COMPLETED_AT,
      willRetry: false,
      failureCategory: 'database unavailable',
    } as unknown as typeof frameDriftExecutionAttempts.$inferInsert);
  });

  it('stores only the allowlisted attempt fields and failure category without an observation FK', async () => {
    const attempt = started('privacy-shape');
    await adapter.recordStarted(attempt);
    await adapter.recordTerminal({
      jobId: attempt.jobId,
      attempt: attempt.attempt,
      completedAt: COMPLETED_AT,
      terminalStatus: 'failed',
      willRetry: true,
      failureCategory: 'measurement',
    });

    const columns = await db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'frame_drift_execution_attempts'
      ORDER BY ordinal_position
    `);
    expect(columns.map((row) => row.column_name)).toEqual([
      'id',
      'queue_name',
      'scheduler_id',
      'job_id',
      'job_name',
      'scheduled_at',
      'bucket_start',
      'bucket_end',
      'attempt',
      'max_attempts',
      'started_at',
      'completed_at',
      'terminal_status',
      'will_retry',
      'failure_category',
    ]);

    const foreignKeys = await db.execute<{ constraint_name: string }>(sql`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'frame_drift_execution_attempts'
        AND constraint_type = 'FOREIGN KEY'
    `);
    expect(foreignKeys).toHaveLength(0);

    const [persisted] = await db.select().from(frameDriftExecutionAttempts).where(
      like(frameDriftExecutionAttempts.jobId, `${jobPrefix}-privacy-shape`),
    );
    expect(persisted.failureCategory).toBe('measurement');
    expect(JSON.stringify(persisted)).not.toContain('database unavailable');
  });
});
