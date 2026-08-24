/**
 * MCP HTTP Handler — wires the MCP server factory to the Streamable HTTP transport.
 * This is the composition root: all adapter/service wiring lives here.
 */

import { jwtVerify, createRemoteJWKSet } from 'jose';
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

import { cacheAdapter, hydeCacheAdapter } from '../adapters/cache.adapter';
import { agentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { chatDatabaseAdapter, conversationDatabaseAdapter, ChatDatabaseAdapter, createUserDatabase, createSystemDatabase } from '../adapters/database.adapter';
import { embedderAdapter } from '../adapters/embedder.adapter';
import { scraperAdapter } from '../adapters/scraper.adapter';
import { intentQueue } from '../queues/intent.queue';
import { negotiationRunExistingQueue } from '../queues/negotiations/run-existing.queue';
import { chatSessionAdapter } from '../adapters/chat-session.adapter';
import { ChatSummaryDatabaseAdapter } from '../adapters/chat-summary.database.adapter';
import { ChatMessageWriterAdapter } from '../adapters/chat-message-writer.adapter';
import { enricherAdapter } from '../adapters/enricher.adapter';
import { checkMcpRateLimit, checkMcpHttpRateLimit } from '../lib/limiter/mcp';
import type { McpHttpThrottleDecision } from '../lib/limiter/mcp';
import { getOpportunityOwnerApprovalAuthority } from '../lib/mcp/owner-approval';
import db from '../lib/drizzle/drizzle';
import { resolveApiKeyUserId } from '../lib/apikey/principal';
import { agentService } from '../services/agent.service';
import { chatSessionService } from '../services/chat.service';
import { ChatSummaryService } from '../services/chat-summary.service';
import { NegotiationSummaryService } from '../services/negotiation-summary.service';
import { AgentDispatcherImpl } from '../services/agent-dispatcher.service';
import { opportunityDeliveryService } from '../services/opportunity-delivery.service';
import { userService } from '../services/user.service';
import { negotiationGraph } from '../lib/negotiation/negotiation-graph';
import { negotiatorVerdictToolsHost } from '../lib/agent/negotiator-verdict.host';
import { resolveProtocolBaseUrl } from '../lib/protocol-url';
import { isHermesNegotiatorAudience } from '../lib/agent/hermes-credential';

import { Intents, EnrichmentGraphFactory, OpportunityGraphFactory, HydeGraphFactory, Networks, HydeGenerator, LensInferrer, createMcpServer, ChatGraphFactory, PremiseGraphFactory, createPersonalAgentPersona, PERSONAL_AGENT_PERSONA_ID, McpApiKeyMetadataSchema, CANONICAL_MCP_CAPABILITY_POLICY_OPTIONS } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, PremiseGraphDatabase, ToolDeps, McpAuthResolver, ScopedDepsFactory, Embedder, ChatGraphCompositeDatabase, McpAuthInput, McpResolvedIdentity, OpportunityOwnerApprovalAuthority, McpAuthorizationObserver } from '@indexnetwork/protocol';

import { API_URL, JWT_AUDIENCE } from '../lib/betterauth/betterauth';
import { log } from '../lib/log';
import { captureAppException } from '../lib/sentry';
import { mergeTelegramHandleIntoSocials } from '../lib/telegram/socials';
import { resolveAgentNetworkScopeById } from '../guards/agent-scope.guard';
import { intentProposalDatabaseAdapter } from '../adapters/intent-proposal.database.adapter';

const logger = log.server.from('mcp');

type McpToolDeps = ToolDeps & {
  opportunityOwnerApproval?: OpportunityOwnerApprovalAuthority;
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITION ROOT (was protocol-init.ts)
// ═══════════════════════════════════════════════════════════════════════════════

const chatSummaryAdapter = new ChatSummaryDatabaseAdapter();
const chatSummaryService = new ChatSummaryService(chatSummaryAdapter);
const negotiationSummaryService = new NegotiationSummaryService();
const agentDispatcher = new AgentDispatcherImpl(agentService);

const apiBaseUrl = resolveProtocolBaseUrl();

const protocolDeps = {
  database: chatDatabaseAdapter,
  embedder: embedderAdapter,
  scraper: scraperAdapter,
  cache: cacheAdapter,
  hydeCache: hydeCacheAdapter,
  intentQueue,
  intentProposalStore: intentProposalDatabaseAdapter,
  chatSession: chatSessionAdapter,
  chatSummary: chatSummaryService,
  negotiationSummary: negotiationSummaryService,
  enricher: enricherAdapter,
  negotiationDatabase: conversationDatabaseAdapter,
  // The one fully-wired composition (reflectEnqueue included) — chat/MCP
  // tool.factory.ts must use this instead of building its own reflect-less
  // instance, or the all-paused -> reflect trigger is silently lost on
  // every negotiation opened through this surface.
  negotiationGraph,
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
  // IND-593: authoritative owner-proof verifier/consumer for opportunity state
  // changes. Shared process-wide with the MCP toolDeps and the REST issuance
  // route; threaded into chat tools by the protocol chat factory.
  opportunityOwnerApproval: getOpportunityOwnerApprovalAuthority(),
  queueNegotiateExisting: async (opportunityId: string, userId: string): Promise<void> => {
    await negotiationRunExistingQueue.addJob({ opportunityId, userId });
  },
  frontendUrl: process.env.WEB_APP_URL ?? 'https://index.network',
  apiBaseUrl,
  // #1471: host bridge for the negotiator persona's `reject_opportunity` /
  // `accept_opportunity` tools — the owner's VERDICT lane, which had no lever
  // in chat before. Registered only in intent-pinned negotiator sessions; the
  // orchestrator registry never sees it.
  negotiatorVerdictTools: negotiatorVerdictToolsHost,
};

const chatSessionReader = {
  getSessionMessages: (sessionId: string, limit?: number) => conversationDatabaseAdapter.getChatSessionMessages(sessionId, limit),
  listSessions: (userId: string, limit?: number) =>
    conversationDatabaseAdapter.listChatSessionSummaries(userId, limit ?? 25, PERSONAL_AGENT_PERSONA_ID),
  getSession: (userId: string, sessionId: string, messageLimit?: number) =>
    conversationDatabaseAdapter.getChatSessionDetail(userId, sessionId, messageLimit ?? 50, PERSONAL_AGENT_PERSONA_ID),
};
/**
 * Composition-root chat factory. Signal is the product's primary chat persona,
 * so it is the one this factory carries; every other persona (onboarding,
 * negotiator) is derived from it via `withPersona`, sharing the
 * persona-neutral runtime and all injected deps. There is no default persona —
 * the retired orchestrator used to be it.
 */
// The runtime has no default persona; this base factory just carries the deps.
// Every chat surface derives a sibling factory bound to the client's own agent
// identity (`ChatSessionService.get*GraphFactory`), so the nameless persona
// here never drives a turn.
export const chatFactory = new ChatGraphFactory(chatDatabaseAdapter, embedderAdapter, scraperAdapter, chatSessionReader, protocolDeps, createPersonalAgentPersona({}, 'global'));

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH COMPILATION (lazy, cached)
// ═══════════════════════════════════════════════════════════════════════════════

let compiledGraphs: ToolDeps['graphs'] | null = null;

/** Compile all protocol graphs once. Same pattern as tool.service.ts. */
function getOrCompileGraphs(): ToolDeps['graphs'] {
  if (compiledGraphs) return compiledGraphs;

  logger.info('Compiling MCP graphs (first call, will be cached)');

  const { database, embedder, scraper } = protocolDeps;
  const intents = new Intents({
    database,
    embedder,
    queue: protocolDeps.intentQueue,
  });
  const intentGraph = intents.createGraph();
  const premiseGraph = new PremiseGraphFactory(database as unknown as PremiseGraphDatabase, embedder).createGraph();
  const profileGraph = new EnrichmentGraphFactory(database).createGraph();
  const compiledHydeGraph = new HydeGraphFactory(
    database as unknown as HydeGraphDatabase,
    embedder,
    protocolDeps.hydeCache,
    new LensInferrer(),
    new HydeGenerator(),
  ).createGraph();
  const opportunityGraph = new OpportunityGraphFactory(
    database, embedder, compiledHydeGraph,
    undefined, undefined, negotiationGraph,
    protocolDeps.agentDispatcher,
    protocolDeps.queueNegotiateExisting,
  ).createGraph();
  const networks = new Networks({ database, indexer: intents });
  const indexGraph = networks.createGraph();
  const networkMembershipGraph = networks.createMembershipGraph();
  const intentIndexGraph = networks.createAssignmentGraph();

  compiledGraphs = {
    profile: profileGraph,
    intent: intentGraph,
    index: indexGraph,
    networkMembership: networkMembershipGraph,
    intentIndex: intentIndexGraph,
    opportunity: opportunityGraph,
    premise: premiseGraph,
  };

  return compiledGraphs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

const JWKS = createRemoteJWKSet(
  new URL('/api/auth/jwks', API_URL),
);

function parseApiKeyMetadata(raw: string | null | undefined): {
  agentId?: string;
  enrollmentCapable?: boolean;
  isDeliveryAgent?: boolean;
} {
  if (!raw) {
    return {};
  }

  try {
    const parsed = McpApiKeyMetadataSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return {};
    return {
      ...(parsed.data.agentId ? { agentId: parsed.data.agentId } : {}),
      ...(parsed.data.enrollmentCapable === true ? { enrollmentCapable: true } : {}),
      ...(parsed.data.isDeliveryAgent === true ? { isDeliveryAgent: true } : {}),
    };
  } catch {
    return {};
  }
}

type ApiKeyPrincipalRow = {
  referenceId: string | null;
  userId: string | null;
  metadata?: string | null;
};

type TelegramSocial = {
  userId?: string;
  label: string;
  value: string;
};

type TelegramHandleMismatch = {
  reason: 'authenticated_user_handle_mismatch' | 'handle_belongs_to_other_user';
  ownerUserId?: string;
};

type ResolvedMcpIdentity = McpResolvedIdentity;

function normalizeTelegramHeader(raw: string | null | undefined): string | null {
  const trimmed = raw
    ?.trim()
    .replace(/^@/, '')
    // Case-insensitive to match the SQL normalization in
    // EnrichmentDatabaseAdapter.findTelegramHandleOwners; otherwise a stored
    // `HTTPS://T.ME/<handle>` would pass the SQL filter but fail this JS
    // re-check, bypassing the mismatch/ownership guard.
    .replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//i, '')
    .split(/[/?#]/)[0];

  if (!trimmed) return null;
  if (!/^[A-Za-z0-9_]{5,32}$/.test(trimmed)) return null;
  return trimmed;
}

export function telegramHandleFromRequest(request: Request): string | null {
  return normalizeTelegramHeader(
    request.headers.get('x-index-telegram-username') ??
    request.headers.get('x-index-telegram-handle'),
  );
}

function telegramHandleFromAuthInput(input: McpAuthInput): string | undefined {
  return normalizeTelegramHeader(input.telegramUsername ?? input.telegramHandle) ?? undefined;
}

function normalizeTelegramHandleForComparison(raw: string): string | null {
  return normalizeTelegramHeader(raw)?.toLowerCase() ?? null;
}

export function findTelegramHandleMismatch(params: {
  userId: string;
  telegramHandle: string;
  authenticatedUserSocials: TelegramSocial[];
  matchingTelegramSocials: TelegramSocial[];
}): TelegramHandleMismatch | null {
  const requested = normalizeTelegramHandleForComparison(params.telegramHandle);
  if (!requested) return null;

  const authenticatedTelegramHandles = params.authenticatedUserSocials
    .filter((social) => social.label === 'telegram')
    .map((social) => normalizeTelegramHandleForComparison(social.value))
    .filter((value): value is string => value !== null);

  if (
    authenticatedTelegramHandles.length > 0 &&
    !authenticatedTelegramHandles.some((handle) => handle === requested)
  ) {
    return { reason: 'authenticated_user_handle_mismatch' };
  }

  const otherOwner = params.matchingTelegramSocials.find((social) => (
    social.userId !== undefined &&
    social.userId !== params.userId &&
    social.label === 'telegram' &&
    normalizeTelegramHandleForComparison(social.value) === requested
  ));

  if (otherOwner?.userId) {
    return { reason: 'handle_belongs_to_other_user', ownerUserId: otherOwner.userId };
  }

  return null;
}

export function resolveMcpApiKeyPrincipal(
  row: ApiKeyPrincipalRow,
  sessionUserId?: string,
): {
  userId: string;
  agentId?: string;
  enrollmentCapable?: boolean;
  isDeliveryAgent?: boolean;
} | null {
  // Check the raw metadata before the canonical MCP schema parses (and strips)
  // unknown fields. Audience is deliberately outside MCP's capability schema.
  if (isHermesNegotiatorAudience(row.metadata)) {
    throw new Error('Hermes negotiator credentials are not accepted by MCP');
  }
  const metadata = parseApiKeyMetadata(row.metadata);

  // Negotiation-only Hermes credentials are REST principals and have no MCP
  // capability profile. Reject them before owner identity resolution can
  // collapse the credential into a broad owner principal.
  // Agent keys must additionally carry BOTH principal columns (the adapter
  // mints them with referenceId === userId); a missing side signals a
  // cross-wired/tampered agent key. Divergence between populated columns is
  // rejected for every key by resolveApiKeyUserId below.
  if (metadata.agentId && (!row.userId || !row.referenceId)) {
    throw new Error('Agent API key principal mismatch');
  }
  if (metadata.isDeliveryAgent && !metadata.agentId) {
    throw new Error('Delivery API key principal mismatch');
  }

  const userId = resolveApiKeyUserId(row, sessionUserId);
  if (!userId) return null;

  return {
    userId,
    ...(metadata.agentId ? { agentId: metadata.agentId } : {}),
    ...(!metadata.agentId && metadata.enrollmentCapable ? { enrollmentCapable: true } : {}),
    ...(metadata.agentId && metadata.isDeliveryAgent ? { isDeliveryAgent: true } : {}),
  };
}

/**
 * Distinguishes Telegram identity verification (infrastructure) failures from
 * auth (token / API-key) failures. A handle that simply belongs to someone
 * else is not one of these: that skips the binding and the request proceeds.
 * The auth resolver's per-path catch blocks
 * reclassify unknown errors (e.g. "API key authentication failed"); rethrowing
 * this type unchanged keeps the client-facing reason accurate and avoids
 * muddling auth alerting.
 */
class TelegramIdentityError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TelegramIdentityError';
  }
}

/**
 * Data access used by Telegram identity binding, injectable so the binding
 * policy can be tested without a database.
 */
export interface TelegramBindingPort {
  getUserSocials(userId: string): Promise<TelegramSocial[]>;
  findTelegramHandleOwners(handle: string): Promise<TelegramSocial[]>;
  setSocials(userId: string, socials: { label: string; value: string }[]): Promise<void>;
}

const defaultTelegramBindingPort: TelegramBindingPort = {
  getUserSocials: (userId) => chatDatabaseAdapter.getUserSocials(userId),
  findTelegramHandleOwners: (handle) => chatDatabaseAdapter.findTelegramHandleOwners(handle),
  setSocials: (userId, socials) => userService.setSocials(userId, socials),
};

export async function finalizeMcpIdentity(
  telegramHandle: string | undefined,
  identity: ResolvedMcpIdentity,
  port: TelegramBindingPort = defaultTelegramBindingPort,
): Promise<ResolvedMcpIdentity> {
  // Telegram identity binding: any client may send the
  // x-index-telegram-username/-handle headers (the Hermes plugin sends one
  // whenever INDEX_TELEGRAM_USERNAME is set), so header presence is only a
  // request to bind, never a claim of identity. Binding is additive and
  // optional: a handle we cannot attribute to the authenticated user is
  // skipped, not rejected.
  if (!telegramHandle) return identity;

  let existingSocials: TelegramSocial[];
  let matchingTelegramSocials: TelegramSocial[];
  try {
    existingSocials = await port.getUserSocials(identity.userId);
    matchingTelegramSocials = await port.findTelegramHandleOwners(telegramHandle);
  } catch (err) {
    logger.warn('Failed to verify Telegram MCP handle', {
      userId: identity.userId,
      telegramHandle,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new TelegramIdentityError('Telegram handle verification failed', { cause: err });
  }

  const mismatch = findTelegramHandleMismatch({
    userId: identity.userId,
    telegramHandle,
    authenticatedUserSocials: existingSocials,
    matchingTelegramSocials,
  });
  if (mismatch) {
    // Non-fatal: the caller is already authenticated as themselves and simply
    // gets no Telegram binding. Failing the request instead would let one
    // misconfigured INDEX_TELEGRAM_USERNAME break every MCP call for a
    // deployment, and skipping the write gives up nothing security-wise.
    logger.warn('Telegram MCP handle mismatch — skipping identity binding', {
      userId: identity.userId,
      telegramHandle,
      reason: mismatch.reason,
      ownerUserId: mismatch.ownerUserId,
    });
    return identity;
  }

  try {
    const merged = mergeTelegramHandleIntoSocials(existingSocials, telegramHandle);
    if (!merged) return identity;

    await port.setSocials(identity.userId, merged);
  } catch (err) {
    logger.warn('Failed to persist Telegram MCP handle', {
      userId: identity.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return identity;
}

const authResolver: McpAuthResolver = {
  async resolveIdentity(input: McpAuthInput): Promise<ResolvedMcpIdentity> {
    if (input.bearerToken) {
      const isJwt = input.bearerToken.split('.').length === 3;

      if (isJwt) {
        // JWT path
        try {
          const { payload } = await jwtVerify(input.bearerToken, JWKS, { issuer: API_URL, audience: JWT_AUDIENCE });
          if (typeof payload.id === 'string') return finalizeMcpIdentity(telegramHandleFromAuthInput(input), { userId: payload.id, isSessionAuth: true, networkScopeId: null });
          if (typeof payload.sub === 'string') return finalizeMcpIdentity(telegramHandleFromAuthInput(input), { userId: payload.sub, isSessionAuth: true, networkScopeId: null });
          throw new Error('JWT payload missing user ID');
        } catch (err) {
          if (err instanceof TelegramIdentityError) throw err;
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
            if (data?.userId) return finalizeMcpIdentity(telegramHandleFromAuthInput(input), { userId: data.userId, isSessionAuth: true, networkScopeId: null });
          }
        } catch (err) {
          if (err instanceof TelegramIdentityError) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`MCP token lookup failed: ${msg}`, { cause: err });
        }
        throw new Error('Invalid or expired access token');
      }
    }

    if (input.apiKey) {
      let sessionUserId: string | undefined;

      try {
        const sessionRes = await fetch(`${API_URL}/api/auth/get-session`, {
          headers: { 'x-api-key': input.apiKey },
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
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.apiKey));
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

          let principal: ReturnType<typeof resolveMcpApiKeyPrincipal>;
          try {
            principal = resolveMcpApiKeyPrincipal(row, sessionUserId);
          } catch (err) {
            logger.warn('API key principal mismatch', {
              keyHashPrefix: hashed.slice(0, 8),
              rowUserId: row.userId,
              referenceId: row.referenceId,
              error: err instanceof Error ? err.message : String(err),
            });
            throw new Error('Invalid API key', { cause: err });
          }

          if (principal) {
            const networkScopeId = principal.agentId
              ? await resolveAgentNetworkScopeById(principal.agentId)
              : null;
            return finalizeMcpIdentity(telegramHandleFromAuthInput(input), {
              userId: principal.userId,
              ...(principal.agentId ? { agentId: principal.agentId } : {}),
              ...(principal.enrollmentCapable ? { enrollmentCapable: true } : {}),
              ...(principal.isDeliveryAgent ? { isDeliveryAgent: true } : {}),
              networkScopeId,
            });
          }
        }

        if (sessionUserId) {
          return finalizeMcpIdentity(telegramHandleFromAuthInput(input), { userId: sessionUserId, networkScopeId: null });
        }
      } catch (err) {
        if (err instanceof TelegramIdentityError) throw err;
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
      telegramHandle: request.headers.get('x-index-telegram-handle') ?? undefined,
      telegramUsername: request.headers.get('x-index-telegram-username') ?? undefined,
    };
    const { userId } = await authResolver.resolveIdentity(input);
    return userId;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHORIZATION OBSERVABILITY (host boundary)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Records MCP capability denials as structured, secret-free authorization audit
 * logs. The protocol constructs the event with only safe caller-profile/reason
 * fields (no token, API key, header, or tool-argument payload), so this seam can
 * log it verbatim. This is standing authorization observability at info level,
 * not debug instrumentation, and it never alters the fail-closed decision.
 */
const mcpAuthorizationObserver: McpAuthorizationObserver = {
  onCapabilityDenied(event) {
    logger.info('MCP capability denied', {
      phase: event.phase,
      toolName: event.toolName,
      profile: event.profile,
      reason: event.reason,
      ...(event.reach ? { reach: event.reach } : {}),
      ...(event.requiredPermissions ? { requiredPermissions: event.requiredPermissions } : {}),
      userId: event.userId,
      ...(event.agentId ? { agentId: event.agentId } : {}),
      networkScopeId: event.networkScopeId,
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PER-REQUEST MCP SERVER CREATION
// ═══════════════════════════════════════════════════════════════════════════════

function createMcpServerInstance(): McpServer {
  const graphs = getOrCompileGraphs();

  const userDb = protocolDeps.createUserDatabase(protocolDeps.database, 'system');
  const systemDb = protocolDeps.createSystemDatabase(protocolDeps.database, 'system', []);

  const toolDeps: McpToolDeps = {
    database: protocolDeps.database,
    userDb,
    systemDb,
    scraper: protocolDeps.scraper,
    embedder: protocolDeps.embedder,
    cache: protocolDeps.cache,
    enricher: protocolDeps.enricher,
    negotiationDatabase: protocolDeps.negotiationDatabase,
    negotiationGraph,
    agentDispatcher: protocolDeps.agentDispatcher,
    // #1471: owner-verdict host behind reject/accept_opportunity (the Radar
    // Skip/Start-Chat path). Registered on the MCP surface only; the
    // capability matrix confines verdicts to session-authenticated owners.
    negotiatorVerdictTools: protocolDeps.negotiatorVerdictTools,
    agentDatabase: protocolDeps.agentDatabase,
    grantDefaultSystemPermissions: protocolDeps.grantDefaultSystemPermissions,
    chatSession: protocolDeps.chatSession,
    chatSummary: protocolDeps.chatSummary,
    negotiationSummary: protocolDeps.negotiationSummary,
    chatMessageWriter: protocolDeps.chatMessageWriter,
    deliveryLedger: protocolDeps.deliveryLedger,
    opportunityOwnerApproval: protocolDeps.opportunityOwnerApproval,
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
    intentProposalStore: protocolDeps.intentProposalStore,
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

  return createMcpServer(
    toolDeps,
    authResolver,
    scopedDepsFactory,
    CANONICAL_MCP_CAPABILITY_POLICY_OPTIONS,
    mcpAuthorizationObserver,
  );
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
