/**
 * MCP HTTP Handler — wires the MCP server factory to the Streamable HTTP transport.
 * This is the MCP composition root: its request-local adapter/service wiring
 * lives here.
 */

import { jwtVerify, createRemoteJWKSet } from 'jose';
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

import { cacheAdapter, hydeCacheAdapter } from '../adapters/cache.adapter';
import { agentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { chatDatabaseAdapter, ChatDatabaseAdapter, createUserDatabase, createSystemDatabase } from '../adapters/database.adapter';
import { embedderAdapter } from '../adapters/embedder.adapter';
import { scraperAdapter } from '../adapters/scraper.adapter';
import { intentIndexing } from '../lib/intent/indexing';
import { enricherAdapter } from '../adapters/enricher.adapter';
import { checkMcpRateLimit, checkMcpHttpRateLimit } from '../lib/limiter/mcp';
import type { McpHttpThrottleDecision } from '../lib/limiter/mcp';
import { negotiatorVerdictToolsHost } from '../lib/agent/negotiator-verdict.host';
import { resolveProtocolBaseUrl } from '../lib/protocol-url';

import { Intents, OpportunityGraphFactory, HydeGraphFactory, Networks, HydeGenerator, LensInferrer, createMcpServer } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, ToolDeps, McpAuthResolver, ScopedDepsFactory, Embedder, CompositeToolDatabase, McpAuthInput, McpResolvedIdentity } from '@indexnetwork/protocol';

import { API_URL, JWT_AUDIENCE } from '../lib/betterauth/betterauth';
import { log } from '../lib/log';
import { captureAppException } from '../lib/sentry';

const logger = log.server.from('mcp');

// ═══════════════════════════════════════════════════════════════════════════════
// MCP COMPOSITION ROOT (was protocol-init.ts)
// ═══════════════════════════════════════════════════════════════════════════════

const apiBaseUrl = resolveProtocolBaseUrl();

const protocolDeps = {
  database: chatDatabaseAdapter,
  embedder: embedderAdapter,
  scraper: scraperAdapter,
  cache: cacheAdapter,
  hydeCache: hydeCacheAdapter,
  intentFollowUp: intentIndexing,
  enricher: enricherAdapter,
  createUserDatabase: (db: CompositeToolDatabase, userId: string) =>
    createUserDatabase(db as ChatDatabaseAdapter, userId),
  createSystemDatabase: (db: CompositeToolDatabase, userId: string, scope: string[], emb?: Embedder) =>
    createSystemDatabase(db as ChatDatabaseAdapter, userId, scope, emb),
  agentDatabase: agentDatabaseAdapter,
  frontendUrl: process.env.WEB_APP_URL ?? 'https://index.network',
  apiBaseUrl,
  // #1471: host bridge for the `reject_opportunity` / `accept_opportunity`
  // tools — the owner's VERDICT lane.
  negotiatorVerdictTools: negotiatorVerdictToolsHost,
};

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH COMPILATION (lazy, cached)
// ═══════════════════════════════════════════════════════════════════════════════

let compiledGraphs: ToolDeps['graphs'] | null = null;

/** Compile all protocol graphs once. Same pattern as tool.service.ts. */
function getOrCompileGraphs(): ToolDeps['graphs'] {
  if (compiledGraphs) return compiledGraphs;

  logger.info('Compiling MCP graphs (first call, will be cached)');

  const { database, embedder } = protocolDeps;
  const intents = new Intents({
    database,
    embedder,
    followUp: protocolDeps.intentFollowUp,
  });
  const intentGraph = intents.createGraph();
  const compiledHydeGraph = new HydeGraphFactory(
    database as unknown as HydeGraphDatabase,
    embedder,
    protocolDeps.hydeCache,
    new LensInferrer(),
    new HydeGenerator(),
  ).createGraph();
  const opportunityGraph = new OpportunityGraphFactory(
    database, embedder, compiledHydeGraph,
  ).createGraph();
  const networks = new Networks({ database });
  const networkGraph = networks.createGraph();
  const networkMembershipGraph = networks.createMembershipGraph();
  const intentNetworkGraph = networks.createAssignmentGraph();

  compiledGraphs = {
    intent: intentGraph,
    network: networkGraph,
    networkMembership: networkMembershipGraph,
    intentNetwork: intentNetworkGraph,
    opportunity: opportunityGraph,
  };

  return compiledGraphs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

const JWKS = createRemoteJWKSet(
  new URL('/api/auth/jwks', API_URL),
);

type ResolvedMcpIdentity = McpResolvedIdentity;

const authResolver: McpAuthResolver = {
  async resolveIdentity(input: McpAuthInput): Promise<ResolvedMcpIdentity> {
    if (input.bearerToken) {
      const isJwt = input.bearerToken.split('.').length === 3;

      if (isJwt) {
        // JWT path
        try {
          const { payload } = await jwtVerify(input.bearerToken, JWKS, { issuer: API_URL, audience: JWT_AUDIENCE });
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
        // Opaque token path
        try {
          const res = await fetch(`${API_URL}/api/auth/mcp/get-session`, {
            headers: { Authorization: `Bearer ${input.bearerToken}` },
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

    if (input.apiKey) {
      // The apiKey plugin owns verification: hashing, enablement, expiry and
      // rate limiting. `referenceId` is the user the key names.
      const { auth } = await import('../lib/betterauth/auth.instance');
      try {
        const { valid, key } = await auth.api.verifyApiKey({ body: { key: input.apiKey } });
        if (valid && key) {
          return { userId: key.referenceId };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`API key authentication failed: ${msg}`, { cause: err });
      }

      throw new Error('Invalid API key');
    }

    throw new Error('Authentication required: provide Bearer token or x-api-key header');
  },

  async resolveUserId(request: Request): Promise<string> {
    // Deprecated bridge: extract McpAuthInput from Request using the same
    // edge semantics as the protocol MCP transport.
    const input: McpAuthInput = {
      bearerToken: (() => {
        const auth = request.headers.get('Authorization');
        if (!auth) return undefined;
        const [scheme, token] = auth.trim().split(/\s+/, 2);
        return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
      })(),
      apiKey: request.headers.get('x-api-key') ?? undefined,
    };
    const { userId } = await authResolver.resolveIdentity(input);
    return userId;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PER-REQUEST MCP SERVER CREATION
// ═══════════════════════════════════════════════════════════════════════════════

function createMcpServerInstance(): McpServer {
  const graphs = getOrCompileGraphs();

  const userDb = protocolDeps.createUserDatabase(protocolDeps.database, 'system');
  const systemDb = protocolDeps.createSystemDatabase(protocolDeps.database, 'system', []);

  const toolDeps: ToolDeps = {
    database: protocolDeps.database,
    userDb,
    systemDb,
    scraper: protocolDeps.scraper,
    embedder: protocolDeps.embedder,
    cache: protocolDeps.cache,
    enricher: protocolDeps.enricher,
    // #1471: owner-verdict host behind reject/accept_opportunity (the Radar
    // Skip/Start-Chat path). Registered on the MCP surface only.
    negotiatorVerdictTools: protocolDeps.negotiatorVerdictTools,
    agentDatabase: protocolDeps.agentDatabase,
    reportToolError: (error, report) => captureAppException(error, {
      subsystem: report.subsystem ?? 'protocol',
      operation: report.operation,
      tags: {
        ...report.tags,
        ...(report.toolName ? { toolName: report.toolName } : {}),
      },
      context: report.context,
      userId: report.userId,
    }),
    mcpRateLimiter: (input) => checkMcpRateLimit(input),
    frontendUrl: protocolDeps.frontendUrl,
    apiBaseUrl: protocolDeps.apiBaseUrl,
    graphs,
  };

  const scopedDepsFactory: ScopedDepsFactory = {
    create(userId: string, allowedNetworkIds: string[]) {
      return {
        userDb: protocolDeps.createUserDatabase(protocolDeps.database, userId),
        systemDb: protocolDeps.createSystemDatabase(protocolDeps.database, userId, allowedNetworkIds, protocolDeps.embedder),
      };
    },
  };

  return createMcpServer(toolDeps, authResolver, scopedDepsFactory);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSPORT (created per request to isolate stream mappings)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Per-request MCP server and transport connection.
 * Both objects must be closed after the response to release SDK callback/state
 * references and prevent accumulation of routed response envelopes for clients
 * that reuse JSON-RPC message IDs across connections.
 */
type PerRequestMcpConnection = {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
};

/**
 * Safely closes both MCP SDK lifecycle objects for a per-request connection.
 * Swallows individual close failures so one failing close does not mask others.
 */
async function closePerRequestMcpConnection(
  connection: Partial<PerRequestMcpConnection> | undefined,
): Promise<void> {
  if (!connection) return;

  const closeOps: Promise<void>[] = [];
  if (connection.transport) {
    closeOps.push(connection.transport.close());
  }
  if (connection.server) {
    closeOps.push(connection.server.close());
  }

  if (closeOps.length === 0) return;
  await Promise.allSettled(closeOps);
}

/**
 * Creates a fresh MCP server and transport for each HTTP request. The transport
 * keeps response-routing state keyed by JSON-RPC message.id, and McpServer keeps
 * a single active transport reference. Reusing either object across concurrent
 * stateless HTTP clients can route a response to the wrong connection when
 * clients reuse ids (for example, all agentvillage pods send id:2 for
 * tools/call).
 *
 * enableJsonResponse makes handleRequest resolve only after the tool response is
 * ready, so the handler can safely close the per-request transport afterwards.
 */
async function createPerRequestTransport(): Promise<PerRequestMcpConnection> {
  const server = createMcpServerInstance();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return { server, transport };
  } catch (err) {
    await closePerRequestMcpConnection({ server, transport });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

/** Ceiling on a single /mcp request body. */
const MCP_MAX_REQUEST_BYTES = 1_000_000;

function requestTooLargeResponse(maxRequestBytes: number, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: `MCP request too large. Max ${maxRequestBytes} bytes.` }),
    { status: 413, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}

function rejectMcpContentLengthTooLarge(
  req: Request,
  maxRequestBytes: number,
  corsHeaders: Record<string, string>,
): Response | null {
  const contentLength = req.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > maxRequestBytes) {
    return requestTooLargeResponse(maxRequestBytes, corsHeaders);
  }
  return null;
}

function mcpHttpRateLimitResponse(
  decision: McpHttpThrottleDecision,
  corsHeaders: Record<string, string>,
): Response {
  const retryAfterSeconds = decision.retryAfterSec ?? 60;
  return new Response(
    JSON.stringify({
      error: 'Too Many Requests',
      code: 'RATE_LIMITED',
      class: 'mcp_http',
      retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...(decision.limit !== undefined ? { 'ratelimit-limit': String(decision.limit) } : {}),
        'ratelimit-remaining': String(decision.remaining ?? 0),
        'ratelimit-reset': String(retryAfterSeconds),
        'retry-after': String(retryAfterSeconds),
        ...corsHeaders,
      },
    },
  );
}

async function enforceMcpRequestSize(
  req: Request,
  maxRequestBytes: number,
  corsHeaders: Record<string, string>,
): Promise<Request | Response> {
  if (!req.body) return req;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxRequestBytes) {
      await reader.cancel().catch(() => undefined);
      return requestTooLargeResponse(maxRequestBytes, corsHeaders);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body,
    signal: req.signal,
  });
}

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
  const maxRequestBytes = MCP_MAX_REQUEST_BYTES;

  // 1. Cheap content-length precheck before any body draining
  const contentLengthResponse = rejectMcpContentLengthTooLarge(req, maxRequestBytes, corsHeaders);
  if (contentLengthResponse) return contentLengthResponse;

  // 2. Cheap HTTP-level limiter before body draining and MCP server allocation
  const httpLimitDecision = await checkMcpHttpRateLimit(req);
  if (!httpLimitDecision.allowed) {
    return mcpHttpRateLimitResponse(httpLimitDecision, corsHeaders);
  }

  // 3. Reject unauthenticated requests at the HTTP level before they reach the MCP transport.
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
          'WWW-Authenticate': `Bearer resource_metadata="${API_URL}/.well-known/oauth-protected-resource"`,
          ...corsHeaders,
        },
      },
    );
  }

  // 4. Drain and validate request body size
  const sizeCheckedRequest = await enforceMcpRequestSize(req, maxRequestBytes, corsHeaders);
  if (sizeCheckedRequest instanceof Response) return sizeCheckedRequest;
  req = sizeCheckedRequest;

  let connection: PerRequestMcpConnection | undefined;
  try {
    connection = await createPerRequestTransport();
    const response = await connection.transport.handleRequest(req);

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

    if (!isAuthError) {
      captureAppException(err, {
        subsystem: 'mcp',
        operation: 'mcp.http',
        tags: {
          'http.method': req.method,
          'http.status_code': status,
          mcp_error_type: isVerifierError ? 'verifier' : 'handler',
        },
        context: { path: new URL(req.url).pathname },
      });
    }

    if (isAuthError) {
      return new Response(
        JSON.stringify({ error: message }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer resource_metadata="${API_URL}/.well-known/oauth-protected-resource"`,
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
  } finally {
    // Close both SDK lifecycle objects to release accumulated routing/callback state
    await closePerRequestMcpConnection(connection);
  }
}
