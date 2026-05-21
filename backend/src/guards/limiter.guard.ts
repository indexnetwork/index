import { SYSTEM_AGENT_IDS } from '@indexnetwork/protocol';

import type { Guard } from '../lib/router/router.decorators';
import { resolveIdentifier, sha256Truncated } from '../lib/limiter/identifier';
import {
  getStorage,
  resolveClassConfig,
  isLimiterDisabled,
  type LimiterClass,
} from '../lib/limiter';
import { RateLimiterError } from '../lib/limiter/error';
import { log } from '../lib/log';

const logger = log.server.from('limiter.guard');

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number;
}

const infoByRequest = new WeakMap<Request, RateLimitInfo>();

export function getRateLimitInfo(req: Request): RateLimitInfo | undefined {
  return infoByRequest.get(req);
}

/**
 * Well-known system agent IDs that should never be rate-limited.
 *
 * @remarks This bypass is per spec but currently vestigial — the JWT payload
 * carries `user.id`, not `agentId`, so system agents authenticate inline rather
 * than via JWT. Kept as defense-in-depth for future token shapes.
 */
const SYSTEM_AGENT_USER_IDS = new Set<string>([
  SYSTEM_AGENT_IDS.chatOrchestrator,
  SYSTEM_AGENT_IDS.negotiator,
]);

/** Fired at most once per process when Railway edge headers aren't forwarding IPs. */
let warnedUnresolved = false;

const PRIVATE_IPV4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^169\.254\./,
];

const isPrivateOrLoopback = (ip: string) => {
  if (ip === 'unknown' || ip === '::1') return true;
  // IPv6: normalize case before prefix checks; RFC 5952 mandates lowercase but
  // some clients send uppercase (e.g. FC00::1).
  const lower = ip.toLowerCase();
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;  // ULA fc00::/7
  if (/^fe[89ab]/.test(lower)) return true;                            // link-local fe80::/10
  return PRIVATE_IPV4.some(re => re.test(ip));
};

/**
 * RateLimit(class): returns a Guard that enforces the given route-class limit
 * before the request reaches the auth guard. On allowed requests, stashes
 * header info on a per-Request WeakMap for the response post-processor.
 *
 * @example
 *   @UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
 *   async listOpportunities(req, user, params) { ... }
 */
export function RateLimit(cls: LimiterClass): Guard {
  const guard = async (req: Request): Promise<null> => {
    if (isLimiterDisabled()) return null;

    const id = await resolveIdentifier(req);

    // System agents bypass rate limiting (per spec; vestigial today — see SYSTEM_AGENT_USER_IDS).
    if (id.kind === 'user' && SYSTEM_AGENT_USER_IDS.has(id.value)) return null;

    // 'unresolved' means Railway is running but no edge header carried a valid IP — rate-limit
    // under a shared bucket as a defensive default. Log once so operators notice the misconfig.
    if (id.kind === 'ip' && id.value === 'unresolved') {
      if (!warnedUnresolved) {
        warnedUnresolved = true;
        logger.warn('Client IP could not be resolved on Railway — rate-limiting under shared bucket. Check edge headers.');
      }
    }

    // 'unknown' is the off-Railway sentinel (no socket peer available in local dev) — bypass.
    if (id.kind === 'ip' && isPrivateOrLoopback(id.value)) return null;

    const { perMinute, windowSec } = resolveClassConfig(cls);
    // `id.kind` is either 'user' (verified JWT) or 'ip' (everything else).
    // Hash the user UUID so the raw identity isn't written into the Redis
    // keyspace — defense-in-depth so operators inspecting Redis don't see
    // user IDs. The IP and its 'unresolved'/'unknown' sentinels are kept
    // readable on purpose: they're operator-relevant for tracing abuse.
    const bucketValue = id.kind === 'user' ? await sha256Truncated(id.value) : id.value;
    const key = `limiter:${cls}:${id.kind}:${bucketValue}`;

    let result;
    try {
      const storage = await getStorage();
      result = await storage.hit(key, windowSec, perMinute);
    } catch (err) {
      logger.error('Limiter storage error — failing open', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    const remaining = Math.max(0, result.limit - result.count);
    infoByRequest.set(req, { limit: result.limit, remaining, resetAt: result.resetAt });

    if (!result.allowed) {
      logger.warn('rate_limited', {
        cls,
        identifier_kind: id.kind,
        key_hash: bucketValue,   // hashed for kind=user; raw IP/sentinel for kind=ip
        count: result.count,
        limit: result.limit,
      });
      throw new RateLimiterError(cls, result.limit, 0, result.resetAt);
    }
    return null;
  };
  Object.defineProperty(guard, 'name', { value: `RateLimit(${cls})` });
  return guard as Guard;
}
