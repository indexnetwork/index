import { expect, test } from 'bun:test';

const runtimeFile = new URL('./Sources/HermesRuntime.swift', import.meta.url);
const runtime = await Bun.file(runtimeFile).exists()
  ? await Bun.file(runtimeFile).text()
  : '';
const launchAttestation = await Bun.file(
  new URL('./Sources/ConnectorLaunchAttestation.swift', import.meta.url),
).text();
const launchFixture = await Bun.file(
  new URL('./Tests/ConnectorLaunchAttestationFixture.swift', import.meta.url),
).text();
const main = await Bun.file(new URL('./Sources/main.swift', import.meta.url)).text();
const build = await Bun.file(new URL('./build.sh', import.meta.url)).text();
const nativeCompatibilityFile = new URL('./Tests/HermesPersistenceCompatibility.swift', import.meta.url);
const nativeCompatibility = await Bun.file(nativeCompatibilityFile).exists()
  ? await Bun.file(nativeCompatibilityFile).text()
  : '';
const macWorkflow = await Bun.file(new URL('../../../.github/workflows/mac-app-build.yml', import.meta.url)).text();

const OWNED_NAME = 'Index Personal Agent Negotiator';
const OWNED_SCHEDULE = 'every 1m';
const OWNED_PROMPT = 'Run one scheduled autonomous Index negotiation pass.';
const OWNED_SKILL = 'index-network:index-negotiator';
const OWNED_TOOLSET = 'index-network';

const ABSENT = Symbol('absent');

function injectedEnvFile({ readExisting, writeReplacement }) {
  const decodeExisting = () => {
    let data;
    try {
      data = readExisting();
    } catch {
      throw new Error('env_write_failed');
    }
    if (data === ABSENT) return [];
    let contents;
    try {
      contents = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      throw new Error('env_write_failed');
    }
    return contents.split('\n');
  };

  const replace = (keys, updates = []) => {
    const lines = decodeExisting().filter((line) => {
      const separator = line.indexOf('=');
      return separator < 0 || !keys.has(line.slice(0, separator));
    });
    while (lines.at(-1) === '') lines.pop();
    lines.push(...updates.map(([key, value]) => `${key}=${value}`));
    const contents = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
    writeReplacement(new TextEncoder().encode(contents));
  };

  return {
    upsert(updates) {
      replace(new Set(updates.map(([key]) => key)), updates);
    },
    removeOwned() {
      replace(new Set([
        'INDEX_API_KEY', 'INDEX_API_URL', 'INDEX_MCP_URL',
        'INDEX_AGENT_ID', 'INDEX_INSTALLATION_ID', 'INDEX_PLUGIN_MODE',
      ]));
    },
  };
}

async function injectedActivation({ journal, runner, readOwnedJob }) {
  const job = readOwnedJob();
  const resume = await runner('resume', job.id);
  if (resume !== 0 || readOwnedJob()?.enabled !== true) return 'cron_resume_failed';
  try {
    const gateway = await runner('gateway', job.id);
    if (gateway !== 0) throw new Error('gateway');
    journal.stage = 'awaitingHeartbeat';
    return 'ok';
  } catch {
    try {
      const pause = await runner('pause', job.id);
      if (pause !== 0) throw new Error('pause');
      const verified = readOwnedJob();
      if (!verified || verified.id !== job.id || verified.enabled !== false) throw new Error('verify');
    } catch {
      return 'activation_rollback_failed';
    }
    return 'gateway_failed';
  }
}

function injectedDisable({ suppliedAttemptId, currentAttemptId, pause }) {
  if (!suppliedAttemptId || suppliedAttemptId !== currentAttemptId) return 'disable_noop';
  pause();
  return 'disabled';
}

function injectedSuccess(readLocalState) {
  try {
    return { ok: true, state: readLocalState() };
  } catch (failure) {
    return { ok: false, errorCode: failure.message };
  }
}

function injectedNavigationPolicy({ url, bundledURL, isMainFrame, linkActivated, openExternal }) {
  if (isMainFrame && url === bundledURL) return 'allow';
  if (linkActivated && /^https?:\/\//i.test(url)) openExternal(url);
  return 'cancel';
}

function admitHermesMessage({ isMainFrame, frameURL, bundledURL, decode, execute }) {
  if (!isMainFrame || frameURL !== bundledURL) return 'rejected';
  execute(decode());
  return 'accepted';
}

function injectedTrustedDocumentGate(bundledURL) {
  let generation = 0;
  let ready = false;
  let currentURL = null;
  return {
    startProvisional(visibleURL = currentURL) {
      generation += 1;
      ready = false;
      currentURL = visibleURL;
    },
    finish(url = bundledURL) {
      currentURL = url;
      ready = true;
    },
    admit({ isMainFrame = true, frameURL = bundledURL } = {}) {
      if (!ready || !isMainFrame || frameURL !== bundledURL || currentURL !== bundledURL) return null;
      return generation;
    },
    canEmit(admittedGeneration) {
      return ready && admittedGeneration === generation && currentURL === bundledURL;
    },
  };
}

async function injectedBoundedRunner({ chunks, deadlineMs, terminate, kill, completesAfterMs }) {
  const limit = 16_384;
  let output = new Uint8Array();
  const completion = new Promise((resolve) => setTimeout(resolve, completesAfterMs, 'completed'));
  const streaming = (async () => {
    for (const chunk of chunks) {
      output = Uint8Array.from([...output, ...chunk]);
      if (output.byteLength > limit) output = output.slice(output.byteLength - limit);
      await Promise.resolve();
    }
  })();
  await streaming;
  const outcome = await Promise.race([
    completion,
    new Promise((resolve) => setTimeout(resolve, deadlineMs, 'timeout')),
  ]);
  if (outcome === 'timeout') {
    terminate();
    kill();
    throw new Error('command_timed_out');
  }
  return output;
}

function injectedEnable({ currentAttempt, suppliedAttempt, journal, job, calls }) {
  if (currentAttempt !== suppliedAttempt) return 'enable_noop';
  const exact = job && job.name === OWNED_NAME && job.schedule === OWNED_SCHEDULE
    && job.prompt === OWNED_PROMPT;
  if (!exact) throw new Error('cron_store_invalid');
  if (job.enabled && journal?.stage === 'awaitingHeartbeat') return 'awaitingHeartbeat';
  if (job.enabled && journal == null) return 'confirmed_healthy';
  journal.stage = 'enabling';
  if (!job.enabled) {
    calls.push('resume');
    job.enabled = true;
  }
  calls.push('gateway');
  journal.stage = 'awaitingHeartbeat';
  return journal.stage;
}

function injectedGatewayState(status, output) {
  if (status !== 0) return 'failure';
  const running = output.match(/^\s*(?:PID\s*[:=]\s*|"pid"\s*:\s*)([0-9]+)\s*[,;]?\s*$/im);
  if (running && Number(running[1]) > 0) return 'running';
  if (/^\s*(?:(?:Status\s*:|state\s*=)\s*|Gateway\s+is\s+)?(?:stopped|not running|exited)\.?\s*$/im.test(output)) return 'stopped';
  return 'failure';
}

function injectedFilesystemPolicy({ components, leaf, destructive = false }) {
  for (const component of components) {
    if (component.kind !== 'directory' || component.symlink) throw new Error('unsafe_path');
  }
  if (leaf?.symlink || (destructive && leaf && leaf.kind !== 'directory')) {
    throw new Error('unsafe_path');
  }
  return 'safe';
}

function injectedVerifiedChildDirectory({ lstat, open, fstat, close = () => {} }) {
  const before = lstat();
  if (before === ABSENT) return null;
  if (before.kind !== 'directory' || before.symlink) throw new Error('unsafe_path');

  const descriptor = open();
  let keepDescriptor = false;
  try {
    const opened = fstat(descriptor);
    const after = lstat();
    const allDirectories = opened.kind === 'directory'
      && after !== ABSENT && after.kind === 'directory' && !after.symlink;
    const sameIdentity = before.dev === opened.dev && before.ino === opened.ino
      && opened.dev === after.dev && opened.ino === after.ino;
    if (!allDirectories || !sameIdentity) throw new Error('unsafe_path');
    keepDescriptor = true;
    return descriptor;
  } finally {
    if (!keepDescriptor) close(descriptor);
  }
}

function injectedOpenDirectoryComponent({ createMissing, mkdir, ...operations }) {
  let descriptor = injectedVerifiedChildDirectory(operations);
  if (descriptor !== null || !createMissing) return descriptor;
  mkdir();
  descriptor = injectedVerifiedChildDirectory(operations);
  if (descriptor === null) throw new Error('unsafe_path');
  return descriptor;
}

function isOwnedTemporary(name, destination = '.env') {
  const escaped = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\.${escaped}\\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.tmp$`, 'i').test(name);
}

function injectedLockedMutation({ withLock, read, identity, publish, mutate, beforeRecheck, attempts = 3 }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = withLock(() => {
      const before = read();
      const next = mutate(before.contents);
      beforeRecheck?.();
      if (before.identity !== identity()) return { retry: true };
      publish(next);
      return { next };
    });
    if (!result.retry) return result.next;
  }
  throw new Error('env_write_failed');
}

function injectedRetainedParentMutation({ openParent, swapPath, mutateRelative }) {
  const retainedParent = openParent();
  swapPath();
  mutateRelative(retainedParent);
}

function injectedDisconnect({ binary, state, operations }) {
  state.journal = 'disconnecting';
  let failure = null;
  if (binary && state.cronPresent) {
    if (operations.removeCron()) state.cronPresent = false;
    else failure = 'cron_remove_failed';
  } else if (!binary && state.cronPresent) {
    failure = 'hermes_not_found';
  }
  if (binary && state.pluginPresent) {
    if (operations.removePlugin()) state.pluginPresent = false;
    else failure ??= 'plugin_remove_failed';
  } else if (!binary && state.pluginPresent) {
    operations.removePluginLocal();
    state.pluginPresent = false;
    failure ??= 'hermes_not_found';
  }
  operations.removeDashboard(); state.dashboardPresent = false;
  operations.removeEnv(); state.ownedEnvKeys = [];
  if (!binary) failure ??= 'hermes_not_found';
  const postconditions = !state.cronPresent && !state.pluginPresent
    && !state.dashboardPresent && state.ownedEnvKeys.length === 0;
  if (failure || !postconditions) return { ok: false, errorCode: failure ?? 'local_cleanup_failed' };
  state.journal = { stage: 'disconnectCleanupComplete', setupAttemptId: state.currentAttempt };
  state.currentAttempt = null;
  if (operations.removeJournal?.() === false) {
    return { ok: false, errorCode: 'journal_write_failed' };
  }
  state.journal = null;
  return { ok: true };
}

function injectedFinishTerminalDisconnect({ state, verifyPostconditions, removeJournal }) {
  if (state.currentAttempt !== null || state.journal?.stage !== 'disconnectCleanupComplete') {
    return 'disconnect_noop';
  }
  if (!verifyPostconditions()) throw new Error('local_cleanup_failed');
  if (!removeJournal()) throw new Error('journal_write_failed');
  state.journal = null;
  return 'disconnected';
}

function injectedRetryDisconnect({ state, suppliedAttemptId, verifyPostconditions, removeJournal }) {
  if (state.journal?.setupAttemptId !== suppliedAttemptId) return 'disconnect_noop';
  return injectedFinishTerminalDisconnect({ state, verifyPostconditions, removeJournal });
}

function injectedRelaunchInspect({ state, verifyPostconditions, removeJournal }) {
  if (state.currentAttempt === null && state.journal?.stage === 'disconnectCleanupComplete') {
    injectedFinishTerminalDisconnect({ state, verifyPostconditions, removeJournal });
  }
  return state.journal?.stage ?? 'inspected';
}

function injectedCronOwnershipInventory({ jobs, ownership }) {
  const attributable = jobs.filter((job) => (
    job.id === ownership.jobId
    || job.index_app_installation_id === ownership.installationId
    || job.index_app_owner_id === ownership.ownerId
    || job.index_app_setup_attempt_id === ownership.setupAttemptId
  ));
  const exactId = jobs.filter((job) => job.id === ownership.jobId);
  const owned = exactId.length === 1 ? exactId[0] : null;
  const markerExact = owned
    && owned.index_app_installation_id === ownership.installationId
    && owned.index_app_owner_id === ownership.ownerId
    && owned.index_app_setup_attempt_id === ownership.setupAttemptId;
  const sandboxExact = owned
    && owned.name === OWNED_NAME
    && owned.prompt === OWNED_PROMPT
    && owned.skills?.length === 1 && owned.skills[0] === OWNED_SKILL
    && owned.skill === OWNED_SKILL
    && owned.enabled_toolsets?.length === 1 && owned.enabled_toolsets[0] === OWNED_TOOLSET;
  const duplicate = attributable.some((job) => job !== owned);
  return {
    attributable,
    owned,
    safe: exactId.length === 1 && markerExact && sandboxExact && !duplicate,
    enabled: attributable.filter((job) => job.enabled),
  };
}

function injectedPreOwnerConfigureRebind({ installation, cron, request }) {
  const preOwner = installation.currentSetupAttemptId
    && installation.currentOwnerId == null
    && installation.currentExecutorId == null;
  if (!preOwner) {
    if (installation.currentOwnerId && installation.currentOwnerId !== request.ownerId) {
      throw new Error('owner_mismatch');
    }
    throw new Error('not_pre_owner');
  }
  const exact = installation.installationId === request.installationId
    && installation.currentCronJobId === cron.id
    && installation.currentCronSetupAttemptId === installation.currentSetupAttemptId
    && cron.index_app_installation_id === installation.installationId
    && cron.index_app_setup_attempt_id === installation.currentSetupAttemptId
    && cron.index_app_owner_id == null
    && cron.enabled === false
    && cron.name === OWNED_NAME
    && cron.schedule === OWNED_SCHEDULE
    && cron.prompt === OWNED_PROMPT
    && cron.skills?.length === 1 && cron.skills[0] === OWNED_SKILL
    && cron.skill === OWNED_SKILL
    && cron.enabled_toolsets?.length === 1 && cron.enabled_toolsets[0] === OWNED_TOOLSET;
  if (!exact) throw new Error('cron_store_invalid');
  installation.currentOwnerId = request.ownerId;
  installation.currentExecutorId = request.executorId;
  installation.currentSetupAttemptId = request.setupAttemptId;
  installation.currentCronSetupAttemptId = request.setupAttemptId;
  cron.index_app_owner_id = request.ownerId;
  cron.index_app_setup_attempt_id = request.setupAttemptId;
  return {
    installationId: installation.installationId,
    ownerId: installation.currentOwnerId,
    executorId: installation.currentExecutorId,
    setupAttemptId: installation.currentSetupAttemptId,
    schedulePresent: true,
    scheduleEnabled: cron.enabled,
  };
}

function injectedPreOwnerInspect({ installationStore, cron, events }) {
  let installation = structuredClone(installationStore.read());
  if (!installation.currentCronJobId && installation.currentSetupAttemptId && cron) {
    installation.currentCronJobId = cron.id;
    installation.currentCronSetupAttemptId = installation.currentSetupAttemptId;
    installationStore.save(installation);
    events.push(['adopt', cron.id]);
  }
  const localState = () => {
    const persisted = installationStore.read();
    const observedCron = persisted.currentCronJobId === cron?.id ? cron : null;
    return {
      installationId: persisted.installationId,
      ownerId: persisted.currentOwnerId ?? null,
      executorId: persisted.currentExecutorId ?? null,
      setupAttemptId: persisted.currentSetupAttemptId ?? null,
      schedulePresent: !!observedCron,
      scheduleEnabled: observedCron?.enabled ?? false,
    };
  };
  if (installation.currentSetupAttemptId
      && (!installation.currentOwnerId || !installation.currentExecutorId)) {
    if (cron?.enabled) {
      events.push(['pause', cron.id]);
      cron.enabled = false;
    }
    events.push(['surface', 'owner_unattributed']);
    const error = new Error('owner_unattributed');
    error.state = localState();
    throw error;
  }
  return localState();
}

test('keeps a Linux source contract for the macOS-native historical persistence fixture', () => {
  expect(nativeCompatibility).toContain('exactHistoricalInstallationJSON');
  expect(nativeCompatibility).toContain('{"installationId":"installation-old","currentSetupAttemptId":"attempt-old"}');
  expect(nativeCompatibility).toContain('HermesLocalStore(applicationSupportURL:');
  expect(nativeCompatibility).toContain('environment["RUNNER_TEMP"]');
  expect(nativeCompatibility).toContain('URL(fileURLWithPath: runnerTemp');
  expect(nativeCompatibility).toContain('manager.handle(inspectRequest)');
  expect(nativeCompatibility).toContain('manager.handle(rebindRequest)');
  expect(nativeCompatibility).toContain('rebound.stage == "connectorActivationConfirmed"');
  expect(nativeCompatibility).toContain('rebound.state?.scheduleEnabled == false');
  expect(nativeCompatibility).not.toContain('rebound.stage == "scheduleDisabled"');
  for (const rejection of ['malformed', 'newer', 'tampered']) {
    expect(nativeCompatibility).toContain(`assertRejected("${rejection}"`);
  }
  expect(macWorkflow).toContain('HermesPersistenceCompatibility.swift');
  expect(macWorkflow).toContain('swiftc -parse-as-library');
  expect(macWorkflow).toContain('hermes-persistence-compatibility');
});

test('uses a verified credential-free connector status boundary for runtime authority', () => {
  expect(runtime).not.toContain('let credential: String?');
  expect(runtime).not.toContain('"INDEX_API_KEY"');
  expect(runtime).toContain('case connectorStatus');
  expect(runtime).toContain('struct HermesConnectorStatus: Codable');
  expect(runtime).toContain('connectorActivationConfirmed');
  for (const token of [
    '/Applications/Index Connector.app',
    'Applications/Index Connector.app',
    'connector-release.cms', '/usr/bin/security',
    'LMQ3XNXLAD', 'expectedDesignatedRequirement', 'SHA256',
    'SecStaticCodeCreateWithPath', 'SecRequirementCreateWithString',
    'SecStaticCodeCheckValidity', 'SecCodeCopySigningInformation',
    'protocolVersion', 'buildMode', 'apiEnvironment',
    'maximumConnectorResponseBytes', 'allowedChildEnvironmentKeys',
    'forbiddenCanonicalKeys', 'connectorDisconnect',
    'stagingRoot', 'copyItem', 'hardenAndRejectSymlinks',
    'sourceAfter.identity == sourceBefore.identity',
    'openRegularFileDescriptor', 'O_RDONLY | O_NOFOLLOW',
    'posix_spawn', 'expectedFileIdentity',
  ]) expect(runtime).toContain(token);
  expect(runtime).toContain('CharacterSet.alphanumerics.contains');
  expect(runtime).toContain('status.st_mode & mode_t(S_IFMT) != mode_t(S_IFLNK)');
  expect(runtime).toContain('metadata["teamId"] as? String == Self.expectedTeamID');
  expect(runtime).toContain('metadata["designatedRequirement"] as? String == Self.expectedDesignatedRequirement');
  expect(build).toContain('production connector trust pins missing or mismatched');
  expect(runtime).not.toContain('credentialId');
  expect(runtime).not.toContain('CommandLine.arguments');
  for (const token of [
    'POSIX_SPAWN_START_SUSPENDED',
    'HermesConnectorCodeAttestor.attestSuspendedChild',
    'SecCodeCopyGuestWithAttributes',
    'kSecCodeInfoUnique',
    'operations.signal(child, SIGCONT)',
  ]) expect(runtime + launchAttestation).toContain(token);

  for (const forbidden of [
    'posix_spawn_file_actions_addinherit_np',
    'O_EXEC | O_NOFOLLOW',
    'let descriptorPath = "/dev/fd/',
  ]) expect(runtime).not.toContain(forbidden);
  expect(build).toContain('Tests/ConnectorLaunchAttestationFixture.swift');
  expect(nativeCompatibility).not.toContain('/dev/fd/');
  expect(nativeCompatibility).not.toContain('posix_spawn');
  const connectorBoundary = runtime.slice(
    runtime.indexOf('final class HermesVerifiedConnectorStatusProvider'),
    runtime.indexOf('final class HermesRuntimeManager'),
  );
  expect(connectorBoundary).not.toContain('process.executableURL = executable');
});

test('production launch delegates ordered child ownership and fault coverage to the shared lifecycle', () => {
  const productionLaunch = runtime.match(
    /private func launch\([\s\S]*?\n    private func runCommand/,
  )?.[0] ?? '';
  const sharedLifecycle = launchAttestation.slice(
    launchAttestation.indexOf('enum HermesSuspendedChildLifecycle'),
  );

  expect(productionLaunch).toContain('HermesSuspendedChildLifecycle.run(');
  expect(productionLaunch).toContain('startIO: {');
  expect(productionLaunch).not.toContain('Darwin.kill(child, SIGCONT)');
  expect(productionLaunch).not.toContain('Darwin.waitpid');
  expect(productionLaunch.indexOf('try handle.write(contentsOf: input)'))
    .toBeGreaterThan(productionLaunch.indexOf('startIO: {'));

  const attestation = sharedLifecycle.indexOf('try attest(child)');
  const resume = sharedLifecycle.indexOf('operations.signal(child, SIGCONT)');
  const stdin = sharedLifecycle.indexOf('try startIO()');
  expect(attestation).toBeGreaterThanOrEqual(0);
  expect(resume).toBeGreaterThan(attestation);
  expect(stdin).toBeGreaterThan(resume);

  for (const faultCase of [
    'injectedAttestationFailureWritesNoStdin',
    'injectedResumeFailureCleansUp',
    'injectedTimeoutEscalates',
    'injectedCleanupErrorsStayBounded',
  ]) expect(launchFixture).toContain(faultCase);
  expect(launchFixture).toContain('HermesSuspendedChildLifecycle.run(');
  expect(launchFixture).not.toContain('private static func waitForChild');
  expect(launchFixture).not.toContain('private static func killAndReap');
});

test('connector staging rejects ancestor links, source replacement, and staged mutation', () => {
  const admit = ({ ancestorKinds, sourceBefore, sourceAfter, stagedBefore, stagedAfter }) => {
    if (ancestorKinds.some((kind) => kind === 'symlink')) throw new Error('connector_unverified');
    if (sourceBefore !== sourceAfter || stagedBefore !== stagedAfter) throw new Error('connector_unverified');
    return true;
  };
  expect(() => admit({
    ancestorKinds: ['directory', 'symlink', 'directory'],
    sourceBefore: 'a', sourceAfter: 'a', stagedBefore: 'a', stagedAfter: 'a',
  })).toThrow('connector_unverified');
  expect(() => admit({
    ancestorKinds: ['directory'],
    sourceBefore: 'source-a', sourceAfter: 'source-b', stagedBefore: 'a', stagedAfter: 'a',
  })).toThrow('connector_unverified');
  expect(() => admit({
    ancestorKinds: ['directory'],
    sourceBefore: 'a', sourceAfter: 'a', stagedBefore: 'stage-a', stagedAfter: 'stage-b',
  })).toThrow('connector_unverified');
  expect(runtime).toContain('HermesFilesystem.openDirectory(bundle, createMissing: false)');
  expect(runtime).toContain('sourceAfter.data == sourceBefore.data');
  expect(runtime).toContain('descriptorSnapshot.identity == stagedExecutable.identity');
  expect(runtime).toContain('immediatelyBeforeExecution.identity == stagedExecutable.identity');
  expect(runtime).toContain('afterExecution.identity == stagedExecutable.identity');
});

test('connector response secret keys are canonicalized recursively across separator variants', () => {
  const forbidden = new Set([
    'credential', 'rawcredential', 'credentialid', 'apikey', 'token', 'secret',
    'password', 'auth', 'authorization', 'authorizationcode', 'verifier', 'challenge',
  ]);
  const rejects = (value) => Array.isArray(value)
    ? value.some(rejects)
    : value && typeof value === 'object'
      ? Object.entries(value).some(([key, child]) => (
        [...forbidden].some((term) => {
          const canonical = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
          return canonical.includes(term);
        }) || rejects(child)
      ))
      : false;
  for (const key of [
    'raw-credential', 'raw_credential', 'credential.id', 'API---KEY', 'auth_token',
    'pass-word', 'veri_fier', 'chal.lenge', 'se-cret', 'user.token.value',
  ]) expect(rejects({ safe: [{ nested: { [key]: 'redacted-fixture' } }] })).toBe(true);
  expect(rejects({ accountLabel: null, installationId: 'safe' })).toBe(false);
  expect(runtime).toContain('Set(payload.keys) == Self.statusKeys');
  expect(runtime).toContain('payload["accountLabel"] is NSNull');
  expect(runtime).toContain('actions.count <= Self.canonicalActions.count');
});

test('defines the request-correlated runtime bridge contract', () => {
  expect(runtime).toContain('enum HermesRuntimeCommand: String');
  for (const command of ['inspect', 'configureDisabled', 'enable', 'confirmHealthy', 'disable', 'disconnect']) {
    expect(runtime).toMatch(new RegExp(`case [^\\n]*\\b${command}\\b`));
  }
  expect(runtime).toContain('struct HermesRuntimeRequest: Decodable');
  expect(runtime).toContain('let requestId: String');
  expect(runtime).toContain('let setupAttemptId: String?');
  expect(runtime).toContain('struct HermesRuntimeResult: Encodable');
  expect(runtime).toContain('requestId: request.requestId');
  expect(main).toContain('name: "hermesRuntime"');
  expect(main).toContain('window.__indexHermesRuntimeProgress');
  expect(main).toContain('window.__indexHermesRuntimeResult');
  expect(main).not.toContain('window.__indexHermesSetup');
  expect(main).not.toContain('setupHermes(apiKey:');
});

test('fails closed on navigation and externalizes only user-activated http(s) links', () => {
  const policy = main.match(/decidePolicyFor navigationAction[\s\S]*?decisionHandler\(\.cancel\)/)?.[0] ?? '';
  expect(policy).toContain('navigationAction.targetFrame?.isMainFrame == true');
  expect(policy).toContain('requestURL == trustedBundledDocumentURL');
  expect(policy).toContain('navigationAction.navigationType == .linkActivated');
  expect(policy).toContain('scheme == "http" || scheme == "https"');
  expect(policy).toContain('NSWorkspace.shared.open(url)');
  expect(policy).toContain('decisionHandler(.cancel)');
  expect(main).toContain('decidePolicyFor navigationResponse');
  expect(main).toContain('navigationResponse.isForMainFrame');
  expect(main).toContain('responseURL == trustedBundledDocumentURL');
  expect(main).toContain('createWebViewWith configuration');
  expect(main).toContain('return nil');

  const opened = [];
  for (const url of ['https://example.test/path', 'http://example.test/path']) {
    expect(injectedNavigationPolicy({
      url, bundledURL: 'file:///bundle/index.html', isMainFrame: true,
      linkActivated: true, openExternal: (candidate) => opened.push(candidate),
    })).toBe('cancel');
  }
  expect(opened).toEqual(['https://example.test/path', 'http://example.test/path']);
  expect(injectedNavigationPolicy({
    url: 'javascript:INDEX_NATIVE.apiKey', bundledURL: 'file:///bundle/index.html',
    isMainFrame: true, linkActivated: true, openExternal: () => { throw new Error('must not open'); },
  })).toBe('cancel');
});

test('applies exact bundled generation admission to auth before decoding actions', () => {
  const block = main.match(/if message\.name == "indexAuth"[\s\S]*?return\n        \}/)?.[0] ?? '';
  expect(block.indexOf('isTrustedBridgeMessage(message)')).toBeGreaterThan(-1);
  expect(block.indexOf('isTrustedBridgeMessage(message)')).toBeLessThan(block.indexOf('message.body'));
  expect(block).toContain('completeLogout');
  expect(block).not.toContain('action == "logout"');
});

test('returns the complete non-secret local state and never callback-encodes credentials', () => {
  expect(runtime).toContain('struct HermesLocalState: Codable');
  for (const field of [
    'installationId', 'ownerId', 'executorId', 'pluginInstalled', 'negotiatorMode',
    'schedulePresent', 'scheduleEnabled', 'setupAttemptId',
  ]) {
    expect(runtime).toMatch(new RegExp(`let ${field}:`));
  }
  const stateBlock = runtime.match(/struct HermesLocalState: Codable \{[\s\S]*?\n\}/)?.[0] ?? '';
  const resultBlock = runtime.match(/struct HermesRuntimeResult: Encodable \{[\s\S]*?\n\}/)?.[0] ?? '';
  const journalBlock = runtime.match(/struct HermesSetupJournal: Codable \{[\s\S]*?\n\}/)?.[0] ?? '';
  expect(stateBlock).not.toContain('credential');
  expect(resultBlock).not.toContain('credential');
  expect(journalBlock).not.toContain('credential');
  expect(main).not.toContain('args.joined(separator: " ")');
});

test('persists stable installation identity and a generation-fenced setup journal', () => {
  expect(runtime).toContain('struct HermesInstallationRecord: Codable');
  expect(runtime).toContain('hermes-installation.json');
  expect(runtime).toContain('UUID().uuidString.lowercased()');
  expect(runtime).toContain('hermes-setup-journal.json');
  expect(runtime).toContain('struct HermesSetupJournal: Codable');
  expect(runtime).toContain('let setupAttemptId: String');
  expect(runtime).toContain('let ownerId: String');
  expect(runtime).toContain('let executorId: String?');
  expect(runtime).toContain('var currentOwnerId: String?');
  for (const stage of [
    'preparing', 'environmentWritten', 'pluginInstalled', 'scheduleDisabled',
    'enabling', 'awaitingHeartbeat', 'disconnecting', 'connectorDisconnected', 'disconnectCleanupComplete',
  ]) {
    expect(runtime).toContain(`case ${stage}`);
  }
  expect(runtime).toContain('currentSetupAttemptId == expectedSetupAttemptId');
  expect(runtime).toContain('disconnect_noop');
  expect(runtime).toContain('confirm_healthy_noop');
  expect(runtime).toContain('store.deleteJournal()');
  expect(runtime).not.toContain('removeItem(at: store.installationURL');
});

test('preserves existing Hermes env unless a readable UTF-8 file or ENOENT is established', () => {
  expect(runtime).toContain('private let readSnapshot: (HermesDirectoryDescriptor, String) throws -> HermesFileSnapshot?');
  expect(runtime).toContain('HermesDirectoryDescriptor,\n        String,\n        HermesExpectedFileState');
  expect(runtime).toContain('private func existingLines() throws -> [String]');
  expect(runtime).toContain('if Self.isNoSuchFileError(error) { return ([], .absent) }');
  expect(runtime).toContain('NSFileReadNoSuchFileError');
  expect(runtime).toContain('POSIXErrorCode.ENOENT.rawValue');
  expect(runtime).toContain('NSPOSIXErrorDomain');
  expect(runtime).toContain('HermesRuntimeFailure.envWriteFailed');
  expect(runtime).not.toContain('guard let contents = try? String(contentsOf: url, encoding: .utf8) else { return [] }');
  expect(runtime).toContain('private func mutate(_ transform: (inout [String]) -> Void) throws');

  const unrelated = 'OTHER_HERMES_SETTING=keep\nINDEX_API_KEY=old\n';
  let replacement;
  injectedEnvFile({
    readExisting: () => new TextEncoder().encode(unrelated),
    writeReplacement: (data) => { replacement = new TextDecoder().decode(data); },
  }).upsert([['INDEX_API_KEY', 'new']]);
  expect(replacement).toBe('OTHER_HERMES_SETTING=keep\nINDEX_API_KEY=new\n');

  replacement = undefined;
  injectedEnvFile({
    readExisting: () => new TextEncoder().encode(unrelated),
    writeReplacement: (data) => { replacement = new TextDecoder().decode(data); },
  }).removeOwned();
  expect(replacement).toBe('OTHER_HERMES_SETTING=keep\n');

  replacement = undefined;
  injectedEnvFile({
    readExisting: () => ABSENT,
    writeReplacement: (data) => { replacement = new TextDecoder().decode(data); },
  }).upsert([['INDEX_API_KEY', 'new']]);
  expect(replacement).toBe('INDEX_API_KEY=new\n');

  for (const readFailure of [
    () => { throw new Error('EACCES'); },
    () => Uint8Array.from([0xff, 0xfe, 0x41]),
  ]) {
    let writes = 0;
    for (const operation of [
      (env) => env.upsert([['INDEX_API_KEY', 'new']]),
      (env) => env.removeOwned(),
    ]) {
      const env = injectedEnvFile({
        readExisting: readFailure,
        writeReplacement: () => { writes += 1; },
      });
      expect(() => operation(env)).toThrow('env_write_failed');
      expect(writes).toBe(0);
    }
  }
});

test('scrubs all legacy env keys and gates nonsecret development values twice', () => {
  expect(runtime).not.toContain('"INDEX_API_KEY"');
  expect(runtime).not.toContain('static let ownedKeys');
  expect(runtime).toContain('static let legacyOwnedKeys');
  expect(runtime).toContain('INDEX_PLUGIN_DEVELOPMENT_TRANSPORT');
  expect(runtime).toContain('.index-plugin-development');
  expect(runtime).toContain('source-checkout-only');
  expect(runtime).toContain('try environment.removeOwnedValues()');
  expect(runtime).toContain('verifyEnvironmentPolicy(developmentTransport:');
  expect(runtime).toContain('mode_t(0o600)');
  expect(runtime).not.toContain('/bin/sh');
  expect(runtime).not.toContain('/bin/zsh');
});

test('persists the strict non-secret saga journal in Application Support across bridge instances', () => {
  expect(runtime).toContain('struct HermesSagaOperationRecord: Codable, Equatable');
  expect(runtime).toContain('hermes-saga-operation.json');
  expect(runtime).toContain('Set(values.allKeys.map(\\.stringValue)) == Self.exactKeys');
  expect(runtime).toContain('func loadOperation() throws -> HermesSagaOperationRecord?');
  expect(runtime).toContain('func saveOperation(_ record: HermesSagaOperationRecord) throws');
  expect(runtime).toContain('func clearOperation(expected: HermesSagaOperationRecord)');
  expect(runtime).toContain('HermesSecureFileWriter.write');
  for (const command of ['loadOperation', 'saveOperation', 'clearOperation']) {
    expect(runtime).toMatch(new RegExp(`case [^\\n]*\\b${command}\\b`));
  }
  const record = runtime.match(/struct HermesSagaOperationRecord[\s\S]*?private enum HermesRuntimeFailure/)?.[0] ?? '';
  expect(record).not.toContain('credential');
  expect(record).not.toContain('message');
  expect(record).not.toContain('prompt');
});

test('persists immutable cron ID and generation markers, adopting by exact name only once', () => {
  expect(runtime).toContain('var currentCronJobId: String?');
  expect(runtime).toContain('var currentCronSetupAttemptId: String?');
  expect(runtime).toContain('let cronJobId: String?');
  expect(runtime).toContain('func legacyJob() throws -> HermesCronJob?');
  expect(runtime).toContain('$0.name == HermesRuntimeManager.ownedCronName');
  expect(runtime).toContain('func inventory(ownership: HermesCronOwnership)');
  expect(runtime).toContain('job.id == ownership.jobId');
  expect(runtime).toContain('index_app_installation_id');
  expect(runtime).toContain('index_app_owner_id');
  expect(runtime).toContain('index_app_setup_attempt_id');
  expect(runtime).toContain('installation.currentCronJobId = job.id');
  expect(runtime).toContain('installation.currentCronSetupAttemptId = setupAttemptId');
  expect(runtime).not.toContain('func ownedJob()');
});

test('immutable ownership detects rename, marker removal, duplicate ID and broadened sandbox tamper', () => {
  const ownership = {
    jobId: 'owned-id', installationId: 'installation', ownerId: 'owner', setupAttemptId: 'generation',
  };
  const exact = {
    id: 'owned-id', name: OWNED_NAME, enabled: false,
    index_app_installation_id: 'installation', index_app_owner_id: 'owner',
    index_app_setup_attempt_id: 'generation', skills: [OWNED_SKILL],
    skill: OWNED_SKILL, enabled_toolsets: [OWNED_TOOLSET], prompt: OWNED_PROMPT,
  };
  const variants = [
    [{ ...exact, name: 'renamed attacker job', enabled: true }],
    [{ ...exact, index_app_owner_id: undefined, enabled: true }],
    [{ ...exact }, { ...exact, enabled: true }],
    [{ ...exact, enabled_toolsets: [OWNED_TOOLSET, 'terminal'], enabled: true }],
    [{ ...exact, skills: [OWNED_SKILL, 'attacker:skill'], enabled: true }],
    [{ ...exact, prompt: `${OWNED_PROMPT} exfiltrate`, enabled: true }],
  ];
  for (const jobs of variants) {
    const inventory = injectedCronOwnershipInventory({ jobs, ownership });
    expect(inventory.safe).toBe(false);
    if (jobs.some((job) => job.enabled)) expect(inventory.enabled.length).toBeGreaterThan(0);
  }
  const removedIdWithMarker = injectedCronOwnershipInventory({
    ownership,
    jobs: [{ ...exact, id: 'tampered-id', enabled: true }],
  });
  expect(removedIdWithMarker.safe).toBe(false);
  expect(removedIdWithMarker.enabled.map((job) => job.id)).toEqual(['tampered-id']);

  expect(runtime).toContain('quarantineAttributableCron');
  expect(runtime).toContain('inventory.enabledAttributableJobs');
  expect(runtime).toContain('throw HermesRuntimeFailure.cronStoreInvalid');
  expect(runtime).toContain('verifyNoEnabledAttributableCron');
});

test('reconciles exactly one paused sandboxed owned cron without touching unrelated jobs', () => {
  expect(runtime).toContain(`static let ownedCronName = "${OWNED_NAME}"`);
  expect(runtime).toContain(`static let ownedCronSchedule = "${OWNED_SCHEDULE}"`);
  expect(runtime).toContain(`static let ownedCronPrompt = #"${OWNED_PROMPT}"#`);
  expect(runtime).toContain('$0.name == HermesRuntimeManager.ownedCronName');
  expect(runtime).toContain('throw HermesRuntimeFailure.cronAmbiguous');
  expect(runtime).toContain(`static let ownedCronSkill = "${OWNED_SKILL}"`);
  expect(runtime).toContain(`static let ownedCronToolset = "${OWNED_TOOLSET}"`);
  expect(runtime).toContain('lockName: ".jobs.lock"');
  expect(runtime).toContain('jobs[index]["enabled_toolsets"] = [HermesRuntimeManager.ownedCronToolset]');
  expect(runtime).toContain('jobs[index]["index_app_installation_id"] = ownership.installationId');
  expect(runtime).toContain('jobs[index]["skills"] = [HermesRuntimeManager.ownedCronSkill]');
  expect(runtime).toContain('isExactOwnedCron(verified)');
  expect(runtime).toContain('job.enabledToolsets == [Self.ownedCronToolset]');
  expect(runtime).toContain('job.skills == [Self.ownedCronSkill]');
  for (const command of ['"create"', '"edit"', '"pause"', '"resume"', '"remove"']) {
    expect(runtime).toContain(command);
  }
  expect(runtime).toContain('["cron", "pause", jobId]');
  expect(runtime).toContain('["cron", "resume", job.id]');
  expect(runtime).toContain('["cron", "remove", jobId]');
  expect(runtime).not.toContain('removeAllCron');
  expect(runtime).not.toContain('cron", "remove"].map');
});

test('sandbox configuration denies injected core tools rather than relying on prompt prose', () => {
  const persistedJob = {
    skills: [OWNED_SKILL],
    skill: OWNED_SKILL,
    enabled_toolsets: [OWNED_TOOLSET],
  };
  const toolRegistry = [
    { name: 'index_pickup_negotiation', toolset: 'index-network' },
    { name: 'terminal', toolset: 'terminal' },
    { name: 'browser', toolset: 'web' },
    { name: 'mcp', toolset: 'mcp' },
  ];
  const exposed = toolRegistry
    .filter((tool) => persistedJob.enabled_toolsets.includes(tool.toolset))
    .map((tool) => tool.name);
  expect(exposed).toEqual(['index_pickup_negotiation']);
  expect(exposed).not.toContain('terminal');
  expect(OWNED_PROMPT).not.toMatch(/do not use|forbid|deny/i);
});

test('inspection fail-closes partial setup locally and native code never calls server APIs', () => {
  expect(runtime).toContain('if journal != nil, cron?.enabled == true');
  expect(runtime).toContain('if case .journalInvalid = failure');
  expect(runtime).toContain('installation.currentSetupAttemptId != nil');
  expect(runtime).toContain('quarantineAttributableCron');
  expect(runtime).toContain('pauseCronByID');
  expect(runtime).toContain('stage: journal?.stage.rawValue ?? "inspected"');
  expect(runtime).not.toContain('URLSession');
  expect(runtime).not.toContain('/api/agents');
  expect(runtime).not.toContain('x-api-key');
});

test('migrates a pre-owner confirmed generation by pausing before surfacing preserved unattributed evidence', () => {
  expect(runtime).not.toContain('let completeGeneration = record.currentSetupAttemptId == nil');
  expect(runtime).toContain('case ownerUnattributed');
  expect(runtime).toContain('return "owner_unattributed"');
  const inspectBlock = runtime.match(/private func inspect\([\s\S]*?private func configureDisabled/)?.[0] ?? '';
  const unattributedCheck = inspectBlock.indexOf('generationOwnerIsUnattributed');
  const pause = inspectBlock.indexOf('pauseCronByID', unattributedCheck);
  const surface = inspectBlock.indexOf('throw HermesRuntimeFailure.ownerUnattributed', unattributedCheck);
  expect(unattributedCheck).toBeGreaterThan(-1);
  expect(pause).toBeGreaterThan(unattributedCheck);
  expect(surface).toBeGreaterThan(pause);
  expect(inspectBlock).not.toContain('currentOwnerId = request.ownerId');
  expect(inspectBlock.slice(unattributedCheck, surface)).not.toContain('saveInstallation');

  // Historical confirmed schema predates owner/executor publication but keeps
  // the exact installation and generation evidence beside an enabled owned job.
  const oldJSON = JSON.stringify({
    installationId: 'installation-old',
    currentSetupAttemptId: 'attempt-old',
  });
  let persistedInstallation = JSON.parse(oldJSON);
  const installationStore = {
    read: () => structuredClone(persistedInstallation),
    save: (next) => { persistedInstallation = structuredClone(next); },
  };
  const cron = { id: 'owned-cron-old', enabled: true };
  const events = [];
  let surfaced;
  try {
    injectedPreOwnerInspect({ installationStore, cron, events });
  } catch (error) {
    surfaced = error;
  }
  expect(events).toEqual([
    ['adopt', 'owned-cron-old'],
    ['pause', 'owned-cron-old'],
    ['surface', 'owner_unattributed'],
  ]);
  expect(surfaced).toMatchObject({
    message: 'owner_unattributed',
    state: {
      installationId: 'installation-old', ownerId: null, executorId: null,
      setupAttemptId: 'attempt-old', schedulePresent: true, scheduleEnabled: false,
    },
  });
  expect(persistedInstallation).toEqual({
    installationId: 'installation-old',
    currentSetupAttemptId: 'attempt-old',
    currentCronJobId: 'owned-cron-old',
    currentCronSetupAttemptId: 'attempt-old',
  });
  expect(cron.enabled).toBe(false);

  // The error fallback is evaluated only after inspect performed the adoption
  // and pause; localState observes the partial legacy tuple by immutable ID
  // without upgrading it into an owner-attributed operational capability.
  const handleBlock = runtime.match(/func handle\([\s\S]*?private func inspect/)?.[0] ?? '';
  const localStateBlock = runtime.match(/private func localState\([\s\S]*?private func success/)?.[0] ?? '';
  expect(handleBlock).toContain('state: try? localState()');
  expect(localStateBlock).toContain('generationOwnerIsUnattributed');
  expect(localStateBlock).toContain('cronStore.job(id: jobId)');
  expect(localStateBlock.indexOf('generationOwnerIsUnattributed')).toBeLessThan(
    localStateBlock.indexOf('verifiedOwnedCron'),
  );

  // Complete the source state-machine path using the immutable ID persisted by
  // inspect and the paused state observed by localState. Only exact historical
  // installation/setup markers permit configureDisabled to publish the owner.
  Object.assign(cron, {
    name: OWNED_NAME, schedule: OWNED_SCHEDULE, prompt: OWNED_PROMPT,
    skills: [OWNED_SKILL], skill: OWNED_SKILL, enabled_toolsets: [OWNED_TOOLSET],
    index_app_installation_id: 'installation-old', index_app_owner_id: null,
    index_app_setup_attempt_id: 'attempt-old',
  });
  expect(injectedPreOwnerConfigureRebind({
    installation: persistedInstallation,
    cron,
    request: {
      installationId: 'installation-old', ownerId: 'owner-new', executorId: 'executor-new',
      setupAttemptId: 'attempt-new',
    },
  })).toMatchObject({
    ownerId: 'owner-new', executorId: 'executor-new', setupAttemptId: 'attempt-new',
    scheduleEnabled: false,
  });
});

test('configureDisabled explicitly rebinds only the exact paused pre-owner generation', () => {
  const configureBlock = runtime.match(/private func configureDisabled\([\s\S]*?private func enable/)?.[0] ?? '';
  expect(configureBlock).toContain('preOwnerRecord');
  expect(configureBlock).toContain('preOwnerRebindJob');
  expect(configureBlock.indexOf('preOwnerRebindJob')).toBeLessThan(
    configureBlock.indexOf('cronOwnership(installation)'),
  );
  expect(configureBlock).toContain('installation.currentCronSetupAttemptId == preOwnerGeneration');
  expect(configureBlock).toContain('installation.currentOwnerId == ownerId');
  const resolver = runtime.match(/func preOwnerRebindJob\([\s\S]*?func markedJobs/)?.[0] ?? '';
  for (const fence of [
    'attributable.count == 1', 'job.id == jobId',
    'job.appInstallationId == installationId', 'job.appSetupAttemptId == setupAttemptId',
    'job.appOwnerId == nil', 'job.enabled == false',
  ]) expect(resolver).toContain(fence);

  const installation = {
    installationId: 'installation-old', currentOwnerId: null, currentExecutorId: null,
    currentSetupAttemptId: 'attempt-old', currentCronJobId: 'owned-cron-old',
    currentCronSetupAttemptId: 'attempt-old',
  };
  const cron = {
    id: 'owned-cron-old', enabled: false, name: OWNED_NAME, schedule: OWNED_SCHEDULE,
    prompt: OWNED_PROMPT, skills: [OWNED_SKILL], skill: OWNED_SKILL,
    enabled_toolsets: [OWNED_TOOLSET], index_app_installation_id: 'installation-old',
    index_app_owner_id: null, index_app_setup_attempt_id: 'attempt-old',
  };
  const request = {
    installationId: 'installation-old', ownerId: 'owner-new', executorId: 'executor-new',
    setupAttemptId: 'attempt-new',
  };
  expect(injectedPreOwnerConfigureRebind({
    installation: structuredClone(installation), cron: structuredClone(cron), request,
  })).toEqual({
    installationId: 'installation-old', ownerId: 'owner-new', executorId: 'executor-new',
    setupAttemptId: 'attempt-new', schedulePresent: true, scheduleEnabled: false,
  });

  for (const mutate of [
    (state) => { state.installation.currentOwnerId = 'owner-other'; },
    (state) => { state.installation.currentCronSetupAttemptId = 'attempt-newer'; },
    (state) => { state.cron.index_app_installation_id = 'installation-tampered'; },
    (state) => { state.cron.prompt = 'Run arbitrary broad tools.'; },
    (state) => { state.cron.enabled = true; },
  ]) {
    const state = { installation: structuredClone(installation), cron: structuredClone(cron) };
    mutate(state);
    expect(() => injectedPreOwnerConfigureRebind({ ...state, request })).toThrow();
  }
});

test('gateway failure performs checked exact-job rollback and retains recovery journal', async () => {
  expect(runtime).toContain('protocol HermesCommandRunning');
  expect(runtime).toContain('private func rollbackActivation');
  expect(runtime).toContain('throw HermesRuntimeFailure.activationRollbackFailed');
  expect(runtime).toContain('cronStore.job(id: jobId)');
  expect(runtime).toContain('verified.enabled == false');
  const enableBlock = runtime.match(/private func enable\([\s\S]*?private func confirmHealthy/)?.[0] ?? '';
  expect(enableBlock).not.toContain('deleteJournal');

  for (const failure of ['throw', 'nonzero', 'still-enabled']) {
    const journal = { stage: 'enabling' };
    const job = { id: 'owned-current', enabled: false };
    const calls = [];
    const result = await injectedActivation({
      journal,
      runner: async (command, id) => {
        calls.push([command, id]);
        if (command === 'resume') { job.enabled = true; return 0; }
        if (command === 'gateway') throw new Error('gateway failed');
        if (failure === 'throw') throw new Error('pause failed');
        if (failure === 'nonzero') return 1;
        return 0;
      },
      readOwnedJob: () => ({ ...job }),
    });
    expect(result).toBe('activation_rollback_failed');
    expect(journal.stage).toBe('enabling');
    expect(calls).toContainEqual(['pause', 'owned-current']);
  }

  const journal = { stage: 'enabling' };
  const job = { id: 'owned-current', enabled: false };
  const result = await injectedActivation({
    journal,
    runner: async (command, id) => {
      expect(id).toBe('owned-current');
      if (command === 'resume') { job.enabled = true; return 0; }
      if (command === 'gateway') throw new Error('gateway failed');
      if (command === 'pause') { job.enabled = false; return 0; }
      return 1;
    },
    readOwnedJob: () => ({ ...job }),
  });
  expect(result).toBe('gateway_failed');
  expect(job.enabled).toBe(false);
  expect(journal.stage).toBe('enabling');
});

test('connector-backed local cleanup requires durable connector and exact server proofs', () => {
  const block = runtime.match(/private func disconnect\(_ request:[\s\S]*?private func finishTerminalDisconnect/)?.[0] ?? '';
  expect(block).toContain('journal?.stage == .connectorDisconnected');
  expect(block).toContain('operation?.stage == "server-complete"');
  expect(block).toContain('operation?.installationId == installation.currentConnectorInstallationId');
  expect(block.indexOf('operation?.stage == "server-complete"')).toBeLessThan(
    block.indexOf('plugins", "remove"'),
  );
});

test('native logout preparation and completion independently require no key and no attributable enabled cron', () => {
  expect(runtime).toMatch(/case [^\n]*\bprepareLogout\b/);
  expect(runtime).toContain('private func prepareLogout');
  expect(runtime).toContain('try environment.removeOwnedValues()');
  expect(runtime).toContain('verifyLogoutPostconditions');
  expect(runtime).toContain('intersection(HermesEnvironmentFile.legacyOwnedKeys).isEmpty');
  expect(runtime).toContain('verifyNoEnabledAttributableCron');
  const evidence = runtime.match(/func logoutEvidence[\s\S]*?func finishLogoutEvidence/)?.[0] ?? '';
  expect(evidence).toContain('evidence.operation == "disconnect"');
  expect(evidence).toContain('evidence.stage == "server-complete"');
  expect(evidence).toContain('verifyLogoutPostconditions');
  expect(evidence).not.toContain('state.scheduleEnabled == false');
});

test('disable requires a non-empty matching generation before pausing', () => {
  expect(runtime).toMatch(/guard let ownerId = validValue\(request\.ownerId\),\s*installation\.currentOwnerId == ownerId,\s*let expectedSetupAttemptId = validValue\(request\.setupAttemptId\),\s*installation\.currentSetupAttemptId == expectedSetupAttemptId else \{\s*return try success\(request, stage: "disable_noop"\)/s);
  for (const suppliedAttemptId of [undefined, null, '', 'stale']) {
    let pauses = 0;
    const result = injectedDisable({
      suppliedAttemptId,
      currentAttemptId: 'current',
      pause: () => { pauses += 1; },
    });
    expect(result).toBe('disable_noop');
    expect(pauses).toBe(0);
  }
  let pauses = 0;
  expect(injectedDisable({
    suppliedAttemptId: 'current',
    currentAttemptId: 'current',
    pause: () => { pauses += 1; },
  })).toBe('disabled');
  expect(pauses).toBe(1);
});

test('prepare-before-configure compensation is a safe no-op only for an unpublished nil-owner generation', () => {
  const disconnect = runtime.match(/private func disconnect\([\s\S]*?private func finishTerminalDisconnect/)?.[0] ?? '';
  const absent = disconnect.indexOf('installation.currentOwnerId == nil, journal == nil');
  const terminal = disconnect.indexOf('stage: "disconnected"', absent);
  const ownerFence = disconnect.indexOf('installation.currentOwnerId == ownerId', terminal);
  expect(absent).toBeGreaterThan(-1);
  expect(terminal).toBeGreaterThan(absent);
  expect(ownerFence).toBeGreaterThan(terminal);
  expect(disconnect).toContain('installation.currentSetupAttemptId == expectedSetupAttemptId');
  expect(disconnect).toContain('disconnect_noop');
});

test('successful results require complete readable local state', () => {
  expect(runtime).toMatch(/private func success\([\s\S]{0,120}\) throws -> HermesRuntimeResult/);
  const successBlock = runtime.match(/private func success\([\s\S]*?\n    \}/)?.[0] ?? '';
  expect(successBlock).toContain('state: try localState()');
  expect(successBlock).not.toContain('state: try? localState()');
  expect(runtime).toContain('let env = try environment.values()');

  expect(injectedSuccess(() => ({ scheduleEnabled: false }))).toEqual({
    ok: true,
    state: { scheduleEnabled: false },
  });
  expect(injectedSuccess(() => { throw new Error('journal_invalid'); })).toEqual({
    ok: false,
    errorCode: 'journal_invalid',
  });
  expect(injectedSuccess(() => { throw new Error('env_write_failed'); })).toEqual({
    ok: false,
    errorCode: 'env_write_failed',
  });
  expect(injectedSuccess(() => { throw new Error('cron_store_invalid'); })).toEqual({
    ok: false,
    errorCode: 'cron_store_invalid',
  });
});

test('emits credential-free dequeue progress from inside the serial queue before native handling', () => {
  expect(main).toContain('struct HermesRuntimeProgress: Encodable');
  expect(main).toContain('event: "started"');
  expect(main).toContain('emitHermesRuntimeProgress');
  const queueBlock = main.match(/hermesRuntimeQueue\.async[\s\S]*?DispatchQueue\.main\.async/)?.[0] ?? '';
  expect(queueBlock.indexOf('emitHermesRuntimeProgress')).toBeGreaterThan(-1);
  expect(queueBlock.indexOf('emitHermesRuntimeProgress')).toBeLessThan(queueBlock.indexOf('hermesRuntime.handle(request)'));
  const progressBlock = main.match(/struct HermesRuntimeProgress: Encodable \{[\s\S]*?\n\}/)?.[0] ?? '';
  expect(progressBlock).toContain('requestId');
  expect(progressBlock).toContain('event');
  expect(progressBlock).not.toContain('credential');
  expect(progressBlock).not.toContain('state');
});

test('uses stable sanitized failures and keeps command execution off the main thread', () => {
  for (const code of [
    'invalid_arguments', 'hermes_not_found', 'cron_store_invalid', 'cron_ambiguous',
    'cron_create_failed', 'cron_edit_failed', 'cron_pause_failed',
    'cron_resume_failed', 'cron_remove_failed', 'gateway_failed',
    'gateway_status_failed', 'command_timed_out', 'activation_rollback_failed',
  ]) {
    expect(runtime).toContain(`"${code}"`);
  }
  expect(runtime).not.toContain('localizedDescription');
  expect(main).toContain('DispatchQueue(label: "network.index.hermes-runtime"');
  expect(main).toContain('hermesRuntimeQueue.async');
  expect(main).toContain('DispatchQueue.main.async');
});

test('admits Hermes messages only from the exact bundled main frame before decode', () => {
  expect(main).toContain('message.frameInfo.isMainFrame');
  expect(main).toContain('trustedBundledDocumentURL');
  const handler = main.match(/private func handleHermesRuntimeMessage[\s\S]*?\n    \}/)?.[0] ?? '';
  expect(handler.indexOf('isTrustedBridgeMessage')).toBeGreaterThan(-1);
  expect(handler.indexOf('isTrustedBridgeMessage')).toBeLessThan(handler.indexOf('message.body'));
  const emitter = main.match(/private func emitHermesRuntimeResult[\s\S]*?\n    \}/)?.[0] ?? '';
  expect(emitter).toContain('webView.url?.standardizedFileURL == trustedBundledDocumentURL');

  for (const candidate of [
    { isMainFrame: false, frameURL: 'file:///bundle/index.html' },
    { isMainFrame: true, frameURL: 'file:///bundle/other.html' },
    { isMainFrame: true, frameURL: 'https://index.network/' },
  ]) {
    let decodes = 0; let executions = 0;
    expect(admitHermesMessage({
      ...candidate,
      bundledURL: 'file:///bundle/index.html',
      decode: () => { decodes += 1; return {}; },
      execute: () => { executions += 1; },
    })).toBe('rejected');
    expect(decodes).toBe(0);
    expect(executions).toBe(0);
  }
  let executions = 0;
  expect(admitHermesMessage({
    isMainFrame: true,
    frameURL: 'file:///bundle/index.html',
    bundledURL: 'file:///bundle/index.html',
    decode: () => ({ requestId: 'r1' }),
    execute: () => { executions += 1; },
  })).toBe('accepted');
  expect(executions).toBe(1);
});

test('suppresses async Hermes results across provisional and same-URL document generations', () => {
  expect(main).toContain('trustedDocumentGeneration');
  expect(main).toMatch(/didStartProvisionalNavigation[\s\S]*trustedDocumentGeneration \+= 1/);
  expect(main).toContain('let admittedGeneration = trustedDocumentGeneration');
  expect(main).toContain('admittedGeneration: admittedGeneration');
  const emitter = main.match(/private func emitHermesRuntimeResult[\s\S]*?\n    \}/)?.[0] ?? '';
  expect(emitter).toContain('webViewReady');
  expect(emitter).toContain('admittedGeneration == trustedDocumentGeneration');

  const bundledURL = 'file:///bundle/index.html';
  const gate = injectedTrustedDocumentGate(bundledURL);
  gate.startProvisional(null);
  gate.finish();
  const firstDocument = gate.admit();
  expect(firstDocument).not.toBeNull();
  expect(gate.canEmit(firstDocument)).toBe(true);

  // During a provisional reload WebKit may still expose the old committed URL.
  gate.startProvisional(bundledURL);
  expect(gate.admit()).toBeNull();
  expect(gate.canEmit(firstDocument)).toBe(false);

  // Finishing a reload of exactly the same URL must not revive old requests.
  gate.finish(bundledURL);
  expect(gate.canEmit(firstDocument)).toBe(false);
  const secondDocument = gate.admit();
  expect(secondDocument).not.toBe(firstDocument);
  expect(gate.canEmit(secondDocument)).toBe(true);
});

test('duplicate enable converges without regressing healthy current generation', () => {
  expect(runtime).toContain('alreadyEnabledCurrentGeneration');
  for (const journal of [{ stage: 'awaitingHeartbeat' }, null]) {
    const job = { name: OWNED_NAME, schedule: OWNED_SCHEDULE, prompt: OWNED_PROMPT, enabled: true };
    const before = journal == null ? null : { ...journal };
    const calls = [];
    const result = injectedEnable({
      currentAttempt: 'current', suppliedAttempt: 'current', journal, job, calls,
    });
    expect(result).toBe(journal == null ? 'confirmed_healthy' : 'awaitingHeartbeat');
    expect(journal).toEqual(before);
    expect(job.enabled).toBe(true);
    expect(calls).toEqual([]);
  }
});

test('command runner streams bounded output and enforces terminate/kill deadline', async () => {
  expect(runtime).not.toContain('readDataToEndOfFile');
  expect(runtime).toContain('readabilityHandler');
  expect(runtime).toContain('commandTimedOut');
  expect(runtime).toContain('process.terminate()');
  expect(runtime).toContain('SIGKILL');
  expect(runtime).toContain('16_384');

  const huge = Array.from({ length: 40 }, () => new Uint8Array(1024).fill(0x61));
  const bounded = await injectedBoundedRunner({
    chunks: huge, deadlineMs: 50, completesAfterMs: 0, terminate: () => {}, kill: () => {},
  });
  expect(bounded.byteLength).toBe(16_384);
  let terminated = 0; let killed = 0;
  await expect(injectedBoundedRunner({
    chunks: [], deadlineMs: 0, completesAfterMs: 100,
    terminate: () => { terminated += 1; }, kill: () => { killed += 1; },
  })).rejects.toThrow('command_timed_out');
  expect(terminated).toBe(1);
  expect(killed).toBe(1);
});

test('binary-less disconnect scrubs safe local wiring but remains retryable', () => {
  expect(runtime).toContain('binaryProvider()');
  expect(runtime).toContain('removePluginDirectory');
  expect(runtime).toContain('verifyDisconnectPostconditions');
  const state = {
    currentAttempt: 'current', journal: null, cronPresent: true, unrelatedCrons: ['backup'],
    pluginPresent: true, dashboardPresent: true,
    ownedEnvKeys: ['INDEX_API_KEY'], unrelatedEnv: ['OTHER=keep'],
  };
  const calls = [];
  const result = injectedDisconnect({
    binary: null,
    state,
    operations: {
      removeCron: () => false,
      removePlugin: () => false,
      removePluginLocal: () => calls.push('plugin-local'),
      removeDashboard: () => calls.push('dashboard'),
      removeEnv: () => calls.push('env'),
    },
  });
  expect(result).toEqual({ ok: false, errorCode: 'hermes_not_found' });
  expect(calls).toEqual(['plugin-local', 'dashboard', 'env']);
  expect(state.ownedEnvKeys).toEqual([]);
  expect(state.dashboardPresent).toBe(false);
  expect(state.pluginPresent).toBe(false);
  expect(state.unrelatedCrons).toEqual(['backup']);
  expect(state.unrelatedEnv).toEqual(['OTHER=keep']);
  expect(state.currentAttempt).toBe('current');
  expect(state.journal).toBe('disconnecting');
});

test('directory components use two no-follow path stats plus descriptor identity verification', () => {
  const verifiedOpen = runtime.match(
    /private static func openVerifiedChildDirectory\([\s\S]*?\n    \}\n\n    static func entryStatus/,
  )?.[0] ?? '';
  expect(verifiedOpen).toContain('AT_SYMLINK_NOFOLLOW');
  expect(verifiedOpen.match(/Darwin\.fstatat/g)?.length).toBe(2);
  expect(verifiedOpen).toContain('Darwin.openat(parent.rawValue, $0, O_RDONLY | O_DIRECTORY)');
  expect(verifiedOpen).not.toContain('O_DIRECTORY | O_NOFOLLOW');
  expect(verifiedOpen).toContain('Darwin.fstat(descriptor, &opened)');
  expect(verifiedOpen).toContain('before.st_dev == opened.st_dev');
  expect(verifiedOpen).toContain('before.st_ino == opened.st_ino');
  expect(verifiedOpen).toContain('opened.st_dev == after.st_dev');
  expect(verifiedOpen).toContain('opened.st_ino == after.st_ino');
  expect(verifiedOpen).toContain('defer {');
  expect(verifiedOpen).toContain('Darwin.close(descriptor)');
  expect(runtime).toMatch(/for component in[\s\S]*openVerifiedChildDirectory/);
  expect(runtime).toMatch(/private static func openChildDirectory\([\s\S]*try openVerifiedChildDirectory/);
  expect(runtime).toMatch(/Darwin\.mkdirat[\s\S]*openVerifiedChildDirectory/);
  expect(runtime).toContain('O_RDONLY | O_NOFOLLOW');

  const record = (overrides = {}) => ({
    kind: 'directory', symlink: false, dev: 7, ino: 11, ...overrides,
  });
  const run = ({ pathRecords = [record(), record()], opened = record(), ...options } = {}) => {
    const observations = [...pathRecords];
    let mkdirCalls = 0;
    const result = injectedOpenDirectoryComponent({
      createMissing: false,
      lstat: () => observations.shift() ?? ABSENT,
      open: () => 42,
      fstat: () => opened,
      mkdir: () => { mkdirCalls += 1; },
      ...options,
    });
    return { result, mkdirCalls };
  };

  expect(run().result).toBe(42);
  expect(run({
    pathRecords: [record({ apfsFirmlink: true }), record({ apfsFirmlink: true })],
    opened: record({ apfsFirmlink: true }),
  }).result).toBe(42);
  for (const candidate of [
    { pathRecords: [record({ symlink: true })] },
    { pathRecords: [record({ kind: 'file' })] },
    { pathRecords: [record(), record({ symlink: true })] },
    { opened: record({ kind: 'file' }) },
    { opened: record({ dev: 8 }) },
    { opened: record({ ino: 12 }) },
    { pathRecords: [record(), record({ dev: 8 })] },
    { pathRecords: [record(), record({ ino: 12 })] },
  ]) expect(() => run(candidate)).toThrow('unsafe_path');

  const closed = [];
  expect(() => run({
    opened: record({ ino: 12 }),
    close: (descriptor) => closed.push(descriptor),
  })).toThrow('unsafe_path');
  expect(closed).toEqual([42]);

  expect(run({ pathRecords: [ABSENT] }).result).toBeNull();
  const created = record({ ino: 99 });
  expect(run({
    createMissing: true,
    pathRecords: [ABSENT, created, created],
    opened: created,
  })).toEqual({ result: 42, mkdirCalls: 1 });
});

test('filesystem policy retains verified parents and env writers coordinate under an advisory lock', () => {
  for (const contract of [
    'O_DIRECTORY', 'O_NOFOLLOW', 'openat', 'renameat', 'unlinkat', 'fdopendir',
    'removeOwnedDirectory', 'verifyRegularFile', 'fsyncDirectory', 'removeOrphanTemporaryFiles',
  ]) expect(runtime).toContain(contract);
  expect(runtime).toContain('0o600');
  expect(runtime).toContain('environmentChanged');
  expect(runtime).toContain('Darwin.lockf');
  expect(runtime).toContain('F_LOCK');
  expect(runtime).toContain('F_ULOCK');
  expect(runtime).toContain('.index-network.env.lock');
  expect(runtime).toContain('Unmanaged external writers');
  expect(runtime).not.toContain('usingNewMetadataOnly');

  expect(injectedFilesystemPolicy({
    components: [{ kind: 'directory', symlink: false }],
    leaf: { kind: 'directory', symlink: false }, destructive: true,
  })).toBe('safe');
  for (const candidate of [
    { components: [{ kind: 'directory', symlink: true }], leaf: null },
    { components: [{ kind: 'file', symlink: false }], leaf: null },
    { components: [{ kind: 'directory', symlink: false }], leaf: { kind: 'directory', symlink: true } },
    { components: [{ kind: 'directory', symlink: false }], leaf: { kind: 'file', symlink: false } },
  ]) expect(() => injectedFilesystemPolicy({ ...candidate, destructive: true })).toThrow('unsafe_path');

  expect(isOwnedTemporary('..env.3D6F0A1E-82C2-4CB1-AE9D-65E99CFFB2C4.tmp')).toBe(true);
  expect(isOwnedTemporary('..env.not-a-uuid.tmp')).toBe(false);
  expect(isOwnedTemporary('.unrelated.3D6F0A1E-82C2-4CB1-AE9D-65E99CFFB2C4.tmp')).toBe(false);

  const originalParent = { name: 'checked-parent', entries: ['owned.tmp'] };
  let pathBinding = originalParent;
  const attackerParent = { name: 'attacker-parent', entries: ['unrelated'] };
  injectedRetainedParentMutation({
    openParent: () => pathBinding,
    swapPath: () => { pathBinding = attackerParent; },
    mutateRelative: (retained) => { retained.entries = []; },
  });
  expect(originalParent.entries).toEqual([]);
  expect(attackerParent.entries).toEqual(['unrelated']);

  let lockHeld = false;
  let managedWriterBlocked = false;
  const withLock = (body) => {
    if (lockHeld) { managedWriterBlocked = true; throw new Error('would-block'); }
    lockHeld = true;
    try { return body(); } finally { lockHeld = false; }
  };
  let version = 1;
  let unrelated = 'OTHER=one\n';
  let injectUnmanagedBeforeRecheck = true;
  const result = injectedLockedMutation({
    withLock,
    read: () => {
      expect(lockHeld).toBe(true);
      return { identity: version, contents: unrelated };
    },
    identity: () => {
      expect(lockHeld).toBe(true);
      return version;
    },
    beforeRecheck: () => {
      if (!injectUnmanagedBeforeRecheck) return;
      injectUnmanagedBeforeRecheck = false;
      try { withLock(() => {}); } catch { /* managed writer waits on the same lock */ }
      version += 1;
      unrelated = 'OTHER=unmanaged\n';
    },
    publish: (next) => {
      expect(lockHeld).toBe(true);
      unrelated = next;
      version += 1;
    },
    mutate: (contents) => `${contents}INDEX_API_KEY=new\n`,
  });
  expect(managedWriterBlocked).toBe(true);
  expect(result).toBe('OTHER=unmanaged\nINDEX_API_KEY=new\n');
});

test('gateway status requires a confirmed positive PID or explicit stopped signal', () => {
  expect(runtime).toContain('enum HermesGatewayState');
  expect(runtime).toContain('gatewayStatusFailed');
  expect(runtime).not.toContain('output.contains("PID")');
  expect(injectedGatewayState(0, 'PID: 1234')).toBe('running');
  expect(injectedGatewayState(0, 'pid = 1234;')).toBe('running');
  expect(injectedGatewayState(0, 'PID: 0')).toBe('failure');
  expect(injectedGatewayState(0, 'Last PID: 1234 stale')).toBe('failure');
  expect(injectedGatewayState(0, 'Status: stopped')).toBe('stopped');
  expect(injectedGatewayState(0, 'state = exited')).toBe('stopped');
  expect(injectedGatewayState(1, 'Status: stopped')).toBe('failure');
  expect(injectedGatewayState(1, 'PID: 1234')).toBe('failure');
});

test('disconnect verifies exact owned postconditions before clearing generation and journal', () => {
  expect(runtime).toContain('verifyDisconnectPostconditions');
  const disconnectBlock = runtime.match(/private func disconnect\([\s\S]*?private func reconcilePlugin/)?.[0] ?? '';
  expect(disconnectBlock.indexOf('verifyDisconnectPostconditions')).toBeGreaterThan(-1);
  expect(disconnectBlock.indexOf('verifyDisconnectPostconditions')).toBeLessThan(disconnectBlock.indexOf('currentSetupAttemptId = nil'));

  const state = {
    currentAttempt: 'current', journal: null, cronPresent: true, unrelatedCrons: ['backup'],
    pluginPresent: true, dashboardPresent: true,
    ownedEnvKeys: ['INDEX_API_KEY'], unrelatedEnv: ['OTHER=keep'],
  };
  const failed = injectedDisconnect({
    binary: '/hermes', state,
    operations: {
      removeCron: () => false,
      removePlugin: () => true,
      removePluginLocal: () => {}, removeDashboard: () => {}, removeEnv: () => {},
    },
  });
  expect(failed.ok).toBe(false);
  expect(state.currentAttempt).toBe('current');
  expect(state.journal).toBe('disconnecting');
});

test('disconnect terminal journal recovers deletion failure on retry and relaunch inspection', () => {
  expect(runtime).toContain('case disconnectCleanupComplete');
  expect(runtime).toContain('finishTerminalDisconnect');
  const disconnectBlock = runtime.match(/private func disconnect\([\s\S]*?private func reconcilePlugin/)?.[0] ?? '';
  expect(disconnectBlock.indexOf('disconnectCleanupComplete')).toBeGreaterThan(-1);
  expect(disconnectBlock.indexOf('disconnectCleanupComplete')).toBeLessThan(disconnectBlock.indexOf('currentSetupAttemptId = nil'));
  const inspectBlock = runtime.match(/private func inspect\([\s\S]*?private func configureDisabled/)?.[0] ?? '';
  expect(inspectBlock).toContain('finishTerminalDisconnect');

  const makeCleanState = () => ({
    currentAttempt: 'current', journal: null, cronPresent: false,
    pluginPresent: false, dashboardPresent: false, ownedEnvKeys: [],
  });
  for (const recovery of ['retry', 'relaunch']) {
    const state = makeCleanState();
    let removals = 0;
    const first = injectedDisconnect({
      binary: '/hermes', state,
      operations: {
        removeDashboard: () => {}, removeEnv: () => {},
        removeJournal: () => { removals += 1; return false; },
      },
    });
    expect(first).toEqual({ ok: false, errorCode: 'journal_write_failed' });
    expect(state.currentAttempt).toBeNull();
    expect(state.journal).toEqual({
      stage: 'disconnectCleanupComplete', setupAttemptId: 'current',
    });

    const recoveryArguments = {
      state,
      verifyPostconditions: () => true,
      removeJournal: () => { removals += 1; return true; },
    };
    const finished = recovery === 'retry'
      ? injectedRetryDisconnect({ ...recoveryArguments, suppliedAttemptId: 'current' })
      : injectedRelaunchInspect(recoveryArguments);
    expect(finished).toBe(recovery === 'retry' ? 'disconnected' : 'inspected');
    expect(state.journal).toBeNull();
    expect(removals).toBe(2);
  }
});

test('includes the runtime source in the Swift build', () => {
  expect(build).toContain('Sources/HermesRuntime.swift');
  expect(build).toContain('Sources/main.swift');
});

test('uses a Bash-3-safe optional Swift define expansion', () => {
  expect(build).toContain('swiftc -Onone ${SWIFT_DEFINES[@]+"${SWIFT_DEFINES[@]}"} \\');
  expect(build).not.toContain('swiftc -Onone "${SWIFT_DEFINES[@]}" \\');
});
