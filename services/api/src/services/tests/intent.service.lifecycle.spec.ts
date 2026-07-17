import { afterEach, describe, expect, it, mock } from 'bun:test';

import { IntentDatabaseAdapter } from '../../adapters/database.adapter';
import { IntentEvents } from '../../events/intent.event';
import { IntentService } from '../intent.service';

afterEach(() => {
  IntentEvents.onPaused = () => {};
  IntentEvents.onResumed = async () => {};
});

describe('IntentService lifecycle transitions', () => {
  it('emits pause only for a real state change', async () => {
    const transitionIntentLifecycle = mock(async () => ({
      kind: 'success' as const,
      id: 'intent-1',
      status: 'PAUSED' as const,
      changed: true,
      lifecycleVersionMs: 100,
    }));
    const paused = mock(() => {});
    IntentEvents.onPaused = paused;
    const service = new IntentService({
      adapter: { transitionIntentLifecycle } as unknown as IntentDatabaseAdapter,
    });

    const result = await service.transitionStatus('intent-1', 'user-1', 'PAUSED', 'network-1');

    expect(result.kind).toBe('success');
    expect(transitionIntentLifecycle).toHaveBeenCalledWith({
      intentId: 'intent-1',
      userId: 'user-1',
      status: 'PAUSED',
      networkScopeId: 'network-1',
    });
    expect(paused).toHaveBeenCalledWith('intent-1', 'user-1', 100);
  });

  it('compensates a changed resume and reports enqueue_failed without claiming success', async () => {
    const transitionIntentLifecycle = mock(async () => ({
      kind: 'success' as const,
      id: 'intent-1',
      status: 'ACTIVE' as const,
      changed: true,
      lifecycleVersionMs: 200,
    }));
    const compensateFailedResume = mock(async () => ({
      status: 'PAUSED' as const,
      lifecycleVersionMs: 201,
    }));
    const resumed = mock(async () => {
      throw new Error('queue unavailable');
    });
    IntentEvents.onResumed = resumed;
    const service = new IntentService({
      adapter: { transitionIntentLifecycle, compensateFailedResume } as unknown as IntentDatabaseAdapter,
    });

    const result = await service.transitionStatus('intent-1', 'user-1', 'ACTIVE', 'network-1');

    expect(result).toEqual({
      kind: 'enqueue_failed',
      id: 'intent-1',
      status: 'PAUSED',
      lifecycleVersionMs: 201,
      retryable: true,
    });
    expect(resumed).toHaveBeenCalledWith('intent-1', 'user-1', 200);
    expect(compensateFailedResume).toHaveBeenCalledWith({
      intentId: 'intent-1',
      userId: 'user-1',
      lifecycleVersionMs: 200,
      networkScopeId: 'network-1',
    });
  });

  it('does not mutate an idempotently ACTIVE intent when resume enqueue fails', async () => {
    const transitionIntentLifecycle = mock(async () => ({
      kind: 'success' as const,
      id: 'intent-1',
      status: 'ACTIVE' as const,
      changed: false,
      lifecycleVersionMs: 200,
    }));
    const compensateFailedResume = mock(async () => ({
      status: 'PAUSED' as const,
      lifecycleVersionMs: 201,
    }));
    IntentEvents.onResumed = mock(async () => {
      throw new Error('queue unavailable');
    });
    const service = new IntentService({
      adapter: { transitionIntentLifecycle, compensateFailedResume } as unknown as IntentDatabaseAdapter,
    });

    const result = await service.transitionStatus('intent-1', 'user-1', 'ACTIVE');

    expect(result).toEqual({
      kind: 'enqueue_failed',
      id: 'intent-1',
      status: 'ACTIVE',
      lifecycleVersionMs: 200,
      retryable: true,
    });
    expect(compensateFailedResume).not.toHaveBeenCalled();
  });

  it('does not emit lifecycle hooks for adapter conflicts', async () => {
    const transitionIntentLifecycle = mock(async () => ({
      kind: 'conflict' as const,
      status: 'FULFILLED' as const,
      archived: false,
    }));
    const paused = mock(() => {});
    const resumed = mock(async () => {});
    IntentEvents.onPaused = paused;
    IntentEvents.onResumed = resumed;
    const service = new IntentService({
      adapter: { transitionIntentLifecycle } as unknown as IntentDatabaseAdapter,
    });

    const result = await service.transitionStatus('intent-1', 'user-1', 'ACTIVE');

    expect(result).toEqual({ kind: 'conflict', status: 'FULFILLED', archived: false });
    expect(paused).not.toHaveBeenCalled();
    expect(resumed).not.toHaveBeenCalled();
  });
});
