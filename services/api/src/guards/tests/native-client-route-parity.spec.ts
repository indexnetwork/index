/**
 * Route-matrix parity between the server audiences and the two Swift clients.
 *
 * Three independent allowlists decide whether a native request survives:
 *
 *   1. `NativeAPIRequestBridge.allowedHTTPRoutes` — the mac app's own bridge,
 *      which denies unlisted routes before they ever reach the network.
 *   2. `ConnectorRoutePolicy` — the same gate for the Hermes connector.
 *   3. `authorizeIndexAppOwner` / `authorizeHermesAgent` in ../auth.guard — the
 *      server side of the same two audiences.
 *
 * Nothing links them, so drift is silent in both directions: a route added to
 * the server works everywhere except the mac app (the UI shows a generic "failed
 * to load"), and a route left in a client is dead on arrival at the server.
 *
 * This spec pins the three together. Every route in any matrix must appear in
 * ROUTE_CORPUS, and for every corpus entry client and server must agree — unless
 * the pair is listed as a deliberate exception below, with a reason.
 *
 * Scope: method + path admission only. Query-name and request-body admission are
 * client-side narrowing with no server mirror to compare against; those are
 * covered by apps/mac/Tests/NativeAPIBodyValidationFixture.swift.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { HERMES_CANONICAL_ACTIONS } from '../../lib/agent/hermes-capabilities';
import { HERMES_AGENT_DYNAMIC_ROUTES, HERMES_AGENT_STATIC_ROUTES, INDEX_APP_OWNER_DYNAMIC_ROUTES, INDEX_APP_OWNER_STATIC_ROUTES, authorizeHermesAgent, authorizeIndexAppOwner, hermesNegotiationRoute } from '../auth.guard';

const REPO_ROOT = resolve(import.meta.dir, '../../../../..');
const BRIDGE_SOURCE = 'apps/mac/Sources/NativeAPIRequestBridge.swift';
const CONNECTOR_SOURCE = 'apps/mac/IndexConnector/Sources/ConnectorHTTPClient.swift';

/** Stand-in path segments. Free of regex metacharacters so they match as literals. */
const AGENT_ID = 'agent-1';

type Route = readonly [method: string, path: string];

// ---------------------------------------------------------------- swift parsing

function swiftSource(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

/** Body of the bracketed literal that follows `declaration`, brackets balanced. */
function arrayLiteral(source: string, declaration: string): string {
  const declarationIndex = source.indexOf(declaration);
  if (declarationIndex < 0) throw new Error(`declaration not found, update the parser: ${declaration}`);
  const open = source.indexOf('[', declarationIndex + declaration.length);
  if (open < 0) throw new Error(`literal not found, update the parser: ${declaration}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '[') depth += 1;
    else if (source[index] === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated literal, update the parser: ${declaration}`);
}

/** Swift interpolations used inside route patterns, resolved to their runtime value. */
function resolveSwiftPattern(pattern: string): string {
  const resolved = pattern
    .replaceAll('\\(segment)', '[^/]+')
    .replaceAll('\\(escapedAgent)', AGENT_ID);
  if (resolved.includes('\\(')) throw new Error(`unresolved Swift interpolation, update the parser: ${pattern}`);
  return resolved;
}

/** `("GET", #"^/auth/me$"#)` / `("GET", "^/users/\(segment)$")` tuple lists. */
function parseRouteTuples(literal: string): Route[] {
  const tuples = [...literal.matchAll(/\(\s*"([A-Z]+)"\s*,\s*(?:#"(.*?)"#|"(.*?)")\s*\)/g)];
  if (tuples.length === 0) throw new Error('no route tuples parsed, update the parser');
  return tuples.map((match) => [match[1], resolveSwiftPattern(match[2] ?? match[3])] as const);
}

/** `["GET /auth/me", ...]` string sets. */
function parseStringSet(literal: string): string[] {
  const values = [...literal.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  if (values.length === 0) throw new Error('no strings parsed, update the parser');
  return values;
}

const bridge = swiftSource(BRIDGE_SOURCE);
const connector = swiftSource(CONNECTOR_SOURCE);

const BRIDGE_HTTP_ROUTES = parseRouteTuples(
  arrayLiteral(bridge, 'static let allowedHTTPRoutes: [(String, String)] = '),
);
const BRIDGE_SSE_ROUTES = parseStringSet(arrayLiteral(bridge, 'static let allowedSSERoutes: Set<String> = '));
const BRIDGE_UPLOAD_PATHS = parseStringSet(arrayLiteral(bridge, 'static let allowedUploadRoutes: Set<String> = '));

const CONNECTOR_STATIC_ROUTES = parseStringSet(
  arrayLiteral(connector, 'private static let staticRoutes: Set<String> = '),
);
const CONNECTOR_DYNAMIC_ROUTES = parseRouteTuples(arrayLiteral(connector, 'let dynamic: [(String, String)] = '));
const CONNECTOR_NEGOTIATION_PATTERN = (() => {
  const match = connector.match(/let negotiation = "([^"]+)"/);
  if (!match) throw new Error('connector negotiation route not found, update the parser');
  return resolveSwiftPattern(match[1]);
})();

// ------------------------------------------------------------------- decisions

/** Swift matches with `range(of:options:.regularExpression)`; every pattern is anchored. */
function matchesAny(routes: readonly Route[], method: string, path: string): boolean {
  return routes.some(([routeMethod, pattern]) => routeMethod === method && new RegExp(pattern).test(path));
}

/** What the mac app's bridge admits, across its http, sse, and upload operation kinds. */
function bridgeAdmits(method: string, path: string): boolean {
  return matchesAny(BRIDGE_HTTP_ROUTES, method, path)
    || BRIDGE_SSE_ROUTES.includes(`${method} ${path}`)
    || (method === 'POST' && BRIDGE_UPLOAD_PATHS.includes(path));
}

function connectorAdmits(method: string, path: string): boolean {
  return CONNECTOR_STATIC_ROUTES.includes(`${method} ${path}`)
    || matchesAny(CONNECTOR_DYNAMIC_ROUTES, method, path)
    || (method === 'POST' && new RegExp(CONNECTOR_NEGOTIATION_PATTERN).test(path));
}

function serverAdmitsOwner(method: string, path: string): boolean {
  return authorizeIndexAppOwner({ method, path }).allowed;
}

function serverAdmitsHermes(method: string, path: string): boolean {
  return authorizeHermesAgent({ method, path, agentId: AGENT_ID, actions: HERMES_CANONICAL_ACTIONS }).allowed;
}

// ---------------------------------------------------------------------- corpus

/**
 * One concrete sample per route in any of the matrices. The coverage tests below
 * fail if a matrix grows a route this list does not exercise, so a new route
 * cannot be added to one side and quietly forgotten on the others.
 */
const ROUTE_CORPUS: readonly Route[] = [
  ['GET', '/auth/me'],
  ['PATCH', '/auth/profile/update'],
  ['GET', '/agent-runtime'],
  ['PUT', '/agent-runtime'],
  ['POST', '/agent-runtime/hermes/prepare'],
  ['POST', '/agent-runtime/reconcile-index'],
  ['POST', '/agent-runtime/rollback'],
  ['DELETE', '/agent-runtime/hermes/installation-1'],
  ['GET', '/agents'],
  ['GET', '/agents/me'],
  ['POST', `/agents/${AGENT_ID}/negotiations/pickup`],
  ['POST', `/agents/${AGENT_ID}/negotiations/task-1/respond`],
  ['POST', `/agents/${AGENT_ID}/negotiations/task-1/consult`],
  ['POST', '/hermes-authorizations/disconnect'],
  ['POST', '/mcp'],
  ['GET', '/networks'],
  ['POST', '/networks'],
  ['GET', '/networks/discovery/public'],
  ['GET', '/networks/network-1/overview'],
  ['GET', '/networks/network-1/my-intents'],
  ['POST', '/networks/network-1/join'],
  ['POST', '/networks/network-1/leave'],
  ['GET', '/network-requests'],
  ['POST', '/network-requests'],
  ['PATCH', '/network-requests/request-1'],
  ['DELETE', '/network-requests/request-1'],
  ['POST', '/intents/list'],
  ['POST', '/intents/confirm'],
  ['POST', '/intents/reject'],
  ['POST', '/intents/intake/start'],
  ['POST', '/intents/intake/question'],
  ['POST', '/intents/intake/prepare'],
  ['POST', '/intents/intake/proposal'],
  ['POST', '/intents/intake/revise'],
  ['GET', '/intents/intent-1'],
  ['PATCH', '/intents/intent-1/archive'],
  ['PATCH', '/intents/intent-1/status'],
  ['GET', '/opportunities'],
  ['GET', '/opportunities/radar'],
  ['GET', '/opportunities/chat-context'],
  ['GET', '/opportunities/opportunity-1'],
  ['GET', '/opportunities/opportunity-1/invite-message'],
  ['PATCH', '/opportunities/opportunity-1/status'],
  ['POST', '/opportunities/opportunity-1/start-chat'],
  ['GET', '/questions'],
  ['POST', '/questions/question-1/answer'],
  ['POST', '/questions/question-1/dismiss'],
  ['GET', '/users/batch'],
  ['GET', '/users/user-1'],
  ['GET', '/users/user-1/negotiations'],
  ['POST', '/tools/read_user_contexts'],
  ['POST', '/tools/preview_user_context'],
  ['POST', '/tools/confirm_user_context'],
  ['POST', '/enrichment/enrich'],
  ['POST', '/enrichment/sync'],
  ['GET', '/conversations'],
  ['GET', '/conversations/negotiations'],
  ['GET', '/conversations/stream'],
  ['POST', '/conversations/dm'],
  ['GET', '/conversations/conversation-1/messages'],
  ['POST', '/conversations/conversation-1/messages'],
  ['PATCH', '/conversations/conversation-1/metadata'],
  ['DELETE', '/conversations/conversation-1'],
  ['GET', '/notifications/stream'],
  ['GET', '/notifications/snapshot'],
  ['POST', '/chat/stream'],
  ['POST', '/storage/avatars'],
  ['POST', '/storage/index-images'],
];

/**
 * Drift has a direction, and only one direction is ever acceptable.
 *
 * A route the client admits but the server rejects is always a bug — the request
 * is built, sent, and refused — so that direction takes no exceptions.
 *
 * A route the server admits but the client does not is only a bug when the client
 * needs it (the Discover tab's `GET /networks/discovery/public` was exactly this).
 * Where the client genuinely has no caller, the narrower matrix is the correct
 * least-privilege posture — these bridges gate a WebView, so unused breadth is
 * attack surface. Those routes are listed here with the reason they stay out.
 */
const OWNER_ROUTES_UNUSED_BY_APP: ReadonlyMap<string, string> = new Map([
  ['DELETE /agent-runtime/hermes/installation-1',
    'connector teardown is server-driven; no app or client wrapper issues this delete'],
]);

const HERMES_ROUTES_UNUSED_BY_CONNECTOR: ReadonlyMap<string, string> = new Map([
  ['POST /mcp', 'the connector speaks MCP over its own transport, not the REST route policy'],
  ['POST /hermes-authorizations/disconnect', 'disconnect is issued by the app, not the connector'],
]);

function key([method, path]: Route): string {
  return `${method} ${path}`;
}

// ----------------------------------------------------------------------- tests

describe('native client route parity', () => {
  it('parses every route matrix out of the Swift sources', () => {
    expect(BRIDGE_HTTP_ROUTES.length).toBeGreaterThan(20);
    expect(BRIDGE_SSE_ROUTES.length).toBeGreaterThan(0);
    expect(BRIDGE_UPLOAD_PATHS.length).toBeGreaterThan(0);
    expect(CONNECTOR_STATIC_ROUTES.length).toBeGreaterThan(10);
    expect(CONNECTOR_DYNAMIC_ROUTES.length).toBeGreaterThan(0);
    expect(CONNECTOR_NEGOTIATION_PATTERN).toContain('/negotiations/');
  });

  it('never lets the mac app bridge admit a route the server rejects', () => {
    const dead = ROUTE_CORPUS
      .filter(([method, path]) => bridgeAdmits(method, path) && !serverAdmitsOwner(method, path))
      .map(key);
    expect(dead).toEqual([]);
  });

  it('lets the mac app bridge reach every owner route it is meant to use', () => {
    const unreachable = ROUTE_CORPUS
      .filter((route) => !OWNER_ROUTES_UNUSED_BY_APP.has(key(route)))
      .filter(([method, path]) => serverAdmitsOwner(method, path) && !bridgeAdmits(method, path))
      .map(key);
    expect(unreachable).toEqual([]);
  });

  it('never lets the connector admit a route the server rejects', () => {
    const dead = ROUTE_CORPUS
      .filter(([method, path]) => connectorAdmits(method, path) && !serverAdmitsHermes(method, path))
      .map(key);
    expect(dead).toEqual([]);
  });

  it('lets the connector reach every agent route it is meant to use', () => {
    const unreachable = ROUTE_CORPUS
      .filter((route) => !HERMES_ROUTES_UNUSED_BY_CONNECTOR.has(key(route)))
      .filter(([method, path]) => serverAdmitsHermes(method, path) && !connectorAdmits(method, path))
      .map(key);
    expect(unreachable).toEqual([]);
  });

  it('keeps every recorded exception real', () => {
    const stale = [...OWNER_ROUTES_UNUSED_BY_APP.keys()]
      .filter((entry) => {
        const [method, path] = entry.split(' ') as [string, string];
        return !serverAdmitsOwner(method, path) || bridgeAdmits(method, path);
      })
      .concat([...HERMES_ROUTES_UNUSED_BY_CONNECTOR.keys()].filter((entry) => {
        const [method, path] = entry.split(' ') as [string, string];
        return !serverAdmitsHermes(method, path) || connectorAdmits(method, path);
      }));
    expect(stale).toEqual([]);
    for (const entry of [...OWNER_ROUTES_UNUSED_BY_APP, ...HERMES_ROUTES_UNUSED_BY_CONNECTOR]) {
      expect(ROUTE_CORPUS.map(key), entry[0]).toContain(entry[0]);
    }
  });

  it('exercises every server route with a corpus sample', () => {
    const corpusKeys = new Set(ROUTE_CORPUS.map(key));
    const uncovered = [
      ...[...INDEX_APP_OWNER_STATIC_ROUTES, ...HERMES_AGENT_STATIC_ROUTES].filter((route) => !corpusKeys.has(route)),
      ...[...INDEX_APP_OWNER_DYNAMIC_ROUTES, ...HERMES_AGENT_DYNAMIC_ROUTES]
        .filter(([method, pattern]) => !ROUTE_CORPUS.some(([m, p]) => m === method && pattern.test(p)))
        .map(([method, pattern]) => `${method} ${pattern.source}`),
    ];
    expect(uncovered).toEqual([]);
  });

  it('exercises every client route with a corpus sample', () => {
    const corpusKeys = new Set(ROUTE_CORPUS.map(key));
    const uncovered = [
      ...[...BRIDGE_SSE_ROUTES, ...CONNECTOR_STATIC_ROUTES].filter((route) => !corpusKeys.has(route)),
      ...BRIDGE_UPLOAD_PATHS.filter((path) => !corpusKeys.has(`POST ${path}`)).map((path) => `POST ${path}`),
      ...[...BRIDGE_HTTP_ROUTES, ...CONNECTOR_DYNAMIC_ROUTES]
        .filter(([method, pattern]) => !ROUTE_CORPUS.some(([m, p]) => m === method && new RegExp(pattern).test(p)))
        .map(([method, pattern]) => `${method} ${pattern}`),
    ];
    expect(uncovered).toEqual([]);
  });

  it('reaches the agent-scoped negotiation routes from both sides', () => {
    const negotiation: Route[] = [
      ['POST', `/agents/${AGENT_ID}/negotiations/pickup`],
      ['POST', `/agents/${AGENT_ID}/negotiations/task-1/respond`],
      ['POST', `/agents/${AGENT_ID}/negotiations/task-1/consult`],
    ];
    for (const [method, path] of negotiation) {
      expect(connectorAdmits(method, path), path).toBe(true);
      expect(serverAdmitsHermes(method, path), path).toBe(true);
      expect(hermesNegotiationRoute(AGENT_ID).test(path), path).toBe(true);
    }
    expect(connectorAdmits('POST', '/agents/other-agent/negotiations/pickup')).toBe(false);
    expect(serverAdmitsHermes('POST', '/agents/other-agent/negotiations/pickup')).toBe(false);
  });
});
