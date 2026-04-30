/**
 * Index Network — OpenClaw plugin entry point.
 *
 * Registers three HTTP routes across four polling domains and starts their
 * respective schedulers:
 *
 *   POST /index/poll/negotiator         — negotiation turn pickup
 *   POST /index/poll/ambient-discovery  — opportunity batch evaluation
 *   POST /index/poll/test-message       — test message pickup
 *
 * Daily digest is scheduled directly (no HTTP route needed).
 *
 * Uses `definePluginEntry` from the OpenClaw plugin SDK so that CLI commands
 * (e.g. `openclaw index setup`) are properly registered.
 */

import type { OpenClawPluginApi } from './lib/openclaw/plugin-api.js';
import { setDefaultResultOrder } from 'node:dns';
import * as negotiatorPoller from './polling/negotiator/negotiator.poller.js';
import * as negotiatorScheduler from './polling/negotiator/negotiator.scheduler.js';
import * as dailyDigestPoller from './polling/daily-digest/daily-digest.poller.js';
import * as dailyDigestScheduler from './polling/daily-digest/daily-digest.scheduler.js';
import * as ambientDiscoveryPoller from './polling/ambient-discovery/ambient-discovery.poller.js';
import * as ambientDiscoveryScheduler from './polling/ambient-discovery/ambient-discovery.scheduler.js';
import * as testMessagePoller from './polling/test-message/test-message.poller.js';
import * as testMessageScheduler from './polling/test-message/test-message.scheduler.js';
import { registerSetupCli } from './setup/setup.cli.js';
import { deriveUrls } from './lib/utils/url.js';

/**
 * Prefer A records before AAAA. Bun's fetch can stall on broken or link-local-only
 * IPv6 while the TCP attempt lingers; curl from the same host often succeeds quickly
 * because it may pick IPv4 first — same request, different resolver order.
 */
setDefaultResultOrder('ipv4first');

/** Prevents double-registration when OpenClaw calls register() more than once. */
let registered = false;

/**
 * Registers the `openclaw index setup` CLI command if the host supports
 * `registerCli`. Also registers `openclaw index-network setup` as a deprecated
 * alias for one minor version (drop in 0.23.0).
 *
 * Safe to call even when the plugin is unconfigured.
 */
function registerSetupCommand(api: OpenClawPluginApi): void {
  if (!api.registerCli) {
    api.logger.debug('registerCli not available — skipping CLI setup command.');
    return;
  }

  api.registerCli(
    ({ program }) => {
      const cmd = (program as { command(n: string): { description(d: string): unknown } })
        .command('index')
        .description('Manage Index Network plugin configuration');
      registerSetupCli(cmd as Parameters<typeof registerSetupCli>[0]);

      // Deprecated alias — same handler, prints a warning. Remove in 0.23.0.
      const aliasCmd = (program as { command(n: string): { description(d: string): unknown } })
        .command('index-network')
        .description('[Deprecated — use `openclaw index`] Manage Index Network plugin configuration');
      registerSetupCli(aliasCmd as Parameters<typeof registerSetupCli>[0], {
        deprecationWarning: 'Note: `openclaw index-network setup` is deprecated. Use `openclaw index setup` instead. The alias will be removed in 0.23.0.',
      });
    },
    {
      descriptors: [
        { name: 'index', description: 'Manage Index Network plugin configuration' },
        { name: 'index-network', description: '[Deprecated alias for `index`]' },
      ],
    },
  );
}

/**
 * Ensures the `index` MCP server definition in OpenClaw config matches the
 * current plugin config. Creates or updates as needed. Also cleans up any
 * legacy `index-network` entry left behind by pre-0.22.0 installs.
 */
function ensureMcpServer(api: OpenClawPluginApi, baseUrl: string, apiKey: string): void {
  const configSet = api.configSet;
  if (!configSet) {
    api.logger.debug('configSet not available — skipping MCP auto-registration.');
    return;
  }
  if (!apiKey) {
    api.logger.warn('API key not configured — skipping MCP auto-registration. Run `openclaw index setup`.');
    return;
  }

  const normalizedUrl = baseUrl.replace(/\/+$/, '');
  const expected = {
    url: `${normalizedUrl}/mcp`,
    transport: 'streamable-http',
    headers: { 'x-api-key': apiKey },
  };

  const current = api.config?.mcp?.servers?.['index'];
  const needsUpdate =
    !current ||
    current.url !== expected.url ||
    current.transport !== expected.transport ||
    current.headers?.['x-api-key'] !== apiKey;

  // Write the new key. When a legacy key exists, delete it first so both ops
  // don't race on the same config file (configSet is read-modify-write).
  const writeNewKey = () => {
    if (!needsUpdate) return;
    configSet('mcp.servers.index', expected).then(
      () => api.logger.info('Index Network MCP server registered/updated.'),
      (err) => api.logger.warn(
        `Failed to auto-register MCP server: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  };

  const legacy = api.config?.mcp?.servers?.['index-network'];
  if (legacy !== undefined) {
    // Delete legacy key first, then write new key so the two writes are sequential.
    configSet('mcp.servers.index-network', undefined).then(
      () => { api.logger.info('Migrated legacy mcp.servers.index-network → mcp.servers.index.'); writeNewKey(); },
      () => writeNewKey(), // cleanup failed — proceed with canonical write anyway
    );
  } else {
    writeNewKey();
  }
}

/**
 * Core plugin registration logic. Called by both `definePluginEntry` (production)
 * and directly in tests.
 */
export function register(api: OpenClawPluginApi): void {
  if (registered) {
    api.logger.debug('Index Network plugin already registered, skipping duplicate call.');
    return;
  }
  registered = true;

  // Register `openclaw index setup` CLI command unconditionally
  registerSetupCommand(api);

  const agentId = readConfig(api, 'agentId');
  const apiKey = readConfig(api, 'apiKey');

  if (!agentId || !apiKey) {
    api.logger.warn(
      'Index Network plugin not configured. Run `openclaw index setup` to complete setup.',
    );
    return;
  }

  const urlFromConfig = readConfig(api, 'url');
  const legacyProtocolUrl = readConfig(api, 'protocolUrl');
  if (!urlFromConfig && legacyProtocolUrl) {
    api.logger.warn(
      'Plugin config uses deprecated "protocolUrl". Run `openclaw index setup` to migrate to the new "url" field.',
    );
  }
  const configUrl = urlFromConfig || legacyProtocolUrl || 'https://index.network';
  const { protocolUrl: baseUrl, frontendUrl } = deriveUrls(configUrl);
  ensureMcpServer(api, baseUrl, apiKey);
  const gatewayPort = api.config?.gateway?.port ?? 18789;
  const gatewayToken = api.config?.gateway?.auth?.token ?? '';

  // Register test-message route
  api.registerHttpRoute({
    path: '/index/poll/test-message',
    auth: 'gateway',
    match: 'exact',
    handler: async (_req, res) => {
      try {
        await testMessagePoller.handle(api, { baseUrl, agentId, apiKey });
        res.statusCode = 200;
        res.end('ok');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(`Test-message poll handler error: ${msg}`);
        res.statusCode = 500;
        res.end(msg);
      }
      return true;
    },
  });

  testMessageScheduler.start({ gatewayPort, gatewayToken, logger: api.logger });

  // Register negotiator route
  const negotiationMode = readConfig(api, 'negotiationMode') || 'enabled';
  if (negotiationMode !== 'disabled') {
    api.registerHttpRoute({
      path: '/index/poll/negotiator',
      auth: 'gateway',
      match: 'exact',
      handler: async (_req, res) => {
        try {
          const result = await negotiatorPoller.handle(api, { baseUrl, agentId, apiKey });
          if (result === 'network_error') {
            negotiatorScheduler.increaseBackoff(api.logger);
          } else {
            negotiatorScheduler.resetBackoff();
          }
          res.statusCode = 200;
          res.end('ok');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          api.logger.error(`Negotiator poll handler error: ${msg}`);
          negotiatorScheduler.increaseBackoff(api.logger);
          res.statusCode = 500;
          res.end(msg);
        }
        return true;
      },
    });

    // Start negotiator scheduler
    negotiatorScheduler.start({ gatewayPort, gatewayToken, logger: api.logger });
  }

  // Register ambient discovery route
  api.registerHttpRoute({
    path: '/index/poll/ambient-discovery',
    auth: 'gateway',
    match: 'exact',
    handler: async (_req, res) => {
      try {
        const outcome = await ambientDiscoveryPoller.handle(api, { baseUrl, agentId, apiKey, frontendUrl });
        // Back off only on real errors (backend unreachable / dispatch failed).
        // 'empty' is a healthy idle state — keep polling at base interval so
        // newly-surfaced opportunities aren't delayed by stale backoff.
        if (outcome === 'error') {
          ambientDiscoveryScheduler.increaseBackoff(api.logger);
        } else {
          ambientDiscoveryScheduler.resetBackoff();
        }
        res.statusCode = 200;
        res.end('ok');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(`Ambient discovery poll handler error: ${msg}`);
        ambientDiscoveryScheduler.increaseBackoff(api.logger);
        res.statusCode = 500;
        res.end(msg);
      }
      return true;
    },
  });

  ambientDiscoveryScheduler.start({ gatewayPort, gatewayToken, logger: api.logger });

  api.logger.info('Index Network polling started', {
    plugin: api.id,
    agentId,
  });

  // Schedule daily digest
  const digestEnabled = readConfig(api, 'digestEnabled') !== 'false';
  if (digestEnabled) {
    const digestTime = readConfig(api, 'digestTime') || '08:00';

    dailyDigestScheduler.start({
      digestTime,
      logger: api.logger,
      onTrigger: async () => { await dailyDigestPoller.handle(api, { baseUrl, agentId, apiKey, frontendUrl }); },
    });
  }

  // Reachability check after a short delay to let the gateway fully start.
  setTimeout(() => {
    checkBackendReachability(api, baseUrl);
  }, 5_000).unref();
}

// --- Plugin entry ---
// Plain object export matching OpenClaw's expected plugin shape.
// Works with or without definePluginEntry — OpenClaw recognizes { id, register }.
export default {
  id: 'indexnetwork-openclaw-plugin',
  name: 'Index Network',
  description: 'Find the right people and let them find you.',
  register,
};

/**
 * One-time startup check: verifies the backend is reachable. Logs an
 * actionable warning if it isn't, so users catch misconfigurations early.
 */
function checkBackendReachability(api: OpenClawPluginApi, baseUrl: string): void {
  fetch(`${baseUrl}/api/health`, {
    method: 'GET',
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {
    api.logger.warn(
      `Cannot reach Index Network backend at ${baseUrl}. ` +
      `Check that the backend is running and url is correct in plugin config.`,
    );
  });
}

function readConfig(api: OpenClawPluginApi, key: string): string {
  const val = api.pluginConfig[key];
  return typeof val === 'string' ? val : '';
}

/**
 * Reset module-level state. Exposed for tests only — not part of public API.
 * @internal
 */
export function _resetForTesting(): void {
  registered = false;
  negotiatorPoller._resetForTesting();
  negotiatorScheduler._resetForTesting();
  dailyDigestScheduler._resetForTesting();
  ambientDiscoveryPoller._resetForTesting();
  ambientDiscoveryScheduler._resetForTesting();
  testMessageScheduler._resetForTesting();
}
