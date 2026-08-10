import { mapAgentRuntimeState } from './agent-runtime.mjs';

const SETUP_JOURNAL_STAGES = new Set([
  'preparing',
  'environmentWritten',
  'pluginInstalled',
  'scheduleDisabled',
  'connectorActivationConfirmed',
  'enabling',
  'awaitingHeartbeat',
]);
const DISCONNECT_JOURNAL_STAGES = new Set([
  'disconnecting',
  'connectorDisconnected',
  'disconnectCleanupComplete',
]);

const SAGA_JOURNAL_STAGES = Object.freeze({
  'select-hermes': new Set([
    'prepare-pending', 'prepared', 'configured', 'activated', 'native-recovery',
    'connector-confirmed', 'connector-configured', 'connector-selected',
  ]),
  'select-index': new Set(['server-pending', 'server-complete']),
  disconnect: new Set(['server-pending', 'server-complete']),
});
const SAGA_JOURNAL_KEY = 'index.agent-runtime.saga.v1';
const CONNECTOR_RECOVERY_STATE = 'revocation_pending';

function aborted(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Hermes runtime operation was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  throw error;
}

function requireSuccessfulNativeResult(result, command) {
  if (result?.ok) return result;
  const error = new Error(`Hermes native ${command} failed`);
  error.name = 'HermesNativeRuntimeError';
  error.code = result?.errorCode || `${command}_failed`;
  error.stage = result?.stage || command;
  error.retryable = result?.retryable !== false;
  error.state = result?.state || null;
  throw error;
}

function generationMismatch(command, result) {
  const error = new Error(`Hermes native ${command} did not apply the requested generation`);
  error.name = 'HermesNativeGenerationMismatchError';
  error.code = 'native_generation_mismatch';
  error.stage = command;
  error.retryable = true;
  error.state = result?.state || null;
  return error;
}

function requireSelectionNativeResult(result, {
  command,
  expectedStage,
  ownerId,
  installationId,
  executorId,
  setupAttemptId,
  scheduleEnabled,
}) {
  const successful = requireSuccessfulNativeResult(result, command);
  const state = successful.state;
  const matches = successful.stage === expectedStage
    && state?.ownerId === ownerId
    && state?.installationId === installationId
    && state?.executorId === executorId
    && state?.setupAttemptId === setupAttemptId
    && state?.pluginInstalled === true
    && state?.negotiatorMode === true
    && state?.schedulePresent === true
    && state?.scheduleEnabled === scheduleEnabled;
  if (!matches) throw generationMismatch(command, successful);
  return successful;
}

function requireGenerationCleanupResult(result, command, setupAttemptId) {
  const successful = requireSuccessfulNativeResult(result, command);
  const terminal = successful.stage === 'disconnected';
  const protectedNewer = successful.stage === 'disconnect_noop'
    && typeof successful.state?.setupAttemptId === 'string'
    && successful.state.setupAttemptId !== setupAttemptId;
  if ((!terminal && !protectedNewer) || successful.state?.setupAttemptId === setupAttemptId) {
    throw generationMismatch(command, successful);
  }
  return successful;
}

const HERMES_CANONICAL_ACTIONS = Object.freeze([
  'manage:identity', 'manage:premises', 'manage:intents',
  'manage:networks', 'manage:opportunities', 'manage:negotiations',
]);
const HERMES_CREDENTIAL_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

function requireConnectorAuthority(result, now = Date.now()) {
  const successful = requireSuccessfulNativeResult(result, 'connectorStatus');
  const status = successful.connectorStatus;
  const expiresAt = Date.parse(status?.expiresAt);
  const exactActions = Array.isArray(status?.actions)
    && status.actions.length === HERMES_CANONICAL_ACTIONS.length
    && HERMES_CANONICAL_ACTIONS.every((action, index) => status.actions[index] === action);
  if (successful.stage !== 'connector_status'
    || status?.connected !== true
    || status?.health !== 'active'
    || status?.revocationPending !== false
    || !nonemptyString(status?.installationId)
    || !nonemptyString(status?.agentId)
    || !nonemptyString(status?.setupAttemptId)
    || !exactActions
    || !Number.isFinite(expiresAt)
    || expiresAt <= now
    || expiresAt > now + HERMES_CREDENTIAL_TTL_MS) {
    const error = new Error('Connector authority is not an exact active 30-day Hermes generation');
    error.code = 'connector_authority_mismatch';
    error.stage = 'connectorStatus';
    error.retryable = true;
    throw error;
  }
  return status;
}

function requireInstallationBinding(binding, authority) {
  const installation = binding?.installation;
  if (installation?.status === 'active'
    && installation.installationId === authority.installationId
    && installation.executorId === authority.agentId
    && installation.setupAttemptId === authority.setupAttemptId) return binding;
  const error = new Error('Server installation did not match connector authority');
  error.code = 'connector_server_authority_mismatch';
  error.stage = 'reconcile';
  throw error;
}

function requireActivatedBinding(binding, authority) {
  if (
    binding?.selectedRuntime === 'hermes'
    && binding.executor?.id === authority.agentId
    && binding.executor?.installationId === authority.installationId
    && binding.executor?.setupAttemptId === authority.setupAttemptId
  ) return binding;
  const error = new Error('Activated Hermes binding did not match the requested executor');
  error.code = 'activation_binding_mismatch';
  error.stage = 'activate';
  throw error;
}

function requireConnectorDisconnectResult(result, authority) {
  const successful = requireSuccessfulNativeResult(result, 'connectorDisconnect');
  const status = successful.connectorStatus;
  if (successful.stage === 'connector_disconnected'
    && status?.connected === false
    && status?.revocationPending === false
    && status?.health === 'disconnected'
    && status?.installationId === authority.installationId
    && status?.agentId == null
    && status?.setupAttemptId == null) return status;
  if (successful.stage === 'connector_revocation_pending'
    && status?.connected === false
    && status?.revocationPending === true
    && status?.health === 'recovery_only'
    && status?.installationId === authority.installationId
    && status?.agentId === authority.agentId
    && status?.setupAttemptId === authority.setupAttemptId) {
    const error = new Error('Connector revocation remains pending');
    error.code = 'connector_revocation_pending';
    error.stage = 'connectorDisconnect';
    error.retryable = true;
    error.recoveryState = CONNECTOR_RECOVERY_STATE;
    throw error;
  }
  throw generationMismatch('connectorDisconnect', successful);
}

function requireCompareSelectIndex(result, authority) {
  if ((result?.outcome === 'selected' || result?.outcome === 'already_index')
    && result.binding?.selectedRuntime === 'index'
    && result.binding?.executor == null) return result.binding;
  const error = new Error('Server authority changed before exact Index recovery');
  error.code = 'server_authority_preserved';
  error.stage = 'reconcile-index';
  error.retryable = true;
  error.authority = authority;
  throw error;
}

async function compareSelectExactIndex(api, authority, options = {}) {
  return requireCompareSelectIndex(await api.compareAndSelectIndex({
    agentId: authority.agentId,
    installationId: authority.installationId,
    setupAttemptId: authority.setupAttemptId,
  }, options), authority);
}

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function nullableNonemptyString(value) {
  return value === null || nonemptyString(value);
}

function sanitizeJournal(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || value.version !== 1) return null;
  const exactKeys = [
    'executorId', 'installationId', 'operation', 'ownerId', 'setupAttemptId', 'stage', 'version',
  ];
  if (Object.keys(value).sort().join('\0') !== exactKeys.join('\0')) return null;
  const allowedStages = SAGA_JOURNAL_STAGES[value.operation];
  if (!allowedStages || !allowedStages.has(value.stage)) return null;
  if (!nonemptyString(value.ownerId) || !nonemptyString(value.installationId)) return null;
  if (!nullableNonemptyString(value.setupAttemptId) || !nullableNonemptyString(value.executorId)) return null;

  if (value.operation === 'select-hermes') {
    if (!nonemptyString(value.setupAttemptId)) return null;
    if (value.stage === 'prepare-pending') {
      if (value.executorId !== null) return null;
    } else if (!nonemptyString(value.executorId)) return null;
  } else {
    // Index selection and server disconnect can be server-only (both null), or
    // generation-matched locally (both nonempty). Half-wired evidence is not
    // executable and must remain preserved for manual recovery.
    const bothNull = value.setupAttemptId === null && value.executorId === null;
    const bothPresent = nonemptyString(value.setupAttemptId) && nonemptyString(value.executorId);
    if (!bothNull && !bothPresent) return null;
  }

  return {
    version: 1,
    operation: value.operation,
    stage: value.stage,
    ownerId: value.ownerId,
    installationId: value.installationId,
    setupAttemptId: value.setupAttemptId,
    executorId: value.executorId,
  };
}

/** App-owned native Application Support journal. The optional legacy storage
 * is read exactly once when native has no record; only a valid strict record is
 * migrated, and the old bytes are removed only after native persistence is
 * confirmed. Every request is serialized so load/migrate/save/clear cannot
 * overtake one another across React effects. */
export function createNativeSagaJournal(
  nativeRuntime,
  legacyStorage = globalThis.localStorage,
  legacyKey = SAGA_JOURNAL_KEY,
) {
  if (typeof nativeRuntime !== 'function') {
    throw new Error('Persistent Hermes saga storage is unavailable');
  }
  let queue = Promise.resolve();
  let migrationChecked = false;
  const serialized = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const decodeNative = (result, command) => {
    const successful = requireSuccessfulNativeResult(result, command);
    if (successful.operationJournal == null) return null;
    const journal = sanitizeJournal(successful.operationJournal);
    if (!journal) throw new Error('Invalid Hermes saga journal');
    return journal;
  };
  const loadNative = async () => decodeNative(
    await nativeRuntime('loadOperation', {}), 'loadOperation',
  );
  return {
    load() {
      return serialized(async () => {
        const existing = await loadNative();
        if (existing || migrationChecked) return existing;
        migrationChecked = true;
        if (!legacyStorage || typeof legacyStorage.getItem !== 'function') return null;
        const raw = legacyStorage.getItem(legacyKey);
        if (!raw) return null;
        let legacy;
        try { legacy = sanitizeJournal(JSON.parse(raw)); } catch { legacy = null; }
        if (!legacy) {
          // Preserve malformed legacy evidence byte-for-byte and fail closed.
          throw new Error('Invalid Hermes saga journal');
        }
        const saved = decodeNative(
          await nativeRuntime('saveOperation', { operationJournal: legacy }),
          'saveOperation',
        );
        if (!sameJournal(saved, legacy)) {
          throw new Error('Invalid Hermes saga journal');
        }
        legacyStorage.removeItem(legacyKey);
        return saved;
      });
    },
    save(value) {
      return serialized(async () => {
        const sanitized = sanitizeJournal(value);
        if (!sanitized) throw new Error('Invalid Hermes saga journal');
        const saved = decodeNative(
          await nativeRuntime('saveOperation', { operationJournal: sanitized }),
          'saveOperation',
        );
        if (!sameJournal(saved, sanitized)) {
          throw new Error('Invalid Hermes saga journal');
        }
        return saved;
      });
    },
    clear(expected) {
      return serialized(async () => {
        const sanitized = sanitizeJournal(expected);
        if (!sanitized) throw new Error('Invalid Hermes saga journal');
        return decodeNative(
          await nativeRuntime('clearOperation', { operationJournal: sanitized }),
          'clearOperation',
        );
      });
    },
  };
}

function sameJournal(left, right) {
  return !!left && !!right
    && left.version === right.version
    && left.operation === right.operation
    && left.stage === right.stage
    && left.ownerId === right.ownerId
    && left.installationId === right.installationId
    && left.setupAttemptId === right.setupAttemptId
    && left.executorId === right.executorId;
}

function operationJournal(operation, stage, {
  ownerId, installationId, setupAttemptId = null, executorId = null,
}) {
  const journal = sanitizeJournal({
    version: 1, operation, stage, ownerId, installationId, setupAttemptId, executorId,
  });
  if (!journal) throw new Error('Invalid Hermes saga journal');
  return journal;
}

function generationAbsentFromServer(binding, journal) {
  if (!binding || !Object.prototype.hasOwnProperty.call(binding, 'installation')) return false;
  const installation = binding.installation;
  // installation:null is authoritative only because every caller reaches this
  // read after proving that journal.ownerId is the pinned authenticated owner.
  if (!installation) return true;
  return installation.installationId !== journal.installationId
    || (journal.executorId !== null && installation.executorId !== journal.executorId)
    || installation.setupAttemptId !== journal.setupAttemptId;
}

function ownerMismatchError(state = null) {
  const error = new Error('Hermes recovery belongs to a different signed-in owner');
  error.name = 'HermesRuntimeOwnerMismatchError';
  error.code = 'owner_mismatch';
  error.stage = 'inspect';
  error.retryable = false;
  error.state = state;
  return error;
}

function journalOwnerMismatch(ownerId, journal) {
  return !!journal && journal.ownerId !== ownerId;
}

async function disableGenerationSafely({ nativeRuntime, ownerId, setupAttemptId }) {
  const result = requireSuccessfulNativeResult(await nativeRuntime('disable', {
    ownerId, setupAttemptId,
  }), 'disable');
  const exactPaused = result.stage === 'disabled'
    && result.state?.setupAttemptId === setupAttemptId
    && result.state?.scheduleEnabled === false;
  const protectedNewer = result.stage === 'disable_noop'
    && typeof result.state?.setupAttemptId === 'string'
    && result.state.setupAttemptId !== setupAttemptId;
  if (!exactPaused && !protectedNewer) throw generationMismatch('disable', result);
  return result.state || null;
}

async function pauseOwnerMismatchedGeneration({ nativeRuntime, localState }) {
  // The JS journal may describe a newer prepare that has not reached native yet.
  // Cross-owner safety must therefore fence the generation actually observed by
  // inspect and use that generation's persisted owner, never the current login
  // or the pending journal identity.
  const setupAttemptId = localState?.setupAttemptId;
  const inspectedOwnerId = localState?.ownerId;
  if (!nonemptyString(setupAttemptId) || !nonemptyString(inspectedOwnerId)) {
    throw ownerMismatchError(localState);
  }
  const pausedState = await disableGenerationSafely({
    nativeRuntime, ownerId: inspectedOwnerId, setupAttemptId,
  });
  throw ownerMismatchError(pausedState || localState);
}

async function authoritativeGenerationAbsence({ api, journal }) {
  const binding = await api.getRuntimeBinding(journal.installationId);
  return { binding, absent: generationAbsentFromServer(binding, journal) };
}

async function cleanupPreparedGeneration({ api, nativeRuntime, operationStore, journal }) {
  let binding = null;
  let rolledBack = false;
  let rollbackError = null;
  try {
    const rollback = await api.rollbackHermesRuntime(journal.setupAttemptId);
    rolledBack = rollback?.rolledBack === true;
  } catch (error) {
    rollbackError = error;
  }

  if (!rolledBack) {
    // A false repeat or a lost response is not proof that local cleanup should
    // be skipped. Read the authoritative installation generation instead.
    const observed = await authoritativeGenerationAbsence({ api, journal });
    binding = observed.binding;
    if (!observed.absent) {
      if (rollbackError) throw rollbackError;
      const error = new Error('Hermes rollback did not clear the requested server generation');
      error.code = 'rollback_generation_still_present';
      error.stage = 'rollback';
      throw error;
    }
  }

  const cleanup = requireGenerationCleanupResult(
    await nativeRuntime('disconnect', {
      ownerId: journal.ownerId, setupAttemptId: journal.setupAttemptId,
    }),
    'disconnect',
    journal.setupAttemptId,
  );
  await operationStore?.clear(journal);
  return {
    binding: binding || await api.getRuntimeBinding(journal.installationId),
    localState: cleanup.state || null,
  };
}

async function compensatePreparedGeneration({
  api, nativeRuntime, operationStore, journal, originalError,
}) {
  try {
    await cleanupPreparedGeneration({ api, nativeRuntime, operationStore, journal });
  } catch (compensationError) {
    originalError.compensationError = compensationError;
  }
}

/** Connector-confirmed configure/select/enable/health saga. The caller's random
 * setup ID is intentionally ignored: only the active Keychain-backed connector
 * generation can become server authority. */
export async function runHermesSelectionSaga({
  api,
  nativeRuntime,
  operationStore,
  ownerId,
  waitForHealth,
  signal,
}) {
  let journal = null;
  try {
    throwIfAborted(signal);
    const authority = requireConnectorAuthority(
      await nativeRuntime('connectorStatus', {}, { signal }),
    );
    const { installationId, agentId: executorId, setupAttemptId } = authority;
    requireInstallationBinding(
      await api.getRuntimeBinding(installationId, { signal }), authority,
    );

    journal = operationJournal('select-hermes', 'connector-confirmed', {
      ownerId, installationId, setupAttemptId, executorId,
    });
    await operationStore?.save(journal);
    throwIfAborted(signal);

    const configured = requireSelectionNativeResult(
      await nativeRuntime('configureDisabled', {
        ownerId, installationId, executorId, setupAttemptId,
      }, { signal }),
      {
        command: 'configureDisabled', expectedStage: 'connectorActivationConfirmed',
        ownerId, installationId, executorId, setupAttemptId, scheduleEnabled: false,
      },
    );
    const confirmedAuthority = requireConnectorAuthority({
      ...configured, stage: 'connector_status',
    });
    if (confirmedAuthority.installationId !== installationId
      || confirmedAuthority.agentId !== executorId
      || confirmedAuthority.setupAttemptId !== setupAttemptId) {
      throw Object.assign(new Error('Connector authority changed during local setup'), {
        code: 'connector_generation_changed', stage: 'configureDisabled',
      });
    }

    journal = operationJournal('select-hermes', 'connector-configured', {
      ownerId, installationId, setupAttemptId, executorId,
    });
    await operationStore?.save(journal);
    throwIfAborted(signal);
    requireInstallationBinding(
      await api.getRuntimeBinding(installationId, { signal }), authority,
    );
    requireActivatedBinding(await api.setRuntimeBinding({
      runtime: 'hermes', installationId, executorId, setupAttemptId,
    }, { signal }), authority);
    requireInstallationBinding(
      await api.getRuntimeBinding(installationId, { signal }), authority,
    );

    journal = operationJournal('select-hermes', 'connector-selected', {
      ownerId, installationId, setupAttemptId, executorId,
    });
    await operationStore?.save(journal);
    throwIfAborted(signal);
    requireSelectionNativeResult(
      await nativeRuntime('enable', { ownerId, setupAttemptId }, { signal }),
      {
        command: 'enable', expectedStage: 'awaitingHeartbeat',
        ownerId, installationId, executorId, setupAttemptId, scheduleEnabled: true,
      },
    );
    const binding = requireActivatedBinding(
      await waitForHealth({ installationId, executorId, setupAttemptId, signal }),
      authority,
    );
    throwIfAborted(signal);
    const confirmed = requireSelectionNativeResult(
      await nativeRuntime('confirmHealthy', { ownerId, setupAttemptId }, { signal }),
      {
        command: 'confirmHealthy', expectedStage: 'confirmed_healthy',
        ownerId, installationId, executorId, setupAttemptId, scheduleEnabled: true,
      },
    );
    await operationStore?.clear(journal);
    return { binding, localState: confirmed.state, installationId };
  } catch (caught) {
    const error = caught instanceof Error
      ? caught
      : Object.assign(new Error('Hermes selection failed'), { code: 'selection_failed' });
    if (journal) {
      try {
        await compareSelectExactIndex(api, {
          agentId: journal.executorId,
          installationId: journal.installationId,
          setupAttemptId: journal.setupAttemptId,
        });
        await disableGenerationSafely({
          nativeRuntime, ownerId: journal.ownerId, setupAttemptId: journal.setupAttemptId,
        });
        await operationStore?.clear(journal);
      } catch (compensationError) {
        error.compensationError = compensationError;
      }
    }
    throw error;
  }
}

async function performSelectIndex({ api, nativeRuntime, operationStore, journal, signal }) {
  throwIfAborted(signal);
  const binding = await api.setRuntimeBinding({ runtime: 'index' }, { signal });
  const serverComplete = { ...journal, stage: 'server-complete' };
  await operationStore?.save(serverComplete);
  if (!journal.setupAttemptId) {
    await operationStore?.clear(serverComplete);
    return { binding, localState: null };
  }
  throwIfAborted(signal);
  const disabled = requireSuccessfulNativeResult(await nativeRuntime('disable', {
    ownerId: journal.ownerId, setupAttemptId: journal.setupAttemptId,
  }, { signal }), 'disable');
  // disable legitimately retains the generation, but must either prove that
  // exact schedule paused or explicitly no-op for a visible newer generation.
  const exactDisabled = disabled.stage === 'disabled'
    && disabled.state?.setupAttemptId === journal.setupAttemptId
    && disabled.state?.scheduleEnabled === false;
  const protectedNewer = disabled.stage === 'disable_noop'
    && typeof disabled.state?.setupAttemptId === 'string'
    && disabled.state.setupAttemptId !== journal.setupAttemptId;
  if (!exactDisabled && !protectedNewer) throw generationMismatch('disable', disabled);
  await operationStore?.clear(serverComplete);
  return { binding, localState: disabled.state || null };
}

/** Select built-in Index first, then pause only the matching local generation. */
export async function selectIndexRuntime({
  api, nativeRuntime, operationStore, ownerId, installationId, localState, signal,
}) {
  const journal = operationJournal('select-index', 'server-pending', {
    ownerId,
    installationId: installationId || localState?.installationId,
    setupAttemptId: localState?.setupAttemptId || null,
    executorId: localState?.executorId || null,
  });
  await operationStore?.save(journal); // durable before server-first mutation
  try {
    return await performSelectIndex({ api, nativeRuntime, operationStore, journal, signal });
  } catch (error) {
    if (aborted(error)) {
      // Auth epoch changed: finish with the already-pinned owner client before
      // the coordinator releases its global operation mutex.
      return performSelectIndex({ api, nativeRuntime, operationStore, journal });
    }
    throw error; // network uncertainty deliberately preserves the journal
  }
}

async function performDisconnect({
  api, nativeRuntime, operationStore, journal, signal, retainLogoutEvidence = false,
}) {
  throwIfAborted(signal);
  const paused = requireSuccessfulNativeResult(await nativeRuntime('prepareLogout', {
    ownerId: journal.ownerId, setupAttemptId: journal.setupAttemptId,
  }, { signal }), 'prepareLogout');
  if (paused.stage !== 'logout_prepared'
    || paused.state?.scheduleEnabled !== false
    || paused.state?.negotiatorMode !== false) {
    throw generationMismatch('prepareLogout', paused);
  }
  if (!journal.setupAttemptId || !journal.executorId) {
    const binding = await api.getRuntimeBinding(journal.installationId, { signal });
    if (binding?.selectedRuntime !== 'index' || binding?.executor != null) {
      throw generationMismatch('disconnect', paused);
    }
    const serverComplete = { ...journal, stage: 'server-complete' };
    await operationStore?.save(serverComplete);
    if (!retainLogoutEvidence) await operationStore?.clear(serverComplete);
    return { binding, localState: paused.state || null };
  }

  const authority = {
    installationId: journal.installationId,
    agentId: journal.executorId,
    setupAttemptId: journal.setupAttemptId,
  };
  throwIfAborted(signal);
  requireConnectorDisconnectResult(await nativeRuntime('connectorDisconnect', {
    installationId: authority.installationId,
    executorId: authority.agentId,
    setupAttemptId: authority.setupAttemptId,
  }, { signal }), authority);

  // The connector owns server revocation, denial probing, and Keychain deletion.
  // Only its terminal proof permits this owner-locked exact-generation CAS.
  throwIfAborted(signal);
  const binding = await compareSelectExactIndex(api, authority, { signal });
  const serverComplete = { ...journal, stage: 'server-complete' };
  await operationStore?.save(serverComplete);

  // Local evidence clears only after connector and server authority proofs.
  throwIfAborted(signal);
  const disconnected = requireGenerationCleanupResult(await nativeRuntime('disconnect', {
    ownerId: journal.ownerId, setupAttemptId: journal.setupAttemptId,
  }, { signal }), 'disconnect', journal.setupAttemptId);
  if (!retainLogoutEvidence) await operationStore?.clear(serverComplete);
  return { binding, localState: disconnected.state || null };
}

/**
 * Logout barrier: persist an owner-pinned disconnect/revoke intent, attempt the
 * owner runtime revocation path, and regardless of its result ask native to
 * quarantine scheduling and scrub the dedicated Hermes environment credential.
 * Native owner-key revocation remains unreachable until that local postcondition
 * is proven. Server uncertainty deliberately remains server-pending for the
 * next login by this same owner.
 */
export async function prepareHermesLogout({
  api, nativeRuntime, operationStore, ownerId,
}) {
  if (!nonemptyString(ownerId)) throw ownerMismatchError();
  const inspection = requireSuccessfulNativeResult(
    await nativeRuntime('inspect', { ownerId }), 'inspect',
  );
  const localState = inspection.state || null;
  const existing = await operationStore?.load() || null;
  if (existing && existing.ownerId !== ownerId) {
    return pauseOwnerMismatchedGeneration({ nativeRuntime, localState });
  }
  const installationId = localState?.installationId || existing?.installationId;
  if (!nonemptyString(installationId)) {
    const error = new Error('Hermes inspection did not return an installation identity');
    error.code = 'installation_missing';
    error.stage = 'logout';
    throw error;
  }

  const hasExactGeneration = nonemptyString(localState?.setupAttemptId)
    && nonemptyString(localState?.executorId);
  const journal = operationJournal('disconnect', 'server-pending', {
    ownerId,
    installationId,
    setupAttemptId: hasExactGeneration ? localState.setupAttemptId : null,
    executorId: hasExactGeneration ? localState.executorId : null,
  });
  await operationStore?.save(journal);

  try {
    const result = await performDisconnect({
      api, nativeRuntime, operationStore, journal, retainLogoutEvidence: true,
    });
    return { ownerId, ...result, serverUncertain: false };
  } catch (caught) {
    const uncertainty = caught instanceof Error
      ? caught : new Error('Hermes connector disconnect remains uncertain');
    uncertainty.stage = uncertainty.stage || 'logout';
    uncertainty.retryable = true;
    uncertainty.serverUncertain = true;
    uncertainty.recoveryState = CONNECTOR_RECOVERY_STATE;
    throw uncertainty;
  }
}

/** Pause locally, revoke through the verified connector, then exact-CAS Index and clean locally. */
export async function disconnectHermesSaga({
  api,
  nativeRuntime,
  operationStore,
  ownerId,
  installationId,
  setupAttemptId,
  executorId = null,
  signal,
}) {
  const journal = operationJournal('disconnect', 'server-pending', {
    ownerId, installationId, setupAttemptId: setupAttemptId || null, executorId,
  });
  await operationStore?.save(journal); // durable before server-first mutation
  try {
    return await performDisconnect({ api, nativeRuntime, operationStore, journal, signal });
  } catch (error) {
    if (aborted(error)) {
      return performDisconnect({ api, nativeRuntime, operationStore, journal });
    }
    throw error; // network uncertainty deliberately preserves the journal
  }
}

async function resumeSagaOperation({ api, nativeRuntime, operationStore, journal }) {
  if (journal.operation === 'select-hermes' && journal.stage.startsWith('connector-')) {
    const binding = await compareSelectExactIndex(api, {
      agentId: journal.executorId,
      installationId: journal.installationId,
      setupAttemptId: journal.setupAttemptId,
    });
    const localState = await disableGenerationSafely({
      nativeRuntime, ownerId: journal.ownerId, setupAttemptId: journal.setupAttemptId,
    });
    await operationStore?.clear(journal);
    return { binding, localState };
  }
  if (journal.operation === 'select-index') {
    return performSelectIndex({ api, nativeRuntime, operationStore, journal });
  }
  if (journal.operation === 'disconnect') {
    return performDisconnect({ api, nativeRuntime, operationStore, journal });
  }
  return cleanupPreparedGeneration({ api, nativeRuntime, operationStore, journal });
}

/**
 * Reconcile the persistent JS operation journal first, then a journal returned
 * by native inspect. Repeat server mutations are idempotent and native cleanup
 * is generation matched, so crashes at every boundary converge safely.
 */
export async function reconcileHermesSaga({
  api,
  nativeRuntime,
  operationStore,
  operationJournal: pendingOperation,
  journal,
  ownerId,
  installationId,
  localState = null,
}) {
  const recoveryRecord = pendingOperation || journal;
  if (
    journalOwnerMismatch(ownerId, recoveryRecord)
    || (nonemptyString(localState?.ownerId) && localState.ownerId !== ownerId)
  ) {
    return pauseOwnerMismatchedGeneration({ nativeRuntime, localState });
  }

  if (pendingOperation) {
    return resumeSagaOperation({
      api, nativeRuntime, operationStore, journal: pendingOperation,
    });
  }

  if (!journal) {
    return {
      binding: await api.getRuntimeBinding(installationId),
      localState,
    };
  }

  const setupAttemptId = journal.setupAttemptId;
  if (!setupAttemptId) {
    const error = new Error('Hermes recovery journal has no setup generation');
    error.code = 'journal_generation_missing';
    error.stage = 'inspect';
    throw error;
  }

  if (SETUP_JOURNAL_STAGES.has(journal.stage) && localState?.connectorActivationConfirmed === true) {
    const recovery = operationJournal('select-hermes', 'connector-configured', {
      ownerId, installationId, setupAttemptId, executorId: journal.executorId || null,
    });
    await operationStore?.save(recovery);
    return resumeSagaOperation({ api, nativeRuntime, operationStore, journal: recovery });
  }

  if (SETUP_JOURNAL_STAGES.has(journal.stage)) {
    const recovery = operationJournal('select-hermes', 'native-recovery', {
      ownerId, installationId, setupAttemptId, executorId: journal.executorId || null,
    });
    await operationStore?.save(recovery);
    return cleanupPreparedGeneration({
      api, nativeRuntime, operationStore, journal: recovery,
    });
  }

  if (DISCONNECT_JOURNAL_STAGES.has(journal.stage)) {
    const recovery = operationJournal('disconnect', 'server-pending', {
      ownerId, installationId, setupAttemptId, executorId: journal.executorId || null,
    });
    await operationStore?.save(recovery);
    return performDisconnect({ api, nativeRuntime, operationStore, journal: recovery });
  }

  const invalid = new Error(`Unknown Hermes recovery journal stage: ${journal.stage}`);
  invalid.code = 'journal_stage_invalid';
  invalid.stage = 'inspect';
  throw invalid;
}

/** Always-mounted owner bootstrap: native inspect/pause, then exact JS recovery. */
export async function bootstrapHermesRuntime({
  api, nativeRuntime, operationStore, ownerId, signal,
}) {
  if (!nonemptyString(ownerId)) throw ownerMismatchError();
  throwIfAborted(signal);
  const inspection = requireSuccessfulNativeResult(
    await nativeRuntime('inspect', { ownerId }, { signal }), 'inspect',
  );
  throwIfAborted(signal);
  const localState = inspection.state || null;
  let pendingOperation;
  try {
    pendingOperation = await operationStore?.load() || null;
  } catch (error) {
    // A malformed JS journal remains byte-for-byte in storage. Pause the exact
    // published native generation when possible, but never guess owner-scoped
    // server work or clear the evidence.
    if (localState?.setupAttemptId) {
      try {
        error.state = await disableGenerationSafely({
          nativeRuntime, ownerId, setupAttemptId: localState.setupAttemptId,
        });
      } catch (pauseError) {
        error.pauseError = pauseError;
      }
    }
    error.code = 'journal_invalid';
    error.stage = 'inspect';
    throw error;
  }
  const installationId = pendingOperation?.installationId || localState?.installationId;
  if (!installationId) {
    const error = new Error('Hermes inspection did not return an installation identity');
    error.code = 'installation_missing';
    error.stage = 'inspect';
    throw error;
  }
  const journal = localState?.setupAttemptId && HERMES_SETUP_JOURNAL_STAGES.includes(inspection.stage)
    ? {
        stage: inspection.stage,
        setupAttemptId: localState.setupAttemptId,
        executorId: localState.executorId || null,
        ownerId: localState.ownerId || null,
      }
    : null;
  const result = await reconcileHermesSaga({
    api, nativeRuntime, operationStore, operationJournal: pendingOperation,
    journal, ownerId, installationId, localState,
  });
  return { installationId, ...result };
}

export const HERMES_SETUP_JOURNAL_STAGES = Object.freeze([
  ...SETUP_JOURNAL_STAGES,
  ...DISCONNECT_JOURNAL_STAGES,
]);

/**
 * Provider-free auth/operation coordinator used by the React owner provider.
 * One global tail serializes owner operations. Each credential change advances
 * the auth epoch, aborts old work, and lets that work compensate with its pinned
 * client before a new owner's bootstrap starts.
 */
export function createAgentRuntimeCoordinator({
  nativeRuntime,
  operationStore,
  waitForHealth,
  onState = () => {},
}) {
  let authEpoch = 0;
  let operationRevision = 0;
  let owner = null;
  let disposed = false;
  let tail = Promise.resolve();
  let activeController = null;
  let refreshController = null;
  let state = {
    binding: null, localState: null, operation: null, installationId: null,
  };

  const publish = (patch, epoch, revision) => {
    if (disposed || epoch !== authEpoch || revision !== operationRevision) return false;
    state = { ...state, ...patch };
    onState({ ...state, authEpoch, operationRevision });
    return true;
  };

  const abortCurrent = () => {
    activeController?.abort();
    refreshController?.abort();
    refreshController = null;
  };

  const enqueue = (kind, execute) => {
    const capturedOwner = owner;
    const epoch = authEpoch;
    const revision = ++operationRevision;
    abortCurrent();
    publish({ operation: { kind, status: 'running' } }, epoch, revision);
    const scheduled = tail.catch(() => undefined).then(async () => {
      if (!capturedOwner || capturedOwner !== owner || disposed) return null;
      const controller = new AbortController();
      activeController = controller;
      try {
        if (
          kind !== 'reconcile'
          && nonemptyString(state.localState?.ownerId)
          && state.localState.ownerId !== capturedOwner.ownerId
        ) throw ownerMismatchError(state.localState);
        const result = await execute(capturedOwner.api, controller.signal, capturedOwner);
        publish({
          ...result,
          installationId: result?.installationId || state.installationId,
          operation: null,
        }, epoch, revision);
        return result;
      } catch (error) {
        publish({
          operation: {
            kind, status: 'failed', stage: error?.stage || kind,
            errorCode: error?.code || 'runtime_operation_failed',
          },
          ...(error?.state ? {
            localState: error.state,
            installationId: error.state.installationId || state.installationId,
          } : {}),
        }, epoch, revision);
        throw error;
      } finally {
        if (activeController === controller) activeController = null;
      }
    });
    tail = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  };

  const bootstrap = () => enqueue('reconcile', async (api, signal, capturedOwner) => {
    try {
      throwIfAborted(signal);
      return await bootstrapHermesRuntime({
        api, nativeRuntime, operationStore, ownerId: capturedOwner.ownerId, signal,
      });
    } catch (error) {
      if (!aborted(error)) throw error;
      // If auth changes during recovery, finish any persisted owner operation
      // with this pinned client before releasing the serialized tail.
      return bootstrapHermesRuntime({
        api, nativeRuntime, operationStore, ownerId: capturedOwner.ownerId,
      });
    }
  });

  const changeOwner = (nextOwner) => {
    authEpoch += 1;
    operationRevision += 1;
    abortCurrent();
    owner = nextOwner
      && nonemptyString(nextOwner.ownerId)
      && nextOwner.api
      ? { ownerId: nextOwner.ownerId, api: nextOwner.api }
      : null;
    state = { binding: null, localState: null, operation: null, installationId: null };
    if (!disposed) onState({ ...state, authEpoch, operationRevision });
    return owner ? bootstrap() : tail;
  };

  const selectHermes = (setupAttemptId) => enqueue('select-hermes', (api, signal, capturedOwner) => (
    runHermesSelectionSaga({
      api, nativeRuntime, operationStore,
      ownerId: capturedOwner.ownerId,
      installationId: state.installationId,
      setupAttemptId,
      signal,
      waitForHealth:(input) => waitForHealth({ ...input, api, signal }),
    })
  ));

  const selectIndex = () => enqueue('select-index', (api, signal, capturedOwner) => (
    selectIndexRuntime({
      api, nativeRuntime, operationStore,
      ownerId: capturedOwner.ownerId,
      installationId: state.installationId,
      localState: state.localState, signal,
    })
  ));

  const prepareLogout = () => enqueue('logout', (api, _signal, capturedOwner) => (
    prepareHermesLogout({
      api, nativeRuntime, operationStore,
      ownerId: capturedOwner.ownerId,
    })
  ));

  const disconnect = () => enqueue('disconnect', (api, signal, capturedOwner) => (
    disconnectHermesSaga({
      api, nativeRuntime, operationStore,
      ownerId: capturedOwner.ownerId,
      installationId: state.installationId,
      setupAttemptId: state.localState?.setupAttemptId,
      executorId: state.localState?.executorId,
      signal,
    })
  ));

  const retry = () => {
    const view = mapAgentRuntimeState(state);
    if (view.retryAction === 'select-hermes') return selectHermes(
      globalThis.crypto?.randomUUID?.() || `runtime-${Math.random().toString(36).slice(2)}`,
    );
    if (view.retryAction === 'reconcile') return bootstrap();
    return Promise.resolve(null);
  };

  const refresh = async () => {
    if (!owner || !state.installationId || state.operation) return null;
    const capturedOwner = owner;
    const epoch = authEpoch;
    const revision = operationRevision;
    refreshController?.abort();
    const controller = new AbortController();
    refreshController = controller;
    try {
      const binding = await capturedOwner.api.getRuntimeBinding(
        state.installationId, { signal: controller.signal },
      );
      publish({ binding }, epoch, revision);
      return binding;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        // Interval refresh failures are observational only; they never replace
        // a newer success/retry/auth state with a needs-attention result.
      }
      return null;
    } finally {
      if (refreshController === controller) refreshController = null;
    }
  };

  const dispose = () => {
    disposed = true;
    authEpoch += 1;
    operationRevision += 1;
    owner = null;
    abortCurrent();
  };

  return {
    changeOwner, bootstrap, selectHermes, selectIndex, prepareLogout, disconnect, retry, refresh, dispose,
    snapshot: () => ({ ...state, authEpoch, operationRevision }),
    idle: () => tail,
  };
}

/** React event boundary: coordinator methods still reject for programmatic use,
 * while view callbacks intentionally consume the already-published failure. */
export function runViewRuntimeAction(action) {
  Promise.resolve().then(action).catch(() => undefined);
}
