import { describe, expect, it } from 'bun:test';

import {
  bootstrapHermesRuntime,
  createAgentRuntimeCoordinator,
  createLocalStorageSagaJournal,
  disconnectHermesSaga,
  runViewRuntimeAction,
  reconcileHermesSaga,
  runHermesSelectionSaga,
  selectIndexRuntime,
} from './agent-runtime-saga.mjs';

const OWNER = '00000000-0000-4000-8000-000000000000';
const OTHER_OWNER = '00000000-0000-4000-8000-000000000099';
const INSTALLATION = '00000000-0000-4000-8000-000000000001';
const EXECUTOR = '00000000-0000-4000-8000-000000000002';
const ATTEMPT = '00000000-0000-4000-8000-000000000003';
const KEY = 'transient-secret-key';
const INDEX = { selectedRuntime: 'index', executor: null, health: 'never-seen', indexCovering: true };
const ACTIVE = {
  selectedRuntime: 'hermes',
  executor: { id: EXECUTOR, installationId: INSTALLATION, status: 'active', lastNegotiationPickupAt: '2026-08-07T00:00:00.000Z' },
  health: 'active', indexCovering: false,
};
const LOCAL_DISABLED = {
  ownerId: OWNER,
  installationId: INSTALLATION, executorId: EXECUTOR, pluginInstalled: true,
  negotiatorMode: true, schedulePresent: true, scheduleEnabled: false, setupAttemptId: ATTEMPT,
};
const LOCAL_ENABLED = { ...LOCAL_DISABLED, scheduleEnabled: true };

function selectionHarness({ failAt, rolledBack = true } = {}) {
  const calls = [];
  const fail = (stage) => {
    if (failAt === stage) {
      const error = new Error(`${stage} failed`);
      error.code = `${stage}_failed`;
      throw error;
    }
  };
  const api = {
    prepareHermesRuntime: async (installationId, setupAttemptId) => {
      calls.push(['prepare', installationId, setupAttemptId]);
      fail('prepare');
      return {
        binding: INDEX, executorId: EXECUTOR, setupAttemptId,
        credential: { id: 'key-id', key: KEY },
      };
    },
    setRuntimeBinding: async (body) => {
      calls.push(['set', body]);
      fail('activate');
      return ACTIVE;
    },
    rollbackHermesRuntime: async (setupAttemptId) => {
      calls.push(['rollback', setupAttemptId]);
      fail('rollback');
      return { rolledBack };
    },
  };
  const nativeRuntime = async (command, payload = {}) => {
    calls.push([`native:${command}`, { ...payload }]);
    fail(command === 'configureDisabled' ? 'configure' : command);
    const stage = command === 'configureDisabled'
      ? 'scheduleDisabled'
      : command === 'enable'
        ? 'awaitingHeartbeat'
        : command === 'confirmHealthy'
          ? 'confirmed_healthy'
          : command === 'disconnect'
            ? 'disconnected'
            : command;
    return {
      ok: true,
      stage,
      state: command === 'configureDisabled'
        ? LOCAL_DISABLED
        : command === 'disconnect'
          ? { ...LOCAL_DISABLED, setupAttemptId: null }
          : LOCAL_ENABLED,
    };
  };
  const waitForHealth = async (input) => {
    calls.push(['health', input]);
    fail('heartbeat');
    return ACTIVE;
  };
  return { api, nativeRuntime, waitForHealth, calls };
}

function callNames(calls) { return calls.map(([name]) => name); }

describe('Hermes selection saga', () => {
  it('configures disabled, generation-matched activation, enable, bounded health, then confirms healthy', async () => {
    const h = selectionHarness();
    const result = await runHermesSelectionSaga({
      ...h, ownerId: OWNER, installationId: INSTALLATION, setupAttemptId: ATTEMPT,
    });

    expect(callNames(h.calls)).toEqual([
      'prepare', 'native:configureDisabled', 'set', 'native:enable', 'health', 'native:confirmHealthy',
    ]);
    expect(h.calls[1][1]).toEqual({
      ownerId: OWNER,
      installationId: INSTALLATION,
      executorId: EXECUTOR,
      setupAttemptId: ATTEMPT,
      credential: KEY,
    });
    expect(h.calls[2][1]).toEqual({
      runtime: 'hermes', installationId: INSTALLATION, executorId: EXECUTOR, setupAttemptId: ATTEMPT,
    });
    expect(h.calls[3][1]).toEqual({ ownerId: OWNER, setupAttemptId: ATTEMPT });
    expect(h.calls[4][1]).toEqual({ installationId: INSTALLATION, executorId: EXECUTOR, setupAttemptId: ATTEMPT });
    expect(h.calls[5][1]).toEqual({ ownerId: OWNER, setupAttemptId: ATTEMPT });
    expect(result).toEqual({ binding: ACTIVE, localState: LOCAL_ENABLED });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('compensates apparent prepare response loss and every post-prepare failure server-first', async () => {
    for (const failAt of ['prepare', 'configure', 'activate', 'enable', 'heartbeat', 'confirmHealthy']) {
      const h = selectionHarness({ failAt });
      await expect(runHermesSelectionSaga({
        ...h, ownerId: OWNER, installationId: INSTALLATION, setupAttemptId: ATTEMPT,
      })).rejects.toThrow(`${failAt} failed`);

      const names = callNames(h.calls);
      // A prepare response can be lost after the server commits, so even an
      // apparent prepare failure goes through idempotent rollback/read/cleanup.
      expect(names).toContain('rollback');
      expect(names).toContain('native:disconnect');
      expect(names.indexOf('rollback')).toBeLessThan(names.indexOf('native:disconnect'));
      expect(h.calls.find(([name]) => name === 'rollback')[1]).toBe(ATTEMPT);
      expect(h.calls.find(([name]) => name === 'native:disconnect')[1]).toEqual({ ownerId: OWNER, setupAttemptId: ATTEMPT });
      expect(JSON.stringify(h.calls.filter(([name]) => name !== 'native:configureDisabled'))).not.toContain(KEY);
    }
  });

  it('preserves local state when rollback/read cannot prove the old server generation absent', async () => {
    const stale = selectionHarness({ failAt: 'heartbeat', rolledBack: false });
    await expect(runHermesSelectionSaga({
      ...stale, ownerId: OWNER, installationId: INSTALLATION, setupAttemptId: ATTEMPT,
    })).rejects.toThrow('heartbeat failed');
    expect(callNames(stale.calls)).toContain('rollback');
    expect(callNames(stale.calls)).not.toContain('native:disconnect');

    const failed = selectionHarness({ failAt: 'enable' });
    failed.api.rollbackHermesRuntime = async (attempt) => {
      failed.calls.push(['rollback', attempt]);
      throw new Error('rollback unavailable');
    };
    await expect(runHermesSelectionSaga({
      ...failed, ownerId: OWNER, installationId: INSTALLATION, setupAttemptId: ATTEMPT,
    })).rejects.toThrow('enable failed');
    expect(callNames(failed.calls)).not.toContain('native:disconnect');
  });

  it('repeated selection converges through the injected boundaries without exposing credentials', async () => {
    const h = selectionHarness();
    await runHermesSelectionSaga({ ...h, ownerId: OWNER, installationId: INSTALLATION, setupAttemptId: ATTEMPT });
    const second = '00000000-0000-4000-8000-000000000004';
    h.nativeRuntime = async (command, payload = {}) => {
      h.calls.push([`native:${command}`, { ...payload }]);
      const state = {
        ...(command === 'configureDisabled' ? LOCAL_DISABLED : LOCAL_ENABLED),
        setupAttemptId: second,
      };
      return {
        ok: true,
        stage: command === 'configureDisabled' ? 'scheduleDisabled'
          : command === 'enable' ? 'awaitingHeartbeat' : 'confirmed_healthy',
        state,
      };
    };
    await runHermesSelectionSaga({ ...h, ownerId: OWNER, installationId: INSTALLATION, setupAttemptId: second });
    expect(callNames(h.calls).filter((name) => name === 'prepare')).toHaveLength(2);
    expect(callNames(h.calls).filter((name) => name === 'native:configureDisabled')).toHaveLength(2);
    expect(callNames(h.calls).filter((name) => name === 'native:confirmHealthy')).toHaveLength(2);
  });

  it('rejects overlapping stale same-installation/same-executor native no-ops and returns only matching confirmed state', async () => {
    const newerAttempt = '00000000-0000-4000-8000-000000000004';
    const newerState = { ...LOCAL_ENABLED, setupAttemptId: newerAttempt };
    let releaseOldEnable;
    const oldEnableReached = new Promise((resolve) => { releaseOldEnable = resolve; });
    let continueOldEnable;
    const oldEnableBlocked = new Promise((resolve) => { continueOldEnable = resolve; });
    let currentAttempt = ATTEMPT;
    const rollbackCalls = [];
    const api = {
      prepareHermesRuntime: async (_installationId, setupAttemptId) => ({
        binding: INDEX, executorId: EXECUTOR, setupAttemptId, credential: { id: 'key', key: KEY },
      }),
      setRuntimeBinding: async () => ACTIVE,
      rollbackHermesRuntime: async (setupAttemptId) => {
        rollbackCalls.push(setupAttemptId);
        return { rolledBack: setupAttemptId === currentAttempt };
      },
    };
    const nativeRuntime = async (command, payload) => {
      if (command === 'configureDisabled') {
        currentAttempt = payload.setupAttemptId;
        return { ok: true, stage: 'scheduleDisabled', state: { ...LOCAL_DISABLED, setupAttemptId: currentAttempt } };
      }
      if (command === 'enable' && payload.setupAttemptId === ATTEMPT) {
        releaseOldEnable();
        await oldEnableBlocked;
        return { ok: true, stage: 'enable_noop', state: newerState };
      }
      if (command === 'enable') {
        return { ok: true, stage: 'awaitingHeartbeat', state: newerState };
      }
      if (command === 'confirmHealthy') {
        return { ok: true, stage: 'confirmed_healthy', state: newerState };
      }
      if (command === 'disconnect') {
        throw new Error('stale generation must not clean newer local wiring');
      }
      throw new Error(`unexpected ${command}`);
    };
    const waitForHealth = async () => ACTIVE;

    const oldSelection = runHermesSelectionSaga({
      api, nativeRuntime, ownerId: OWNER, installationId: INSTALLATION, setupAttemptId: ATTEMPT, waitForHealth,
    });
    await oldEnableReached;
    const newerSelection = runHermesSelectionSaga({
      api, nativeRuntime, ownerId: OWNER, installationId: INSTALLATION, setupAttemptId: newerAttempt, waitForHealth,
    });
    const newerResult = await newerSelection;
    continueOldEnable();

    expect(newerResult.localState).toEqual(newerState);
    await expect(oldSelection).rejects.toMatchObject({ code: 'native_generation_mismatch' });
    expect(rollbackCalls).toContain(ATTEMPT);
    expect(currentAttempt).toBe(newerAttempt);
  });
});

describe('selection, disconnect, and relaunch reconciliation', () => {
  it('selecting Index updates the server first and only disables matching local scheduling', async () => {
    const calls = [];
    const result = await selectIndexRuntime({
      api: { setRuntimeBinding: async (body) => { calls.push(['set', body]); return INDEX; } },
      nativeRuntime: async (command, payload) => {
        calls.push([command, payload]);
        return { ok: true, stage: 'disabled', state: LOCAL_DISABLED };
      },
      ownerId: OWNER, installationId: INSTALLATION, localState: LOCAL_ENABLED,
    });
    expect(calls).toEqual([
      ['set', { runtime: 'index' }],
      ['disable', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
    ]);
    expect(result).toEqual({ binding: INDEX, localState: LOCAL_DISABLED });
  });

  it('disconnect selects/revokes on the server before exact local cleanup', async () => {
    const calls = [];
    const result = await disconnectHermesSaga({
      api: { disconnectHermesRuntime: async (installationId) => {
        calls.push(['server-disconnect', installationId]); return INDEX;
      } },
      nativeRuntime: async (command, payload) => {
        calls.push([command, payload]); return { ok: true, stage: 'disconnected', state: { ...LOCAL_DISABLED, executorId: null, setupAttemptId: null, pluginInstalled: false, negotiatorMode: false, schedulePresent: false } };
      },
      ownerId: OWNER, installationId: INSTALLATION,
      setupAttemptId: ATTEMPT, executorId: EXECUTOR,
    });
    expect(calls[0]).toEqual(['server-disconnect', INSTALLATION]);
    expect(calls[1]).toEqual(['disconnect', { ownerId: OWNER, setupAttemptId: ATTEMPT }]);
    expect(result.binding).toEqual(INDEX);
    expect(result.localState.schedulePresent).toBe(false);
  });

  it('relaunch rolls back and cleans up every setup journal stage deterministically', async () => {
    const setupStages = ['preparing', 'environmentWritten', 'pluginInstalled', 'scheduleDisabled', 'enabling', 'awaitingHeartbeat'];
    for (const stage of setupStages) {
      const calls = [];
      const result = await reconcileHermesSaga({
        api: {
          rollbackHermesRuntime: async (attempt) => { calls.push(['rollback', attempt]); return { rolledBack: true }; },
          getRuntimeBinding: async () => INDEX,
        },
        nativeRuntime: async (command, payload) => {
          calls.push([command, payload]);
          return { ok: true, stage: 'disconnected', state: { ...LOCAL_DISABLED, pluginInstalled: false, schedulePresent: false, setupAttemptId: null } };
        },
        journal: { stage, setupAttemptId: ATTEMPT, executorId: EXECUTOR, ownerId: OWNER },
        ownerId: OWNER, installationId: INSTALLATION,
      });
      expect(calls.slice(0, 2)).toEqual([
        ['rollback', ATTEMPT],
        ['disconnect', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
      ]);
      expect(result.binding).toEqual(INDEX);
    }
  });

  it('relaunch retries both disconnect journal stages without recreating wiring', async () => {
    for (const stage of ['disconnecting', 'disconnectCleanupComplete']) {
      const calls = [];
      await reconcileHermesSaga({
        api: {
          disconnectHermesRuntime: async (installationId) => { calls.push(['server-disconnect', installationId]); return INDEX; },
          getRuntimeBinding: async () => INDEX,
        },
        nativeRuntime: async (command, payload) => {
          calls.push([command, payload]);
          return { ok: true, stage: 'disconnected', state: { ...LOCAL_DISABLED, pluginInstalled: false, schedulePresent: false, setupAttemptId: null } };
        },
        journal: { stage, setupAttemptId: ATTEMPT, executorId: EXECUTOR, ownerId: OWNER },
        ownerId: OWNER, installationId: INSTALLATION,
      });
      expect(calls).toEqual([
        ['server-disconnect', INSTALLATION],
        ['disconnect', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
      ]);
    }
  });

  it('proves the old server generation absent, then invokes generation-matched native cleanup that no-ops for newer wiring', async () => {
    const calls = [];
    const newerState = { ...LOCAL_ENABLED, setupAttemptId: 'newer-attempt', executorId: 'newer-executor' };
    const newer = {
      ...ACTIVE,
      executor: { ...ACTIVE.executor, id: 'newer-executor' },
      installation: {
        executorId: 'newer-executor', installationId: INSTALLATION,
        setupAttemptId: 'newer-attempt', status: 'active',
      },
    };
    const result = await reconcileHermesSaga({
      api: {
        rollbackHermesRuntime: async () => { calls.push('rollback'); return { rolledBack: false }; },
        getRuntimeBinding: async () => { calls.push('read'); return newer; },
      },
      nativeRuntime: async (command, payload) => {
        calls.push([command, payload]);
        return { ok: true, stage: 'disconnect_noop', state: newerState };
      },
      journal: { stage: 'awaitingHeartbeat', setupAttemptId: ATTEMPT, executorId: EXECUTOR, ownerId: OWNER },
      ownerId: OWNER, installationId: INSTALLATION,
    });
    expect(calls.slice(0, 3)).toEqual([
      'rollback', 'read', ['disconnect', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
    ]);
    expect(result.localState).toEqual(newerState);
  });

  it('returns inspection state unchanged when there is no recovery journal', async () => {
    const result = await reconcileHermesSaga({
      api: { getRuntimeBinding: async () => INDEX },
      nativeRuntime: async () => { throw new Error('not called'); },
      journal: null,
      ownerId: OWNER, installationId: INSTALLATION,
      localState: LOCAL_DISABLED,
    });
    expect(result).toEqual({ binding: INDEX, localState: LOCAL_DISABLED });
  });

  it('default relaunch bootstrap inspects (and therefore pauses) before JS exact rollback and cleanup at every setup stage', async () => {
    for (const stage of ['preparing', 'environmentWritten', 'pluginInstalled', 'scheduleDisabled', 'enabling', 'awaitingHeartbeat']) {
      const calls = [];
      let paused = false;
      const nativeRuntime = async (command, payload) => {
        calls.push([command, payload]);
        if (command === 'inspect') {
          paused = true; // Native inspect contract pauses a partial enabled schedule.
          return { ok: true, stage, state: { ...LOCAL_ENABLED } };
        }
        expect(paused).toBe(true);
        return {
          ok: true,
          stage: 'disconnected',
          state: { ...LOCAL_DISABLED, setupAttemptId: null, schedulePresent: false, pluginInstalled: false },
        };
      };
      const api = {
        rollbackHermesRuntime: async (attempt) => {
          calls.push(['rollback', attempt]);
          expect(paused).toBe(true);
          return { rolledBack: true };
        },
        getRuntimeBinding: async () => INDEX,
      };
      const result = await bootstrapHermesRuntime({ api, nativeRuntime, ownerId: OWNER });
      expect(calls.slice(0, 3)).toEqual([
        ['inspect', { ownerId: OWNER }],
        ['rollback', ATTEMPT],
        ['disconnect', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
      ]);
      expect(result.installationId).toBe(INSTALLATION);
      expect(result.binding).toEqual(INDEX);
    }
  });

  it('default relaunch bootstrap retries server revocation and matching cleanup at every disconnect stage', async () => {
    for (const stage of ['disconnecting', 'disconnectCleanupComplete']) {
      const calls = [];
      const result = await bootstrapHermesRuntime({
        ownerId: OWNER,
        api: {
          disconnectHermesRuntime: async (installationId) => {
            calls.push(['server-disconnect', installationId]);
            return INDEX;
          },
        },
        nativeRuntime: async (command, payload) => {
          calls.push([command, payload]);
          if (command === 'inspect') return { ok: true, stage, state: LOCAL_DISABLED };
          return { ok: true, stage: 'disconnected', state: null };
        },
      });
      expect(calls).toEqual([
        ['inspect', { ownerId: OWNER }],
        ['server-disconnect', INSTALLATION],
        ['disconnect', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
      ]);
      expect(result).toMatchObject({ installationId: INSTALLATION, binding: INDEX, localState: null });
    }
  });
});

function persistentJournalHarness(seed = null) {
  const values = new Map();
  const key = 'index.agent-runtime.saga.v1';
  if (seed !== null) values.set(key, typeof seed === 'string' ? seed : JSON.stringify(seed));
  const storage = {
    getItem: (storageKey) => values.get(storageKey) || null,
    setItem: (storageKey, value) => values.set(storageKey, value),
    removeItem: (storageKey) => values.delete(storageKey),
  };
  return { journal: createLocalStorageSagaJournal(storage), values, key };
}

function persistedOperation(operation, stage, overrides = {}) {
  return {
    version: 1, operation, stage,
    ownerId: OWNER,
    installationId: INSTALLATION,
    setupAttemptId: ATTEMPT,
    executorId: EXECUTOR,
    ...overrides,
  };
}

describe('owner-bound strict JavaScript saga journal', () => {
  it('accepts only exact operation/stage pairs with stage-required nonempty fields', async () => {
    const valid = [
      persistedOperation('select-hermes', 'prepare-pending', { executorId: null }),
      persistedOperation('select-hermes', 'prepared'),
      persistedOperation('select-hermes', 'configured'),
      persistedOperation('select-hermes', 'activated'),
      persistedOperation('select-hermes', 'native-recovery'),
      persistedOperation('select-index', 'server-pending'),
      persistedOperation('select-index', 'server-complete', { setupAttemptId: null, executorId: null }),
      persistedOperation('disconnect', 'server-pending'),
      persistedOperation('disconnect', 'server-complete', { setupAttemptId: null, executorId: null }),
    ];
    for (const record of valid) {
      const { journal } = persistentJournalHarness();
      await expect(journal.save(record)).resolves.toEqual(record);
      await expect(journal.load()).resolves.toEqual(record);
    }

    const invalid = [
      null,
      [],
      { ...persistedOperation('select-hermes', 'prepared'), version: 2 },
      { ...persistedOperation('select-hermes', 'prepared'), operation: 'unknown' },
      persistedOperation('select-index', 'prepared'),
      persistedOperation('disconnect', 'native-recovery'),
      persistedOperation('select-hermes', 'server-pending'),
      persistedOperation('select-hermes', 'prepared', { ownerId: '' }),
      persistedOperation('select-hermes', 'prepared', { installationId: '' }),
      persistedOperation('select-hermes', 'prepared', { setupAttemptId: '' }),
      persistedOperation('select-hermes', 'prepared', { executorId: null }),
      persistedOperation('select-hermes', 'prepare-pending', { executorId: EXECUTOR }),
      persistedOperation('select-index', 'server-pending', { setupAttemptId: ATTEMPT, executorId: null }),
      persistedOperation('disconnect', 'server-complete', { setupAttemptId: null, executorId: EXECUTOR }),
    ];
    for (const record of invalid) {
      const { journal } = persistentJournalHarness();
      await expect(journal.save(record)).rejects.toThrow('Invalid Hermes saga journal');
    }
  });

  it('preserves malformed recovery evidence and never executes or clears it silently', async () => {
    for (const malformed of [
      '{not-json',
      JSON.stringify(persistedOperation('select-index', 'prepared')),
      JSON.stringify(persistedOperation('select-hermes', 'prepared', { ownerId: '' })),
    ]) {
      const { journal, values, key } = persistentJournalHarness(malformed);
      const nativeCalls = [];
      let serverCalls = 0;
      let local = LOCAL_ENABLED;
      await expect(bootstrapHermesRuntime({
        ownerId: OWNER,
        operationStore: journal,
        nativeRuntime: async (command, payload) => {
          nativeCalls.push([command, payload]);
          if (command === 'inspect') return { ok: true, stage: 'inspected', state: local };
          local = { ...local, scheduleEnabled: false };
          return { ok: true, stage: 'disabled', state: local };
        },
        api: { getRuntimeBinding: async () => { serverCalls += 1; return INDEX; } },
      })).rejects.toThrow('Invalid Hermes saga journal');
      expect(nativeCalls).toEqual([
        ['inspect', { ownerId: OWNER }],
        ['disable', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
      ]);
      expect(local.scheduleEnabled).toBe(false);
      expect(serverCalls).toBe(0);
      expect(values.get(key)).toBe(malformed);
    }
  });
});

describe('durable JavaScript operation crash boundaries', () => {
  it('persists only non-secret identifiers before select-Index and disconnect server mutations', async () => {
    for (const operation of ['select-index', 'disconnect']) {
      const { journal, values } = persistentJournalHarness();
      const calls = [];
      const api = {
        setRuntimeBinding: async () => {
          expect((await journal.load())?.stage).toBe('server-pending');
          calls.push('server');
          return INDEX;
        },
        disconnectHermesRuntime: async () => {
          expect((await journal.load())?.stage).toBe('server-pending');
          calls.push('server');
          return INDEX;
        },
      };
      const nativeRuntime = async (command) => {
        expect((await journal.load())?.stage).toBe('server-complete');
        calls.push(command);
        return {
          ok: true,
          stage: operation === 'select-index' ? 'disabled' : 'disconnected',
          state: operation === 'select-index'
            ? { ...LOCAL_DISABLED }
            : { ...LOCAL_DISABLED, setupAttemptId: null },
        };
      };
      if (operation === 'select-index') {
        await selectIndexRuntime({ api, nativeRuntime, operationStore: journal, ownerId: OWNER, installationId: INSTALLATION, localState: LOCAL_ENABLED });
      } else {
        await disconnectHermesSaga({
          api, nativeRuntime, operationStore: journal, ownerId: OWNER,
          installationId: INSTALLATION, setupAttemptId: ATTEMPT, executorId: EXECUTOR,
        });
      }
      expect(calls).toEqual(['server', operation === 'select-index' ? 'disable' : 'disconnect']);
      expect(await journal.load()).toBeNull();
      expect(JSON.stringify([...values.values()])).not.toContain(KEY);
    }
  });

  it('relaunch reasserts each server mutation from every pre/post-response boundary before native completion', async () => {
    for (const operation of ['select-index', 'disconnect']) {
      for (const stage of ['server-pending', 'server-complete']) {
        const { journal } = persistentJournalHarness();
        await journal.save(persistedOperation(operation, stage));
        const calls = [];
        const api = {
          setRuntimeBinding: async () => { calls.push('select-index'); return INDEX; },
          disconnectHermesRuntime: async () => { calls.push('server-disconnect'); return INDEX; },
        };
        const nativeRuntime = async (command) => {
          calls.push(command);
          if (command === 'inspect') return { ok: true, stage: 'inspected', state: LOCAL_ENABLED };
          return {
            ok: true,
            stage: command === 'disable' ? 'disabled' : 'disconnected',
            state: command === 'disable'
              ? LOCAL_DISABLED
              : { ...LOCAL_DISABLED, setupAttemptId: null },
          };
        };
        await bootstrapHermesRuntime({ api, nativeRuntime, operationStore: journal, ownerId: OWNER });
        expect(calls).toEqual(operation === 'select-index'
          ? ['inspect', 'select-index', 'disable']
          : ['inspect', 'server-disconnect', 'disconnect']);
        expect(await journal.load()).toBeNull();
      }
    }
  });

  it('cleans native state after a lost rollback response only when the authoritative read proves the old generation absent', async () => {
    const { journal } = persistentJournalHarness();
    const calls = [];
    const h = selectionHarness({ failAt: 'heartbeat' });
    h.api.rollbackHermesRuntime = async () => {
      calls.push('rollback-committed-response-lost');
      throw new Error('connection reset');
    };
    h.api.getRuntimeBinding = async () => {
      calls.push('authoritative-read');
      return { ...INDEX, installation: {
        executorId: EXECUTOR, installationId: INSTALLATION,
        setupAttemptId: null, status: 'inactive',
      } };
    };
    h.nativeRuntime = async (command, payload) => {
      calls.push(command);
      if (command === 'disconnect') {
        return { ok: true, stage: 'disconnected', state: { ...LOCAL_DISABLED, setupAttemptId: null } };
      }
      return selectionHarness().nativeRuntime(command, payload);
    };
    await expect(runHermesSelectionSaga({
      ...h, operationStore: journal, ownerId: OWNER,
      installationId: INSTALLATION, setupAttemptId: ATTEMPT,
    })).rejects.toThrow('heartbeat failed');
    expect(calls.slice(-3)).toEqual(['rollback-committed-response-lost', 'authoritative-read', 'disconnect']);
    expect(await journal.load()).toBeNull();
  });

  it('preserves the journal and local generation on rollback/read network uncertainty', async () => {
    const { journal } = persistentJournalHarness();
    const h = selectionHarness({ failAt: 'enable' });
    let cleanup = 0;
    h.api.rollbackHermesRuntime = async () => { throw new Error('rollback network uncertain'); };
    h.api.getRuntimeBinding = async () => { throw new Error('read network uncertain'); };
    const successfulNative = h.nativeRuntime;
    h.nativeRuntime = async (command, payload) => {
      if (command === 'disconnect') cleanup += 1;
      if (command === 'enable') throw new Error('enable failed');
      return successfulNative(command, payload);
    };
    await expect(runHermesSelectionSaga({
      ...h, operationStore: journal, ownerId: OWNER,
      installationId: INSTALLATION, setupAttemptId: ATTEMPT,
    })).rejects.toThrow('enable failed');
    expect(cleanup).toBe(0);
    expect(await journal.load()).toMatchObject({ operation: 'select-hermes', setupAttemptId: ATTEMPT });
  });

  it('recovers a server-committed prepare whose response was lost before native setup started', async () => {
    const { journal } = persistentJournalHarness();
    let serverAttempt = null;
    const calls = [];
    const api = {
      prepareHermesRuntime: async (_installation, attempt) => {
        serverAttempt = attempt;
        throw new Error('prepare response lost');
      },
      rollbackHermesRuntime: async (attempt) => {
        calls.push('rollback');
        serverAttempt = null;
        return { rolledBack: attempt === ATTEMPT };
      },
      getRuntimeBinding: async () => ({ ...INDEX, installation: {
        executorId: EXECUTOR, installationId: INSTALLATION,
        setupAttemptId: serverAttempt, status: serverAttempt ? 'active' : 'inactive',
      } }),
    };
    const nativeRuntime = async (command) => {
      calls.push(command);
      return { ok: true, stage: 'disconnected', state: { ...LOCAL_DISABLED, setupAttemptId: null } };
    };
    await expect(runHermesSelectionSaga({
      api, nativeRuntime, operationStore: journal, ownerId: OWNER,
      installationId: INSTALLATION, setupAttemptId: ATTEMPT,
      waitForHealth: async () => ACTIVE,
    })).rejects.toThrow('prepare response lost');
    expect(calls).toEqual(['rollback', 'disconnect']);
    expect(serverAttempt).toBeNull();
    expect(await journal.load()).toBeNull();
  });
});

describe('authentication epoch and operation revision coordinator', () => {
  it('pauses inspected owner A1, preserves pending A2 and all server evidence across owner B, then lets A recover A2', async () => {
    const pendingAttempt = '00000000-0000-4000-8000-000000000004';
    const seeded = persistedOperation('select-hermes', 'prepare-pending', {
      setupAttemptId: pendingAttempt, executorId: null,
    });
    const { journal } = persistentJournalHarness(seeded);
    const events = [];
    let serverGeneration = pendingAttempt;
    let serverKey = KEY;
    let local = { ...LOCAL_ENABLED, ownerId: OWNER }; // confirmed healthy A1; no native journal
    const nativeRuntime = async (command, payload = {}) => {
      events.push([`native:${command}`, payload]);
      if (command === 'inspect') return { ok: true, stage: 'inspected', state: local };
      if (command === 'disable') {
        expect(payload).toEqual({ ownerId: OWNER, setupAttemptId: ATTEMPT });
        local = { ...local, scheduleEnabled: false };
        return { ok: true, stage: 'disabled', state: local };
      }
      if (command === 'disconnect') {
        expect(payload).toEqual({ ownerId: OWNER, setupAttemptId: pendingAttempt });
        return { ok: true, stage: 'disconnect_noop', state: local };
      }
      throw new Error(`unexpected ${command}`);
    };
    const apiA = {
      rollbackHermesRuntime: async (attempt) => {
        events.push(['A:rollback', attempt]);
        if (attempt === serverGeneration) { serverGeneration = null; serverKey = null; return { rolledBack: true }; }
        return { rolledBack: false };
      },
      getRuntimeBinding: async () => { events.push(['A:get']); return ACTIVE; },
    };
    let ownerBServerCalls = 0;
    const apiB = {
      rollbackHermesRuntime: async () => { ownerBServerCalls += 1; throw new Error('owner B server call'); },
      getRuntimeBinding: async () => { ownerBServerCalls += 1; throw new Error('owner B server call'); },
    };
    const states = [];
    const coordinator = createAgentRuntimeCoordinator({
      nativeRuntime, operationStore: journal,
      waitForHealth: async () => ACTIVE,
      onState: (state) => states.push(state),
    });

    await expect(coordinator.changeOwner({
      ownerId: OTHER_OWNER, ownerCredential: 'owner-B-exact', api: apiB,
    })).rejects.toMatchObject({ code: 'owner_mismatch', stage: 'inspect' });
    expect(events.slice(0, 2)).toEqual([
      ['native:inspect', { ownerId: OTHER_OWNER }],
      ['native:disable', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
    ]);
    expect(ownerBServerCalls).toBe(0);
    expect(serverGeneration).toBe(pendingAttempt);
    expect(serverKey).toBe(KEY);
    expect(local).toMatchObject({ ownerId: OWNER, setupAttemptId: ATTEMPT, scheduleEnabled: false });
    expect(await journal.load()).toEqual(seeded);
    expect(coordinator.snapshot().operation).toMatchObject({
      status: 'failed', errorCode: 'owner_mismatch', stage: 'inspect',
    });
    expect(states.at(-1).operation.errorCode).toBe('owner_mismatch');

    await coordinator.changeOwner({
      ownerId: OWNER, ownerCredential: 'owner-A-exact', api: apiA,
    });
    expect(events.find(([name]) => name === 'A:rollback')).toEqual(['A:rollback', pendingAttempt]);
    expect(serverGeneration).toBeNull();
    expect(serverKey).toBeNull();
    expect(local).toMatchObject({ ownerId: OWNER, setupAttemptId: ATTEMPT, scheduleEnabled: false });
    expect(await journal.load()).toBeNull();
    expect(coordinator.snapshot()).toMatchObject({ binding: ACTIVE, localState: local });
    coordinator.dispose();
  });

  it('surfaces a paused pre-owner installation as retryable reprovisioning and lets the signed-in owner retry normally', async () => {
    const { journal } = persistentJournalHarness();
    let local = {
      ...LOCAL_ENABLED, ownerId: null, executorId: null,
    };
    const calls = [];
    const nativeRuntime = async (command, payload = {}) => {
      calls.push([`native:${command}`, payload]);
      if (command === 'inspect') {
        local = { ...local, scheduleEnabled: false }; // native safety action precedes its error
        return {
          ok: false, stage: 'inspect', errorCode: 'owner_unattributed', retryable: true,
          state: local,
        };
      }
      if (command === 'configureDisabled') {
        local = {
          ...local, ownerId: payload.ownerId, executorId: payload.executorId,
          setupAttemptId: payload.setupAttemptId, scheduleEnabled: false,
        };
        return { ok: true, stage: 'scheduleDisabled', state: local };
      }
      if (command === 'enable') {
        local = { ...local, scheduleEnabled: true };
        return { ok: true, stage: 'awaitingHeartbeat', state: local };
      }
      if (command === 'confirmHealthy') {
        return { ok: true, stage: 'confirmed_healthy', state: local };
      }
      throw new Error(`unexpected ${command}`);
    };
    const binding = {
      ...ACTIVE,
      executor: { ...ACTIVE.executor, installationId: INSTALLATION },
    };
    const api = {
      prepareHermesRuntime: async (_installationId, setupAttemptId) => ({
        binding: INDEX, executorId: EXECUTOR, setupAttemptId,
        credential: { id: 'replacement-key', key: KEY },
      }),
      setRuntimeBinding: async () => binding,
      rollbackHermesRuntime: async () => ({ rolledBack: true }),
      getRuntimeBinding: async () => INDEX,
    };
    const coordinator = createAgentRuntimeCoordinator({
      nativeRuntime, operationStore: journal,
      waitForHealth: async () => binding,
    });

    await expect(coordinator.changeOwner({
      ownerId: OWNER, ownerCredential: 'original-owner', api,
    })).rejects.toMatchObject({
      code: 'owner_unattributed',
      state: { ownerId: null, setupAttemptId: ATTEMPT, scheduleEnabled: false },
    });
    expect(coordinator.snapshot()).toMatchObject({
      localState: { ownerId: null, setupAttemptId: ATTEMPT, scheduleEnabled: false },
      operation: { status: 'failed', errorCode: 'owner_unattributed' },
    });

    await coordinator.retry();
    expect(calls.map(([name]) => name)).toEqual([
      'native:inspect', 'native:configureDisabled', 'native:enable', 'native:confirmHealthy',
    ]);
    expect(coordinator.snapshot()).toMatchObject({
      binding,
      localState: { ownerId: OWNER, executorId: EXECUTOR, scheduleEnabled: true },
      operation: null,
    });
    coordinator.dispose();
  });

  it('fences late interval refreshes behind auth epoch, operation revision, and AbortController', async () => {
    const { journal } = persistentJournalHarness();
    let resolveRefresh;
    const lateRefresh = new Promise((resolve) => { resolveRefresh = resolve; });
    let reads = 0;
    let refreshSignal = null;
    const newest = { ...INDEX, marker: 'new-operation-success' };
    const api = {
      getRuntimeBinding: async (_installationId, options = {}) => {
        reads += 1;
        if (reads === 1) return INDEX;
        refreshSignal = options.signal;
        return lateRefresh;
      },
      setRuntimeBinding: async () => newest,
    };
    const coordinator = createAgentRuntimeCoordinator({
      operationStore: journal,
      nativeRuntime: async (command) => {
        expect(command).toBe('inspect');
        return {
          ok: true, stage: 'inspected',
          state: { ...LOCAL_DISABLED, executorId: null, setupAttemptId: null,
            pluginInstalled: false, negotiatorMode: false, schedulePresent: false },
        };
      },
      waitForHealth: async () => ACTIVE,
    });
    await coordinator.changeOwner({ ownerId: OWNER, ownerCredential: 'owner-A', api });
    const refresh = coordinator.refresh();
    await Promise.resolve();
    await coordinator.selectIndex();
    expect(refreshSignal?.aborted).toBe(true);
    resolveRefresh({ ...ACTIVE, marker: 'stale-refresh' });
    await refresh;
    expect(coordinator.snapshot().binding).toEqual(newest);
    coordinator.dispose();
  });

  it('view action wrappers consume expected rejected coordinator promises without unhandled rejection', async () => {
    const unhandled = [];
    const listener = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      const expected = Object.assign(new Error('published failure'), { code: 'owner_mismatch' });
      expect(runViewRuntimeAction(() => Promise.reject(expected))).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });
});
