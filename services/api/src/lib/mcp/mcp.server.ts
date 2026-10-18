import { readFileSync } from 'node:fs';

import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';

import { authenticateApiKey, SessionOnlyGuard } from '../../guards/auth.guard';
import { userService } from '../../services/user.service';
import { log } from '../log';

import { registerMcpEvents } from './mcp.events';
import { mcpInstructions } from './mcp.instructions';
import { registerMcpTools } from './mcp.tools';
import type { McpPrincipal } from './mcp.types';

// `src/` and `dist/` sit at the same depth, and `package.json` is outside `rootDir`, so it cannot be imported.
const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };

const logger = log.lib.from('mcp/mcp.server');

/** Methods whose result carries the instructions, and the one that ends onboarding. */
const INSTRUCTION_METHODS = new Set(['initialize', 'server/discover']);
const TOOL_CALL = 'tools/call';

/**
 * An MCP OAuth access token is an opaque string, so a failed session check
 * still has to look it up. Expired rows are rejected so the client refreshes.
 */
async function authenticateMcpOAuthToken(request: Request): Promise<McpPrincipal | null> {
  try {
    const { auth } = await import('../betterauth/auth.instance');
    const session = await auth.api.getMcpSession({ headers: request.headers });
    if (!session?.userId) return null;
    const expiresAt = new Date(session.accessTokenExpiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return { userId: session.userId, authKind: 'session', credential: { kind: 'oauth', id: session.clientId } };
  } catch {
    // Do not attach the SDK error: authentication failures must never carry a raw token into logs or Sentry.
    throw new Error('Session verification failed');
  }
}

/** Authenticate `/mcp` with a Better Auth session, an MCP OAuth access token, or an API key. */
export async function authenticateMcpRequest(request: Request): Promise<McpPrincipal | null> {
  const authorization = request.headers.get('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    try {
      const user = await SessionOnlyGuard(request);
      return {
        userId: user.id,
        authKind: 'session',
        ...(user.sessionId && { credential: { kind: 'session', id: user.sessionId } }),
      };
    } catch (error) {
      if (error instanceof Error && (
        error.message === 'Access token required'
        || error.message === 'Invalid or expired access token'
      )) return authenticateMcpOAuthToken(request);
      // Do not attach the SDK error: authentication failures must never carry a raw token into logs or Sentry.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Session verification failed');
    }
  }

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) return null;

  try {
    const user = await authenticateApiKey(request, apiKey);
    return {
      userId: user.id,
      authKind: 'api_key',
      ...(user.apiKeyId && { credential: { kind: 'api_key', id: user.apiKeyId } }),
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid API key') return null;
    // Do not attach the SDK error: authentication failures must never carry a raw key into logs or Sentry.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('API key verification failed');
  }
}

/** JSON-RPC methods in one POST body, single or batched. Anything unreadable yields none. */
async function rpcMethods(request: Request): Promise<string[]> {
  if (request.method !== 'POST') return [];
  try {
    const body: unknown = await request.clone().json();
    return (Array.isArray(body) ? body : [body])
      .map((message) => (message && typeof message === 'object' ? (message as { method?: unknown }).method : undefined))
      .filter((method): method is string => typeof method === 'string');
  } catch {
    return [];
  }
}

/**
 * Where this request should carry onboarding: the handshake's instructions, or
 * the result of the owner's first tool call. Onboarding lasts until that call,
 * so a client that probes the server more than once still sees it, and later
 * sessions don't.
 */
async function firstConnection(request: Request, principal: McpPrincipal): Promise<'instructions' | 'result' | null> {
  const methods = await rpcMethods(request);
  const handshake = methods.some((method) => INSTRUCTION_METHODS.has(method));
  const toolCall = methods.includes(TOOL_CALL);
  if (!handshake && !toolCall) return null;
  try {
    if (await userService.isMcpOnboarded(principal.userId)) return null;
    if (!toolCall) return 'instructions';
    await userService.markMcpOnboarded(principal.userId);
    return 'result';
  } catch (error) {
    // Onboarding is a nicety: a failed read must never break the connection.
    logger.warn('MCP onboarding state unavailable', { userId: principal.userId, error: String(error) });
    return null;
  }
}

/** Build a fresh owner-scoped MCP server for one stateless HTTP request. */
function createIndexMcpServer(principal: McpPrincipal, onboarding: 'instructions' | 'result' | null): McpServer {
  const server = new McpServer({ name: 'index', version }, { instructions: mcpInstructions(onboarding === 'instructions') });
  registerMcpTools(server, onboarding === 'result' ? { ...principal, onboarding: true } : principal);
  registerMcpEvents(server, principal);
  return server;
}

/** Serve one stateless MCP request, in either protocol era, with no protocol session state. */
export async function handleMcpRequest(request: Request, principal: McpPrincipal): Promise<Response> {
  const onboarding = await firstConnection(request, principal);
  const handler = createMcpHandler(() => createIndexMcpServer(principal, onboarding));
  return handler.fetch(request);
}
