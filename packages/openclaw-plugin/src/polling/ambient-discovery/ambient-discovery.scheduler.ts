import type { PluginLogger } from '../../lib/openclaw/plugin-api.js';

const BASE_INTERVAL_MS = 300_000;
const MAX_BACKOFF_MULTIPLIER = 16;

let timer: ReturnType<typeof setTimeout> | null = null;
let backoffMultiplier = 1;

export interface AmbientDiscoverySchedulerConfig {
  gatewayPort: number;
  gatewayToken: string;
  logger: PluginLogger;
}

/**
 * Starts the ambient discovery scheduler, which periodically triggers the
 * `/index/poll/ambient-discovery` route via local fetch.
 *
 * @param config - Scheduler configuration including gateway port and token.
 */
export function start(config: AmbientDiscoverySchedulerConfig): void {
  if (timer) { clearTimeout(timer); }

  const trigger = () => {
    fetch(`http://127.0.0.1:${config.gatewayPort}/index/poll/ambient-discovery`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.gatewayToken}` },
      signal: AbortSignal.timeout(30_000),
    }).catch((err) => {
      config.logger.error(
        `Ambient discovery poll trigger failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const scheduleNext = () => {
    timer = setTimeout(() => { trigger(); scheduleNext(); }, BASE_INTERVAL_MS * backoffMultiplier);
    timer.unref();
  };

  scheduleNext();
  setTimeout(trigger, 5_000).unref();
}

/**
 * Increases the backoff multiplier on consecutive failures.
 *
 * @param logger - Logger for reporting the new backoff interval.
 */
export function increaseBackoff(logger: PluginLogger): void {
  if (backoffMultiplier < MAX_BACKOFF_MULTIPLIER) {
    backoffMultiplier = Math.min(backoffMultiplier * 2, MAX_BACKOFF_MULTIPLIER);
    const seconds = (BASE_INTERVAL_MS * backoffMultiplier / 1000).toFixed(0);
    logger.info(
      `Ambient discovery backing off — next poll in ${seconds}s (×${backoffMultiplier} base interval after error; see preceding warn/error)`,
    );
  }
}

/** Resets the backoff multiplier to 1 after a successful poll. */
export function resetBackoff(): void {
  backoffMultiplier = 1;
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  backoffMultiplier = 1;
}
