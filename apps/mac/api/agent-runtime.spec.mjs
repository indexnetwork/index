import { describe, expect, it } from 'bun:test';

import {
  createHermesRuntimeBridge,
  HERMES_RUNTIME_QUEUE_WAIT_TIMEOUT_MS,
  HERMES_RUNTIME_TIMEOUTS_MS,
  mapAgentRuntimeState,
  waitForHermesHealth,
} from './agent-runtime.mjs';

const LOCAL = {
  installationId: 'installation-local',
  executorId: 'executor-hermes',
  pluginInstalled: true,
  negotiatorMode: true,
  schedulePresent: true,
  scheduleEnabled: false,
  setupAttemptId: 'setup-current',
};

const INDEX = {
  selectedRuntime: 'index', executor: null, health: 'never-seen', indexCovering: true,
};
const HERMES_ACTIVE = {
  selectedRuntime: 'hermes',
  executor: {
    id: 'executor-hermes', installationId: 'installation-local', status: 'active',
    lastNegotiationPickupAt: '2026-08-07T00:00:00.000Z',
  },
  health: 'active', indexCovering: false,
};

describe('agent runtime state mapper', () => {
  it('maps every durable visual state without calculating heartbeat freshness', () => {
    expect(mapAgentRuntimeState({ binding: INDEX, localState: null, operation: null })).toEqual({
      selectorValue: 'index',
      visualState: 'index',
      statusLine: 'Index is handling negotiations.',
      canRetry: false,
      canDisconnect: false,
      retryAction: null,
    });

    expect(mapAgentRuntimeState({
      binding: INDEX, localState: LOCAL, operation: { kind: 'select-hermes', status: 'running' },
    })).toMatchObject({
      selectorValue: 'hermes', visualState: 'connecting', canRetry: false, canDisconnect: false,
    });

    expect(mapAgentRuntimeState({ binding: HERMES_ACTIVE, localState: { ...LOCAL, scheduleEnabled: true }, operation: null })).toEqual({
      selectorValue: 'hermes',
      visualState: 'active',
      statusLine: 'Hermes is active. Index takes over when Hermes is unavailable.',
      canRetry: false,
      canDisconnect: true,
      retryAction: null,
    });

    for (const health of ['stale', 'never-seen']) {
      expect(mapAgentRuntimeState({
        binding: { ...HERMES_ACTIVE, health, indexCovering: true },
        localState: { ...LOCAL, scheduleEnabled: true },
        operation: null,
      })).toEqual({
        selectorValue: 'hermes',
        visualState: 'unavailable',
        statusLine: 'Hermes is unavailable — Index is covering.',
        canRetry: true,
        canDisconnect: true,
        retryAction: 'select-hermes',
      });
    }
  });

  it('keeps an Index-selected but connected Hermes installation selectable and disconnectable', () => {
    expect(mapAgentRuntimeState({ binding: INDEX, localState: LOCAL, operation: null })).toEqual({
      selectorValue: 'index',
      visualState: 'index',
      statusLine: 'Index is handling negotiations. Hermes remains connected and can be selected again.',
      canRetry: false,
      canDisconnect: true,
      retryAction: null,
    });
  });

  it('fails closed on installation mismatch, reconciliation failure, and legacy external selection', () => {
    const mismatch = mapAgentRuntimeState({
      binding: HERMES_ACTIVE,
      localState: { ...LOCAL, installationId: 'other-installation' },
      operation: null,
    });
    expect(mismatch).toMatchObject({
      selectorValue: 'index', visualState: 'needs-attention', canRetry: true, canDisconnect: true,
    });
    expect(mismatch.statusLine).toContain('does not match');

    const failed = mapAgentRuntimeState({
      binding: INDEX,
      localState: LOCAL,
      operation: {
        kind: 'reconcile', status: 'failed', stage: 'rollback',
        errorCode: 'secret native detail /Users/alice/.hermes',
      },
    });
    expect(failed).toMatchObject({
      selectorValue: 'index', visualState: 'needs-attention', canRetry: true, canDisconnect: true,
    });
    expect(failed.statusLine).toContain('server rollback');
    expect(failed.statusLine).not.toContain('secret');
    expect(failed.statusLine).not.toContain('/Users');

    const ownerMismatch = mapAgentRuntimeState({
      binding: null,
      localState: { ...LOCAL, ownerId: 'owner-A' },
      operation: {
        kind: 'reconcile', status: 'failed', stage: 'inspect',
        errorCode: 'owner_mismatch',
      },
    });
    expect(ownerMismatch).toEqual({
      selectorValue: 'index', visualState: 'needs-attention',
      statusLine: 'Hermes recovery belongs to another signed-in owner. Its schedule is paused for that owner to recover later.',
      canRetry: false, canDisconnect: false, retryAction: null,
    });

    const ownerUnattributed = mapAgentRuntimeState({
      binding: null,
      localState: { ...LOCAL, ownerId: null, scheduleEnabled: false },
      operation: {
        kind: 'reconcile', status: 'failed', stage: 'inspect',
        errorCode: 'owner_unattributed',
      },
    });
    expect(ownerUnattributed).toEqual({
      selectorValue: 'index', visualState: 'needs-attention',
      statusLine: 'An older Hermes installation has no owner identity. Its schedule is paused; retry to reprovision it for this signed-in owner.',
      canRetry: true, canDisconnect: false, retryAction: 'select-hermes',
    });

    const legacy = mapAgentRuntimeState({
      binding: { ...HERMES_ACTIVE, selectedRuntime: 'external' },
      localState: LOCAL,
      operation: null,
    });
    expect(legacy).toEqual({
      selectorValue: 'index',
      visualState: 'needs-attention',
      statusLine: 'A legacy external runtime is selected. Select Index before connecting Hermes.',
      canRetry: true,
      canDisconnect: true,
      retryAction: 'reconcile',
    });
  });

  it('requires complete matching enabled local wiring before reporting Hermes active', () => {
    const incompleteStates = [
      null,
      { ...LOCAL, installationId: null, scheduleEnabled: true },
      { ...LOCAL, executorId: null, scheduleEnabled: true },
      { ...LOCAL, setupAttemptId: null, scheduleEnabled: true },
      { ...LOCAL, pluginInstalled: false, scheduleEnabled: true },
      { ...LOCAL, negotiatorMode: false, scheduleEnabled: true },
      { ...LOCAL, schedulePresent: false, scheduleEnabled: true },
      { ...LOCAL, scheduleEnabled: false },
      { ...LOCAL, executorId: 'wrong-executor', scheduleEnabled: true },
    ];
    for (const localState of incompleteStates) {
      expect(mapAgentRuntimeState({ binding: HERMES_ACTIVE, localState, operation: null })).toMatchObject({
        selectorValue: 'index', visualState: 'needs-attention', canRetry: true,
      });
    }
    expect(mapAgentRuntimeState({
      binding: { ...HERMES_ACTIVE, executor: { ...HERMES_ACTIVE.executor, status: 'inactive' } },
      localState: { ...LOCAL, scheduleEnabled: true },
      operation: null,
    })).toMatchObject({ selectorValue: 'index', visualState: 'needs-attention' });
  });

  it('keeps routine Index bootstrap honest and derives retry from the current condition', () => {
    expect(mapAgentRuntimeState({
      binding: INDEX, localState: null,
      operation: { kind: 'reconcile', status: 'running' },
    })).toMatchObject({
      selectorValue: 'index', visualState: 'index', retryAction: null,
    });
    expect(mapAgentRuntimeState({
      binding: { ...HERMES_ACTIVE, health: 'stale', indexCovering: true },
      localState: { ...LOCAL, scheduleEnabled: true }, operation: null,
    })).toMatchObject({ retryAction: 'select-hermes', canRetry: true });
    expect(mapAgentRuntimeState({
      binding: HERMES_ACTIVE,
      localState: { ...LOCAL, executorId: 'wrong', scheduleEnabled: true },
      operation: null,
    })).toMatchObject({ retryAction: 'reconcile', canRetry: true });
    expect(mapAgentRuntimeState({ binding: INDEX, localState: null, operation: null }))
      .toMatchObject({ retryAction: null, canRetry: false });
  });

  it('gives operation and wiring mismatch precedence, then stale covering precedence', () => {
    expect(mapAgentRuntimeState({
      binding: HERMES_ACTIVE,
      localState: { ...LOCAL, scheduleEnabled: true },
      operation: { kind: 'select-index', status: 'running' },
    })).toMatchObject({ selectorValue: 'index', visualState: 'connecting' });

    expect(mapAgentRuntimeState({
      binding: { ...HERMES_ACTIVE, health: 'stale', indexCovering: true },
      localState: { ...LOCAL, executorId: 'wrong-executor', scheduleEnabled: true },
      operation: null,
    })).toMatchObject({ selectorValue: 'index', visualState: 'needs-attention' });

    expect(mapAgentRuntimeState({
      binding: { ...HERMES_ACTIVE, health: 'stale', indexCovering: true },
      localState: { ...LOCAL, scheduleEnabled: true },
      operation: null,
    })).toMatchObject({ selectorValue: 'hermes', visualState: 'unavailable' });

    for (const contradictory of [
      { ...HERMES_ACTIVE, indexCovering: true },
      { ...HERMES_ACTIVE, health: 'stale', indexCovering: false },
    ]) {
      expect(mapAgentRuntimeState({
        binding: contradictory,
        localState: { ...LOCAL, scheduleEnabled: true },
        operation: null,
      })).toMatchObject({ selectorValue: 'index', visualState: 'needs-attention' });
    }
  });
});

describe('queue-aware Hermes bridge bounds', () => {
  function bridgeHarness() {
    const messages = [];
    const timers = [];
    let sequence = 0;
    const bridge = createHermesRuntimeBridge({
      postMessage: (message) => messages.push(message),
      createRequestId: () => `request-${++sequence}`,
      setTimeoutImpl: (callback, duration) => {
        const timer = { callback, duration, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeoutImpl: (timer) => { timer.cleared = true; },
    });
    return { bridge, messages, timers };
  }

  it('starts each execution timeout only after trusted native dequeue progress', async () => {
    const h = bridgeHarness();
    for (const command of Object.keys(HERMES_RUNTIME_TIMEOUTS_MS)) {
      const payload = command === 'inspect' ? {} : { setupAttemptId: 'setup-current' };
      const promise = h.bridge.request(command, payload);
      const message = h.messages.at(-1);
      const queueTimer = h.timers.at(-1);
      expect(queueTimer.duration).toBe(HERMES_RUNTIME_QUEUE_WAIT_TIMEOUT_MS);
      expect(h.bridge.receiveProgress({
        requestId: message.requestId, event: 'started', credential: 'must-not-be-trusted',
      })).toBe(true);
      expect(queueTimer.cleared).toBe(true);
      expect(h.timers.at(-1).duration).toBe(HERMES_RUNTIME_TIMEOUTS_MS[command]);
      expect(h.bridge.receive({ requestId: message.requestId, ok: true, stage: command })).toBe(true);
      await expect(promise).resolves.toMatchObject({ ok: true });
    }
    expect(HERMES_RUNTIME_QUEUE_WAIT_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 60_000);
    expect(HERMES_RUNTIME_TIMEOUTS_MS.configureDisabled).toBeGreaterThanOrEqual(5 * 60_000);
    expect(HERMES_RUNTIME_TIMEOUTS_MS.disconnect).toBeGreaterThanOrEqual(5 * 60_000);
    expect(HERMES_RUNTIME_TIMEOUTS_MS.enable).toBeGreaterThanOrEqual(3 * 60_000);
  });

  it('bounds queue wait separately and ignores late progress/results after timeout', async () => {
    const h = bridgeHarness();
    const timedOut = h.bridge.request('enable', { setupAttemptId: 'setup-1' });
    const requestId = h.messages.at(-1).requestId;
    h.timers.at(-1).callback();
    await expect(timedOut).rejects.toMatchObject({ code: 'bridge_queue_timeout' });
    expect(h.bridge.pendingCount()).toBe(0);
    expect(h.bridge.receiveProgress({ requestId, event: 'started' })).toBe(false);
    expect(h.bridge.receive({ requestId, ok: true })).toBe(false);
  });

  it('marks an admitted aborted caller stale but waits for native final before rejecting', async () => {
    const h = bridgeHarness();
    const controller = new AbortController();
    const pending = h.bridge.request(
      'configureDisabled',
      { setupAttemptId: 'setup-1', credential: 'secret' },
      { signal: controller.signal },
    );
    const requestId = h.messages.at(-1).requestId;
    expect(h.bridge.receiveProgress({ requestId, event: 'started' })).toBe(true);
    controller.abort();
    let settled = false;
    pending.finally(() => { settled = true; }).catch(() => {});
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(h.bridge.pendingCount()).toBe(1);
    expect(h.bridge.receive({ requestId, ok: true, stage: 'scheduleDisabled' })).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    expect(h.bridge.pendingCount()).toBe(0);
  });

  it('holds an abort-after-post-before-started request until native final so compensation cannot race admission', async () => {
    const h = bridgeHarness();
    const controller = new AbortController();
    let compensationStarted = false;
    const pending = h.bridge.request(
      'disable', { setupAttemptId: 'setup-1' }, { signal: controller.signal },
    );
    const requestId = h.messages.at(-1).requestId;
    const compensated = pending.catch((error) => {
      compensationStarted = true;
      throw error;
    });

    controller.abort();
    await Promise.resolve();
    expect(compensationStarted).toBe(false);
    expect(h.bridge.pendingCount()).toBe(1);
    expect(h.bridge.receive({ requestId, ok: true, stage: 'disabled' })).toBe(true);
    await expect(compensated).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    expect(compensationStarted).toBe(true);
    expect(h.timers[0].cleared).toBe(true);
    expect(h.bridge.pendingCount()).toBe(0);
    expect(h.bridge.receiveProgress({ requestId, event: 'started' })).toBe(false);
    expect(h.bridge.receive({ requestId, ok: true })).toBe(false);
  });

  it('releases a stale admitted request at execution timeout and ignores every late callback', async () => {
    const h = bridgeHarness();
    const controller = new AbortController();
    const pending = h.bridge.request(
      'enable', { setupAttemptId: 'setup-1' }, { signal: controller.signal },
    );
    const requestId = h.messages.at(-1).requestId;
    expect(h.bridge.receiveProgress({ requestId, event: 'started' })).toBe(true);
    controller.abort();
    const executionTimer = h.timers.at(-1);
    executionTimer.callback();
    await expect(pending).rejects.toMatchObject({ code: 'bridge_timeout' });
    expect(h.bridge.pendingCount()).toBe(0);
    expect(h.bridge.receiveProgress({ requestId, event: 'started' })).toBe(false);
    expect(h.bridge.receive({ requestId, ok: true })).toBe(false);
  });

  it('releases a stale posted request at queue-wait timeout and ignores every late callback', async () => {
    const h = bridgeHarness();
    const controller = new AbortController();
    const pending = h.bridge.request(
      'disable', { setupAttemptId: 'setup-1' }, { signal: controller.signal },
    );
    const requestId = h.messages.at(-1).requestId;
    controller.abort();
    h.timers.at(-1).callback();
    await expect(pending).rejects.toMatchObject({ code: 'bridge_queue_timeout' });
    expect(h.bridge.pendingCount()).toBe(0);
    expect(h.bridge.receiveProgress({ requestId, event: 'started' })).toBe(false);
    expect(h.bridge.receive({ requestId, ok: true })).toBe(false);
  });

  it('rejects only signals already aborted before post without dispatching native work', async () => {
    const h = bridgeHarness();
    const controller = new AbortController();
    controller.abort();
    await expect(h.bridge.request(
      'disable', { setupAttemptId: 'setup-1' }, { signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    expect(h.messages).toEqual([]);
    expect(h.bridge.pendingCount()).toBe(0);
  });
});

describe('bounded server-observed health wait', () => {
  it('polls the binding until the matching executor is active', async () => {
    const replies = [
      { ...HERMES_ACTIVE, health: 'never-seen', indexCovering: true },
      HERMES_ACTIVE,
    ];
    let sleeps = 0;
    const result = await waitForHermesHealth({
      api: { getRuntimeBinding: async () => replies.shift() },
      installationId: 'installation-local',
      executorId: 'executor-hermes',
      timeoutMs: 10,
      pollIntervalMs: 1,
      now: (() => { let value = 0; return () => value++; })(),
      sleep: async () => { sleeps += 1; },
    });
    expect(result).toEqual(HERMES_ACTIVE);
    expect(sleeps).toBe(1);
  });

  it('retries transient refresh failures without widening the health window', async () => {
    let calls = 0;
    const result = await waitForHermesHealth({
      api: { getRuntimeBinding: async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary network failure');
        return HERMES_ACTIVE;
      } },
      installationId: 'installation-local',
      executorId: 'executor-hermes',
      timeoutMs: 20,
      pollIntervalMs: 1,
      sleep: async () => {},
    });
    expect(result).toEqual(HERMES_ACTIVE);
    expect(calls).toBe(2);
  });

  it('bounds even a refresh call that never settles', async () => {
    const startedAt = performance.now();
    await expect(waitForHermesHealth({
      api: { getRuntimeBinding: async () => new Promise(() => {}) },
      installationId: 'installation-local',
      executorId: 'executor-hermes',
      timeoutMs: 15,
      pollIntervalMs: 100,
    })).rejects.toMatchObject({ code: 'health_timeout' });
    expect(performance.now() - startedAt).toBeLessThan(80);
  });

  it('clamps sleep to the remaining wall-clock budget', async () => {
    const sleeps = [];
    const startedAt = performance.now();
    await expect(waitForHermesHealth({
      api: { getRuntimeBinding: async () => ({ ...HERMES_ACTIVE, health: 'never-seen' }) },
      installationId: 'installation-local',
      executorId: 'executor-hermes',
      timeoutMs: 15,
      pollIntervalMs: 250,
      sleep: (duration) => {
        sleeps.push(duration);
        return new Promise((resolve) => setTimeout(resolve, duration));
      },
    })).rejects.toMatchObject({ code: 'health_timeout' });
    expect(sleeps[0]).toBeLessThanOrEqual(15);
    expect(performance.now() - startedAt).toBeLessThan(80);
  });

  it('races a nonsettling injected sleep against the wall-clock deadline', async () => {
    const startedAt = performance.now();
    await expect(waitForHermesHealth({
      api: { getRuntimeBinding: async () => ({ ...HERMES_ACTIVE, health: 'never-seen' }) },
      installationId: 'installation-local',
      executorId: 'executor-hermes',
      timeoutMs: 15,
      pollIntervalMs: 1,
      sleep: async () => new Promise(() => {}),
    })).rejects.toMatchObject({ code: 'health_timeout' });
    expect(performance.now() - startedAt).toBeLessThan(80);
  });

  it('uses a bounded timeout and rejects a mismatched active executor', async () => {
    let calls = 0;
    await expect(waitForHermesHealth({
      api: { getRuntimeBinding: async () => {
        calls += 1;
        return {
          ...HERMES_ACTIVE,
          executor: { ...HERMES_ACTIVE.executor, id: 'newer-executor' },
        };
      } },
      installationId: 'installation-local',
      executorId: 'executor-hermes',
      timeoutMs: 2,
      pollIntervalMs: 1,
      now: (() => { let value = 0; return () => value++; })(),
      sleep: async () => {},
    })).rejects.toMatchObject({ code: 'health_timeout' });
    expect(calls).toBeLessThanOrEqual(3);
  });
});
