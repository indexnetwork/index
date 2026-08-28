import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, describe, expect, it, mock } from 'bun:test';

afterAll(() => mock.restore());

import type { FrameDriftExecutionAttemptStartResult } from '../../adapters/frame-drift-execution-attempt.database.adapter';
import type { FrameDriftMonitoringResult } from '../../services/frame-drift-monitoring.service';
import { FRAME_DRIFT_MONITORING } from '../../lib/frame-drift.config';
import { deriveMostRecentlyClosedUtcDay, FrameDriftQueue, type FrameDriftQueueDeps } from '../frame-drift.queue';

function createHarness() {
  const info = mock(() => undefined);
  const error = mock(() => undefined);
  const sleep = mock(async (_delayMs: number) => undefined);
  const lifecycleCalls: string[] = [];
  const recordStarted = mock(async (): Promise<FrameDriftExecutionAttemptStartResult> => {
    lifecycleCalls.push('started');
    return { recordStatus: 'inserted' as const, terminalStatus: null };
  });
  const recordTerminal = mock(async () => {
    lifecycleCalls.push('terminal');
    return 'updated' as const;
  });
  const clock = mock(() => new Date('2026-07-15T00:15:01.000Z'));
  const captureDailyBucket = mock(async (): Promise<FrameDriftMonitoringResult> => {
    lifecycleCalls.push('measurement');
    return {
      observationStatus: 'inserted' as const,
      centroidSnapshotCount: 0,
      yieldProxySnapshotCount: 0,
      capturedAt: new Date('2026-07-15T00:15:00Z'),
      selectedNetworkCount: 0,
      eligibleNetworkCount: 0,
      stableCohortHash: '',
      totalPossibleCohortPairCount: 0,
      selectedPairCount: 0,
      positiveMeasuredPairCount: 0,
      graphOpportunityCount: 0,
      attributedGraphOpportunityCount: 0,
      unattributedGraphOpportunityCount: 0,
      suppressedCentroidCount: 0,
      emptyCentroidCount: 0,
      invalidVectorCount: 0,
      networksTruncated: false,
      pairsTruncated: false,
      durationMs: 0,
    };
  });
  const deps: FrameDriftQueueDeps = {
    service: { captureDailyBucket },
    attemptStore: { recordStarted, recordTerminal },
    logger: { info, error },
    sleep,
    clock,
  };
  return {
    queue: new FrameDriftQueue(deps),
    captureDailyBucket,
    recordStarted,
    recordTerminal,
    clock,
    lifecycleCalls,
    info,
    error,
    sleep,
  };
}

describe('deriveMostRecentlyClosedUtcDay', () => {
  it('derives UTC boundaries across a month boundary', () => {
    const bucket = deriveMostRecentlyClosedUtcDay(Date.parse('2026-03-01T00:15:00.000Z'));
    expect(bucket.bucketStart.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(bucket.bucketEnd.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('FrameDriftQueue — start', () => {
  it('schedules the daily cron and is idempotent on a second call', async () => {
    // node-cron isn't mocked in this file — mocking it would leak into every
    // other suite that imports node-cron in the same test run. This exercises
    // the real scheduler, then stops whatever task it registered.
    const cron = await import('node-cron');
    const before = new Set(cron.getTasks().keys());
    const harness = createHarness();
    try {
      await harness.queue.start();
      await harness.queue.start();
      const after = cron.getTasks();
      const newIds = [...after.keys()].filter((id) => !before.has(id));
      expect(newIds).toHaveLength(1);
      expect(harness.info).toHaveBeenCalledWith(
        'Frame-drift monitoring scheduled',
        expect.objectContaining({ schedule: FRAME_DRIFT_MONITORING.schedule, timezone: 'UTC' }),
      );
    } finally {
      const after = cron.getTasks();
      for (const [id, task] of after) if (!before.has(id)) task.stop();
    }
  });
});

describe('FrameDriftQueue — runDailyCapture', () => {
  it('derives the closed bucket from the clock and delegates to the service', async () => {
    const harness = createHarness();

    await harness.queue.runDailyCapture();

    expect(harness.lifecycleCalls).toEqual(['started', 'measurement', 'terminal']);
    expect(harness.captureDailyBucket).toHaveBeenCalledWith(
      new Date('2026-07-14T00:00:00.000Z'),
      new Date('2026-07-15T00:00:00.000Z'),
    );
    expect(harness.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: 'inserted',
      willRetry: false,
      failureCategory: null,
      attempt: 1,
    }));
  });

  it('records a duplicate measurement result as terminal duplicate', async () => {
    const harness = createHarness();
    harness.captureDailyBucket.mockImplementationOnce(async () => ({
      observationStatus: 'duplicate',
      centroidSnapshotCount: 0,
      yieldProxySnapshotCount: 0,
      capturedAt: new Date('2026-07-15T00:15:00Z'),
      selectedNetworkCount: 0,
      eligibleNetworkCount: 0,
      stableCohortHash: '',
      totalPossibleCohortPairCount: 0,
      selectedPairCount: 0,
      positiveMeasuredPairCount: 0,
      graphOpportunityCount: 0,
      attributedGraphOpportunityCount: 0,
      unattributedGraphOpportunityCount: 0,
      suppressedCentroidCount: 0,
      emptyCentroidCount: 0,
      invalidVectorCount: 0,
      networksTruncated: false,
      pairsTruncated: false,
      durationMs: 0,
    }));

    await harness.queue.runDailyCapture();

    expect(harness.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: 'duplicate',
      willRetry: false,
      failureCategory: null,
    }));
  });

  it('logs and rethrows on measurement failure, with willRetry false (no retry above background())', async () => {
    const harness = createHarness();
    const failure = new Error('database unavailable');
    harness.captureDailyBucket.mockImplementationOnce(async () => { throw failure; });

    await expect(harness.queue.runDailyCapture()).rejects.toThrow('database unavailable');

    expect(harness.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: 'failed',
      willRetry: false,
      failureCategory: 'measurement',
    }));
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift observation failed',
      expect.objectContaining({
        event: 'frame_drift_monitoring_job_failed',
        bucketStart: '2026-07-14T00:00:00.000Z',
        bucketEnd: '2026-07-15T00:00:00.000Z',
        error: failure,
      }),
    );
  });

  it('short-circuits redelivered attempts whose successful or skipped terminal state exists', async () => {
    for (const terminalStatus of ['inserted', 'skipped'] as const) {
      const harness = createHarness();
      harness.recordStarted.mockImplementationOnce(async () => ({
        recordStatus: 'replayed',
        terminalStatus,
      }));

      await harness.queue.runDailyCapture();

      expect(harness.captureDailyBucket).not.toHaveBeenCalled();
      expect(harness.recordTerminal).not.toHaveBeenCalled();
      expect(harness.info).toHaveBeenCalledWith(
        'Frame-drift terminal attempt redelivered; retaining recorded outcome',
        expect.objectContaining({
          event: 'frame_drift_monitoring_terminal_attempt_replayed',
          terminalStatus,
        }),
      );
    }
  });

  it('preserves failure semantics when a terminal failed attempt is redelivered', async () => {
    const harness = createHarness();
    harness.recordStarted.mockImplementationOnce(async () => ({
      recordStatus: 'replayed',
      terminalStatus: 'failed',
    }));

    await expect(harness.queue.runDailyCapture()).rejects.toThrow(
      'Frame-drift attempt was already recorded as failed',
    );

    expect(harness.captureDailyBucket).not.toHaveBeenCalled();
    expect(harness.recordTerminal).not.toHaveBeenCalled();
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift failed attempt redelivered; preserving recorded failure',
      expect.objectContaining({
        event: 'frame_drift_monitoring_terminal_attempt_replayed',
        terminalStatus: 'failed',
      }),
    );
  });

  it('fails before measurement when started tracking fails', async () => {
    const harness = createHarness();
    const trackingFailure = new Error('attempt store unavailable');
    harness.recordStarted.mockImplementationOnce(async () => { throw trackingFailure; });

    await expect(harness.queue.runDailyCapture()).rejects.toBe(trackingFailure);

    expect(harness.captureDailyBucket).not.toHaveBeenCalled();
    expect(harness.recordTerminal).not.toHaveBeenCalled();
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift attempt-start tracking failed',
      expect.objectContaining({
        event: 'frame_drift_monitoring_attempt_tracking_failed',
        trackingPhase: 'started',
      }),
    );
  });

  it('recovers when a terminal ledger write succeeds within the bounded retries', async () => {
    const harness = createHarness();
    harness.recordTerminal.mockImplementationOnce(async () => {
      throw new Error('attempt store unavailable');
    });

    await harness.queue.runDailyCapture();

    // Measurement is never re-run while the ledger write retries.
    expect(harness.captureDailyBucket).toHaveBeenCalledTimes(1);
    expect(harness.recordTerminal).toHaveBeenCalledTimes(2);
    expect(harness.sleep).toHaveBeenCalledWith(50);
    expect(harness.error).not.toHaveBeenCalled();
  });

  it('rethrows after exhausting terminal ledger write retries', async () => {
    const harness = createHarness();
    const trackingFailure = new Error('attempt store unavailable');
    harness.recordTerminal.mockImplementation(async () => { throw trackingFailure; });

    await expect(harness.queue.runDailyCapture()).rejects.toBe(trackingFailure);

    expect(harness.captureDailyBucket).toHaveBeenCalledTimes(1);
    expect(harness.recordTerminal).toHaveBeenCalledTimes(3);
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift terminal tracking failed',
      expect.objectContaining({
        event: 'frame_drift_monitoring_attempt_tracking_failed',
        trackingPhase: 'terminal',
        observationStatus: 'inserted',
      }),
    );
  });

  it('preserves the service error when failure bookkeeping also fails', async () => {
    const harness = createHarness();
    const serviceFailure = new Error('measurement database unavailable');
    harness.captureDailyBucket.mockImplementationOnce(async () => { throw serviceFailure; });
    harness.recordTerminal.mockImplementation(async () => {
      throw new Error('attempt store unavailable');
    });

    await expect(harness.queue.runDailyCapture()).rejects.toBe(serviceFailure);

    // The failed-measurement ledger write also exhausts its bounded retries.
    expect(harness.recordTerminal).toHaveBeenCalledTimes(3);
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift failure bookkeeping failed; preserving service error',
      expect.objectContaining({
        event: 'frame_drift_monitoring_attempt_tracking_failed',
        trackingPhase: 'terminal',
      }),
    );
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift observation failed',
      expect.objectContaining({
        error: serviceFailure,
        failureWasTracked: false,
      }),
    );
  });
});
