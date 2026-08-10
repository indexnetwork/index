export const HERMES_RUNTIME_TIMEOUTS_MS = Object.freeze({
  inspect: 130_000,
  connectorStatus: 45_000,
  connectorDisconnect: 90_000,
  configureDisabled: 330_000,
  enable: 210_000,
  confirmHealthy: 15_000,
  disable: 75_000,
  prepareLogout: 90_000,
  disconnect: 330_000,
  loadOperation: 15_000,
  saveOperation: 15_000,
  clearOperation: 15_000,
});

// Native commands execute on one serial queue. Queue wait is bounded separately
// so a valid command ahead of this request does not consume its execution
// budget, while a wedged/dead native bridge still releases every waiter.
export const HERMES_RUNTIME_QUEUE_WAIT_TIMEOUT_MS = 11 * 60_000;

function bridgeAbortError() {
  const error = new Error('Hermes runtime request was aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

const JOURNAL_COMMANDS = new Set(['saveOperation', 'clearOperation']);
const OPERATION_JOURNAL_STAGES = Object.freeze({
  'select-hermes': new Set([
    'prepare-pending', 'prepared', 'configured', 'activated', 'native-recovery',
    'connector-confirmed', 'connector-configured', 'connector-selected',
  ]),
  'select-index': new Set(['server-pending', 'server-complete']),
  disconnect: new Set(['server-pending', 'server-complete']),
});

function hasExactKeys(value, expected) {
  return value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function validJournalIdentifier(value) {
  return typeof value === 'string' && value.length > 0
    && !value.includes('\0') && !/[\r\n]/.test(value);
}

function validOperationJournal(value) {
  if (!hasExactKeys(value, [
    'version', 'operation', 'stage', 'ownerId', 'installationId', 'setupAttemptId', 'executorId',
  ])) return false;
  if (value.version !== 1
    || !OPERATION_JOURNAL_STAGES[value.operation]?.has(value.stage)
    || !validJournalIdentifier(value.ownerId)
    || !validJournalIdentifier(value.installationId)) return false;
  if (value.operation === 'select-hermes') {
    return validJournalIdentifier(value.setupAttemptId)
      && (value.stage === 'prepare-pending'
        ? value.executorId === null
        : validJournalIdentifier(value.executorId));
  }
  const bothNull = value.setupAttemptId === null && value.executorId === null;
  const bothPresent = validJournalIdentifier(value.setupAttemptId)
    && validJournalIdentifier(value.executorId);
  return bothNull || bothPresent;
}

const FORBIDDEN_RUNTIME_KEYS = new Set([
  'credential', 'rawcredential', 'credentialid', 'apikey', 'token', 'secret',
  'password', 'auth', 'authorization', 'authorizationcode', 'verifier', 'challenge',
]);

function containsForbiddenRuntimeField(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenRuntimeField);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => {
    const canonical = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const forbidden = [...FORBIDDEN_RUNTIME_KEYS].some((term) => (
      canonical === term || canonical.startsWith(term) || canonical.endsWith(term)
    ));
    return forbidden || containsForbiddenRuntimeField(child);
  });
}

function validateRuntimePayload(command, payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    return 'Hermes runtime payload must be an object';
  }
  if (command === 'loadOperation' || command === 'connectorStatus') {
    return hasExactKeys(payload, []) ? null : `Hermes ${command} payload must be empty`;
  }
  if (command === 'connectorDisconnect') {
    return hasExactKeys(payload, ['installationId', 'executorId', 'setupAttemptId'])
      && ['installationId', 'executorId', 'setupAttemptId'].every((key) => validJournalIdentifier(payload[key]))
      ? null
      : 'Hermes connector disconnect requires only the exact authority tuple';
  }
  if (JOURNAL_COMMANDS.has(command)) {
    return hasExactKeys(payload, ['operationJournal'])
      && validOperationJournal(payload.operationJournal)
      ? null
      : `Hermes ${command} requires only a strict operation journal payload`;
  }
  if (command === 'prepareLogout') {
    return payload.setupAttemptId === null
      || (typeof payload.setupAttemptId === 'string' && payload.setupAttemptId.length > 0)
      ? null
      : 'Hermes logout generation must be nonempty or explicitly null';
  }
  if (containsForbiddenRuntimeField(payload)) {
    return 'Hermes runtime payload must not contain credential material';
  }
  if (command !== 'inspect' && !(typeof payload.setupAttemptId === 'string' && payload.setupAttemptId.length > 0)) {
    return 'Hermes runtime generation is required';
  }
  return null;
}

/** Request-correlated bridge with native-dequeue acknowledgement and hard bounds. */
export function createHermesRuntimeBridge({
  postMessage,
  createRequestId,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  const waiters = new Map();

  function finish(requestId) {
    const waiter = waiters.get(requestId);
    if (!waiter) return null;
    waiters.delete(requestId);
    if (waiter.queueTimeout) clearTimeoutImpl(waiter.queueTimeout);
    if (waiter.executionTimeout) clearTimeoutImpl(waiter.executionTimeout);
    if (waiter.signal && waiter.abort) {
      waiter.signal.removeEventListener('abort', waiter.abort);
    }
    return waiter;
  }

  function receiveProgress(progress) {
    if (!progress || typeof progress.requestId !== 'string' || progress.event !== 'started') {
      return false;
    }
    const waiter = waiters.get(progress.requestId);
    if (!waiter || waiter.phase !== 'queued') return false;
    waiter.phase = 'admitted';
    if (waiter.queueTimeout) {
      clearTimeoutImpl(waiter.queueTimeout);
      waiter.queueTimeout = null;
    }
    waiter.executionTimeout = setTimeoutImpl(() => {
      const expired = finish(progress.requestId);
      if (!expired) return;
      const error = new Error('Hermes runtime request timed out after native dequeue');
      error.name = 'HermesRuntimeBridgeTimeoutError';
      error.code = 'bridge_timeout';
      expired.reject(error);
    }, waiter.executionTimeoutMs);
    return true;
  }

  function receive(result) {
    if (!result || typeof result.requestId !== 'string') return false;
    const current = waiters.get(result.requestId);
    // A final callback is itself proof that a successfully posted request was
    // admitted, even if WebKit delivered it before the separate started event.
    // This is especially important after abort: compensation must wait for the
    // native final rather than racing work whose progress callback was delayed.
    if (!current || (current.phase !== 'queued' && current.phase !== 'admitted')) return false;
    const waiter = finish(result.requestId);
    if (!waiter) return false;
    if (waiter.stale) {
      waiter.reject(bridgeAbortError());
    } else if (result.ok) {
      waiter.resolve(result);
    } else {
      const error = new Error(`Hermes runtime ${result.stage || 'request'} failed`);
      error.name = 'HermesRuntimeBridgeError';
      error.code = result.errorCode || 'native_runtime_failed';
      error.stage = result.stage || null;
      error.retryable = result.retryable !== false;
      error.state = result.state || null;
      waiter.reject(error);
    }
    return true;
  }

  function request(command, payload = {}, { signal } = {}) {
    const executionTimeoutMs = HERMES_RUNTIME_TIMEOUTS_MS[command];
    if (!executionTimeoutMs) return Promise.reject(new Error('unsupported Hermes runtime command'));
    const payloadError = validateRuntimePayload(command, payload);
    if (payloadError) return Promise.reject(new Error(payloadError));
    if (signal?.aborted) return Promise.reject(bridgeAbortError());

    const requestId = createRequestId();
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        phase: 'posting',
        stale: false,
        executionTimeoutMs,
        queueTimeout: null,
        executionTimeout: null,
        abort: null,
      };
      waiter.queueTimeout = setTimeoutImpl(() => {
        const expired = finish(requestId);
        if (!expired) return;
        const error = new Error('Hermes runtime request timed out waiting for native dequeue');
        error.name = 'HermesRuntimeBridgeQueueTimeoutError';
        error.code = 'bridge_queue_timeout';
        reject(error);
      }, HERMES_RUNTIME_QUEUE_WAIT_TIMEOUT_MS);
      waiter.abort = signal ? () => {
        const current = waiters.get(requestId);
        if (!current) return;
        // The only definitely unposted abort was handled before allocating the
        // request. Once dispatch begins, WebKit may already have admitted the
        // message even when its started callback has not reached JavaScript.
        // Retain every timer/listener until native final or the applicable hard
        // bound; only then may the saga observe AbortError and compensate.
        current.stale = true;
      } : null;
      waiters.set(requestId, waiter);
      if (signal && waiter.abort) signal.addEventListener('abort', waiter.abort, { once: true });
      try {
        postMessage({ ...payload, requestId, command });
        const posted = waiters.get(requestId);
        if (posted && posted.phase === 'posting') posted.phase = 'queued';
      } catch {
        finish(requestId);
        reject(new Error('Hermes runtime bridge dispatch failed'));
      }
    });
  }

  return { request, receive, receiveProgress, pendingCount: () => waiters.size };
}

const CONNECTED_LOCAL_FIELDS = [
  'executorId', 'pluginInstalled', 'negotiatorMode', 'schedulePresent', 'setupAttemptId',
];

const FAILURE_STAGE_LABELS = Object.freeze({
  prepare: 'server preparation',
  configureDisabled: 'local configuration',
  configure: 'local configuration',
  activate: 'server activation',
  enable: 'local activation',
  heartbeat: 'health confirmation',
  confirmHealthy: 'healthy-state confirmation',
  rollback: 'server rollback',
  disconnect: 'local cleanup',
  inspect: 'local inspection',
  reconcile: 'relaunch reconciliation',
  'select-index': 'Index selection',
  'select-hermes': 'Hermes selection',
});

function sanitizedFailureStage(operation) {
  const raw = typeof operation?.stage === 'string' ? operation.stage : operation?.kind;
  return FAILURE_STAGE_LABELS[raw] || 'runtime reconciliation';
}

/** Stable, UI-ready projection of the server binding plus native local state. */
export function mapAgentRuntimeState({ binding, localState, operation }) {
  const localConnected = !!localState && CONNECTED_LOCAL_FIELDS.some((field) => !!localState[field]);
  const serverHermes = binding?.selectedRuntime === 'hermes';
  const canDisconnect = localConnected || serverHermes;

  if (operation?.status === 'running') {
    if (operation.kind === 'select-hermes') {
      return {
        selectorValue: 'hermes', visualState: 'connecting',
        statusLine: 'Hermes is connecting. Index is covering until a heartbeat is observed.',
        canRetry: false, canDisconnect: false, retryAction: null,
      };
    }
    if (operation.kind === 'select-index' || operation.kind === 'disconnect') {
      return {
        selectorValue: 'index', visualState: 'connecting',
        statusLine: 'Index is taking over. Hermes scheduling is being disabled.',
        canRetry: false, canDisconnect: false, retryAction: null,
      };
    }
    return {
      selectorValue: serverHermes ? 'hermes' : 'index',
      visualState: serverHermes ? 'connecting' : 'index',
      statusLine: serverHermes
        ? 'Checking the selected Hermes runtime. Index is covering during reconciliation.'
        : 'Checking the negotiation runtime. Index remains the system default.',
      canRetry: false, canDisconnect: false, retryAction: null,
    };
  }

  if (operation?.status === 'failed') {
    if (operation.errorCode === 'owner_mismatch') {
      return {
        selectorValue: 'index',
        visualState: 'needs-attention',
        statusLine: 'Hermes recovery belongs to another signed-in owner. Its schedule is paused for that owner to recover later.',
        canRetry: false,
        canDisconnect: false,
        retryAction: null,
      };
    }
    if (operation.errorCode === 'owner_unattributed') {
      return {
        selectorValue: 'index',
        visualState: 'needs-attention',
        statusLine: 'An older Hermes installation has no owner identity. Its schedule is paused; retry to reprovision it for this signed-in owner.',
        canRetry: true,
        canDisconnect: false,
        retryAction: 'select-hermes',
      };
    }
    return {
      selectorValue: binding?.selectedRuntime === 'hermes' ? 'hermes' : 'index',
      visualState: 'needs-attention',
      statusLine: `Hermes needs attention after ${sanitizedFailureStage(operation)} failed. Retry reconciliation or disconnect it.`,
      canRetry: true,
      canDisconnect,
      retryAction: 'reconcile',
    };
  }

  if (binding?.selectedRuntime === 'external') {
    return {
      selectorValue: 'index',
      visualState: 'needs-attention',
      statusLine: 'A legacy external runtime is selected. Select Index before connecting Hermes.',
      canRetry: true,
      canDisconnect,
      retryAction: 'reconcile',
    };
  }

  if (serverHermes) {
    const executor = binding.executor;
    const completeMatchingWiring = !!(
      executor?.installationId
      && localState?.installationId
      && executor.installationId === localState.installationId
      && executor.id
      && executor.status === 'active'
      && localState.executorId === executor.id
      && localState.setupAttemptId
      && executor.setupAttemptId === localState.setupAttemptId
      && localState.pluginInstalled === true
      && localState.negotiatorMode === true
      && localState.schedulePresent === true
      && localState.scheduleEnabled === true
    );
    if (!completeMatchingWiring) {
      return {
        selectorValue: 'index',
        visualState: 'needs-attention',
        statusLine: 'The selected Hermes runtime does not match complete local wiring on this Mac. Index is covering.',
        canRetry: true,
        canDisconnect,
        retryAction: 'reconcile',
      };
    }

    if (binding.health === 'active' && binding.indexCovering === false) {
      return {
        selectorValue: 'hermes',
        visualState: 'active',
        statusLine: 'Hermes is active. Index takes over when Hermes is unavailable.',
        canRetry: false,
        canDisconnect,
        retryAction: null,
      };
    }

    if (
      (binding.health === 'stale' || binding.health === 'never-seen')
      && binding.indexCovering === true
    ) {
      return {
        selectorValue: 'hermes',
        visualState: 'unavailable',
        statusLine: 'Hermes is unavailable — Index is covering.',
        canRetry: true,
        canDisconnect,
        retryAction: 'select-hermes',
      };
    }

    return {
      selectorValue: 'index',
      visualState: 'needs-attention',
      statusLine: 'Hermes health and Index coverage do not match. Index is covering.',
      canRetry: true,
      canDisconnect,
      retryAction: 'reconcile',
    };
  }

  return {
    selectorValue: 'index',
    visualState: 'index',
    statusLine: localConnected
      ? 'Index is handling negotiations. Hermes remains connected and can be selected again.'
      : 'Index is handling negotiations.',
    canRetry: false,
    canDisconnect,
    retryAction: null,
  };
}

export class HermesHealthTimeoutError extends Error {
  constructor() {
    super('Hermes did not become healthy within the bounded activation window');
    this.name = 'HermesHealthTimeoutError';
    this.code = 'health_timeout';
  }
}

function remainingBudget(startedAt, timeoutMs, now) {
  return Math.max(0, timeoutMs - (now() - startedAt));
}

async function raceDeadline(startedAt, timeoutMs, now, begin, parentSignal) {
  const remainingMs = remainingBudget(startedAt, timeoutMs, now);
  if (remainingMs <= 0) throw new HermesHealthTimeoutError();
  if (parentSignal?.aborted) {
    const error = new Error('Hermes health wait was aborted');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    throw error;
  }
  const controller = new AbortController();
  let timer;
  let rejectParent;
  const abortParent = () => {
    controller.abort();
    const error = new Error('Hermes health wait was aborted');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    rejectParent?.(error);
  };
  parentSignal?.addEventListener('abort', abortParent, { once: true });
  try {
    return await Promise.race([
      Promise.resolve().then(() => begin(controller.signal, remainingMs)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new HermesHealthTimeoutError());
        }, Math.max(1, remainingMs));
      }),
      new Promise((_, reject) => { rejectParent = reject; }),
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortParent);
  }
}

function defaultSleep(duration, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, duration);
    if (!signal) return;
    const abort = () => {
      clearTimeout(timer);
      reject(new HermesHealthTimeoutError());
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Wait only on the server's authoritative health classification. The UI does
 * not parse timestamps or reproduce the dispatcher's freshness threshold.
 * Every read and sleep is raced against the same hard wall-clock deadline.
 */
export async function waitForHermesHealth({
  api,
  installationId,
  executorId,
  setupAttemptId,
  timeoutMs = 90_000,
  pollIntervalMs = 2_000,
  now = () => Date.now(),
  sleep = defaultSleep,
  signal,
}) {
  const startedAt = now();
  while (true) {
    if (remainingBudget(startedAt, timeoutMs, now) <= 0) throw new HermesHealthTimeoutError();
    try {
      const binding = await raceDeadline(startedAt, timeoutMs, now, (requestSignal) => (
        api.getRuntimeBinding(installationId, { signal: requestSignal })
      ), signal);
      if (
        binding?.selectedRuntime === 'hermes'
        && binding.health === 'active'
        && binding.executor?.id === executorId
        && binding.executor?.installationId === installationId
        && binding.executor?.setupAttemptId === setupAttemptId
      ) {
        return binding;
      }
    } catch (error) {
      if (error instanceof HermesHealthTimeoutError || error?.name === 'AbortError') throw error;
    }

    const remainingMs = remainingBudget(startedAt, timeoutMs, now);
    if (remainingMs <= 0) throw new HermesHealthTimeoutError();
    const duration = Math.min(pollIntervalMs, remainingMs);
    await raceDeadline(startedAt, timeoutMs, now, (sleepSignal, wallClockRemaining) => (
      sleep(Math.min(duration, wallClockRemaining), { signal: sleepSignal })
    ), signal);
  }
}
