/**
 * MCP HTTP Handler — wires the MCP server factory to the Streamable HTTP transport.
 * Uses createDefaultProtocolDeps() from the composition root for adapter wiring.
 */

import { jwtVerify, createRemoteJWKSet } from 'jose';
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';

// TODO: fix layering violation — controller should not import from init layer
// eslint-disable-next-line boundaries/dependencies
import { createDefaultProtocolDeps } from '../protocol-init';

// TODO: fix layering violation — controller should not import protocol directly
// eslint-disable-next-line boundaries/dependencies
import { IntentGraphFactory } from '../lib/protocol/graphs/intent.graph';
// eslint-disable-next-line boundaries/dependencies
import { ProfileGraphFactory } from '../lib/protocol/graphs/profile.graph';
// eslint-disable-next-line boundaries/dependencies
import { OpportunityGraphFactory } from '../lib/protocol/graphs/opportunity.graph';
// eslint-disable-next-line boundaries/dependencies
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde.graph';
// eslint-disable-next-line boundaries/dependencies
import { IndexGraphFactory } from '../lib/protocol/graphs/index.graph';
// eslint-disable-next-line boundaries/dependencies
import { IndexMembershipGraphFactory } from '../lib/protocol/graphs/index_membership.graph';
// eslint-disable-next-line boundaries/dependencies
import { IntentIndexGraphFactory } from '../lib/protocol/graphs/intent_index.graph';
// eslint-disable-next-line boundaries/dependencies
import { NegotiationGraphFactory } from '../lib/protocol/graphs/negotiation.graph';
// eslint-disable-next-line boundaries/dependencies
import { HydeGenerator } from '../lib/protocol/agents/hyde.generator';
// eslint-disable-next-line boundaries/dependencies
import { LensInferrer } from '../lib/protocol/agents/lens.inferrer';
// eslint-disable-next-line boundaries/dependencies
import { NegotiationProposer } from '../lib/protocol/agents/negotiation.proposer';
// eslint-disable-next-line boundaries/dependencies
import { NegotiationResponder } from '../lib/protocol/agents/negotiation.responder';
// eslint-disable-next-line boundaries/dependencies
import type { HydeGraphDatabase } from '../lib/protocol/interfaces/database.interface';

// eslint-disable-next-line boundaries/dependencies
import type { ToolDeps } from '../lib/protocol/tools/tool.helpers';
// eslint-disable-next-line boundaries/dependencies
import type { McpAuthResolver } from '../lib/protocol/interfaces/auth.interface';
// eslint-disable-next-line boundaries/dependencies
import { createMcpServer } from '../lib/protocol/mcp/mcp.server';
// eslint-disable-next-line boundaries/dependencies
import type { ScopedDepsFactory } from '../lib/protocol/mcp/mcp.server';
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
    new NegotiationProposer(),
    new NegotiationResponder(),
  ).createGraph();
  const opportunityGraph = new OpportunityGraphFactory(
    database, embedder, compiledHydeGraph,
    undefined, undefined, negotiationGraph,
  ).createGraph();
  const indexGraph = new IndexGraphFactory(database).createGraph();
  const indexMembershipGraph = new IndexMembershipGraphFactory(database).createGraph();
  const intentIndexGraph = new IntentIndexGraphFactory(database).createGraph();

  compiledGraphs = {
    profile: profileGraph,
    intent: intentGraph,
    index: indexGraph,
    indexMembership: indexMembershipGraph,
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

const authResolver: McpAuthResolver = {
  async resolveUserId(request: Request): Promise<string> {
    const authHeader = request.headers.get('Authorization');
    const [scheme, token] = authHeader?.split(/\s+/, 2) ?? [];
    if (scheme?.toLowerCase() === 'bearer' && token) {
      try {
        const { payload } = await jwtVerify(token, JWKS);
        if (typeof payload.id === 'string') return payload.id;
        if (typeof payload.sub === 'string') return payload.sub;
        throw new Error('JWT payload missing user ID');
      } catch (err) {
        // Distinguish JWKS transport errors (network/fetch) from credential errors
        const msg = err instanceof Error ? err.message : String(err);
        const isTransport = msg.includes('fetch') || msg.includes('ECONNREFUSED') ||
          msg.includes('timeout') || msg.includes('NetworkError');
        if (isTransport) throw new Error(`JWKS transport error: ${msg}`);
        throw new Error(`Invalid or expired access token: ${msg}`);
      }
    }

    const apiKey = request.headers.get('x-api-key');
    if (apiKey) {
      try {
        const verifyRes = await fetch(`${BASE_URL}/api/auth/api-key/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: apiKey }),
          signal: AbortSignal.timeout(5000),
        });
        if (!verifyRes.ok) throw new Error(`API key verification failed: ${verifyRes.status}`);
        const data = await verifyRes.json() as { valid: boolean; userId?: string; error?: string };
        if (data.valid && data.userId) return data.userId;
        throw new Error(data.error || 'Invalid API key');
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('API key verification failed')) throw err;
        throw new Error(`API key authentication failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    throw new Error('Authentication required: provide Bearer token or x-api-key header');
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
    graphs,
  };

  const scopedDepsFactory: ScopedDepsFactory = {
    create(userId: string, indexScope: string[]) {
      return {
        userDb: deps.createUserDatabase(deps.database, userId),
        systemDb: deps.createSystemDatabase(deps.database, userId, indexScope, deps.embedder),
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

    return new Response(
      JSON.stringify({ error: message }),
      {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      },
    );
  }
}
