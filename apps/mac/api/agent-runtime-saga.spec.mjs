import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHermesRuntimeBridge } from './agent-runtime.mjs';
import {
  bootstrapHermesRuntime,
  createAgentRuntimeCoordinator,
  createNativeSagaJournal,
  disconnectHermesSaga,
  prepareHermesLogout,
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
  executor: { id: EXECUTOR, installationId: INSTALLATION, setupAttemptId: ATTEMPT, status: 'active', lastNegotiationPickupAt: '2026-08-07T00:00:00.000Z' },
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
  it('selects only the exact active connector authority without preparing or carrying plaintext', async () => {
    const calls = [];
    const connectorStatus = {
      connected: true, health: 'active', revocationPending: false,
      installationId: INSTALLATION, agentId: EXECUTOR, setupAttemptId: ATTEMPT,
      actions: [
        'manage:identity', 'manage:premises', 'manage:intents',
        'manage:networks', 'manage:opportunities', 'manage:negotiations',
      ],
      expiresAt: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const api = {
      prepareHermesRuntime: async () => { throw new Error('legacy prepare must not run'); },
      getRuntimeBinding: async (installationId) => {
        calls.push(['get', installationId]);
        return { ...INDEX, installation: {
          executorId: EXECUTOR, installationId: INSTALLATION,
          setupAttemptId: ATTEMPT, status: 'active',
        } };
      },
      setRuntimeBinding: async (body) => { calls.push(['set', body]); return ACTIVE; },
    };
    const nativeRuntime = async (command, payload = {}) => {
      calls.push([`native:${command}`, payload]);
      if (command === 'connectorStatus') return { ok: true, stage: 'connector_status', connectorStatus };
      if (command === 'configureDisabled') return {
        ok: true, stage: 'connectorActivationConfirmed', state: LOCAL_DISABLED,
        connectorStatus,
      };
      if (command === 'enable') return { ok: true, stage: 'awaitingHeartbeat', state: LOCAL_ENABLED };
      if (command === 'confirmHealthy') return { ok: true, stage: 'confirmed_healthy', state: LOCAL_ENABLED };
      throw new Error(`unexpected ${command}`);
    };
    const result = await runHermesSelectionSaga({
      api, nativeRuntime, ownerId: OWNER, installationId: 'legacy-local-installation',
      setupAttemptId: 'caller-random-generation-must-not-be-authority',
      waitForHealth: async () => ACTIVE,
    });
    expect(calls).toEqual([
      ['native:connectorStatus', {}],
      ['get', INSTALLATION],
      ['native:configureDisabled', {
        ownerId: OWNER, installationId: INSTALLATION, executorId: EXECUTOR,
        setupAttemptId: ATTEMPT,
      }],
      ['get', INSTALLATION],
      ['set', {
        runtime: 'hermes', installationId: INSTALLATION,
        executorId: EXECUTOR, setupAttemptId: ATTEMPT,
      }],
      ['get', INSTALLATION],
      ['native:enable', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
      ['native:confirmHealthy', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
    ]);
    expect(result).toEqual({
      binding: ACTIVE, localState: LOCAL_ENABLED, installationId: INSTALLATION,
    });
    expect(JSON.stringify(calls)).not.toContain(KEY);
  });

  it('rejects stale, recovery-only, mismatched, and overlong connector authority before selection', async () => {
    const exact = {
      connected: true, health: 'active', revocationPending: false,
      installationId: INSTALLATION, agentId: EXECUTOR, setupAttemptId: ATTEMPT,
      actions: [
        'manage:identity', 'manage:premises', 'manage:intents',
        'manage:networks', 'manage:opportunities', 'manage:negotiations',
      ],
      expiresAt: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const invalid = [
      { ...exact, connected: false },
      { ...exact, health: 'recovery_only', revocationPending: true },
      { ...exact, actions: exact.actions.slice(0, -1) },
      { ...exact, expiresAt: new Date(Date.now() - 1_000).toISOString() },
      { ...exact, expiresAt: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString() },
    ];
    for (const connectorStatus of invalid) {
      let serverCalls = 0;
      await expect(runHermesSelectionSaga({
        ownerId: OWNER,
        nativeRuntime: async () => ({ ok: true, stage: 'connector_status', connectorStatus }),
        api: { getRuntimeBinding: async () => { serverCalls += 1; return INDEX; } },
        waitForHealth: async () => ACTIVE,
      })).rejects.toMatchObject({ code: 'connector_authority_mismatch' });
      expect(serverCalls).toBe(0);
    }
  });

  it('falls back to Index and pauses only the exact generation after post-confirmation failure', async () => {
    const connectorStatus = {
      connected: true, health: 'active', revocationPending: false,
      installationId: INSTALLATION, agentId: EXECUTOR, setupAttemptId: ATTEMPT,
      actions: [
        'manage:identity', 'manage:premises', 'manage:intents',
        'manage:networks', 'manage:opportunities', 'manage:negotiations',
      ],
      expiresAt: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const calls = [];
    const binding = { ...INDEX, installation: {
      executorId: EXECUTOR, installationId: INSTALLATION,
      setupAttemptId: ATTEMPT, status: 'active',
    } };
    await expect(runHermesSelectionSaga({
      ownerId: OWNER,
      api: {
        getRuntimeBinding: async () => binding,
        setRuntimeBinding: async (body) => {
          calls.push(['set', body]);
          throw new Error('selection unavailable');
        },
        compareAndSelectIndex: async (expected) => {
          calls.push(['compare-index', expected]);
          return { outcome: 'selected', binding: INDEX };
        },
      },
      nativeRuntime: async (command, payload) => {
        calls.push([command, payload]);
        if (command === 'connectorStatus') return { ok: true, stage: 'connector_status', connectorStatus };
        if (command === 'configureDisabled') return {
          ok: true, stage: 'connectorActivationConfirmed', state: LOCAL_DISABLED, connectorStatus,
        };
        if (command === 'disable') return { ok: true, stage: 'disabled', state: LOCAL_DISABLED };
        throw new Error(`unexpected ${command}`);
      },
      waitForHealth: async () => ACTIVE,
    })).rejects.toThrow('selection unavailable');
    expect(calls).toContainEqual(['compare-index', {
      agentId: EXECUTOR, installationId: INSTALLATION, setupAttemptId: ATTEMPT,
    }]);
    expect(calls).toContainEqual(['disable', { ownerId: OWNER, setupAttemptId: ATTEMPT }]);
    expect(callNames(calls)).not.toContain('disconnect');
  });
});

describe('selection, disconnect, and relaunch reconciliation', () => {
  it('disconnect pauses locally, invokes exact connector revocation, then CAS-selects Index and cleans', async () => {
    const calls = [];
    const result = await disconnectHermesSaga({
      api: { compareAndSelectIndex: async (expected) => {
        calls.push(['compare-index', expected]); return { outcome: 'selected', binding: INDEX };
      } },
      nativeRuntime: async (command, payload) => {
        calls.push([command, payload]);
        if (command === 'prepareLogout') return {
          ok: true, stage: 'logout_prepared',
          state: { ...LOCAL_DISABLED, negotiatorMode: false },
        };
        if (command === 'connectorDisconnect') return {
          ok: true, stage: 'connector_disconnected',
          connectorStatus: {
            connected: false, health: 'disconnected', revocationPending: false,
            installationId: INSTALLATION, agentId: null, setupAttemptId: null,
            actions: [], expiresAt: null,
          },
        };
        return {
          ok: true, stage: 'disconnected',
          state: { ...LOCAL_DISABLED, executorId: null, setupAttemptId: null,
            pluginInstalled: false, negotiatorMode: false, schedulePresent: false },
        };
      },
      ownerId: OWNER, installationId: INSTALLATION,
      setupAttemptId: ATTEMPT, executorId: EXECUTOR,
    });
    expect(calls).toEqual([
      ['prepareLogout', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
      ['connectorDisconnect', {
        installationId: INSTALLATION, executorId: EXECUTOR, setupAttemptId: ATTEMPT,
      }],
      ['compare-index', {
        agentId: EXECUTOR, installationId: INSTALLATION, setupAttemptId: ATTEMPT,
      }],
      ['disconnect', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
    ]);
    expect(result.binding).toEqual(INDEX);
    expect(result.localState.schedulePresent).toBe(false);
  });

  it('retains exact recovery and never reaches server/local clear while connector revocation is uncertain', async () => {
    const calls = [];
    const store = { saved: [], save: async function (value) { this.saved.push(value); return value; }, clear: async () => { throw new Error('must retain'); } };
    await expect(disconnectHermesSaga({
      api: { compareAndSelectIndex: async () => { throw new Error('must not CAS'); } },
      operationStore: store,
      nativeRuntime: async (command, payload) => {
        calls.push([command, payload]);
        if (command === 'prepareLogout') return {
          ok: true, stage: 'logout_prepared', state: { ...LOCAL_DISABLED, negotiatorMode: false },
        };
        if (command === 'connectorDisconnect') return {
          ok: true, stage: 'connector_revocation_pending',
          connectorStatus: {
            connected: false, health: 'recovery_only', revocationPending: true,
            installationId: INSTALLATION, agentId: EXECUTOR, setupAttemptId: ATTEMPT,
            actions: ['manage:identity'], expiresAt: new Date().toISOString(),
          },
        };
        throw new Error('must not clear locally');
      },
      ownerId: OWNER, installationId: INSTALLATION,
      setupAttemptId: ATTEMPT, executorId: EXECUTOR,
    })).rejects.toMatchObject({
      code: 'connector_revocation_pending', recoveryState: 'revocation_pending',
    });
    expect(calls.map(([command]) => command)).toEqual(['prepareLogout', 'connectorDisconnect']);
    expect(store.saved.at(-1)).toMatchObject({
      operation: 'disconnect', stage: 'server-pending', installationId: INSTALLATION,
      executorId: EXECUTOR, setupAttemptId: ATTEMPT,
    });
  });

  it('preserves a newer server authority when stale recovery loses the exact CAS', async () => {
    const calls = [];
    await expect(disconnectHermesSaga({
      api: { compareAndSelectIndex: async (expected) => {
        calls.push(['compare-index', expected]);
        return { outcome: 'preserved', binding: {
          ...ACTIVE,
          executor: { ...ACTIVE.executor, id: OTHER_OWNER, setupAttemptId: OTHER_OWNER },
        } };
      } },
      nativeRuntime: async (command, payload) => {
        calls.push([command, payload]);
        if (command === 'prepareLogout') return {
          ok: true, stage: 'logout_prepared', state: { ...LOCAL_DISABLED, negotiatorMode: false },
        };
        if (command === 'connectorDisconnect') return {
          ok: true, stage: 'connector_disconnected', connectorStatus: {
            connected: false, health: 'disconnected', revocationPending: false,
            installationId: INSTALLATION, agentId: null, setupAttemptId: null,
            actions: [], expiresAt: null,
          },
        };
        throw new Error('stale cleanup must not run');
      },
      ownerId: OWNER, installationId: INSTALLATION,
      setupAttemptId: ATTEMPT, executorId: EXECUTOR,
    })).rejects.toMatchObject({ code: 'server_authority_preserved' });
    expect(calls.map(([command]) => command)).toEqual([
      'prepareLogout', 'connectorDisconnect', 'compare-index',
    ]);
  });

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

  it('logout scrubs locally at every in-flight stage but rejects while server disconnect is uncertain', async () => {
    const inFlight = [
      null,
      persistedOperation('select-hermes', 'prepare-pending', { executorId: null }),
      persistedOperation('select-hermes', 'prepared'),
      persistedOperation('select-hermes', 'configured'),
      persistedOperation('select-hermes', 'activated'),
      persistedOperation('select-hermes', 'native-recovery'),
      persistedOperation('select-index', 'server-pending'),
      persistedOperation('select-index', 'server-complete'),
      persistedOperation('disconnect', 'server-pending'),
      persistedOperation('disconnect', 'server-complete'),
    ];
    for (const seed of inFlight) {
      const h = persistentJournalHarness(seed);
      if (seed) await h.journal.load(); // migrate the pre-relaunch evidence first
      const calls = [];
      const nativeRuntime = async (command, payload) => {
        if (command.endsWith('Operation')) return h.nativeRuntime(command, payload);
        calls.push([command, payload]);
        if (command === 'inspect') return { ok: true, stage: 'inspected', state: LOCAL_ENABLED };
        if (command === 'prepareLogout') return {
          ok: true,
          stage: 'logout_prepared',
          state: { ...LOCAL_DISABLED, negotiatorMode: false },
        };
        if (command === 'connectorDisconnect') return {
          ok: true, stage: 'connector_revocation_pending', connectorStatus: {
            connected: false, health: 'recovery_only', revocationPending: true,
            installationId: INSTALLATION, agentId: EXECUTOR, setupAttemptId: ATTEMPT,
          },
        };
        throw new Error(`unexpected ${command}`);
      };
      const operationStore = createNativeSagaJournal(h.nativeRuntime, null);
      await expect(prepareHermesLogout({
        ownerId: OWNER,
        operationStore,
        nativeRuntime,
        api: { compareAndSelectIndex: async () => {
          throw new Error('server CAS must not run before connector proof');
        } },
      })).rejects.toMatchObject({
        code: 'connector_revocation_pending',
        retryable: true,
        serverUncertain: true,
        recoveryState: 'revocation_pending',
      });
      expect(calls).toEqual([
        ['inspect', { ownerId: OWNER }],
        ['prepareLogout', { ownerId: OWNER, setupAttemptId: ATTEMPT }],
        ['connectorDisconnect', {
          installationId: INSTALLATION, executorId: EXECUTOR, setupAttemptId: ATTEMPT,
        }],
      ]);
      expect(await operationStore.load()).toEqual(
        persistedOperation('disconnect', 'server-pending'),
      );
    }
  });

  it('retains the crash journal when exact server CAS is uncertain after connector proof', async () => {
    const { journal } = persistentJournalHarness();
    const calls = [];
    const network = new Error('response uncertain');
    await expect(prepareHermesLogout({
      ownerId: OWNER,
      operationStore: journal,
      api: { compareAndSelectIndex: async () => { calls.push('compare-index'); throw network; } },
      nativeRuntime: async (command) => {
        calls.push(command);
        if (command === 'inspect') return { ok: true, stage: 'inspected', state: LOCAL_ENABLED };
        if (command === 'prepareLogout') return {
          ok: true, stage: 'logout_prepared', state: { ...LOCAL_DISABLED, negotiatorMode: false },
        };
        if (command === 'connectorDisconnect') return {
          ok: true, stage: 'connector_disconnected', connectorStatus: {
            connected: false, health: 'disconnected', revocationPending: false,
            installationId: INSTALLATION, agentId: null, setupAttemptId: null,
          },
        };
        throw new Error(`unexpected ${command}`);
      },
    })).rejects.toMatchObject({ serverUncertain: true, recoveryState: 'revocation_pending' });
    expect(calls).toEqual(['inspect', 'prepareLogout', 'connectorDisconnect', 'compare-index']);
    expect(await journal.load()).toEqual(persistedOperation('disconnect', 'server-pending'));
  });

  it('logout retains server-complete evidence until native owner-key revocation and supports credential-only local scrub', async () => {
    const { journal, nativeRuntime: journalRuntime } = persistentJournalHarness();
    const calls = [];
    const result = await prepareHermesLogout({
      ownerId: OWNER,
      operationStore: journal,
      api: {
        getRuntimeBinding: async (installationId) => {
          calls.push(['server-read', installationId]);
          return INDEX;
        },
      },
      nativeRuntime: async (command, payload) => {
        if (command.endsWith('Operation')) return journalRuntime(command, payload);
        calls.push([command, payload]);
        if (command === 'inspect') return {
          ok: true, stage: 'inspected', state: {
            ...LOCAL_DISABLED, setupAttemptId: null, executorId: null,
            schedulePresent: false, negotiatorMode: true,
          },
        };
        if (command === 'prepareLogout') return {
          ok: true, stage: 'logout_prepared', state: {
            ...LOCAL_DISABLED, setupAttemptId: null, executorId: null,
            schedulePresent: false, negotiatorMode: false,
          },
        };
        throw new Error(`unexpected ${command}`);
      },
    });
    expect(result).toMatchObject({ ownerId: OWNER, serverUncertain: false });
    expect(calls).toEqual([
      ['inspect', { ownerId: OWNER }],
      ['prepareLogout', { ownerId: OWNER, setupAttemptId: null }],
      ['server-read', INSTALLATION],
    ]);
    expect(await journal.load()).toEqual(persistedOperation('disconnect', 'server-complete', {
      setupAttemptId: null, executorId: null,
    }));
  });

  it('production bridge carries bootstrap journal and logout scrub through correlated native callbacks', async () => {
    const posted = [];
    let nativeRecord = null;
    let local = {
      ...LOCAL_DISABLED, executorId: null, setupAttemptId: null,
      schedulePresent: false, scheduleEnabled: false, negotiatorMode: true,
    };
    let sequence = 0;
    let bridge;
    bridge = createHermesRuntimeBridge({
      createRequestId: () => `production-${++sequence}`,
      postMessage: (message) => {
        posted.push(structuredClone(message));
        queueMicrotask(() => {
          expect(bridge.receiveProgress({ requestId: message.requestId, event: 'started' })).toBe(true);
          let result;
          if (message.command === 'inspect') {
            result = { ok: true, stage: 'inspected', state: local };
          } else if (message.command === 'loadOperation') {
            result = { ok: true, stage: 'operation_loaded', operationJournal: nativeRecord };
          } else if (message.command === 'saveOperation') {
            nativeRecord = structuredClone(message.operationJournal);
            result = { ok: true, stage: 'operation_saved', operationJournal: nativeRecord };
          } else if (message.command === 'clearOperation') {
            nativeRecord = null;
            result = { ok: true, stage: 'operation_cleared', operationJournal: null };
          } else if (message.command === 'prepareLogout') {
            local = { ...local, negotiatorMode: false, scheduleEnabled: false };
            result = { ok: true, stage: 'logout_prepared', state: local };
          } else {
            throw new Error(`unexpected production callback command ${message.command}`);
          }
          expect(bridge.receive({ requestId: message.requestId, ...result })).toBe(true);
        });
      },
    });
    const nativeRuntime = (command, payload = {}, options = {}) => (
      bridge.request(command, payload, options)
    );
    const operationStore = createNativeSagaJournal(nativeRuntime, null);
    const api = { getRuntimeBinding: async () => INDEX };

    await expect(bootstrapHermesRuntime({
      api, nativeRuntime, operationStore, ownerId: OWNER,
    })).resolves.toMatchObject({ installationId: INSTALLATION, binding: INDEX });
    await expect(prepareHermesLogout({
      api, nativeRuntime, operationStore, ownerId: OWNER,
    })).resolves.toMatchObject({ ownerId: OWNER, serverUncertain: false });

    expect(posted.map(({ command }) => command)).toEqual([
      'inspect', 'loadOperation',
      'inspect', 'loadOperation', 'saveOperation', 'prepareLogout', 'saveOperation',
    ]);
    expect(posted.every(({ requestId }) => /^production-\d+$/.test(requestId))).toBe(true);
    expect(posted.find(({ command }) => command === 'prepareLogout')).toMatchObject({
      ownerId: OWNER, setupAttemptId: null,
    });
    expect(nativeRecord).toEqual(persistedOperation('disconnect', 'server-complete', {
      setupAttemptId: null, executorId: null,
    }));
    expect(local.negotiatorMode).toBe(false);
    expect(bridge.pendingCount()).toBe(0);
  });

  it('logout never reaches native credential revocation when local scrub postconditions are unproven', async () => {
    const { journal } = persistentJournalHarness();
    await expect(prepareHermesLogout({
      ownerId: OWNER,
      operationStore: journal,
      api: { compareAndSelectIndex: async () => { throw new Error('must not reach server CAS'); } },
      nativeRuntime: async (command) => {
        if (command === 'inspect') return { ok: true, stage: 'inspected', state: LOCAL_ENABLED };
        return { ok: true, stage: 'logout_prepared', state: { ...LOCAL_DISABLED, negotiatorMode: true } };
      },
    })).rejects.toMatchObject({ code: 'native_generation_mismatch' });
    expect(await journal.load()).toEqual(persistedOperation('disconnect', 'server-pending'));
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
  let nativeRecord = null;
  const nativeRuntime = async (command, payload = {}) => {
    if (command === 'loadOperation') {
      return { ok: true, stage: 'operation_loaded', operationJournal: nativeRecord };
    }
    if (command === 'saveOperation') {
      nativeRecord = structuredClone(payload.operationJournal);
      return { ok: true, stage: 'operation_saved', operationJournal: nativeRecord };
    }
    if (command === 'clearOperation') {
      if (JSON.stringify(nativeRecord) === JSON.stringify(payload.operationJournal)) nativeRecord = null;
      return { ok: true, stage: 'operation_cleared', operationJournal: nativeRecord };
    }
    throw new Error(`unexpected journal command ${command}`);
  };
  return { journal: createNativeSagaJournal(nativeRuntime, storage), values, key, nativeRuntime };
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
  it('survives an actual bridge/store relaunch through an atomic native-owned file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'index-native-journal-'));
    const file = join(directory, 'hermes-saga-operation.json');
    const makeBridgeInstance = () => async (command, payload = {}) => {
      let current = null;
      try { current = JSON.parse(await readFile(file, 'utf8')); } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (command === 'loadOperation') {
        return { ok: true, stage: 'operation_loaded', operationJournal: current };
      }
      if (command === 'saveOperation') {
        const temporary = `${file}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(payload.operationJournal), { mode: 0o600 });
        await rename(temporary, file);
        return { ok: true, stage: 'operation_saved', operationJournal: payload.operationJournal };
      }
      if (command === 'clearOperation') {
        if (JSON.stringify(current) === JSON.stringify(payload.operationJournal)) {
          await rm(file, { force: true });
          current = null;
        }
        return { ok: true, stage: 'operation_cleared', operationJournal: current };
      }
      throw new Error(`unexpected ${command}`);
    };
    try {
      const record = persistedOperation('select-index', 'server-pending');
      const firstProcessStore = createNativeSagaJournal(makeBridgeInstance(), null);
      await firstProcessStore.save(record);

      // New request bridge and new adapter instance model a fresh WebView/app
      // process; no JavaScript object from the writer is reused.
      const relaunchedStore = createNativeSagaJournal(makeBridgeInstance(), null);
      expect(await relaunchedStore.load()).toEqual(record);
      await relaunchedStore.clear(record);
      expect(await createNativeSagaJournal(makeBridgeInstance(), null).load()).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
