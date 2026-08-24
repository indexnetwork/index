import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const apiBridge = readFileSync(new URL('../src/ui/bridge.jsx', import.meta.url), 'utf8');
const securityWorkflow = readFileSync(
  new URL('../../../.github/workflows/hermes-runtime-security.yml', import.meta.url), 'utf8',
);
const agents = readFileSync(new URL('../src/ui/agents.jsx', import.meta.url), 'utf8');
const assembly = readFileSync(new URL('../scripts/assemble.py', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/ui/app.jsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../Sources/AppDelegate.swift', import.meta.url), 'utf8');
const hermesSetup = readFileSync(new URL('../Sources/HermesSetup.swift', import.meta.url), 'utf8');
const client = readFileSync(new URL('./client.mjs', import.meta.url), 'utf8');

test('security workflow watches the full Mac/plugin/protocol/API authority closure and lockfile', () => {
  for (const path of [
    '"apps/mac/**"', '"packages/hermes-plugin/**"', '"packages/protocol/**"',
    '"services/api/**"', '"bun.lock"',
  ]) expect(securityWorkflow).toContain(path);
  expect(securityWorkflow).not.toContain('services/api/src/controllers/**');
  expect(securityWorkflow).not.toContain('services/api/src/services/agent-runtime.service.ts');
  expect(securityWorkflow).toContain('bun run architecture:check');
  for (const test of [
    './src/internal/mcp/tests/mcp.authorization-policy.spec.ts',
    './src/internal/mcp/tests/mcp.server.spec.ts',
    './src/capabilities/tests/negotiations.e2e.spec.ts',
  ]) expect(securityWorkflow).toContain(test);
});

test('the app facade restores simple Hermes setup/teardown beside the native API bridge', () => {
  expect(apiBridge).toContain('window.IndexApi.createHermesRuntimeBridge');
  expect(apiBridge).toContain('window.IndexApi.createNativeAPIRequestBridge');
  expect(apiBridge).toContain('nativeRequest: nativeAPIBridge.request');
  expect(apiBridge).toContain('__indexHermesSetup');
  expect(apiBridge).toContain('function setupHermes');
  expect(apiBridge).toContain('function teardownHermes');
  expect(apiBridge).toContain('setupHermes,');
  expect(apiBridge).toContain('teardownHermes,');
  expect(apiBridge).toContain('registerAgent');
  expect(apiBridge).not.toContain('createPinnedIndexApiClient');
  expect(apiBridge).not.toContain('setLogoutSafetyHandler');
  expect(apiBridge).not.toContain('console.log');
});

test('native logout completes without requiring a Hermes saga journal', () => {
  expect(apiBridge).toContain('post("completeLogout"');
  expect(apiBridge).toContain('api.auth.me()');
  expect(apiBridge).not.toContain('post("logout")');
  expect(shell).toContain('hermesRuntime.logoutEvidence');
  expect(shell).toContain('/auth/cli-credential/revoke');
  expect(shell.indexOf('verifyCredentialDenied')).toBeLessThan(shell.indexOf('store.deleteAndVerify()'));
  expect(shell).toContain('setupHermes(apiKey:');
  expect(shell).toContain('teardownHermes(admittedGeneration:');
  expect(hermesSetup).toContain('enum HermesSetup');
  expect(hermesSetup).toContain('INDEX_API_KEY');
  expect(hermesSetup).toContain('indexnetwork/hermes-plugin');
});

test('agents inventory lists runtimes, permissions, and a negotiator picker', () => {
  expect(agents).toContain('title="agents"');
  expect(agents).toContain('check again');
  expect(agents).toContain('runtimes');
  expect(agents).toContain('negotiator agent');
  expect(agents).toContain('AGENT_PERMISSIONS');
  expect(agents).toContain('last heartbeat');
  expect(agents).toContain('setupHermes');
  expect(agents).toContain('teardownHermes');
  expect(agents).toContain('registerAgent');
  expect(agents).toContain('{ id:"index", label:"Index · system default" }');
  expect(agents).toContain('handleNegotiations');
  expect(agents).toContain('client.agents.update');
  expect(agents).toContain('myAgent()');
  expect(agents).not.toContain('mapAgentRuntimeState');
  expect(agents).not.toContain('AgentRuntimeProvider');
  expect(agents).not.toContain('createAgentRuntimeCoordinator');
  expect(app).not.toContain('AgentRuntimeProvider');
});

test('owner API client can PATCH agents.handleNegotiations', () => {
  expect(client).toContain('update: (agentId, body, options = {}) => request(');
  expect(client).toContain('method: \'PATCH\'');
});

test('native bridge allowlists Hermes activate paths', () => {
  const nativeBridge = readFileSync(new URL('../Sources/NativeAPIRequestBridge.swift', import.meta.url), 'utf8');
  expect(nativeBridge).toContain('"register_agent"');
  expect(nativeBridge).toContain('^/agents/[^/?]+/tokens$');
  expect(nativeBridge).toContain('^/agents/[^/?]+$');
  expect(nativeBridge).toContain('handleNegotiations');
  expect(apiBridge).toContain('mcpCall("register_agent"');
  expect(agents).toContain('agents.createToken');
});

test('assembly still exports leftover runtime modules (deletion is follow-up)', () => {
  expect(assembly).toContain('"agent-runtime.mjs"');
  expect(assembly).toContain('"agent-runtime-saga.mjs"');
  for (const symbol of [
    'mapAgentRuntimeState', 'waitForHermesHealth', 'runHermesSelectionSaga',
    'bootstrapHermesRuntime', 'reconcileHermesSaga', 'selectIndexRuntime', 'disconnectHermesSaga',
    'createHermesRuntimeBridge', 'createNativeSagaJournal', 'createAgentRuntimeCoordinator',
    'prepareHermesLogout', 'renderAgentMarkdown',
    'runViewRuntimeAction',
  ]) expect(assembly).toContain(`"${symbol}"`);
});
