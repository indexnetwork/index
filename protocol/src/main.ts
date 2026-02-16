import './startup.env';

import { ChatController } from './controllers/chat.controller';
import { IndexController } from './controllers/index.controller';
import { IntentController } from './controllers/intent.controller';
import { FileController } from './controllers/file.controller';
import { LinkController } from './controllers/link.controller';
import { OpportunityController, IndexOpportunityController } from './controllers/opportunity.controller';
import { AuthController } from './controllers/auth.controller';
import { ProfileController } from './controllers/profile.controller';
import { UploadController } from './controllers/upload.controller';
import { UserController } from './controllers/user.controller';
import { RouteRegistry } from './lib/router/router.decorators';
import { startXMTPAgent } from './agent/xmtp.agent';
import { log } from './lib/log';
import { adminQueuesApp } from './controllers/queues.controller';
// Bootstrap queue workers and HyDE crons (only in this process, not in CLI e.g. db:seed)
import { intentQueue } from './queues/intent.queue';
import { opportunityQueue } from './queues/opportunity.queue';
import { notificationQueue } from './queues/notification.queue';
import { hydeQueue } from './queues/hyde.queue';

intentQueue.startWorker();
opportunityQueue.startWorker();
notificationQueue.startWorker();
hydeQueue.startCrons();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const GLOBAL_PREFIX = '/api';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const logger = log.server.from("main");

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
const controllerInstances = new Map();
controllerInstances.set(AuthController, new AuthController());
controllerInstances.set(ProfileController, new ProfileController());
controllerInstances.set(ChatController, new ChatController());
controllerInstances.set(IndexController, new IndexController());
controllerInstances.set(IntentController, new IntentController());
controllerInstances.set(FileController, new FileController());
controllerInstances.set(LinkController, new LinkController());
controllerInstances.set(OpportunityController, new OpportunityController());
controllerInstances.set(IndexOpportunityController, new IndexOpportunityController());
controllerInstances.set(UploadController, new UploadController());
controllerInstances.set(UserController, new UserController());

logger.info('Routes registered', { prefix: GLOBAL_PREFIX });

// Cron jobs (newsletter, opportunity finder, HyDE) are registered in index.ts (runs with queue workers).
Bun.serve({
  port: PORT,
  idleTimeout: 60, // 60 seconds to prevent request timeout errors
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    // CORS: allow explicit FRONTEND_URL, or reflect Origin for localhost/127.0.0.1 (so both work), else *
    const origin = req.headers.get('Origin') ?? '';
    const allowOrigin =
      process.env.FRONTEND_URL ||
      (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) ? origin : null) ||
      '*';

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
      'Access-Control-Expose-Headers': 'X-Session-Id',
      'Access-Control-Max-Age': '86400',
    };

    // If we reflected a specific origin, allow credentials (cookies/auth headers)
    if (allowOrigin !== '*') {
      corsHeaders['Access-Control-Allow-Credentials'] = 'true';
    }

    logger.info('Request', { method, path: url.pathname });

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

    // Iterate over controllers and routes to find a match.
    // Optimization: could pre-compile regex or a router map.
    // For now, simple iteration is fine for small number of routes.

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
        // Remove trailing slash if strictly matching, or just strip both
        const hasParams = fullPath.includes(':');
        const params = hasParams ? matchPath(fullPath, url.pathname) : null;
        const isMatch = url.pathname === fullPath || params !== null;

        if (isMatch) {
          const routeParams = params ?? {} as Record<string, string>;
          logger.info('Matched route', { path: fullPath, handler: `${target.name}.${String(route.methodName)}`, params: routeParams });
          try {
            const instance = controllerInstances.get(target);
            if (!instance) {
              logger.error('No instance found for controller', { controller: target.name });
              return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
            }

            // Execute Guards
            const guards = RouteRegistry.getGuards(target, route.methodName);
            logger.info('Guards found', { count: guards.length });
            let guardResult: any = null;

            for (const guard of guards) {
              logger.info('Executing guard', { guard: guard.name || 'anonymous' });
              guardResult = await guard(req);
              logger.info('Guard execution successful');
            }

            // Invoke handler: (req, user, params?)
            const handler = instance[route.methodName];
            logger.info('Invoking handler', { handler: String(route.methodName) });
            const result = await handler.call(instance, req, guardResult, routeParams);
            logger.info('Handler invoked successfully');

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

          } catch (error: any) {
            logger.error('Error handling request', {
              method,
              path: fullPath,
              error: error?.message ?? String(error),
            });
            const message = error.message || 'Internal Server Error';
            // Map common auth errors
            if (message === 'Access token required' || message === 'Invalid or expired access token') {
              return new Response(JSON.stringify({ error: message }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            if (message === 'User not found' || message === 'Account deactivated') {
              return new Response(JSON.stringify({ error: message }), { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }

            return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
        }
      }
    }

    logger.info('No match found', { path: url.pathname });
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
});

logger.info('Server running', { port: PORT });

// Start XMTP agent alongside the server (only when wallet key is configured)
if (process.env.XMTP_WALLET_KEY) {
  startXMTPAgent().catch((error) => {
    console.error('[XMTP Agent] Failed to start:', error);
  });
}
