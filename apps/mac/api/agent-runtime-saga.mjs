import { mapAgentRuntimeState } from './agent-runtime.mjs';

const SETUP_JOURNAL_STAGES = new Set([
  'preparing',
  'environmentWritten',
  'pluginInstalled',
  'scheduleDisabled',
  'enabling',
  'awaitingHeartbeat',
]);
const DISCONNECT_JOURNAL_STAGES = new Set([
  'disconnecting',
  'disconnectCleanupComplete',
]);

const SAGA_JOURNAL_STAGES = Object.freeze({
  'select-hermes': new Set([
    'prepare-pending', 'prepared', 'configured', 'activated', 'native-recovery',
  ]),
  'select-index': new Set(['server-pending', 'server-complete']),
  disconnect: new Set(['server-pending', 'server-complete']),
});
const SAGA_JOURNAL_KEY = 'index.agent-runtime.saga.v1';

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
    && state?.negotiatorMode === false
    && state?.schedulePresent === false
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

function requireActivatedBinding(binding, { installationId, executorId }) {
  if (
    binding?.selectedRuntime === 'hermes'
    && binding.executor?.id === executorId
    && binding.executor?.installationId === installationId
  ) return binding;
  const error = new Error('Activated Hermes binding did not match the requested executor');
  error.code = 'activation_binding_mismatch';
  error.stage = 'activate';
  throw error;
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

/** Generation-fenced prepare/configure/activate/enable/health saga. */
export async function runHermesSelectionSaga({
  api,
  nativeRuntime,
  operationStore,
  ownerId,
  installationId,
  setupAttemptId,
  waitForHealth,
  signal,
}) {
  let journal = operationJournal('select-hermes', 'prepare-pending', {
    ownerId, installationId, setupAttemptId, executorId: null,
  });
  await operationStore?.save(journal); // crash boundary before server prepare

  try {
    throwIfAborted(signal);
    const prepareResult = await api.prepareHermesRuntime(
      installationId, setupAttemptId, { signal },
    );
    if (prepareResult?.setupAttemptId !== setupAttemptId) {
      const mismatch = new Error('Prepared Hermes generation did not match the request');
      mismatch.code = 'prepare_generation_mismatch';
      mismatch.stage = 'prepare';
      throw mismatch;
    }

    const executorId = prepareResult.executorId;
    const transientCredential = prepareResult.credential?.key;
    if (!executorId || !transientCredential) {
      const invalid = new Error('Hermes prepare response was incomplete');
      invalid.code = 'prepare_response_invalid';
      invalid.stage = 'prepare';
      throw invalid;
    }
    journal = operationJournal('select-hermes', 'prepared', {
      ownerId, installationId, setupAttemptId, executorId,
    });
    await operationStore?.save(journal);
    throwIfAborted(signal);

    // This is the sole credential-bearing native call. The credential is never
    // returned by this saga or passed to health, state, storage, or callbacks.
    requireSelectionNativeResult(await nativeRuntime('configureDisabled', {
      ownerId,
      installationId,
      executorId,
      setupAttemptId,
      credential: transientCredential,
    }, { signal }), {
      command: 'configureDisabled', expectedStage: 'scheduleDisabled',
      ownerId, installationId, executorId, setupAttemptId, scheduleEnabled: false,
    });

    journal = operationJournal('select-hermes', 'configured', {
      ownerId, installationId, setupAttemptId, executorId,
    });
    await operationStore?.save(journal);
    throwIfAborted(signal);
    requireActivatedBinding(await api.setRuntimeBinding({
      runtime: 'hermes',
      installationId,
      executorId,
      setupAttemptId,
    }, { signal }), { installationId, executorId });

    journal = operationJournal('select-hermes', 'activated', {
      ownerId, installationId, setupAttemptId, executorId,
    });
    await operationStore?.save(journal);
    throwIfAborted(signal);
    requireSelectionNativeResult(
      await nativeRuntime('enable', { ownerId, setupAttemptId }, { signal }),
      {
        command: 'enable', expectedStage: 'awaitingHeartbeat',
        ownerId, installationId, executorId, setupAttemptId, scheduleEnabled: false,
      },
    );
    const binding = requireActivatedBinding(
      await waitForHealth({ installationId, executorId, setupAttemptId, signal }),
      { installationId, executorId },
    );
    throwIfAborted(signal);
    const confirmed = requireSelectionNativeResult(
      await nativeRuntime('confirmHealthy', { ownerId, setupAttemptId }, { signal }),
      {
        command: 'confirmHealthy', expectedStage: 'confirmed_healthy',
        ownerId, installationId, executorId, setupAttemptId, scheduleEnabled: false,
      },
    );

    await operationStore?.clear(journal); // exact native completion is durable
    return { binding, localState: confirmed.state };
  } catch (caught) {
    const error = caught instanceof Error
      ? caught
      : Object.assign(new Error('Hermes selection failed'), { code: 'selection_failed' });
    // Even when prepare's response was lost, the pre-mutation JS journal makes
    // an idempotent rollback/read/cleanup possible with the pinned owner client.
    await compensatePreparedGeneration({
      api, nativeRuntime, operationStore, journal, originalError: error,
    });
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

async function performDisconnect({ api, nativeRuntime, operationStore, journal, signal }) {
  throwIfAborted(signal);
  const binding = await api.disconnectHermesRuntime(journal.installationId, { signal });
  const serverComplete = { ...journal, stage: 'server-complete' };
  await operationStore?.save(serverComplete);
  if (!journal.setupAttemptId) {
    await operationStore?.clear(serverComplete);
    return { binding, localState: null };
  }
  throwIfAborted(signal);
  const disconnected = requireGenerationCleanupResult(await nativeRuntime('disconnect', {
    ownerId: journal.ownerId, setupAttemptId: journal.setupAttemptId,
  }, { signal }), 'disconnect', journal.setupAttemptId);
  await operationStore?.clear(serverComplete);
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

  let binding = null;
  let serverError = null;
  try {
    binding = await api.disconnectHermesRuntime(installationId);
    await operationStore?.save({ ...journal, stage: 'server-complete' });
  } catch (error) {
    serverError = error;
  }

  const prepared = requireSuccessfulNativeResult(await nativeRuntime('prepareLogout', {
    ownerId,
    setupAttemptId: hasExactGeneration ? localState.setupAttemptId : null,
  }), 'prepareLogout');
  const scrubbedState = prepared.state || null;
  const exactPrepared = prepared.stage === 'logout_prepared'
    && scrubbedState?.installationId === installationId
    && scrubbedState?.scheduleEnabled === false
    && scrubbedState?.negotiatorMode === false;
  if (!exactPrepared) throw generationMismatch('prepareLogout', prepared);

  // Keep both pending and server-complete evidence until native owner-key
  // revocation independently reproves the local postcondition. Native clears
  // only server-complete; uncertainty survives logout for same-owner recovery.
  // Local pause/scrub has already completed, but the owner credential must stay
  // usable so this same owner can authoritatively retry the server disconnect.
  if (serverError) {
    const uncertainty = serverError instanceof Error
      ? serverError
      : new Error('Hermes server disconnect remains uncertain');
    uncertainty.code = uncertainty.code || 'server_disconnect_uncertain';
    uncertainty.stage = 'logout';
    uncertainty.retryable = true;
    uncertainty.state = scrubbedState;
    uncertainty.serverUncertain = true;
    throw uncertainty;
  }
  return {
    ownerId,
    binding,
    localState: scrubbedState,
    serverUncertain: false,
  };
}

/** Revoke/select Index on the server before exact local key/plugin/schedule cleanup. */
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
