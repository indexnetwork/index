import { getStorage } from './index';
import { intEnv, isLimiterDisabled } from './config';
import { sha256Truncated } from './identifier';
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

/** Per-tool ceiling per principal per minute. `discover_opportunities` is expensive, so it is far tighter. */
function toolLimit(toolName: string): number {
  if (toolName === 'discover_opportunities') return intEnv('MCP_LIMIT_DISCOVER_PER_MIN', 10);
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
  // (backend/src/guards/limiter.guard.ts).
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
