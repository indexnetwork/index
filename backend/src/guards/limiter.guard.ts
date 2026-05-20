import type { Guard } from '../lib/router/router.decorators';
import { resolveIdentifier } from '../lib/limiter/identifier';
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

const PRIVATE_IPV4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^169\.254\./,
];
const isPrivateOrLoopback = (ip: string) =>
  ip === 'unknown' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') ||
  PRIVATE_IPV4.some(re => re.test(ip));

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
    if (id.kind === 'ip' && isPrivateOrLoopback(id.value)) return null;

    const { perMinute, windowSec } = resolveClassConfig(cls);
    const key = `limiter:${cls}:${id.kind}:${id.value}`;

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
        cls, identifier_kind: id.kind, count: result.count, limit: result.limit,
      });
      throw new RateLimiterError(cls, result.limit, 0, result.resetAt);
    }
    return null;
  };
  Object.defineProperty(guard, 'name', { value: `RateLimit(${cls})` });
  return guard as Guard;
}
