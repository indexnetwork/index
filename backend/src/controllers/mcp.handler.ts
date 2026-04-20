/**
 * MCP HTTP Handler — wires the MCP server factory to the Streamable HTTP transport.
 * Uses createDefaultProtocolDeps() from the composition root for adapter wiring.
 */

import { jwtVerify, createRemoteJWKSet } from 'jose';
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';

import { createDefaultProtocolDeps } from '../protocol-init';

import { IntentGraphFactory, ProfileGraphFactory, OpportunityGraphFactory, HydeGraphFactory, NetworkGraphFactory, NetworkMembershipGraphFactory, IntentNetworkGraphFactory, NegotiationGraphFactory, HydeGenerator, LensInferrer, IntentIndexer, createMcpServer } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, ToolDeps, McpAuthResolver, ScopedDepsFactory } from '@indexnetwork/protocol';

 
 
 
 
import { BASE_URL } from '../lib/betterauth/betterauth';
import { log } from '../lib/log';

const logger = log.server.from('mcp');

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH COMPILATION (lazy, cached)
// ═══════════════════════════════════════════════════════════════════════════════

let compiledGraphs: ToolDeps['graphs'] | null = null;

/** Compile all protocol graphs once. Same pattern as tool.service.ts. */
function getOrCompileGraphs(deps: ReturnType<typeof createDefaultProtocolDeps>): ToolDeps['graphs'] {
  if (compiledGraphs) return compiledGraphs;

  logger.info('Compiling MCP graphs (first call, will be cached)');

  const { database, embedder, scraper } = deps;
  const intentGraph = new IntentGraphFactory(database, embedder, deps.intentQueue).createGraph();
  const profileGraph = new ProfileGraphFactory(database, embedder, scraper, deps.enricher).createGraph();
  const compiledHydeGraph = new HydeGraphFactory(
    database as unknown as HydeGraphDatabase,
    embedder,
    deps.hydeCache,
    new LensInferrer(),
    new HydeGenerator(),
  ).createGraph();
  const negotiationGraph = new NegotiationGraphFactory(
    deps.negotiationDatabase,
    deps.agentDispatcher!,
    deps.negotiationTimeoutQueue,
  ).createGraph();
  const opportunityGraph = new OpportunityGraphFactory(
    database, embedder, compiledHydeGraph,
    undefined, undefined, negotiationGraph,
    deps.agentDispatcher,
    deps.queueNegotiateExisting,
  ).createGraph();
  const indexGraph = new NetworkGraphFactory(database).createGraph();
  const networkMembershipGraph = new NetworkMembershipGraphFactory(database).createGraph();
  const intentIndexGraph = new IntentNetworkGraphFactory(database, new IntentIndexer()).createGraph();

  compiledGraphs = {
    profile: profileGraph,
    intent: intentGraph,
    network: indexGraph,
    networkMembership: networkMembershipGraph,
    intentIndex: intentIndexGraph,
    opportunity: opportunityGraph,
  };

  return compiledGraphs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

const JWKS = createRemoteJWKSet(
  new URL(`${BASE_URL}/api/auth/jwks`),
);

function parseApiKeyMetadata(raw: string | null | undefined): { agentId?: string } {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as { agentId?: unknown };
    return typeof parsed.agentId === 'string' ? { agentId: parsed.agentId } : {};
  } catch {
    return {};
  }
}

const authResolver: McpAuthResolver = {
  async resolveIdentity(request: Request): Promise<{ userId: string; agentId?: string; isSessionAuth?: boolean }> {
    const authHeader = request.headers.get('Authorization');
    const [scheme, token] = authHeader?.split(/\s+/, 2) ?? [];

    if (scheme?.toLowerCase() === 'bearer' && token) {
      const isJwt = token.split('.').length === 3;

      if (isJwt) {
        // JWT path: verify with JWKS (issued by the jwt() plugin for CLI/API use)
        try {
          const { payload } = await jwtVerify(token, JWKS);
          if (typeof payload.id === 'string') return { userId: payload.id, isSessionAuth: true };
          if (typeof payload.sub === 'string') return { userId: payload.sub, isSessionAuth: true };
          throw new Error('JWT payload missing user ID');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isTransport = msg.includes('fetch') || msg.includes('ECONNREFUSED') ||
            msg.includes('timeout') || msg.includes('NetworkError');
          if (isTransport) throw new Error(`JWKS transport error: ${msg}`, { cause: err });
          throw new Error(`Invalid or expired access token: ${msg}`, { cause: err });
        }
      } else {
        // Opaque token path: issued by the mcp() plugin via OAuth flow
        try {
          const res = await fetch(`${BASE_URL}/api/auth/mcp/get-session`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = await res.json() as { userId?: string } | null;
            if (data?.userId) return { userId: data.userId, isSessionAuth: true };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`MCP token lookup failed: ${msg}`, { cause: err });
        }
        throw new Error('Invalid or expired access token');
      }
    }

    const apiKey = request.headers.get('x-api-key');
    if (apiKey) {
      let sessionUserId: string | undefined;

      try {
        const sessionRes = await fetch(`${BASE_URL}/api/auth/get-session`, {
          headers: { 'x-api-key': apiKey },
          signal: AbortSignal.timeout(5000),
        });
        if (sessionRes.ok) {
          const data = await sessionRes.json() as { user?: { id?: string } } | null;
          if (data?.user?.id) {
            sessionUserId = data.user.id;
          }
        }
      } catch { /* session lookup failed, try direct DB */ }

      try {
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
        const hashed = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const drizzle = await import('../lib/drizzle/drizzle');
        const { eq } = await import('drizzle-orm');
        const { apikeys } = await import('../schemas/database.schema');
        const [row] = await drizzle.default.select({
          referenceId: apikeys.referenceId,
          userId: apikeys.userId,
          enabled: apikeys.enabled,
          expiresAt: apikeys.expiresAt,
          metadata: apikeys.metadata,
        })
          .from(apikeys)
          .where(eq(apikeys.key, hashed))
          .limit(1);

        if (row) {
          if (!row.enabled) {
            throw new Error('Invalid API key');
          }

          if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
            throw new Error('Invalid API key');
          }

          const userId = row.referenceId ?? row.userId ?? sessionUserId;
          if (userId) {
            const metadata = parseApiKeyMetadata(row.metadata);
            return {
              userId,
              ...(metadata.agentId ? { agentId: metadata.agentId } : {}),
            };
          }
        }

        if (sessionUserId) {
          return { userId: sessionUserId };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'Invalid API key') {
          throw err;
        }
        throw new Error(`API key authentication failed: ${msg}`, { cause: err });
      }

      throw new Error('Invalid API key');
    }

    throw new Error('Authentication required: provide Bearer token or x-api-key header');
  },

  async resolveUserId(request: Request): Promise<string> {
    const { userId } = await authResolver.resolveIdentity(request);
    return userId;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// LAZY MCP SERVER CREATION
// ═══════════════════════════════════════════════════════════════════════════════

let mcpServer: McpServer | null = null;

function getOrCreateMcpServer(): McpServer {
  if (mcpServer) return mcpServer;

  const deps = createDefaultProtocolDeps();
  const graphs = getOrCompileGraphs(deps);

  const userDb = deps.createUserDatabase(deps.database, 'system');
  const systemDb = deps.createSystemDatabase(deps.database, 'system', []);

  const toolDeps: ToolDeps = {
    database: deps.database,
    userDb,
    systemDb,
    scraper: deps.scraper,
    embedder: deps.embedder,
    cache: deps.cache,
    integration: deps.integration,
    contactService: deps.contactService,
    integrationImporter: deps.integrationImporter,
    enricher: deps.enricher,
    negotiationDatabase: deps.negotiationDatabase,
    agentDispatcher: deps.agentDispatcher,
    negotiationTimeoutQueue: deps.negotiationTimeoutQueue,
    agentDatabase: deps.agentDatabase,
    grantDefaultSystemPermissions: deps.grantDefaultSystemPermissions,
    chatSession: deps.chatSession,
    graphs,
  };

  const scopedDepsFactory: ScopedDepsFactory = {
    create(userId: string, networkScope: string[]) {
      return {
        userDb: deps.createUserDatabase(deps.database, userId),
        systemDb: deps.createSystemDatabase(deps.database, userId, networkScope, deps.embedder),
      };
    },
  };

  mcpServer = createMcpServer(toolDeps, authResolver, scopedDepsFactory);
  logger.info('MCP server initialized');
  return mcpServer;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSPORT (created once, reused across requests)
// ═══════════════════════════════════════════════════════════════════════════════

let mcpTransportPromise: Promise<WebStandardStreamableHTTPServerTransport> | null = null;

function getOrCreateTransport(): Promise<WebStandardStreamableHTTPServerTransport> {
  if (mcpTransportPromise) return mcpTransportPromise;

  mcpTransportPromise = (async () => {
    const server = getOrCreateMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    logger.info('MCP transport connected');
    return transport;
  })();

  mcpTransportPromise.catch(() => { mcpTransportPromise = null; });
  return mcpTransportPromise;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handles an incoming MCP HTTP request.
 *
 * @param req - The incoming HTTP request
 * @param corsHeaders - CORS headers to merge into the response
 * @returns The HTTP response
 */
export async function mcpHandler(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  // Reject unauthenticated requests at the HTTP level before they reach the MCP transport.
  // The transport catches errors and wraps them as HTTP 200 isError responses, which means
  // Claude Code never sees a 401 and never triggers OAuth. By checking here, we return a
  // proper HTTP 401 + WWW-Authenticate so Claude Code can initiate the OAuth flow.
  const hasAuth = req.headers.has('Authorization') || req.headers.has('x-api-key');
  if (!hasAuth) {
    return new Response(
      JSON.stringify({ error: 'Authentication required: provide Bearer token or x-api-key header' }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
          ...corsHeaders,
        },
      },
    );
  }

  try {
    const transport = await getOrCreateTransport();
    const response = await transport.handleRequest(req);

    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('MCP handler error', { error: message });

    // Explicit invalid credentials → 401
    const isAuthError =
      message.includes('Authentication required') ||
      message.includes('Invalid or expired access token') ||
      message.includes('Invalid API key') ||
      message.includes('JWT payload missing user ID');

    // Verifier/JWKS transport failures (timeout, network) → 503
    const isVerifierError =
      message.includes('API key verification failed') ||
      message.includes('API key authentication failed') ||
      message.includes('JWKS transport error') ||
      message.includes('AbortError') ||
      message.includes('fetch failed');

    const status = isAuthError ? 401 : isVerifierError ? 503 : 500;

    if (isAuthError) {
      return new Response(
        JSON.stringify({ error: message }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
            ...corsHeaders,
          },
        },
      );
    }

    return new Response(
      JSON.stringify({ error: message }),
      {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      },
    );
  }
}
