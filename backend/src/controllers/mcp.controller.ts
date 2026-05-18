/**
 * MCP HTTP Handler — wires the MCP server factory to the Streamable HTTP transport.
 * This is the composition root: all adapter/service wiring lives here.
 */

import { jwtVerify, createRemoteJWKSet } from 'jose';
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';

import { cacheAdapter, hydeCacheAdapter } from '../adapters/cache.adapter';
import { agentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { ComposioIntegrationAdapter } from '../adapters/integration.adapter';
import {
  chatDatabaseAdapter,
  conversationDatabaseAdapter,
  ChatDatabaseAdapter,
  createUserDatabase,
  createSystemDatabase,
} from '../adapters/database.adapter';
import { embedderAdapter } from '../adapters/embedder.adapter';
import { scraperAdapter } from '../adapters/scraper.adapter';
import { intentQueue } from '../queues/intent.queue';
import { negotiationRunExistingQueue } from '../queues/negotiations/run-existing.queue';
import { chatSessionAdapter } from '../adapters/chat-session.adapter';
import { ChatSummaryDatabaseAdapter } from '../adapters/chat-summary.database.adapter';
import { ChatMessageWriterAdapter } from '../adapters/chat-message-writer.adapter';
import { enricherAdapter } from '../adapters/enricher.adapter';
import { agentService } from '../services/agent.service';
import { chatSessionService } from '../services/chat.service';
import { ChatSummaryService } from '../services/chat-summary.service';
import { QuestionGeneratorService } from '../services/question-generator.service';
import { AgentDispatcherImpl } from '../services/agent-dispatcher.service';
import { contactService } from '../services/contact.service';
import { IntegrationService } from '../services/integration.service';
import { opportunityDeliveryService } from '../services/opportunity-delivery.service';
import { negotiationTimeoutQueue } from '../queues/negotiations/timeout.queue';
import { signConnectToken } from '../services/connect-token.service';
import type { ConnectLinkKind } from '../services/connect-link.service';
import { mintConnectLink as mintConnectLinkSvc, buildConnectShortUrl } from '../services/connect-link.service';

import { IntentGraphFactory, ProfileGraphFactory, OpportunityGraphFactory, HydeGraphFactory, NetworkGraphFactory, NetworkMembershipGraphFactory, IntentNetworkGraphFactory, NegotiationGraphFactory, HydeGenerator, LensInferrer, IntentIndexer, createMcpServer, ChatGraphFactory } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, ToolDeps, McpAuthResolver, ScopedDepsFactory, Embedder, ChatGraphCompositeDatabase } from '@indexnetwork/protocol';

import { BASE_URL, JWT_AUDIENCE } from '../lib/betterauth/betterauth';
import { log } from '../lib/log';
import { resolveAgentNetworkScopeById } from '../guards/agent-scope.guard';

const logger = log.server.from('mcp');

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITION ROOT (was protocol-init.ts)
// ═══════════════════════════════════════════════════════════════════════════════

const integration = new ComposioIntegrationAdapter();
const chatSummaryAdapter = new ChatSummaryDatabaseAdapter();
const chatSummaryService = new ChatSummaryService(chatSummaryAdapter);
const questionGeneratorService = new QuestionGeneratorService();
const integrationImporter = new IntegrationService(integration, contactService);
const agentDispatcher = new AgentDispatcherImpl(agentService, negotiationTimeoutQueue);

const apiBaseUrl = (
  process.env.BASE_URL ||
  process.env.API_BASE_URL ||
  process.env.APP_URL ||
  'http://localhost:3001'
).replace(/\/+$/, '');

const mintConnectLink = async ({ userId, opportunityId, kind, greeting, preferredSurface }: {
  userId: string;
  opportunityId: string;
  kind: ConnectLinkKind;
  greeting?: string | null;
  preferredSurface?: 'telegram' | 'web';
}): Promise<{ url: string }> => {
  const { code } = await mintConnectLinkSvc({ userId, opportunityId, kind, greeting, preferredSurface });
  return { url: buildConnectShortUrl(apiBaseUrl, code) };
};

const protocolDeps = {
  database: chatDatabaseAdapter,
  embedder: embedderAdapter,
  scraper: scraperAdapter,
  cache: cacheAdapter,
  hydeCache: hydeCacheAdapter,
  integration,
  intentQueue,
  contactService,
  chatSession: chatSessionAdapter,
  chatSummary: chatSummaryService,
  questionGenerator: questionGeneratorService,
  enricher: enricherAdapter,
  negotiationDatabase: conversationDatabaseAdapter,
  integrationImporter,
  createUserDatabase: (db: ChatGraphCompositeDatabase, userId: string) =>
    createUserDatabase(db as ChatDatabaseAdapter, userId),
  createSystemDatabase: (db: ChatGraphCompositeDatabase, userId: string, scope: string[], emb?: Embedder) =>
    createSystemDatabase(db as ChatDatabaseAdapter, userId, scope, emb),
  agentDatabase: agentDatabaseAdapter,
  grantDefaultSystemPermissions: (userId: string) =>
    agentService.grantDefaultSystemPermissions(userId),
  agentDispatcher,
  chatMessageWriter: new ChatMessageWriterAdapter(chatSessionService),
  deliveryLedger: opportunityDeliveryService,
  negotiationTimeoutQueue,
  queueNegotiateExisting: async (opportunityId: string, userId: string): Promise<void> => {
    await negotiationRunExistingQueue.addJob({ opportunityId, userId });
  },
  mintConnectToken: signConnectToken,
  mintConnectLink,
  frontendUrl: process.env.FRONTEND_URL ?? 'https://index.network',
  apiBaseUrl,
};

const chatSessionReader = {
  getSessionMessages: (sessionId: string, limit?: number) => conversationDatabaseAdapter.getChatSessionMessages(sessionId, limit),
  listSessions: (userId: string, limit?: number) => conversationDatabaseAdapter.listChatSessionSummaries(userId, limit),
  getSession: (userId: string, sessionId: string, messageLimit?: number) =>
    conversationDatabaseAdapter.getChatSessionDetail(userId, sessionId, messageLimit),
};
export const chatFactory = new ChatGraphFactory(chatDatabaseAdapter, embedderAdapter, scraperAdapter, chatSessionReader, protocolDeps);

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH COMPILATION (lazy, cached)
// ═══════════════════════════════════════════════════════════════════════════════

let compiledGraphs: ToolDeps['graphs'] | null = null;

/** Compile all protocol graphs once. Same pattern as tool.service.ts. */
function getOrCompileGraphs(): ToolDeps['graphs'] {
  if (compiledGraphs) return compiledGraphs;

  logger.info('Compiling MCP graphs (first call, will be cached)');

  const { database, embedder, scraper } = protocolDeps;
  const intentGraph = new IntentGraphFactory(database, embedder, protocolDeps.intentQueue).createGraph();
  const profileGraph = new ProfileGraphFactory(database, embedder, scraper, protocolDeps.enricher).createGraph();
  const compiledHydeGraph = new HydeGraphFactory(
    database as unknown as HydeGraphDatabase,
    embedder,
    protocolDeps.hydeCache,
    new LensInferrer(),
    new HydeGenerator(),
  ).createGraph();
  const negotiationGraph = new NegotiationGraphFactory(
    protocolDeps.negotiationDatabase,
    protocolDeps.agentDispatcher!,
    protocolDeps.negotiationTimeoutQueue,
  ).createGraph();
  const opportunityGraph = new OpportunityGraphFactory(
    database, embedder, compiledHydeGraph,
    undefined, undefined, negotiationGraph,
    protocolDeps.agentDispatcher,
    protocolDeps.queueNegotiateExisting,
  ).createGraph();
  const indexGraph = new NetworkGraphFactory(database).createGraph();
  const networkMembershipGraph = new NetworkMembershipGraphFactory(database).createGraph();
  const intentIndexGraph = new IntentNetworkGraphFactory(database, new IntentIndexer()).createGraph();

  compiledGraphs = {
    profile: profileGraph,
    intent: intentGraph,
    index: indexGraph,
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
  new URL('/api/auth/jwks', BASE_URL),
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

// Module-scope on purpose: dedupes the warn across the process lifetime so an
// unknown header value only logs once per server process, not once per request.
const seenInvalidSurfaces = new Set<string>();

/**
 * Normalize the `x-index-surface` request header to one of the two values the
 * connect-link click handler understands.
 *
 * Absent or unrecognized values collapse to `'web'` — the new default. Only
 * `'telegram'` activates the t.me redirect path at click time.
 *
 * @param raw - The raw header value (case-insensitive; whitespace-trimmed).
 * @returns `'telegram'` if and only if the trimmed lower-case value is exactly
 *   `'telegram'`; `'web'` otherwise (including for `null`, `''`, and unknowns).
 */
export function parseClientSurface(raw: string | null): 'telegram' | 'web' {
  if (raw === null) return 'web';
  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return 'web';
  if (normalized === 'telegram') return 'telegram';
  // Short-circuit for the known-valid value so explicit `web` doesn't trigger the unknown-value warn.
  if (normalized === 'web') return 'web';
  if (!seenInvalidSurfaces.has(normalized)) {
    seenInvalidSurfaces.add(normalized);
    console.warn(`[mcp] unknown x-index-surface value "${normalized}" — coercing to "web"`);
  }
  return 'web';
}

const authResolver: McpAuthResolver = {
  async resolveIdentity(request: Request): Promise<{ userId: string; agentId?: string; isSessionAuth?: boolean; networkScopeId?: string | null; clientSurface?: 'telegram' | 'web' }> {
    const clientSurface = parseClientSurface(request.headers.get('x-index-surface'));
    const authHeader = request.headers.get('Authorization');
    const [scheme, token] = authHeader?.split(/\s+/, 2) ?? [];

    if (scheme?.toLowerCase() === 'bearer' && token) {
      const isJwt = token.split('.').length === 3;

      if (isJwt) {
        // JWT path: verify with JWKS (issued by the jwt() plugin for CLI/API use).
        // JWTs don't carry an agentId — they authenticate users, not agents — so
        // there is no network scope to compute; the field is explicitly null
        // (not omitted) so callers cannot conflate "no scope" with "scope unset".
        try {
          const { payload } = await jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE });
          if (typeof payload.id === 'string') return { userId: payload.id, isSessionAuth: true, networkScopeId: null, clientSurface };
          if (typeof payload.sub === 'string') return { userId: payload.sub, isSessionAuth: true, networkScopeId: null, clientSurface };
          throw new Error('JWT payload missing user ID');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isTransport = msg.includes('fetch') || msg.includes('ECONNREFUSED') ||
            msg.includes('timeout') || msg.includes('NetworkError');
          if (isTransport) throw new Error(`JWKS transport error: ${msg}`, { cause: err });
          throw new Error(`Invalid or expired access token: ${msg}`, { cause: err });
        }
      } else {
        // Opaque token path: issued by the mcp() plugin via OAuth flow — also
        // session-auth, no agent identity, so network scope is always null.
        try {
          const res = await fetch(`${BASE_URL}/api/auth/mcp/get-session`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = await res.json() as { userId?: string } | null;
            if (data?.userId) return { userId: data.userId, isSessionAuth: true, networkScopeId: null, clientSurface };
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
            // For network-scoped agents, resolve the bound network scope so the
            // MCP server can clamp `indexScope` to that single network downstream.
            const networkScopeId = metadata.agentId
              ? await resolveAgentNetworkScopeById(metadata.agentId)
              : null;
            return {
              userId,
              ...(metadata.agentId ? { agentId: metadata.agentId } : {}),
              networkScopeId,
              clientSurface,
            };
          }
        }

        if (sessionUserId) {
          return { userId: sessionUserId, networkScopeId: null, clientSurface };
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
    integration: protocolDeps.integration,
    contactService: protocolDeps.contactService,
    integrationImporter: protocolDeps.integrationImporter,
    enricher: protocolDeps.enricher,
    negotiationDatabase: protocolDeps.negotiationDatabase,
    agentDispatcher: protocolDeps.agentDispatcher,
    negotiationTimeoutQueue: protocolDeps.negotiationTimeoutQueue,
    agentDatabase: protocolDeps.agentDatabase,
    grantDefaultSystemPermissions: protocolDeps.grantDefaultSystemPermissions,
    chatSession: protocolDeps.chatSession,
    chatSummary: protocolDeps.chatSummary,
    questionGenerator: protocolDeps.questionGenerator,
    chatMessageWriter: protocolDeps.chatMessageWriter,
    deliveryLedger: protocolDeps.deliveryLedger,
    mintConnectToken: protocolDeps.mintConnectToken,
    mintConnectLink: protocolDeps.mintConnectLink,
    frontendUrl: protocolDeps.frontendUrl,
    apiBaseUrl: protocolDeps.apiBaseUrl,
    graphs,
  };

  const scopedDepsFactory: ScopedDepsFactory = {
    create(userId: string, indexScope: string[]) {
      return {
        userDb: protocolDeps.createUserDatabase(protocolDeps.database, userId),
        systemDb: protocolDeps.createSystemDatabase(protocolDeps.database, userId, indexScope, protocolDeps.embedder),
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
