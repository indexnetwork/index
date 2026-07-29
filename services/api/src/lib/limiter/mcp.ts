import { getStorage } from './index';
import { intEnv, isLimiterDisabled, resolveClassConfig } from './config';
import { resolveIdentifier, sha256Truncated } from './identifier';
import type { LimiterStorage } from './storage';
import { log } from '../log';

const logger = log.server.from('limiter');

/**
 * Per-principal, per-tool throttle for the MCP transport.
 *
 * The `/mcp` endpoint bypasses the controller-level `RateLimit` guard (it is
 * dispatched directly in `main.ts` before the `/api/*` branch), so without this
 * an authenticated agent can fire tool calls unbounded — which is how an
 * over-eager autonomous agent drove itself into provider rate limits. This caps
 * call volume two ways: a tight per-(principal, tool) bucket (with a much lower
 * ceiling for the expensive `discover_opportunities`) and a looser aggregate
 * per-principal bucket as a backstop across all tools.
 */

const WINDOW_SEC = 60;

const PRIVATE_IPV4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^169\.254\./,
];

const isPrivateOrLoopbackIp = (ip: string): boolean => {
  if (ip === 'unknown' || ip === '::1') return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  return PRIVATE_IPV4.some((re) => re.test(ip));
};

/** Per-tool ceiling per principal per minute. `discover_opportunities` is expensive, so it is far tighter. */
function toolLimit(toolName: string): number {
  return intEnv('MCP_LIMIT_TOOL_PER_MIN', 120);
}

/** Aggregate ceiling per principal per minute, across all tools. */
function principalLimit(): number {
  return intEnv('MCP_LIMIT_PRINCIPAL_PER_MIN', 300);
}

export interface McpThrottleInput {
  userId: string;
  agentId?: string;
  toolName: string;
}

export interface McpThrottleDecision {
  allowed: boolean;
  /** Seconds until the offending bucket resets (present when blocked). */
  retryAfterSec?: number;
  /** The limit that was exceeded (present when blocked). */
  limit?: number;
  /** Which bucket blocked: a single tool, or the principal-wide aggregate. */
  scope?: 'tool' | 'principal';
}

const retryAfter = (resetAt: number): number =>
  Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

export interface McpHttpThrottleDecision {
  allowed: boolean;
  retryAfterSec?: number;
  limit?: number;
  remaining?: number;
  resetAt?: number;
}

/**
 * Cheap HTTP-level throttle for the `/mcp` endpoint.
 *
 * Runs before MCP server/transport allocation. It intentionally buckets only by
 * verified JWT user or client IP (same pre-auth posture as RateLimit) so raw
 * API keys cannot be rotated to create fresh buckets.
 */
export async function checkMcpHttpRateLimit(
  req: Request,
  storage?: LimiterStorage,
): Promise<McpHttpThrottleDecision> {
  if (isLimiterDisabled()) return { allowed: true };

  try {
    const id = await resolveIdentifier(req);
    if (id.kind === 'ip' && isPrivateOrLoopbackIp(id.value)) {
      return { allowed: true };
    }

    const { perMinute, windowSec } = resolveClassConfig('mcp_http');
    const bucketValue = id.kind === 'user' ? await sha256Truncated(id.value) : id.value;
    const store = storage ?? (await getStorage());
    const hit = await store.hit(`mcp:http:${id.kind}:${bucketValue}`, windowSec, perMinute);
    const remaining = Math.max(0, hit.limit - hit.count);

    if (!hit.allowed) {
      return {
        allowed: false,
        retryAfterSec: retryAfter(hit.resetAt),
        limit: hit.limit,
        remaining,
        resetAt: hit.resetAt,
      };
    }

    return {
      allowed: true,
      limit: hit.limit,
      remaining,
      resetAt: hit.resetAt,
    };
  } catch (err) {
    logger.error('MCP HTTP limiter storage/identity error — failing open', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true };
  }
}

/**
 * Check (and consume) the MCP rate budget for one tool call.
 *
 * @param input - the resolved principal (userId + optional agentId) and tool name
 * @param storage - optional storage override (tests inject MemoryStorage); defaults to the shared limiter storage
 * @returns a decision; `allowed: false` carries `retryAfterSec`, `limit`, and `scope`
 */
export async function checkMcpRateLimit(
  input: McpThrottleInput,
  storage?: LimiterStorage,
): Promise<McpThrottleDecision> {
  if (isLimiterDisabled()) return { allowed: true };

  // Fail OPEN on storage errors (Redis/bootstrap hiccups) so a limiter incident
  // never takes down /mcp tool dispatch — same posture as the RateLimit guard
  // (services/api/src/guards/limiter.guard.ts).
  try {
    // Hash the principal so raw user/agent UUIDs aren't written into the Redis
    // keyspace — same defense-in-depth the RateLimit guard applies to user IDs.
    const principal = await sha256Truncated(`${input.userId}:${input.agentId ?? '-'}`);
    const store = storage ?? (await getStorage());

    const toolMax = toolLimit(input.toolName);
    const toolHit = await store.hit(`mcp:tool:${principal}:${input.toolName}`, WINDOW_SEC, toolMax);
    if (!toolHit.allowed) {
      return { allowed: false, retryAfterSec: retryAfter(toolHit.resetAt), limit: toolMax, scope: 'tool' };
    }

    const aggMax = principalLimit();
    const aggHit = await store.hit(`mcp:all:${principal}`, WINDOW_SEC, aggMax);
    if (!aggHit.allowed) {
      return { allowed: false, retryAfterSec: retryAfter(aggHit.resetAt), limit: aggMax, scope: 'principal' };
    }

    return { allowed: true };
  } catch (err) {
    logger.error('MCP limiter storage error — failing open', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true };
  }
}
