/**
 * Joining a network through its MCP server, and reading the member's own
 * profile from it. Plain OAuth 2.1 (PKCE, dynamic client registration) and
 * MCP over streamable HTTP, so it needs no client SDK.
 *
 * Tokens live in `accounts` (`providerId: mcp:<networkId>`). The registered
 * client and each login's PKCE state live in `verifications`.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { and, db, eq, schema } from '../../adapters/database.shared';
import { ChatDatabaseAdapter } from '../../adapters/chat.database.adapter';
import { API_URL } from '../betterauth/betterauth';
import { log } from '../log';

const logger = log.service.from('NetworkMcp');

const REDIRECT_URI = `${API_URL}/api/networks/mcp/callback`;
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const PROFILE_LIMIT = 1500;
const TIMEOUT_MS = 10_000;

type Mcp = schema.NetworkMcp;
interface Client { clientId: string; clientSecret?: string; tokenEndpoint: string }
interface Tokens { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }

const providerId = (networkId: string) => `mcp:${networkId}`;

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
  return res?.ok ? await res.json() as T : null;
}

async function postForm(url: string, body: Record<string, string | undefined>): Promise<Tokens> {
  const form = new URLSearchParams(Object.entries(body).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Token request failed (${res.status})`);
  return await res.json() as Tokens;
}

async function keep(identifier: string, value: unknown, ttlMs: number): Promise<void> {
  await db.insert(schema.verifications).values({
    id: randomUUID(), identifier, value: JSON.stringify(value), expiresAt: new Date(Date.now() + ttlMs), createdAt: new Date(), updatedAt: new Date(),
  });
}

async function recall<T>(identifier: string): Promise<T | null> {
  const [row] = await db.select().from(schema.verifications).where(eq(schema.verifications.identifier, identifier)).limit(1);
  return row && row.expiresAt > new Date() ? JSON.parse(row.value) as T : null;
}

async function forget(identifier: string): Promise<void> {
  await db.delete(schema.verifications).where(eq(schema.verifications.identifier, identifier));
}

/** The OAuth client this network's server knows Index as: configured, or registered once and kept. */
async function clientFor(networkId: string, mcp: Mcp): Promise<Client & { authorizationEndpoint: string }> {
  const { origin, pathname } = new URL(mcp.url);
  const resource = await getJson<{ authorization_servers?: string[] }>(`${origin}/.well-known/oauth-protected-resource${pathname}`)
    ?? await getJson<{ authorization_servers?: string[] }>(`${origin}/.well-known/oauth-protected-resource`);
  const issuer = (resource?.authorization_servers?.[0] ?? origin).replace(/\/$/, '');
  const meta = await getJson<{ authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string }>(`${issuer}/.well-known/oauth-authorization-server`)
    ?? await getJson<{ authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string }>(`${issuer}/.well-known/openid-configuration`);
  if (!meta) throw new Error('This network\'s MCP server does not describe its login.');

  const base = { authorizationEndpoint: meta.authorization_endpoint, tokenEndpoint: meta.token_endpoint };
  if (mcp.clientId) return { ...base, clientId: mcp.clientId, clientSecret: mcp.clientSecret };

  const kept = await recall<Client>(`mcp-client:${networkId}`);
  if (kept) return { ...base, ...kept };
  if (!meta.registration_endpoint) throw new Error('This network\'s MCP server needs a configured client id.');
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Index Network', redirect_uris: [REDIRECT_URI], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Client registration failed (${res.status})`);
  const registered = await res.json() as { client_id: string; client_secret?: string };
  const client = { clientId: registered.client_id, clientSecret: registered.client_secret, tokenEndpoint: meta.token_endpoint };
  await keep(`mcp-client:${networkId}`, client, 10 * 365 * 24 * 60 * 60 * 1000);
  return { ...base, ...client };
}

/**
 * @param networkId - The MCP network being joined.
 * @param userId - Who is joining.
 * @param mcp - The network's MCP server.
 * @returns The server's login URL, which returns to `/networks/mcp/callback`.
 */
export async function authorizeUrl(networkId: string, userId: string, mcp: Mcp): Promise<string> {
  const client = await clientFor(networkId, mcp);
  const state = randomUUID();
  const verifier = randomBytes(32).toString('base64url');
  await keep(`mcp-state:${state}`, { userId, networkId, verifier, resource: mcp.url }, 10 * 60 * 1000);
  const url = new URL(client.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: client.clientId, redirect_uri: REDIRECT_URI, state, resource: mcp.url,
    ...(mcp.scope ? { scope: mcp.scope } : {}),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

async function saveTokens(networkId: string, userId: string, tokens: Tokens, previousRefresh?: string | null): Promise<void> {
  const values = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previousRefresh ?? null,
    accessTokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    scope: tokens.scope ?? null,
    updatedAt: new Date(),
  };
  const where = and(eq(schema.accounts.providerId, providerId(networkId)), eq(schema.accounts.userId, userId));
  const updated = await db.update(schema.accounts).set(values).where(where).returning({ id: schema.accounts.id });
  if (!updated.length) await db.insert(schema.accounts).values({ id: randomUUID(), accountId: userId, providerId: providerId(networkId), userId, ...values });
}

/**
 * Complete a login the callback received.
 *
 * @param state - The `state` the server echoed back.
 * @param code - The authorization code.
 * @returns Who logged in to which network.
 * @throws When the state is unknown or expired, or the server refuses the code.
 */
export async function finishAuth(state: string, code: string): Promise<{ userId: string; networkId: string }> {
  const identifier = `mcp-state:${state}`;
  const saved = await recall<{ userId: string; networkId: string; verifier: string; resource: string }>(identifier);
  await forget(identifier);
  const mcp = saved && await new ChatDatabaseAdapter().getNetworkMcp(saved.networkId);
  if (!saved || !mcp) throw new Error('This login has expired. Try joining again.');
  const { tokenEndpoint, clientId, clientSecret } = await clientFor(saved.networkId, mcp);

  const tokens = await postForm(tokenEndpoint, {
    grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, client_secret: clientSecret,
    code_verifier: saved.verifier, resource: saved.resource,
  });
  await saveTokens(saved.networkId, saved.userId, tokens);
  return { userId: saved.userId, networkId: saved.networkId };
}

/** Forget a member's login, so leaving a network leaves nothing of theirs behind. */
export async function dropTokens(networkId: string, userId: string): Promise<void> {
  await db.delete(schema.accounts).where(and(eq(schema.accounts.providerId, providerId(networkId)), eq(schema.accounts.userId, userId)));
}

async function accessToken(networkId: string, userId: string, mcp: Mcp): Promise<string | null> {
  const [account] = await db.select().from(schema.accounts)
    .where(and(eq(schema.accounts.providerId, providerId(networkId)), eq(schema.accounts.userId, userId))).limit(1);
  if (!account?.accessToken) return null;
  if (!account.accessTokenExpiresAt || account.accessTokenExpiresAt.getTime() > Date.now() + 30_000) return account.accessToken;
  if (!account.refreshToken) return null;

  const { tokenEndpoint, clientId, clientSecret } = await clientFor(networkId, mcp);
  const tokens = await postForm(tokenEndpoint, {
    grant_type: 'refresh_token', refresh_token: account.refreshToken, client_id: clientId, client_secret: clientSecret, resource: mcp.url,
  });
  await saveTokens(networkId, userId, tokens, account.refreshToken);
  return tokens.access_token;
}

/** One JSON-RPC message to an MCP server; the reply may arrive as plain JSON or as one SSE event. */
async function rpc(url: string, token: string, session: string | undefined, message: { id?: number; method: string; params?: unknown }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...message }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`MCP server answered ${res.status}`);
  const body = await res.text();
  const reply = body.trimStart().startsWith('{')
    ? JSON.parse(body)
    : body.split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5))).find((m) => m.id === message.id);
  if (reply?.error) throw new Error(reply.error.message ?? 'MCP error');
  return { session: res.headers.get('mcp-session-id') ?? session, result: reply?.result as { isError?: boolean; content?: { type: string; text?: string }[] } | undefined };
}

/** A profile with an unpublished draft is read as its published side only, and compact: the member has not approved the draft. */
function published(text: string): string {
  try {
    const { draft: _draft, hasUnpublishedDraft: _flag, ...profile } = JSON.parse(text) as Record<string, unknown>;
    return JSON.stringify(profile);
  } catch {
    return text;
  }
}

async function readProfile(mcp: Mcp, token: string): Promise<string | null> {
  const { url } = mcp;
  const init = await rpc(url, token, undefined, {
    id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'index-network', version: '1' } },
  });
  await rpc(url, token, init.session, { method: 'notifications/initialized' });
  const { result } = await rpc(url, token, init.session, { id: 2, method: 'tools/call', params: { name: mcp.profileTool, arguments: mcp.profileArgs ?? {} } });
  // A tool that refuses its arguments answers with an error as text, which is not a profile.
  if (result?.isError) throw new Error((result.content?.[0]?.text ?? 'Tool failed').slice(0, 200));
  const text = (result?.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n').trim();
  return text ? published(text).slice(0, PROFILE_LIMIT) : null;
}

/**
 * A member's own profile on a network's MCP server, read at most once a day.
 *
 * @param network - The MCP network and the profile last read for it.
 * @param userId - The member.
 * @returns The profile text, the last one read when the server cannot be reached, or null.
 */
export async function memberProfile(
  network: { networkId: string; mcp: Mcp; cached?: { text: string; fetchedAt: string } },
  userId: string,
): Promise<string | null> {
  const { networkId, mcp, cached } = network;
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < PROFILE_TTL_MS) return cached.text;
  try {
    const token = await accessToken(networkId, userId, mcp);
    const text = token && await readProfile(mcp, token);
    if (!text) {
      logger.verbose('No network profile', { networkId, userId, signedIn: Boolean(token) });
      return cached?.text ?? null;
    }
    await new ChatDatabaseAdapter().setMemberMcpProfile(networkId, userId, text);
    return text;
  } catch (error) {
    logger.warn('Network profile read failed', { networkId, userId, error: error instanceof Error ? error.message : String(error) });
    return cached?.text ?? null;
  }
}
