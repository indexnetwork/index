import './startup.env';

import * as Sentry from '@sentry/bun';

import { ChatController } from './controllers/chat.controller';
import { DebugController } from './controllers/debug.controller';
import { ToolController } from './controllers/tool.controller';
import { ToolService } from './services/tool.service';
import { S3StorageAdapter } from './adapters/storage.adapter';
import { NetworkController } from './controllers/network.controller';
import { NetworkRequestController } from './controllers/network-request.controller';
import { IntentController } from './controllers/intent.controller';
import { IntentIntakeController } from './controllers/intent-intake.controller';
import { OpportunityController, NetworkOpportunityController } from './controllers/opportunity.controller';
import { ConnectLinkController } from './controllers/connect-link.controller';
import { AuthController } from './controllers/auth.controller';
import { EnrichmentController } from './controllers/enrichment.controller';
import { UserController } from './controllers/user.controller';
import { StorageController } from './controllers/storage.controller';
import { StorageService } from './services/storage.service';
import { SubscribeController } from './controllers/subscribe.controller';
import { fileService } from './services/file.service';
import { ConversationController } from './controllers/conversation.controller';
import { NotificationController } from './controllers/notification.controller';
import { AgentController } from './controllers/agent.controller';
import { AgentRuntimeController } from './controllers/agent-runtime.controller';
import { ConnectedAgentsController } from './controllers/connected-agents.controller';
import { ConversationService } from './services/conversation.service';
import { NotificationService } from './services/notification.service';
import { NotificationDeliveryService, loadNotificationIntentLabel } from './services/notification-delivery.service';
import { TaskService } from './services/task.service';
import { IntegrationController } from './controllers/integration.controller';
import { WebhooksController } from './controllers/webhooks.controller';
import { QuestionController } from './controllers/question.controller';
import { ComposioIntegrationAdapter } from './adapters/integration.adapter';
import { IntegrationService } from './services/integration.service';
import { contactService } from './services/contact.service';
import { RouteRegistry } from './lib/router/router.decorators';
import { ScopeViolationError } from './guards/agent-scope.guard';
import { HermesNegotiatorRouteDeniedError, OwnerControlRequiredError, SessionRequiredError } from './guards/auth.guard';
import { RateLimiterError } from './lib/limiter/error';
import { getRateLimitInfo } from './guards/limiter.guard';
import { bindLimiterServer } from './lib/limiter/identifier';
import { log, sanitizeForLog } from './lib/log';
import { getCorsHeaders } from './lib/cors';
import { captureAppException } from './lib/sentry';
import { setSpanAttributes, setSpanHttpStatus, traceAppOperation } from './lib/sentry-performance';
import { adminQueuesApp } from './controllers/queues.controller';
import { mcpHandler, chatFactory } from './controllers/mcp.controller';
import { chatSessionService } from './services/chat.service';
import { auth } from './lib/betterauth/auth.instance';
// Bootstrap queue workers and HyDE crons (only in this process, not in CLI e.g. db:seed)
import { intentQueue } from './queues/intent.queue';
import { fromIntentQueue } from './queues/opportunity/from-intent.queue';
import { fromIntroducerQueue } from './queues/opportunity/from-introducer.queue';
import { fromEnrichmentQueue } from './queues/opportunity/from-enrichment.queue';
import { enrichmentRunQueue } from './queues/enrichment-run.queue';
import { negotiationRunExistingQueue } from './queues/negotiations/run-existing.queue';
import { negotiationWatchdogQueue, isNegotiationWatchdogEnabled } from './queues/negotiations/watchdog.queue';
import { opportunityExpirationCron } from './queues/opportunity/expiration.queue';
import { checkpointRetentionCron } from './queues/checkpoint/retention.queue';
import { frameDriftQueue } from './queues/frame-drift.queue';
import { getCheckpointer } from './adapters/checkpointer.adapter';
import { notificationQueue } from './queues/notification.queue';
import { hydeQueue } from './queues/hyde.queue';
import { emailQueue } from './queues/email.queue';
import { enrichmentQueue } from './queues/enrichment.queue';
import { negotiationTimeoutQueue } from './queues/negotiations/timeout.queue';
import { negotiationClaimTimeoutQueue } from './queues/negotiations/claim-timeout.queue';
import { RedisTimeoutUpgradeLease, TimeoutUpgradeReconciler } from './lib/negotiation/timeout-upgrade-reconciliation';
import { getRedisClient } from './adapters/cache.adapter';
import { negotiationReflectQueue, reflectEnqueueIfEnabled } from './queues/negotiations/reflect.queue';
import { negotiatorMemoryRetrieve } from './adapters/negotiator-memory.retrieval.adapter';
import { negotiatorClientDmRetrieve } from './adapters/negotiator-client-dm.retrieval.adapter';
import { negotiatorMemoryWriteService } from './services/negotiator-memory.service';
import { questionerQueue, questionerEnqueueIfEnabled } from './queues/questioner.queue';
import { questionMessageQueue } from './queues/question-message.queue';
import { NetworkMembershipEvents } from './events/network_membership.event';
import { handleIntentCreatedMaintenance, IntentEvents, intentResumeDiscoveryJobId } from './events/intent.event';
import { PremiseEvents } from './events/premise.event';
import { QuestionEvents } from './events/question.event';
import { OpportunityEvents } from './events/opportunity.event';
import { evaluateOpportunityTransition } from './lib/question/question-exhaustion.evaluator';
import { handleQuestionAnswered } from './events/handlers/question.answer.handler';
import { emitChatQuestionResolution } from './lib/chat-question.events';
import { createPremiseFromAnswerFactory } from './events/handlers/question.answer.enrichment';
import { resumeInflightNegotiationFactory } from './events/handlers/question.answer.negotiation-inflight';
import { QuestionerAdapter } from './adapters/questioner.adapter';
import { questionerAdapter } from './adapters/questioner.adapter.instance';
import { OpportunityDatabaseAdapter } from './adapters/opportunity.database.adapter';
import db from './lib/drizzle/drizzle';
import { premiseQueue } from './queues/premise.queue';
import { userContextQueue } from './queues/usercontext.queue';
import { init as initTelegramGateway } from './gateways/telegram.gateway';
import { setWebhook } from './lib/telegram/bot-api';
import { opportunityService } from './services/opportunity.service';
import { AMBIENT_PARK_WINDOW_MS, Intents, NegotiationGraphFactory, PremiseGraphFactory, setLoggerFactory, setTimingWrapper, isQuestionerEnabled } from '@indexnetwork/protocol';
import type { PremiseGraphDatabase } from '@indexnetwork/protocol';
import { conversationDatabaseAdapter, chatDatabaseAdapter } from './adapters/database.adapter';
import { embedderAdapter } from './adapters/embedder.adapter';
import { agentService } from './services/agent.service';
import { intentService } from './services/intent.service';
import { userService } from './services/user.service';
import { AgentDispatcherImpl } from './services/agent-dispatcher.service';
import { publishNotificationStreamEvent } from './lib/notification-stream-events';

// Wire the protocol library's logging into the rich API logger (context colors,
// emoji, LOG_FILTER/LOG_LEVEL, Sentry, embedding redaction + payload truncation).
// Protocol loggers are late-bound, so this upgrades loggers created at import time too.
setLoggerFactory(
  (context, source) => log.withContext(context as Parameters<typeof log.withContext>[0], source),
  sanitizeForLog,
);

// Wire ChatGraphFactory into chat service at startup
chatSessionService.setFactory(chatFactory);

setTimingWrapper((name, fn) => traceAppOperation(
  {
    name,
    op: 'protocol.phase',
    attributes: {
      subsystem: 'protocol',
      'code.function': name,
    },
  },
  fn,
));

// Wire negotiation into background discovery so the post-assignment HyDE path
// negotiates latent opportunities consistently with chat/MCP discovery.
// Without this, OpportunityGraph's negotiateNode short-circuits and every evaluated
// candidate is persisted unfiltered.
const backgroundAgentDispatcher = new AgentDispatcherImpl(agentService, negotiationTimeoutQueue);
const backgroundNegotiationGraph = new NegotiationGraphFactory(
  conversationDatabaseAdapter as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0],
  backgroundAgentDispatcher,
  negotiationTimeoutQueue,
  // Stalled/capped/timeout negotiations enqueue follow-up questions for the
  // source user (mode='negotiation', sourceType='opportunity') so the intent
  // page can surface what would unblock the next attempt.
  questionerEnqueueIfEnabled(),
  // Finished negotiations enqueue memory distillation for both sides (P5.2,
  // gated on NEGOTIATOR_MEMORY_WRITE_ENABLED).
  reflectEnqueueIfEnabled(),
  // Screen/turn prompts read the speaker's own negotiator memories (P5.3,
  // gated on NEGOTIATOR_MEMORY_INJECT).
  negotiatorMemoryRetrieve(),
  // The acting user's own negotiator DM for this signal (A2H read path,
  // gated on NEGOTIATOR_CLIENT_DM_INJECT). System-agent grounding only.
  negotiatorClientDmRetrieve(),
).createGraph();
fromIntentQueue.setRuntimeDeps({
  negotiationGraph: backgroundNegotiationGraph,
  agentDispatcher: backgroundAgentDispatcher,
});
fromIntroducerQueue.setRuntimeDeps({
  negotiationGraph: backgroundNegotiationGraph,
  agentDispatcher: backgroundAgentDispatcher,
});
fromEnrichmentQueue.setRuntimeDeps({
  negotiationGraph: backgroundNegotiationGraph,
  agentDispatcher: backgroundAgentDispatcher,
});
negotiationRunExistingQueue.setRuntimeDeps({
  negotiationGraph: backgroundNegotiationGraph,
  agentDispatcher: backgroundAgentDispatcher,
});

const notificationOpportunityAdapter = new OpportunityDatabaseAdapter();
const notificationDeliveryService = new NotificationDeliveryService({
  questioner: questionerAdapter,
  opportunities: notificationOpportunityAdapter,
  getIdentity: (userId) => notificationOpportunityAdapter.getProfile(userId),
  getIntentLabel: loadNotificationIntentLabel,
  publish: publishNotificationStreamEvent,
});

// Assign callbacks before starting workers to avoid a race with jobs already in Redis.
OpportunityEvents.onActionable = (payload) => notificationDeliveryService.publishOpportunityActionable(payload);
// Exhaustion evaluator (conversational questions): every committed status
// transition re-checks both sides' question-messages against the parked set.
OpportunityEvents.onTransition = ({ opportunity }) =>
  evaluateOpportunityTransition({ opportunityId: opportunity.id, status: opportunity.status });
QuestionEvents.onCreated = (payload) => { void notificationDeliveryService.publishQuestionCreated(payload); };

NetworkMembershipEvents.onMemberAdded = (userId: string, networkId: string) => {
  enrichmentQueue.addEnsureProfileHydeJob({ userId, networkId, reason: 'network_membership' }).catch((err) => {
    log.job.from('NetworkMembership').error('Failed to enqueue ensure_profile_hyde', { userId, networkId, error: err });
  });
  // Regenerate per-network user contexts so the newly joined network gets one.
  // Without this, a user whose premises predate the membership never gets a
  // context for this network (regen only fired on enrichment/premise changes).
  // No-op for users with zero active premises; the premiseHash short-circuit
  // skips networks whose context is already fresh.
  userContextQueue.addRegenJob({ userId, reason: 'network_membership' }).catch((err) => {
    log.job.from('NetworkMembership').error('Failed to enqueue context regen', { userId, networkId, error: err });
  });
  // Re-evaluate the member's pre-existing intents against the joined network.
  // Intents created before joining never get an assignment pass for this network
  // otherwise, leaving them silently absent from it. Assignment-only (no HyDE
  // regen / opportunity discovery); scoped to this network.
  intentQueue.addNetworkReconcileForUser(userId, networkId).catch((err) => {
    log.job.from('NetworkMembership').error('Failed to enqueue intent network reconcile', { userId, networkId, error: err });
  });
};

enrichmentQueue.onEnrichmentComplete = (userId: string) => {
  userContextQueue.addRegenJob({ userId, reason: 'enrichment_complete' })
    .catch(err => log.job.from('UserContext').error('Failed to enqueue context regen after enrichment', { userId, error: err }));

  // KNOWN RESIDUAL: profile-based discovery runs unscoped (no networkId), so for
  // a user who belongs to more than one network it can still surface matches across
  // all of them — the same cross-network leak fixed for intent-triggered discovery.
  // Enrichment completion carries no network/agent context, so scoping this needs a
  // separate design (derive scope from the user's network-scoped agent, or thread a
  // scope through the enrichment pipeline). fromEnrichmentQueue already accepts networkId.
  fromEnrichmentQueue.addJob(
    { userId },
    { priority: 20, jobId: `profile-discovery-${userId}-${Math.floor(Date.now() / (6 * 60 * 60 * 1000))}` },
  ).catch((err) => log.job.from('ProfileEnrichment').error('Failed to enqueue profile-based discovery', { userId, error: err }));
};

PremiseEvents.onCreated = (premiseId: string, userId: string) => {
  log.job.from('PremiseEvents').verbose('Premise created, triggering profile regen', { premiseId, userId });
  premiseQueue.addProfileRegenJob({ userId, trigger: 'premise_created' })
    .catch(err => log.job.from('PremiseEvents').error('Failed to enqueue profile regen', { premiseId, userId, error: err }));
};

PremiseEvents.onUpdated = (premiseId: string, userId: string) => {
  log.job.from('PremiseEvents').verbose('Premise updated, triggering profile regen', { premiseId, userId });
  premiseQueue.addProfileRegenJob({ userId, trigger: 'premise_updated' })
    .catch(err => log.job.from('PremiseEvents').error('Failed to enqueue profile regen', { premiseId, userId, error: err }));
};

PremiseEvents.onRetracted = (premiseId: string, userId: string) => {
  log.job.from('PremiseEvents').verbose('Premise retracted, triggering cascade + regen', { premiseId, userId });
  premiseQueue.addCascadeJob({ premiseId, userId, event: 'retracted' })
    .catch(err => log.job.from('PremiseEvents').error('Failed to enqueue cascade', { premiseId, userId, error: err }));
  premiseQueue.addProfileRegenJob({ userId, trigger: 'premise_retracted' })
    .catch(err => log.job.from('PremiseEvents').error('Failed to enqueue profile regen', { premiseId, userId, error: err }));
};

PremiseEvents.onExpired = (premiseId: string, userId: string) => {
  log.job.from('PremiseEvents').verbose('Premise expired, triggering cascade + regen', { premiseId, userId });
  premiseQueue.addCascadeJob({ premiseId, userId, event: 'expired' })
    .catch(err => log.job.from('PremiseEvents').error('Failed to enqueue cascade', { premiseId, userId, error: err }));
  premiseQueue.addProfileRegenJob({ userId, trigger: 'premise_expired' })
    .catch(err => log.job.from('PremiseEvents').error('Failed to enqueue profile regen', { premiseId, userId, error: err }));
};

// ─── Question answer reaction handlers ──────────────────────────────────────

const profileAnswerPremiseDatabase: PremiseGraphDatabase = chatDatabaseAdapter;
const profileAnswerPremiseGraph = new PremiseGraphFactory(
  profileAnswerPremiseDatabase,
  embedderAdapter,
).createGraph();

const answerQuestionerAdapter = new QuestionerAdapter(db);

const questionAnswerDeps = {
  createPremiseFromAnswer: createPremiseFromAnswerFactory({
    runPremiseLifecycle: async (input) => profileAnswerPremiseGraph.invoke(input),
    emitPremiseCreated: (premiseId, userId) => PremiseEvents.onCreated(premiseId, userId),
  }),
  resumeInflightNegotiation: resumeInflightNegotiationFactory({
    enqueueResume: async (input) => {
      await negotiationRunExistingQueue.addJob(input);
    },
    // P5.2: the answer is already a distilled disclosure policy — record it
    // as a negotiator memory (no-op while NEGOTIATOR_MEMORY_WRITE_ENABLED is off).
    recordDisclosureRule: async ({ userId, questionId, selectedOptions, freeText }) => {
      const question = await answerQuestionerAdapter.getById(questionId).catch(() => null);
      await negotiatorMemoryWriteService.recordDisclosureRuleFromAnswer({
        userId,
        questionId,
        ...(question?.payload.prompt && { questionPrompt: question.payload.prompt }),
        selectedOptions,
        ...(freeText !== undefined && { freeText }),
      });
    },
  }),
  resolveChatQuestionWait: ({ questionId, answer }: {
    questionId: string;
    answer: { selectedOptions: string[]; freeText?: string; answeredBy: string; answeredAt: string };
  }) => {
    emitChatQuestionResolution({ questionId, status: 'answered', answer });
  },
};

QuestionEvents.onAnswered = async (payload) => {
  await handleQuestionAnswered(payload, questionAnswerDeps);
};

// Chat dismissals unblock the waiting turn. An authoritative inflight
// dismissal has already conservatively closed exactly its stamped task at the
// adapter boundary; post-commit work enqueues the deterministic continuation
// while the original timer remains the durable recovery sweep.
QuestionEvents.onDismissed = async (payload) => {
  if (payload.mode === 'chat') {
    emitChatQuestionResolution({ questionId: payload.questionId, status: 'dismissed' });
    return;
  }
  if (
    payload.mode === 'negotiation_inflight'
    && payload.settlement?.authoritative
    && payload.settlement.resumeClaimed
    && payload.settlement.taskId
    && payload.settlement.settlementId
  ) {
    await questionAnswerDeps.resumeInflightNegotiation({
      userId: payload.userId,
      opportunityId: payload.settlement.opportunityId,
      questionId: payload.questionId,
      selectedOptions: [],
      taskId: payload.settlement.taskId,
      settlementId: payload.settlement.settlementId,
      recipientIntentId: payload.settlement.recipientIntentId,
      networkId: payload.settlement.networkId,
    });
  }
};

intentQueue.startWorker();
fromIntentQueue.startWorker();
fromIntroducerQueue.startWorker();
fromEnrichmentQueue.startWorker();
enrichmentRunQueue.startWorker();
negotiationRunExistingQueue.startWorker();
if (isNegotiationWatchdogEnabled()) {
  void negotiationWatchdogQueue.start().catch((error) => {
    log.queue.from('NegotiationWatchdogQueue').error('Negotiation watchdog startup failed', { error });
  });
}
opportunityExpirationCron.start();
checkpointRetentionCron.start();
void frameDriftQueue.start().catch((error) => {
  log.queue.from('FrameDriftQueue').error('Frame-drift queue startup failed', {
    event: 'frame_drift_monitoring_startup_failed',
    error,
  });
});
notificationQueue.startWorker();
enrichmentQueue.startWorker();
hydeQueue.startCrons();
emailQueue.startWorker();
// Upgrade legacy park/claim rows before either timeout worker can consume an
// old generation-less delayed payload. The database stamps a durable install
// outbox under row lock; deterministic Bull IDs make rolling-start delivery
// concurrent and crash-safe. Refuse to start these workers if the explicitly
// bounded sweep did not drain, rather than processing only part of the legacy
// cohort unsafely.
const timeoutUpgrade = new TimeoutUpgradeReconciler(
  conversationDatabaseAdapter,
  {
    enqueueOrdinary: (...args) => negotiationTimeoutQueue.enqueueTimeout(...args),
    enqueueClaim: (...args) => negotiationClaimTimeoutQueue.enqueueTimeout(...args),
  },
  new RedisTimeoutUpgradeLease(getRedisClient()),
);
const timeoutUpgradeResult = await timeoutUpgrade.reconcile({
  parkWindowMs: AMBIENT_PARK_WINDOW_MS,
  batchSize: 100,
  maxBatches: 100,
});
if (!timeoutUpgradeResult.exhausted) {
  throw new Error('Negotiation timeout upgrade reconciliation exceeded its bounded startup budget');
}
log.queue.from('NegotiationTimeoutUpgrade').info('Timeout upgrade reconciliation complete', { ...timeoutUpgradeResult });
negotiationTimeoutQueue.startWorker();
negotiationClaimTimeoutQueue.startWorker();
negotiationReflectQueue.startWorker();
negotiationReflectQueue.startCrons();
if (isQuestionerEnabled()) {
  questionerQueue.startWorker();
}
questionMessageQueue.startWorker();
premiseQueue.startWorker();
userContextQueue.startWorker();
premiseQueue.startCrons();

IntentEvents.onCreated = (intentId: string, userId: string) => {
  // IntentQueue owns the authoritative discovery trigger: it assigns networks,
  // generates HyDE, then awaits one from-intent enqueue. Starting here races the
  // assignment transaction and produces a misleading successful fail-closed run.
  log.job.from('IntentEvents').verbose('Intent created, triggering maintenance', { intentId, userId });
  handleIntentCreatedMaintenance(
    intentId,
    userId,
    (ownerUserId, reason) => opportunityService.triggerMaintenance(ownerUserId, reason),
  );
};

IntentEvents.onPaused = (intentId: string, userId: string, lifecycleVersionMs: number) => {
  log.job.from('IntentEvents').verbose('Intent paused', { intentId, userId, lifecycleVersionMs });
};

IntentEvents.onResumed = async (intentId: string, userId: string, lifecycleVersionMs: number) => {
  log.job.from('IntentEvents').verbose('Intent resumed, triggering discovery', {
    intentId,
    userId,
    lifecycleVersionMs,
  });
  await fromIntentQueue.addJob(
    { intentId, userId, trigger: 'intent_resume' },
    {
      priority: 10,
      jobId: intentResumeDiscoveryJobId(userId, intentId, lifecycleVersionMs),
    },
  );
};

IntentEvents.onArchived = (intentId: string, userId: string) => {
  log.job.from('IntentEvents').verbose('Intent archived, triggering maintenance', { intentId, userId });
  opportunityService.triggerMaintenance(userId, 'intent-archived');
};

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const GLOBAL_PREFIX = '/api';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const logger = log.server.from("main");

// Warm up the PostgresSaver checkpointer at boot so the first chat request
// doesn't pay the table-setup round trip and misconfiguration surfaces at
// startup instead of mid-stream. Non-fatal: chat degrades to no checkpointer.
getCheckpointer().catch((err) => {
  logger.warn('Checkpointer warm-up failed; chat will run without persistence', {
    error: err instanceof Error ? err.message : String(err),
  });
});

// ── Telegram bot startup ────────────────────────────────────────────────────
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET) {
  const webhookBase = process.env.TELEGRAM_WEBHOOK_URL ?? process.env.API_URL ?? '';
  const webhookUrl = `${webhookBase.replace(/\/$/, '')}/api/webhooks/telegram`;
  setWebhook(webhookUrl, process.env.TELEGRAM_WEBHOOK_SECRET).catch((err) => {
    logger.error('Failed to register Telegram webhook on startup', { error: err });
  });
  initTelegramGateway();
  logger.info('Telegram bot gateway initialised', { webhookUrl });
}

/** Match pathname against a route pattern with :param placeholders; returns params or null. */
function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const paramNames: string[] = [];
  const regexStr = pattern.replace(/\/+/g, '/').replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  const regex = new RegExp(`^${regexStr}$`);
  const m = pathname.match(regex);
  if (!m) return null;
  const params: Record<string, string> = {};
  paramNames.forEach((name, i) => {
    params[name] = m[i + 1] ?? '';
  });
  return params;
}

logger.info('Initializing Server...');

// Manually instantiate controllers if needed, or just let strict import handle registration (depends on how decorator works vs instantiation).
// The decorators run when the class is defined (imported).
// However, to invoke methods, we need instances.
if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
  logger.error('Missing required S3 env vars: S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
  process.exit(1);
}

const storageAdapter = new S3StorageAdapter({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  bucket: process.env.S3_BUCKET,
});

// Set storage adapter on fileService for S3 file operations
fileService.setStorageAdapter(storageAdapter);

const controllerInstances = new Map();
controllerInstances.set(AuthController, new AuthController());
controllerInstances.set(EnrichmentController, new EnrichmentController());
controllerInstances.set(ChatController, new ChatController());
controllerInstances.set(NetworkController, new NetworkController());
controllerInstances.set(NetworkRequestController, new NetworkRequestController());
controllerInstances.set(IntentController, new IntentController());
controllerInstances.set(IntentIntakeController, new IntentIntakeController());
controllerInstances.set(OpportunityController, new OpportunityController());
controllerInstances.set(NetworkOpportunityController, new NetworkOpportunityController());
controllerInstances.set(ConnectLinkController, new ConnectLinkController());
controllerInstances.set(UserController, new UserController());
controllerInstances.set(StorageController, new StorageController(new StorageService(storageAdapter)));
controllerInstances.set(SubscribeController, new SubscribeController());
controllerInstances.set(ConversationController, new ConversationController(new ConversationService(), new TaskService()));
controllerInstances.set(
  NotificationController,
  new NotificationController(new NotificationService(), notificationDeliveryService),
);
controllerInstances.set(AgentController, new AgentController());
controllerInstances.set(AgentRuntimeController, new AgentRuntimeController());
controllerInstances.set(ConnectedAgentsController, new ConnectedAgentsController());
const integrationAdapter = new ComposioIntegrationAdapter();
const integrationService = new IntegrationService(integrationAdapter);
controllerInstances.set(IntegrationController, new IntegrationController(integrationService));
controllerInstances.set(WebhooksController, new WebhooksController());
controllerInstances.set(DebugController, new DebugController());
const toolService = new ToolService(contactService);
controllerInstances.set(ToolController, new ToolController(toolService));
controllerInstances.set(QuestionController, new QuestionController());

logger.info('Routes registered', { prefix: GLOBAL_PREFIX });

function classifyRequestSubsystem(pathname: string): string {
  if (pathname === '/throw-error') return 'sentry-test';
  if (pathname === '/mcp' || pathname.startsWith('/mcp/')) return 'mcp';
  if (pathname.startsWith('/api/auth') || pathname.startsWith('/.well-known/')) return 'auth';
  if (pathname.startsWith('/api/tools')) return 'protocol';
  if (pathname.startsWith('/dev/queues')) return 'queue-admin';
  if (pathname.startsWith('/api/')) return 'controller';
  return 'server';
}

// Cron jobs (newsletter, opportunity finder, HyDE) are registered in index.ts (runs with queue workers).
const server = Bun.serve({
  port: PORT,
  idleTimeout: 60, // 60 seconds to prevent request timeout errors
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    const corsHeaders = getCorsHeaders(req);
    const subsystem = classifyRequestSubsystem(url.pathname);

    logger.verbose('Request', { method, path: url.pathname });

    return traceAppOperation(
      {
        name: `${method} ${subsystem}`,
        op: 'http.server',
        forceTransaction: true,
        attributes: {
          subsystem,
          'http.request.method': method,
          'url.path': url.pathname,
        },
      },
      async () => {
    try {
    // Sentry smoke-test endpoint. Intentionally throws so the top-level request
    // boundary captures and reports the error. Disabled in production unless
    // explicitly enabled for a short operational smoke test.
    if (url.pathname === '/throw-error') {
      if (IS_PRODUCTION && process.env.ENABLE_SENTRY_TEST_ENDPOINT !== 'true') {
        return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
      throw new Error('Sentry test error from /throw-error');
    }

    // Handle OPTIONS preflight requests
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return Response.json(
        {
          status: 'ok',
          timestamp: new Date().toISOString(),
          service: 'protocol-v2',
        },
        { headers: corsHeaders }
      );
    }

    // Bull Board UI at /dev/queues (before API loop so it is always served in dev)
    if (!IS_PRODUCTION && (url.pathname === '/dev/queues' || url.pathname.startsWith('/dev/queues/'))) {
      const res = await adminQueuesApp.fetch(req);
      const newHeaders = new Headers(res.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => newHeaders.set(key, value));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: newHeaders });
    }

    // Better Auth handles its own /api/auth/* routes (sign-in, sign-up, session, etc.)
    // Our custom auth routes (/api/auth/me, /api/auth/profile/update) fall through to controllers
    const betterAuthPaths = [
      '/api/auth/sign-in', '/api/auth/sign-up', '/api/auth/sign-out',
      '/api/auth/session', '/api/auth/callback', '/api/auth/error',
      '/api/auth/get-session', '/api/auth/forget-password',
      '/api/auth/magic-link', '/api/auth/reset-password', '/api/auth/verify-email',
      '/api/auth/change-password', '/api/auth/change-email',
      '/api/auth/delete-user', '/api/auth/list-sessions',
      '/api/auth/revoke-session', '/api/auth/revoke-other-sessions',
      '/api/auth/update-user',
      '/api/auth/token', '/api/auth/jwks',
      // API key management
      '/api/auth/api-key',
      // MCP OAuth endpoints
      '/api/auth/mcp/',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource',
    ];
    const isBetterAuthRoute = betterAuthPaths.some(p => url.pathname.startsWith(p));
    if (isBetterAuthRoute) {
      // better-call strips basePath via `pathname.split(basePath)`, which only works
      // for paths that contain the basePath string. Root-level /.well-known/* paths
      // don't contain "/api/auth" so the split yields a 1-element array → empty path → 404.
      // Rewriting to /api/auth/.well-known/* makes the split work correctly.
      let handlerReq = req;
      if (url.pathname.startsWith('/.well-known/')) {
        const rewritten = new URL(req.url);
        rewritten.pathname = `/api/auth${url.pathname}`;
        handlerReq = new Request(rewritten.toString(), req);
      }
      const res = await auth.handler(handlerReq);
      const newHeaders = new Headers(res.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => newHeaders.set(key, value));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: newHeaders });
    }

    // MCP Streamable HTTP endpoint (OPTIONS already handled globally above)
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return mcpHandler(req, corsHeaders);
    }

    // Short connect-link URLs are minted at <base>/c/<code> (no /api prefix
    // — the brevity is the point). Rewrite to the controller path so the
    // normal route-matching loop can dispatch to ConnectLinkController.
    if (url.pathname.startsWith('/c/')) {
      url.pathname = `/api${url.pathname}`;
    }

    // Iterate over controllers and routes to find a match.

    for (const [target, controllerDef] of RouteRegistry.getControllers()) {
      const routes = RouteRegistry.getRoutes(target);

      for (const route of routes) {
        if (route.method !== method) continue;

        // Construct full path pattern
        // Global Prefix + Controller Prefix + Route Path
        // Ensure slashes are handled correctly
        let fullPath = GLOBAL_PREFIX + controllerDef.path + route.path;
        // Normalize double slashes
        fullPath = fullPath.replace(/\/+/g, '/');
        const hasParams = fullPath.includes(':');
        const params = hasParams ? matchPath(fullPath, url.pathname) : null;
        const isMatch = url.pathname === fullPath || params !== null;

        if (isMatch) {
          const routeParams = params ?? {} as Record<string, string>;
          const handlerName = `${target.name}.${String(route.methodName)}`;
          const activeSpan = Sentry.getActiveSpan();
          if (activeSpan) {
            Sentry.updateSpanName(activeSpan, `${method} ${fullPath}`);
          }
          setSpanAttributes({
            'http.route': fullPath,
            controller: target.name,
            handler: handlerName,
            subsystem: fullPath.startsWith('/api/tools') ? 'protocol' : 'controller',
          });
          logger.verbose('Matched route', { path: fullPath, handler: handlerName, params: routeParams });
          try {
            const instance = controllerInstances.get(target);
            if (!instance) {
              logger.error('No instance found for controller', { controller: target.name });
              return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
            }

            // Execute Guards
            const guards = RouteRegistry.getGuards(target, route.methodName);
            logger.verbose('Guards found', { count: guards.length });
            let guardResult: unknown = null;

            for (const guard of guards) {
              logger.verbose('Executing guard', { guard: guard.name || 'anonymous' });
              guardResult = await guard(req);
              logger.verbose('Guard execution successful');
            }

            // Invoke handler: (req, user, params?)
            const handler = instance[route.methodName];
            logger.verbose('Invoking handler', { handler: String(route.methodName) });
            const result = await handler.call(instance, req, guardResult, routeParams);
            logger.verbose('Handler invoked successfully');

            // Attach ratelimit headers if available
            const limiterInfo = getRateLimitInfo(req);
            const limiterHeaders: Record<string, string> = limiterInfo
              ? {
                  'ratelimit-limit': String(limiterInfo.limit),
                  'ratelimit-remaining': String(limiterInfo.remaining),
                  'ratelimit-reset': String(Math.max(0, Math.ceil((limiterInfo.resetAt - Date.now()) / 1000))),
                }
              : {};

            // If result is a Response object, add CORS headers and return it.
            if (result instanceof Response) {
              setSpanHttpStatus(result.status);
              // Clone the response with CORS headers added
              const newHeaders = new Headers(result.headers);
              Object.entries(corsHeaders).forEach(([key, value]) => {
                newHeaders.set(key, value);
              });
              Object.entries(limiterHeaders).forEach(([key, value]) => {
                newHeaders.set(key, value);
              });
              return new Response(result.body, {
                status: result.status,
                statusText: result.statusText,
                headers: newHeaders,
              });
            }
            // Otherwise assume JSON
            setSpanHttpStatus(200);
            return Response.json(result, { headers: { ...corsHeaders, ...limiterHeaders } });

          } catch (error: unknown) {
            logger.error('Error handling request', {
              method,
              path: fullPath,
              error: error instanceof Error ? error.message : String(error),
            });
            const message = error instanceof Error ? error.message : 'Internal Server Error';
            // Map agent-scope violations to 403 (network-scoped API keys hitting
            // a network they aren't bound to)
            if (error instanceof ScopeViolationError) {
              setSpanHttpStatus(403);
              return new Response(JSON.stringify({ error: 'forbidden', detail: message }), { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            // Session-only endpoints reject API-key credentials outright
            if (error instanceof SessionRequiredError || error instanceof OwnerControlRequiredError || error instanceof HermesNegotiatorRouteDeniedError) {
              setSpanHttpStatus(403);
              return new Response(JSON.stringify({ error: 'forbidden', detail: message }), { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            if (error instanceof RateLimiterError) {
              setSpanHttpStatus(429);
              return new Response(error.toBody(), error.toResponseInit(corsHeaders));
            }
            // Map common auth errors
            if (
              message === 'Access token required' ||
              message === 'Access token or API key required' ||
              message === 'Invalid or expired access token' ||
              message === 'Invalid API key'
            ) {
              setSpanHttpStatus(401);
              return new Response(JSON.stringify({ error: message }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            if (message === 'User not found' || message === 'Account deactivated') {
              setSpanHttpStatus(403);
              return new Response(JSON.stringify({ error: message }), { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            if (message === 'Not found') {
              setSpanHttpStatus(404);
              return new Response(JSON.stringify({ error: message }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }

            captureAppException(error, {
              subsystem: fullPath.startsWith('/api/tools') ? 'protocol' : 'controller',
              operation: 'controller.route',
              tags: {
                'http.method': method,
                'http.route': fullPath,
                controller: target.name,
                handler: String(route.methodName),
              },
              context: {
                path: url.pathname,
                params: routeParams,
              },
            });
            setSpanHttpStatus(500);
            return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
        }
      }
    }

    logger.verbose('No match found', { path: url.pathname });
    setSpanHttpStatus(404);
    return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error: unknown) {
      logger.error('Unhandled request error', {
        method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      const eventId = captureAppException(error, {
        subsystem,
        operation: 'http.fetch',
        tags: {
          'http.method': method,
          'http.path': url.pathname,
        },
        context: { path: url.pathname },
      });
      if (url.pathname === '/throw-error') {
        await Sentry.flush(5000);
      }
      setSpanHttpStatus(500);
      return new Response(
        JSON.stringify({ error: 'Internal Server Error', eventId }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }
      },
    );
  },
});

// Bind the live server to the limiter so resolveClientIp can fall back to
// the socket peer in environments where RAILWAY_ENVIRONMENT isn't set.
bindLimiterServer(server);

logger.info('Server running', { port: PORT });


// Graceful shutdown: close BullMQ workers so stale workers don't linger after restart
const shutdown = async () => {
  logger.info('Shutting down workers...');
  await Promise.allSettled([
    enrichmentQueue.close(),
    intentQueue.close(),
    fromIntentQueue.close(),
    fromIntroducerQueue.close(),
    fromEnrichmentQueue.close(),
    enrichmentRunQueue.close(),
    negotiationRunExistingQueue.close(),
    negotiationWatchdogQueue.close(),
    notificationQueue.close(),
    emailQueue.close(),
    negotiationTimeoutQueue.close(),
    negotiationClaimTimeoutQueue.close(),
    questionerQueue.close(),
    questionMessageQueue.close(),
    premiseQueue.close(),
    userContextQueue.close(),
    frameDriftQueue.close(),
  ]);
  logger.info('Workers closed');
  await Sentry.close(2000);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
