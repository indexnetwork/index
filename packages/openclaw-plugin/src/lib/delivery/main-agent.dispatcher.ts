/**
 * Dispatches a render prompt to the user's main OpenClaw agent via the
 * gateway's `POST /hooks/agent` endpoint. The endpoint is documented at
 * https://github.com/openclaw/openclaw/blob/main/docs/gateway/configuration-reference.md
 *
 * To deliver to whichever channel the user actually chats on, we discover
 * the user's most-recently-active chat-bound session from the agent's
 * `sessions.json` and pass it as `sessionKey`. This lands the hook IN
 * that session, so the agent's reply routes through the session's bound
 * channel (Telegram, WhatsApp, Discord, etc.). Without `sessionKey` the
 * gateway creates an isolated session with no channel binding and the
 * reply has nowhere to go.
 *
 * Required gateway config (bootstrapped by `openclaw index setup`):
 *  - `hooks.enabled = true`
 *  - `hooks.token`   = a non-empty secret distinct from `gateway.auth.token`
 *  - `hooks.path`    = a sub-path, defaulting to `/hooks`
 *  - `hooks.allowRequestSessionKey = true`
 *  - `hooks.allowedSessionKeyPrefixes` ⊇ ["agent:main:"]
 *
 * The endpoint returns only `{ ok: true, runId: ... }` — the agent's
 * rendered text is delivered to the channel asynchronously and is not
 * available to the plugin synchronously. The agent calls
 * `confirm_opportunity_delivery(opportunityId, trigger)` via MCP for each
 * opportunity it actually mentions in its reply; the plugin does not
 * perform any post-dispatch confirmation.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join as joinPath } from 'node:path';

import type { OpenClawPluginApi } from '../openclaw/plugin-api.js';

/** Context required to dispatch a prompt to the main agent. */
export interface DispatchContext {
  /** The fully-rendered prompt to hand to the agent. */
  prompt: string;
  /** Idempotency key sent as the `idempotency-key` header. */
  idempotencyKey: string;
  /** Optional per-call timeout. Defaults to 120 seconds. */
  timeoutMs?: number;
}

/** Outcome of `dispatchToMainAgent`. */
export interface DispatchResult {
  /** True when the gateway acknowledged the dispatch (HTTP 2xx). */
  delivered: boolean;
  /**
   * Set when delivery failed in a way callers should react to:
   *  - `config_error`: missing gateway port or hooks.token → setup not run.
   *  - `unauthorized`: hooks.token rejected (401/403) → token mismatch.
   *  - `network_error`: any other failure (5xx, fetch threw, parse).
   */
  error?: 'config_error' | 'unauthorized' | 'network_error';
  /** True when no chat-bound session was found and we fell back to channel:'last'. */
  unboundFallback?: boolean;
}

/** Channel prefixes that indicate a real user-chat session. */
const CHAT_CHANNEL_PREFIXES = [
  'telegram',
  'whatsapp',
  'discord',
  'slack',
  'imessage',
  'sms',
];

interface SessionsMapEntry {
  sessionId?: string;
  lastTo?: string;
  lastChannel?: string;
  updatedAt?: number;
  origin?: {
    to?: string;
    from?: string;
    provider?: string;
    surface?: string;
  };
}

/** Routing target extracted from the user's most-recent chat session. */
interface ChatTarget {
  /** Session key, e.g. `agent:main:telegram:direct:69340471`. */
  sessionKey: string;
  /** Channel id, e.g. `telegram`. Required by `/hooks/agent` to route delivery. */
  channel: string;
  /** Recipient identifier, e.g. `telegram:69340471`. */
  to: string;
}

function isTelegramAddress(addr: string): boolean {
  return addr.startsWith('telegram:');
}

/**
 * Derives `channel` + `to` from an `agent:main:<channel>:…` session key when
 * OpenClaw omits `origin` (seen on `telegram:direct` rows). Uses the last
 * `:`-separated segment as the peer id (matches `direct` / `slash` Telegram keys).
 */
function routeFromSessionKey(
  sessionKey: string,
): { channel: string; to: string } | undefined {
  const prefix = 'agent:main:';
  if (!sessionKey.startsWith(prefix)) return undefined;
  const parts = sessionKey.slice(prefix.length).split(':');
  if (parts.length < 3) return undefined;
  const channel = parts[0];
  if (!CHAT_CHANNEL_PREFIXES.includes(channel)) return undefined;
  const id = parts[parts.length - 1];
  if (!id) return undefined;
  return { channel, to: `${channel}:${id}` };
}

/**
 * Extracts the routing pair from a sessions.json row plus its session key.
 * Prefers `origin`; normalizes OpenClaw's `webchat` surface when `origin.to` /
 * `origin.from` are still `telegram:…` (Telegram bridged through the web UI).
 * Falls back to top-level `lastTo`, then to parsing the session key.
 */
function readChannelTo(
  sessionKey: string,
  val: SessionsMapEntry,
): { channel: string; to: string } | undefined {
  const originTo = typeof val.origin?.to === 'string' ? val.origin.to : '';
  const originFrom = typeof val.origin?.from === 'string' ? val.origin.from : '';
  const originChannel =
    (typeof val.origin?.provider === 'string' && val.origin.provider) ||
    (typeof val.origin?.surface === 'string' && val.origin.surface) ||
    '';

  if (originTo && originChannel) {
    if (
      originChannel === 'webchat' &&
      (isTelegramAddress(originTo) || isTelegramAddress(originFrom))
    ) {
      const to = isTelegramAddress(originTo) ? originTo : originFrom;
      return { channel: 'telegram', to };
    }
    return { channel: originChannel, to: originTo };
  }

  if (originChannel === 'webchat' && isTelegramAddress(originFrom)) {
    return { channel: 'telegram', to: originFrom };
  }

  const lastTo = typeof val.lastTo === 'string' ? val.lastTo : '';
  const colonIdx = lastTo.indexOf(':');
  if (colonIdx > 0) {
    return { channel: lastTo.slice(0, colonIdx), to: lastTo };
  }

  return routeFromSessionKey(sessionKey);
}

/**
 * Locates the user's most-recently-active chat-bound session by reading
 * `~/.openclaw/agents/main/sessions/sessions.json` and filtering for
 * rows that resolve to a known chat channel via `origin` (including
 * `webchat` + `telegram:*` normalization), `lastTo`, or the session key
 * (`agent:main:<channel>:…`).
 *
 * Returns the routing triple `{sessionKey, channel, to}` or `undefined`
 * when no such session exists. `/hooks/agent` needs all three together
 * to deliver to the channel — sessionKey alone makes the run "join" the
 * existing session, but the gateway still consults `channel` and `to`
 * for the actual delivery target.
 */
async function findChatTarget(
  api: OpenClawPluginApi,
): Promise<ChatTarget | undefined> {
  const sessionsPath = joinPath(
    homedir(),
    '.openclaw',
    'agents',
    'main',
    'sessions',
    'sessions.json',
  );
  let raw: string;
  try {
    raw = await readFile(sessionsPath, 'utf-8');
  } catch (err) {
    api.logger.debug(
      `sessions.json not readable at ${sessionsPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  let map: Record<string, SessionsMapEntry>;
  try {
    map = JSON.parse(raw) as Record<string, SessionsMapEntry>;
  } catch (err) {
    api.logger.warn(
      `sessions.json parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  const candidates = Object.entries(map)
    .filter(([key, val]) => {
      // Skip plugin-internal hook/heartbeat sessions and the plugin's own
      // bookkeeping sessions.
      if (key.startsWith('agent:main:hook:')) return false;
      if (key === 'agent:main:main') return false;
      if (key.startsWith('agent:main:index:')) return false;
      const target = readChannelTo(key, val);
      return target !== undefined && CHAT_CHANNEL_PREFIXES.includes(target.channel);
    })
    .sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const top = candidates[0];
  if (!top) return undefined;

  const target = readChannelTo(top[0], top[1]);
  if (!target) return undefined;
  return { sessionKey: top[0], channel: target.channel, to: target.to };
}

/**
 * Dispatches `ctx.prompt` to the user's main OpenClaw agent via
 * `POST /hooks/agent`. When a chat-bound session is found, the call
 * targets that session via `sessionKey` + `channel` + `to`; otherwise
 * it falls back to `channel: 'last'` (which the gateway maps to a fresh
 * isolated session — reply has nowhere to go, but the failure is
 * observable rather than silent).
 *
 * @param api - Plugin API. Reads `api.config.gateway.port` and `api.config.hooks.{enabled,token,path}`.
 * @param ctx - Prompt + idempotency key + optional timeout.
 * @returns A `DispatchResult`. On `error`, `delivered` is `false`.
 */
export async function dispatchToMainAgent(
  api: OpenClawPluginApi,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  const port = api.config?.gateway?.port;
  const hooks = api.config?.hooks;
  const hooksEnabled = hooks?.enabled === true;
  const hooksToken = typeof hooks?.token === 'string' ? hooks.token : '';
  const hooksPath = (typeof hooks?.path === 'string' && hooks.path
    ? hooks.path
    : '/hooks'
  ).replace(/\/+$/, '');

  if (!port) {
    api.logger.warn(
      'Cannot dispatch to main agent: gateway.port is missing from api.config.',
    );
    return { delivered: false, error: 'config_error' };
  }
  if (!hooksEnabled || !hooksToken) {
    api.logger.warn(
      'Cannot dispatch to main agent: hooks.enabled=false or hooks.token unset. ' +
        'Run `openclaw index setup` to bootstrap hooks.',
    );
    return { delivered: false, error: 'config_error' };
  }

  const target = await findChatTarget(api);
  const unboundFallback = !target;
  if (unboundFallback) {
    api.logger.info(
      'No chat-bound session found in sessions.json; falling back to channel:"last". ' +
        'The reply may land in an isolated session with no channel binding — send a ' +
        'message to your agent on a chat platform first.',
    );
  } else {
    api.logger.debug(
      `Dispatching to ${target.channel} (${target.to}) via sessionKey=${target.sessionKey}`,
    );
  }

  const url = `http://127.0.0.1:${port}${hooksPath}/agent`;
  const body: Record<string, unknown> = {
    message: ctx.prompt,
    wakeMode: 'now',
    deliver: true,
  };
  if (target) {
    body.sessionKey = target.sessionKey;
    body.channel = target.channel;
    body.to = target.to;
  } else {
    body.channel = 'last';
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${hooksToken}`,
        'idempotency-key': ctx.idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120_000),
    });
  } catch (err) {
    api.logger.warn(
      `${url} threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { delivered: false, error: 'network_error', unboundFallback };
  }

  if (res.status === 401 || res.status === 403) {
    api.logger.warn(
      `${url} returned ${res.status}: hooks.token rejected. ` +
        'Verify hooks.token in ~/.openclaw/openclaw.json matches what the plugin reads.',
    );
    return { delivered: false, error: 'unauthorized', unboundFallback };
  }
  if (!res.ok) {
    const respBody = await res.text().catch(() => '');
    api.logger.warn(`${url} returned ${res.status}: ${respBody.slice(0, 200)}`);
    return { delivered: false, error: 'network_error', unboundFallback };
  }

  return { delivered: true, unboundFallback };
}
