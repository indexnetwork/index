import './startup.env';

import { ChatController } from './controllers/chat.controller';
import { DebugController } from './controllers/debug.controller';
import { ToolController } from './controllers/tool.controller';
import { ToolService } from './services/tool.service';
import { S3StorageAdapter } from './adapters/storage.adapter';
import { NetworkController } from './controllers/network.controller';
import { IntentController } from './controllers/intent.controller';
import { LinkController } from './controllers/link.controller';
import { OpportunityController, NetworkOpportunityController } from './controllers/opportunity.controller';
import { ConnectLinkController } from './controllers/connect-link.controller';
import { AuthController } from './controllers/auth.controller';
import { ProfileController } from './controllers/profile.controller';
import { UserController } from './controllers/user.controller';
import { StorageController } from './controllers/storage.controller';
import { StorageService } from './services/storage.service';
import { SubscribeController } from './controllers/subscribe.controller';
import { UnsubscribeController } from './controllers/unsubscribe.controller';
import { fileService } from './services/file.service';
import { ConversationController } from './controllers/conversation.controller';
import { AgentController } from './controllers/agent.controller';
import { ConversationService } from './services/conversation.service';
import { TaskService } from './services/task.service';
import { IntegrationController } from './controllers/integration.controller';
import { WebhooksController } from './controllers/webhooks.controller';
import { ComposioIntegrationAdapter } from './adapters/integration.adapter';
import { IntegrationService } from './services/integration.service';
import { contactService } from './services/contact.service';
import { RouteRegistry } from './lib/router/router.decorators';
import { ScopeViolationError } from './guards/agent-scope.guard';
import { RateLimiterError } from './lib/limiter/error';
import { log } from './lib/log';
import { getCorsHeaders } from './lib/cors';
import { adminQueuesApp } from './controllers/queues.controller';
import { mcpHandler, chatFactory } from './controllers/mcp.controller';
import { chatSessionService } from './services/chat.service';
import { auth } from './lib/betterauth/auth.instance';
import { getStats } from './lib/performance';
// Bootstrap queue workers and HyDE crons (only in this process, not in CLI e.g. db:seed)
import { intentQueue } from './queues/intent.queue';
import { fromIntentQueue } from './queues/opportunity/from-intent.queue';
import { fromIntroducerQueue } from './queues/opportunity/from-introducer.queue';
import { negotiationRunExistingQueue } from './queues/negotiations/run-existing.queue';
import { opportunityExpirationCron } from './queues/opportunity/expiration.queue';
import { notificationQueue } from './queues/notification.queue';
import { hydeQueue } from './queues/hyde.queue';
import { emailQueue } from './queues/email.queue';
import { profileQueue } from './queues/profile.queue';
import { negotiationTimeoutQueue } from './queues/negotiations/timeout.queue';
import { negotiationClaimTimeoutQueue } from './queues/negotiations/claim-timeout.queue';
import { NetworkMembershipEvents } from './events/network_membership.event';
import { IntentEvents } from './events/intent.event';
import { NegotiationEvents } from './events/negotiation.event';
import { init as initTelegramGateway } from './gateways/telegram.gateway';
import { setWebhook } from './lib/telegram/bot-api';
import { opportunityService } from './services/opportunity.service';
import { NegotiationGraphFactory } from '@indexnetwork/protocol';
import { conversationDatabaseAdapter } from './adapters/database.adapter';
import { agentService } from './services/agent.service';
import { AgentDispatcherImpl } from './services/agent-dispatcher.service';

// Wire ChatGraphFactory into chat service at startup
chatSessionService.setFactory(chatFactory);

// Wire negotiation into the background discovery queue so latent opportunities
// from the IntentEvents.onCreated path are negotiated, matching the chat/MCP paths.
// Without this, OpportunityGraph's negotiateNode short-circuits and every evaluated
// candidate is persisted unfiltered.
const backgroundAgentDispatcher = new AgentDispatcherImpl(agentService, negotiationTimeoutQueue);
const backgroundNegotiationGraph = new NegotiationGraphFactory(
  conversationDatabaseAdapter as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0],
  backgroundAgentDispatcher,
  negotiationTimeoutQueue,
).createGraph();
fromIntentQueue.setRuntimeDeps({
  negotiationGraph: backgroundNegotiationGraph,
  agentDispatcher: backgroundAgentDispatcher,
});
fromIntroducerQueue.setRuntimeDeps({
  negotiationGraph: backgroundNegotiationGraph,
  agentDispatcher: backgroundAgentDispatcher,
});
negotiationRunExistingQueue.setRuntimeDeps({
  negotiationGraph: backgroundNegotiationGraph,
  agentDispatcher: backgroundAgentDispatcher,
});

intentQueue.startWorker();
fromIntentQueue.startWorker();
fromIntroducerQueue.startWorker();
negotiationRunExistingQueue.startWorker();
opportunityExpirationCron.start();
notificationQueue.startWorker();
profileQueue.startWorker();
hydeQueue.startCrons();
emailQueue.startWorker();
negotiationTimeoutQueue.startWorker();
negotiationClaimTimeoutQueue.startWorker();

NetworkMembershipEvents.onMemberAdded = (userId: string) => {
  profileQueue.addEnsureProfileHydeJob({ userId }).catch((err) => {
    log.job.from('NetworkMembership').error('Failed to enqueue ensure_profile_hyde', { userId, error: err });
  });
};

IntentEvents.onCreated = (intentId: string, userId: string) => {
  log.job.from('IntentEvents').verbose('Intent created, triggering discovery + maintenance', { intentId, userId });
  fromIntentQueue.addJob(
    { intentId, userId },
    { priority: 10, jobId: `rediscovery-${userId}-${intentId}-${Math.floor(Date.now() / (6 * 60 * 60 * 1000))}` },
  ).catch((err) => log.job.from('IntentEvents').error('Failed to enqueue discovery on create', { intentId, userId, error: err }));
  opportunityService.triggerMaintenance(userId, 'intent-created');
};

IntentEvents.onUpdated = (intentId: string, userId: string) => {
  log.job.from('IntentEvents').verbose('Intent updated, triggering maintenance', { intentId, userId });
  opportunityService.triggerMaintenance(userId, 'intent-updated');
};

IntentEvents.onArchived = (intentId: string, userId: string) => {
  log.job.from('IntentEvents').verbose('Intent archived, triggering maintenance', { intentId, userId });
  opportunityService.triggerMaintenance(userId, 'intent-archived');
};

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const GLOBAL_PREFIX = '/api';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const logger = log.server.from("main");

// ── NegotiationEvents → Telegram notifications ──────────────────────────────
NegotiationEvents.onTurnReceived = (data) => {
  notificationQueue.queueNegotiationNotification(
    data.negotiationId,
    data.userId,
    data.turnNumber,
    data.counterpartyAction,
  ).catch((err) => {
    logger.error('Failed to enqueue negotiation notification', { negotiationId: data.negotiationId, error: err });
  });
};

// ── Telegram bot startup ────────────────────────────────────────────────────
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET) {
  const webhookBase = process.env.BASE_URL ?? process.env.APP_URL ?? '';
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
controllerInstances.set(ProfileController, new ProfileController());
controllerInstances.set(ChatController, new ChatController());
controllerInstances.set(NetworkController, new NetworkController());
controllerInstances.set(IntentController, new IntentController());
controllerInstances.set(LinkController, new LinkController());
controllerInstances.set(OpportunityController, new OpportunityController());
controllerInstances.set(NetworkOpportunityController, new NetworkOpportunityController());
controllerInstances.set(ConnectLinkController, new ConnectLinkController());
controllerInstances.set(UserController, new UserController());
controllerInstances.set(StorageController, new StorageController(new StorageService(storageAdapter)));
controllerInstances.set(SubscribeController, new SubscribeController());
controllerInstances.set(UnsubscribeController, new UnsubscribeController());
controllerInstances.set(ConversationController, new ConversationController(new ConversationService(), new TaskService()));
controllerInstances.set(AgentController, new AgentController());
const integrationAdapter = new ComposioIntegrationAdapter();
const integrationService = new IntegrationService(integrationAdapter, contactService);
controllerInstances.set(IntegrationController, new IntegrationController(integrationService));
controllerInstances.set(WebhooksController, new WebhooksController());
controllerInstances.set(DebugController, new DebugController());
const toolService = new ToolService(contactService, integrationService, integrationAdapter);
controllerInstances.set(ToolController, new ToolController(toolService));

logger.info('Routes registered', { prefix: GLOBAL_PREFIX });

// Cron jobs (newsletter, opportunity finder, HyDE) are registered in index.ts (runs with queue workers).
Bun.serve({
  port: PORT,
  idleTimeout: 60, // 60 seconds to prevent request timeout errors
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    const corsHeaders = getCorsHeaders(req);

    logger.verbose('Request', { method, path: url.pathname });

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

    // Performance stats at /dev/performance (dev only, alongside Bull Board)
    if (!IS_PRODUCTION && url.pathname === '/dev/performance') {
      return Response.json(getStats(), { headers: corsHeaders });
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
          logger.verbose('Matched route', { path: fullPath, handler: `${target.name}.${String(route.methodName)}`, params: routeParams });
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

            // If result is a Response object, add CORS headers and return it.
            if (result instanceof Response) {
              // Clone the response with CORS headers added
              const newHeaders = new Headers(result.headers);
              Object.entries(corsHeaders).forEach(([key, value]) => {
                newHeaders.set(key, value);
              });
              return new Response(result.body, {
                status: result.status,
                statusText: result.statusText,
                headers: newHeaders,
              });
            }
            // Otherwise assume JSON
            return Response.json(result, { headers: corsHeaders });

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
              return new Response(JSON.stringify({ error: 'forbidden', detail: message }), { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            if (error instanceof RateLimiterError) {
              return new Response(error.toBody(), error.toResponseInit(corsHeaders));
            }
            // Map common auth errors
            if (
              message === 'Access token required' ||
              message === 'Access token or API key required' ||
              message === 'Invalid or expired access token' ||
              message === 'Invalid API key'
            ) {
              return new Response(JSON.stringify({ error: message }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            if (message === 'User not found' || message === 'Account deactivated') {
              return new Response(JSON.stringify({ error: message }), { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            if (message === 'Not found') {
              return new Response(JSON.stringify({ error: message }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }

            return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
        }
      }
    }

    logger.verbose('No match found', { path: url.pathname });
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
});

logger.info('Server running', { port: PORT });


// Graceful shutdown: close BullMQ workers so stale workers don't linger after restart
const shutdown = async () => {
  logger.info('Shutting down workers...');
  await Promise.allSettled([
    profileQueue.close(),
    intentQueue.close(),
    fromIntentQueue.close(),
    fromIntroducerQueue.close(),
    negotiationRunExistingQueue.close(),
    notificationQueue.close(),
    emailQueue.close(),
    negotiationTimeoutQueue.close(),
    negotiationClaimTimeoutQueue.close(),
  ]);
  logger.info('Workers closed');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
