import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const apiBridge = readFileSync(new URL('../IndexApp/src/index-amiga/api.jsx', import.meta.url), 'utf8');
const securityWorkflow = readFileSync(
  new URL('../../../.github/workflows/hermes-runtime-security.yml', import.meta.url), 'utf8',
);
const agents = readFileSync(new URL('../IndexApp/src/index-amiga/agents.jsx', import.meta.url), 'utf8');
const assembly = readFileSync(new URL('../IndexApp/assemble.py', import.meta.url), 'utf8');

test('security workflow watches the full Mac/plugin/protocol/API authority closure and lockfile', () => {
  for (const path of [
    '"apps/mac/**"', '"packages/hermes-plugin/**"', '"packages/protocol/**"',
    '"services/api/**"', '"bun.lock"',
  ]) expect(securityWorkflow).toContain(path);
  expect(securityWorkflow).not.toContain('services/api/src/controllers/**');
  expect(securityWorkflow).not.toContain('services/api/src/services/agent-runtime.service.ts');
  expect(securityWorkflow).toContain('bun run architecture:check');
  for (const test of [
    'src/negotiation/tests/negotiation.hermes-contract.spec.ts',
    'src/negotiation/tests/negotiator-timeout.spec.ts',
    'src/lib/agent/tests/hermes-negotiation-run.spec.ts',
  ]) expect(securityWorkflow).toContain(test);
});

test('the app facade composes correlated Hermes and credential-free native API bridges', () => {
  expect(apiBridge).toContain('window.IndexApi.createHermesRuntimeBridge');
  expect(apiBridge).toContain('hermesRuntimeBridge.receive(result)');
  expect(apiBridge).toContain('window.IndexApi.createNativeAPIRequestBridge');
  expect(apiBridge).toContain('nativeRequest: nativeAPIBridge.request');
  expect(apiBridge).not.toContain('createPinnedIndexApiClient');
  expect(apiBridge).not.toContain('__indexHermesSetup');
  expect(apiBridge).not.toContain('setupHermes');
  expect(apiBridge).not.toContain('teardownHermes');
  expect(apiBridge).not.toContain('console.log');
});

test('native logout revocation is gated behind the serialized runtime safety barrier', () => {
  expect(apiBridge).toContain('setLogoutSafetyHandler');
  expect(apiBridge).toMatch(/\.then\(\(\) => logoutSafetyHandler\(\)\)[\s\S]*?\.then\(\(result\) => post\("completeLogout", \{ ownerId:result\.ownerId \}\)\)/);
  expect(apiBridge).not.toContain('post("logout")');
  expect(agents).toContain('coordinator.prepareLogout()');
  const native = readFileSync(new URL('../IndexApp/Sources/HermesRuntime.swift', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../IndexApp/Sources/main.swift', import.meta.url), 'utf8');
  expect(native).toContain('func logoutEvidence(ownerId: String)');
  expect(native).toContain('evidence.stage == "server-complete"');
  expect(native).toContain('try verifyLogoutPostconditions');
  expect(native).toContain('env["INDEX_API_KEY"] == nil');
  expect(shell.indexOf('hermesRuntime.logoutEvidence')).toBeLessThan(shell.indexOf('revokeAndDelete(record: record'));
  expect(shell).toContain('/index-app-owner-authorizations/revoke');
  expect(shell.indexOf('verifyCredentialDenied')).toBeLessThan(shell.indexOf('store.deleteAndVerify()'));
});

test('the selector is Index versus Hermes and renders mapper-owned states/actions', () => {
  expect(agents).toContain('mapAgentRuntimeState');
  expect(agents).toContain('createAgentRuntimeCoordinator');
  expect(agents).toContain('createNativeSagaJournal');
  expect(agents).toContain('setLogoutSafetyHandler');
  expect(agents).toContain('coordinator.prepareLogout()');
  expect(agents).toContain('window.IndexApp.getClient()');
  expect(agents).toContain('ownerId:user.id');
  expect(agents).not.toContain('ownerCredential');
  expect(agents).toContain('runViewRuntimeAction');
  expect(agents).toContain('crypto.randomUUID()');
  expect(agents).toContain('{ id:"index", label:"Index · system default" }');
  expect(agents).toContain('{ id:"hermes", label:"Hermes · on this Mac" }');
  expect(agents).not.toContain('Date.now()');
  expect(agents).not.toContain('last heartbeat');
  expect(agents).not.toContain('AGENT_PERMISSIONS');
  expect(agents).toContain('negotiations only');
  expect(agents).toContain('retry');
  expect(agents).toContain('disconnect');
});

test('stable Personal Agent identity, history, memory, and policy render byte-identically for every runtime state', () => {
  expect(agents.match(/<MyAgentAvatar size=\{54\}\/>/g)).toHaveLength(1);
  expect(agents.match(/{agent\.name}/g)).toHaveLength(1);
  expect(agents.match(/memory and history stay with this Personal Agent/g)).toHaveLength(1);
  expect(agents.match(/authority: negotiations only/g)).toHaveLength(1);
  expect(agents.match(/profile & memory/g)).toHaveLength(1);
  expect(agents.match(/negotiation history/g)).toHaveLength(1);
  expect(agents.match(/runtime changes never expand this authority/g)).toHaveLength(1);

  const profileStart = agents.indexOf('function NegotiatorProfile');
  const runtimeStatus = agents.indexOf('function RuntimeStatus');
  expect(profileStart).toBeGreaterThan(-1);
  expect(runtimeStatus).toBeGreaterThan(-1);
  const componentSource = agents.slice(profileStart, runtimeStatus);
  expect(componentSource).not.toContain('visualState ===');

  const transpiler = new Bun.Transpiler({
    loader: 'jsx',
    tsconfig: { compilerOptions: { jsx: 'react', jsxFactory: 'React.createElement' } },
  });
  const compiled = transpiler.transformSync(`${componentSource}\nreturn NegotiatorProfile;`);
  const Component = new Function('React', 'RuleLabel', 'MyAgentAvatar', compiled)(
    React,
    ({ children }) => React.createElement('h3', null, children),
    () => React.createElement('span', { 'data-avatar': 'personal-agent' }),
  );
  const states = ['index', 'connecting', 'active', 'unavailable', 'needs-attention'];
  const rendered = states.map((visualState) => renderToStaticMarkup(React.createElement(Component, {
    agent: { name: 'Stable Persona' },
    onShuffle: () => {}, onOpenMemory: () => {}, onOpenHistory: () => {},
    runtimeView: { visualState },
  })));
  expect(new Set(rendered).size).toBe(1);
  expect(rendered[0]).toContain('profile &amp; memory');
  expect(rendered[0]).toContain('negotiation history');
  expect(rendered[0]).toContain('runtime changes never expand this authority');
});

test('authenticated relaunch recovery is owned by the always-mounted epoch coordinator, not the Agents screen', () => {
  expect(agents).toContain('const AgentRuntimeContext = React.createContext(null)');
  expect(agents).toContain('function AgentRuntimeProvider');
  expect(agents).toContain('coordinator.changeOwner({');
  expect(agents).toContain('ownerId:user.id');
  expect(agents).toContain('ownerId:user.id, api');
  const agentsView = agents.slice(agents.indexOf('function Agents('));
  expect(agentsView).not.toContain('nativeRuntime("inspect")');
  expect(agentsView).not.toContain('reconcileHermesSaga({');
  expect(apiBridge).toContain('onAuthChanged');
  const app = readFileSync(new URL('../IndexApp/src/index-amiga/app.jsx', import.meta.url), 'utf8');
  expect(app).toContain('<AgentRuntimeProvider>');
});

test('runtime status renders an accessible polite atomic live region', () => {
  const start = agents.indexOf('function RuntimeStatus');
  const end = agents.indexOf('function NegotiatorSelect');
  const componentSource = agents.slice(start, end);
  const transpiler = new Bun.Transpiler({
    loader: 'jsx',
    tsconfig: { compilerOptions: { jsx: 'react', jsxFactory: 'React.createElement' } },
  });
  const compiled = transpiler.transformSync(`${componentSource}\nreturn RuntimeStatus;`);
  const Component = new Function('React', 'RUNTIME_STATE_LABELS', compiled)(React, {
    index: 'Index', connecting: 'Connecting', active: 'Active',
    unavailable: 'Unavailable', 'needs-attention': 'Needs attention',
  });
  const markup = renderToStaticMarkup(React.createElement(Component, {
    runtimeView: {
      visualState: 'connecting', statusLine: 'Changing runtime',
      canRetry: false, canDisconnect: false,
    },
    busy: true, onRetry: () => {}, onDisconnect: () => {},
  }));
  expect(markup).toContain('role="status"');
  expect(markup).toContain('aria-live="polite"');
  expect(markup).toContain('aria-atomic="true"');
  expect(markup).toContain('Changing runtime');
});

test('assembly exports both pure runtime modules into the generated boundary', () => {
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
