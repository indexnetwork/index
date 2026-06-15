/**
 * MCP HTTP Handler — wires the MCP server factory to the Streamable HTTP transport.
 * This is the composition root: all adapter/service wiring lives here.
 */

import { jwtVerify, createRemoteJWKSet } from 'jose';
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

import { cacheAdapter, hydeCacheAdapter } from '../adapters/cache.adapter';
import { agentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { ComposioIntegrationAdapter } from '../adapters/integration.adapter';
import { chatDatabaseAdapter, conversationDatabaseAdapter, ChatDatabaseAdapter, createUserDatabase, createSystemDatabase } from '../adapters/database.adapter';
import { embedderAdapter } from '../adapters/embedder.adapter';
import { scraperAdapter } from '../adapters/scraper.adapter';
import { intentQueue } from '../queues/intent.queue';
import { negotiationRunExistingQueue } from '../queues/negotiations/run-existing.queue';
import { chatSessionAdapter } from '../adapters/chat-session.adapter';
import { ChatSummaryDatabaseAdapter } from '../adapters/chat-summary.database.adapter';
import { ChatMessageWriterAdapter } from '../adapters/chat-message-writer.adapter';
import { enricherAdapter } from '../adapters/enricher.adapter';
import { QuestionerAdapter } from '../adapters/questioner.adapter';
import { questionerQueue } from '../queues/questioner.queue';
import { checkMcpRateLimit } from '../lib/limiter/mcp';
import { discoveryRunAdapter } from '../adapters/discovery-run.adapter';
import { profileRunAdapter } from '../adapters/profile-run.adapter';
import { discoveryRunQueue } from '../queues/opportunity/discovery-run.queue';
import { profileRunQueue } from '../queues/profile-run.queue';
import db from '../lib/drizzle/drizzle';
import { resolveApiKeyUserId } from '../lib/apikey/principal';
import { agentService } from '../services/agent.service';
import { chatSessionService } from '../services/chat.service';
import { ChatSummaryService } from '../services/chat-summary.service';
import { QuestionGeneratorService } from '../services/question-generator.service';
import { NegotiationSummaryService } from '../services/negotiation-summary.service';
import { AgentDispatcherImpl } from '../services/agent-dispatcher.service';
import { contactService } from '../services/contact.service';
import { IntegrationService } from '../services/integration.service';
import { opportunityDeliveryService } from '../services/opportunity-delivery.service';
import { userService } from '../services/user.service';
import { negotiationTimeoutQueue } from '../queues/negotiations/timeout.queue';
import { signConnectToken } from '../services/connect-token.service';
import type { ConnectLinkKind } from '../services/connect-link.service';
import { mintConnectLink as mintConnectLinkSvc, buildConnectShortUrl } from '../services/connect-link.service';
import { resolveProtocolBaseUrl } from '../lib/protocol-url';

import { IntentGraphFactory, ProfileGraphFactory, OpportunityGraphFactory, HydeGraphFactory, NetworkGraphFactory, NetworkMembershipGraphFactory, IntentNetworkGraphFactory, NegotiationGraphFactory, HydeGenerator, LensInferrer, IntentIndexer, createMcpServer, ChatGraphFactory, PremiseGraphFactory } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, PremiseGraphDatabase, ToolDeps, McpAuthResolver, ScopedDepsFactory, Embedder, ChatGraphCompositeDatabase, QuestionerEnqueuePayload, PendingQuestionSummary, McpAuthInput } from '@indexnetwork/protocol';

import { BASE_URL, JWT_AUDIENCE } from '../lib/betterauth/betterauth';
import { log } from '../lib/log';
import { captureAppException } from '../lib/sentry';
import { mergeTelegramHandleIntoSocials } from '../lib/telegram/socials';
import { resolveAgentNetworkScopeById } from '../guards/agent-scope.guard';
import { PremiseEvents } from '../events/premise.event';

const logger = log.server.from('mcp');

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITION ROOT (was protocol-init.ts)
// ═══════════════════════════════════════════════════════════════════════════════

const integration = new ComposioIntegrationAdapter();
const chatSummaryAdapter = new ChatSummaryDatabaseAdapter();
const chatSummaryService = new ChatSummaryService(chatSummaryAdapter);
const questionGeneratorService = new QuestionGeneratorService();
const questionerAdapter = new QuestionerAdapter(db);
const negotiationSummaryService = new NegotiationSummaryService();
const integrationImporter = new IntegrationService(integration, contactService);
const agentDispatcher = new AgentDispatcherImpl(agentService, negotiationTimeoutQueue);

const apiBaseUrl = resolveProtocolBaseUrl();

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
  negotiationSummary: negotiationSummaryService,
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
  discoveryRuns: discoveryRunAdapter,
  discoveryRunQueue,
  profileRuns: profileRunAdapter,
  profileRunQueue,
  negotiationTimeoutQueue,
  queueNegotiateExisting: async (opportunityId: string, userId: string): Promise<void> => {
    await negotiationRunExistingQueue.addJob({ opportunityId, userId });
  },
  mintConnectToken: signConnectToken,
  mintConnectLink,
  frontendUrl: process.env.FRONTEND_URL ?? process.env.APP_URL ?? 'https://index.network',
  apiBaseUrl,
  questionerDatabase: questionerAdapter,
  ...(process.env.QUESTIONER_ENABLED === 'true' && {
    questionerEnqueue: async (input: QuestionerEnqueuePayload) => {
      await questionerQueue.addGenerateJob(input);
    },
  }),
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
  const qEnqueue = protocolDeps.questionerEnqueue;
  const intentGraph = new IntentGraphFactory(database, embedder, protocolDeps.intentQueue, qEnqueue).createGraph();
  const premiseGraph = new PremiseGraphFactory(database as unknown as PremiseGraphDatabase, embedder).createGraph();
  const profileGraph = new ProfileGraphFactory(database, scraper, protocolDeps.enricher, qEnqueue, premiseGraph).createGraph();
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
    qEnqueue,
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
    premise: premiseGraph,
  };

  return compiledGraphs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

const JWKS = createRemoteJWKSet(
  new URL('/api/auth/jwks', BASE_URL),
);

export function parseApiKeyMetadata(raw: string | null | undefined): { agentId?: string } {
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

type ResolvedMcpIdentity = {
  userId: string;
  agentId?: string;
  isSessionAuth?: boolean;
  networkScopeId?: string | null;
  clientSurface?: 'telegram' | 'web';
};

function normalizeTelegramHeader(raw: string | null | undefined): string | null {
  const trimmed = raw
    ?.trim()
    .replace(/^@/, '')
    // Case-insensitive to match the SQL normalization in
    // ProfileDatabaseAdapter.findTelegramHandleOwners; otherwise a stored
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
): { userId: string; agentId?: string } | null {
  const metadata = parseApiKeyMetadata(row.metadata);

  // Agent keys must additionally carry BOTH principal columns (the adapter
  // mints them with referenceId === userId); a missing side signals a
  // cross-wired/tampered agent key. Divergence between populated columns is
  // rejected for every key by resolveApiKeyUserId below.
  if (metadata.agentId && (!row.userId || !row.referenceId)) {
    throw new Error('Agent API key principal mismatch');
  }

  const userId = resolveApiKeyUserId(row, sessionUserId);
  if (!userId) return null;

  return {
    userId,
    ...(metadata.agentId ? { agentId: metadata.agentId } : {}),
  };
}

/**
 * Distinguishes Telegram identity verification/mismatch failures from auth
 * (token / API-key) failures. The auth resolver's per-path catch blocks
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

async function finalizeMcpIdentity(telegramHandle: string | undefined, identity: ResolvedMcpIdentity): Promise<ResolvedMcpIdentity> {
  if (identity.clientSurface !== 'telegram' || !telegramHandle) return identity;

  let existingSocials: TelegramSocial[];
  let matchingTelegramSocials: TelegramSocial[];
  try {
    existingSocials = await chatDatabaseAdapter.getUserSocials(identity.userId);
    matchingTelegramSocials = await chatDatabaseAdapter.findTelegramHandleOwners(telegramHandle);
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
    logger.warn('Telegram MCP handle mismatch', {
      userId: identity.userId,
      telegramHandle,
      reason: mismatch.reason,
      ownerUserId: mismatch.ownerUserId,
    });
    throw new TelegramIdentityError('Telegram handle does not match authenticated user');
  }

  try {
    const merged = mergeTelegramHandleIntoSocials(existingSocials, telegramHandle);
    if (!merged) return identity;

    await userService.setSocials(identity.userId, merged);
  } catch (err) {
    logger.warn('Failed to persist Telegram MCP handle', {
      userId: identity.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return identity;
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
    logger.warn('Unknown x-index-surface value; coercing to web', {
      value: normalized,
    });
  }
  return 'web';
}

const authResolver: McpAuthResolver = {
  async resolveIdentity(input: McpAuthInput): Promise<ResolvedMcpIdentity> {
    const clientSurface = input.clientSurface ?? 'web';

    if (input.bearerToken) {
      const isJwt = input.bearerToken.split('.').length === 3;

      if (isJwt) {
        // JWT path
        try {
          const { payload } = await jwtVerify(input.bearerToken, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE });
          if (typeof payload.id === 'string') return finalizeMcpIdentity(telegramHandleFromAuthInput(input), { userId: payload.id, isSessionAuth: true, networkScopeId: null, clientSurface });
          if (typeof payload.sub === 'string') return finalizeMcpIdentity(telegramHandleFromAuthInput(input), { userId: payload.sub, isSessionAuth: true, networkScopeId: null, clientSurface });
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
          const res = await fetch(`${BASE_URL}/api/auth/mcp/get-session`, {
            headers: { Authorization: `Bearer ${input.bearerToken}` },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = await res.json() as { userId?: string } | null;
            if (data?.userId) return finalizeMcpIdentity(telegramHandleFromAuthInput(input), { userId: data.userId, isSessionAuth: true, networkScopeId: null, clientSurface });
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
        const sessionRes = await fetch(`${BASE_URL}/api/auth/get-session`, {
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

          let principal: { userId: string; agentId?: string } | null;
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
              networkScopeId,
              clientSurface,
            });
          }
        }

        if (sessionUserId) {
          return finalizeMcpIdentity(telegramHandleFromAuthInput(input), { userId: sessionUserId, networkScopeId: null, clientSurface });
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
      clientSurface: request.headers.get('x-index-surface')?.trim().toLowerCase() === 'telegram' ? 'telegram' : 'web',
      telegramHandle: request.headers.get('x-index-telegram-handle') ?? undefined,
      telegramUsername: request.headers.get('x-index-telegram-username') ?? undefined,
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
    negotiationSummary: protocolDeps.negotiationSummary,
    questionGenerator: protocolDeps.questionGenerator,
    chatMessageWriter: protocolDeps.chatMessageWriter,
    deliveryLedger: protocolDeps.deliveryLedger,
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
    discoveryRuns: protocolDeps.discoveryRuns,
    discoveryRunQueue: protocolDeps.discoveryRunQueue,
    profileRuns: protocolDeps.profileRuns,
    profileRunQueue: protocolDeps.profileRunQueue,
    mintConnectToken: protocolDeps.mintConnectToken,
    mintConnectLink: protocolDeps.mintConnectLink,
    frontendUrl: protocolDeps.frontendUrl,
    apiBaseUrl: protocolDeps.apiBaseUrl,
    ...(protocolDeps.questionerEnqueue && { questionerEnqueue: protocolDeps.questionerEnqueue }),
    findPendingQuestions: async (
      userId: string,
      filters?: {
        sourceType?: string;
        sourceId?: string;
        modes?: Array<'discovery' | 'intent' | 'profile' | 'negotiation'>;
        limit?: number;
      },
    ) => {
      const rows = await questionerAdapter.findPending(userId, filters);
      return rows.map((row): PendingQuestionSummary => ({
        id: row.id,
        title: row.payload.title,
        prompt: row.payload.prompt,
        options: row.payload.options,
        multiSelect: row.payload.multiSelect,
        mode: row.detection.mode,
        sourceType: row.detection.sourceType,
        sourceId: row.detection.sourceId,
        createdAt: row.createdAt,
        ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
      }));
    },
    premiseEvents: {
      onCreated: (premiseId, userId) => PremiseEvents.onCreated(premiseId, userId),
      onUpdated: (premiseId, userId) => PremiseEvents.onUpdated(premiseId, userId),
      onRetracted: (premiseId, userId) => PremiseEvents.onRetracted(premiseId, userId),
    },
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

  return createMcpServer(toolDeps, authResolver, scopedDepsFactory);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSPORT (created per request to isolate stream mappings)
// ═══════════════════════════════════════════════════════════════════════════════

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
async function createPerRequestTransport(): Promise<WebStandardStreamableHTTPServerTransport> {
  const server = createMcpServerInstance();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_MCP_MAX_REQUEST_BYTES = 1_000_000;

function getMcpMaxRequestBytes(): number {
  const parsed = Number.parseInt(process.env.MCP_MAX_REQUEST_BYTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MCP_MAX_REQUEST_BYTES;
}

function requestTooLargeResponse(maxRequestBytes: number, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: `MCP request too large. Max ${maxRequestBytes} bytes.` }),
    { status: 413, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}

async function enforceMcpRequestSize(
  req: Request,
  maxRequestBytes: number,
  corsHeaders: Record<string, string>,
): Promise<Request | Response> {
  const contentLength = req.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > maxRequestBytes) {
    return requestTooLargeResponse(maxRequestBytes, corsHeaders);
  }

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
  const maxRequestBytes = getMcpMaxRequestBytes();
  const sizeCheckedRequest = await enforceMcpRequestSize(req, maxRequestBytes, corsHeaders);
  if (sizeCheckedRequest instanceof Response) return sizeCheckedRequest;
  req = sizeCheckedRequest;

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

  let transport: WebStandardStreamableHTTPServerTransport | undefined;
  try {
    transport = await createPerRequestTransport();
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
  } finally {
    // Close the per-request transport to release accumulated state and prevent memory leaks
    if (transport) {
      await transport.close().catch(() => {});
    }
  }
}
