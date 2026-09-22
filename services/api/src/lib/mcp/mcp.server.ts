import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';

import { authenticateApiKey, SessionOnlyGuard } from '../../guards/auth.guard';

import { registerMcpTools } from './mcp.tools';
import type { McpPrincipal } from './mcp.types';

/** Authenticate `/mcp` with a Better Auth session or API key. */
export async function authenticateMcpRequest(request: Request): Promise<McpPrincipal | null> {
  const authorization = request.headers.get('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    try {
      const user = await SessionOnlyGuard(request);
      return { userId: user.id, authKind: 'session' };
    } catch (error) {
      if (error instanceof Error && (
        error.message === 'Access token required'
        || error.message === 'Invalid or expired access token'
      )) return null;
      // Do not attach the SDK error: authentication failures must never carry a raw token into logs or Sentry.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Session verification failed');
    }
  }

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) return null;

  try {
    const user = await authenticateApiKey(request, apiKey);
    return { userId: user.id, authKind: 'api_key' };
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid API key') return null;
    // Do not attach the SDK error: authentication failures must never carry a raw key into logs or Sentry.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('API key verification failed');
  }
}

/** Build a fresh owner-scoped MCP server for one stateless HTTP request. */
function createIndexMcpServer(principal: McpPrincipal): McpServer {
  const server = new McpServer({ name: 'index', version: '0.135.1' });
  registerMcpTools(server, principal);
  return server;
}

/** Serve one modern, stateless MCP request with no protocol session state. */
export async function handleMcpRequest(request: Request, principal: McpPrincipal): Promise<Response> {
  const handler = createMcpHandler(
    () => createIndexMcpServer(principal),
    { legacy: 'reject' },
  );
  return handler.fetch(request);
}
