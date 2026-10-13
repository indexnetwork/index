/**
 * The two blurbs on a network's public invite page (`/l/:code`): what people
 * are looking for, and what their agents are negotiating about. A model reads
 * the members' recent signals and negotiating pairs and writes aggregate,
 * lightly funny overviews; no single signal ever reaches the page.
 *
 * The page is public and unauthenticated, so the model runs at most once per
 * network per {@link SUMMARY_TTL_SECONDS}, never on every view: results (empty
 * ones included) are cached in Redis, concurrent views share one call, and a
 * view waits at most {@link WAIT_MS} before the page renders without it.
 */
import { NetworkPulseSummarizer, type NetworkPulseSummary } from '@indexnetwork/protocol';

import { log } from './log';
import { isRedisConfigured } from './redis-env';

/** A network smaller than this shows counts only; a summary of a few people points at them. */
export const SUMMARY_MIN_MEMBERS = 5;
const SUMMARY_TTL_SECONDS = 6 * 60 * 60;
const WAIT_MS = 4_000;

const logger = log.lib.from('network-pulse-summary');
const inFlight = new Map<string, Promise<NetworkPulseSummary>>();
const NONE: NetworkPulseSummary = { summary: null, negotiations: null };
let summarizer: NetworkPulseSummarizer | null = null;


async function cache() {
  if (!isRedisConfigured()) return null;
  // Imported lazily: the cache module connects to Redis as soon as it loads.
  const { cacheAdapter } = await import('../adapters/cache.adapter');
  return cacheAdapter;
}

type Input = { networkTitle: string; signals: string[]; negotiations: Array<{ a: string; b: string }> };

async function compute(key: string, input: Input): Promise<NetworkPulseSummary> {
  summarizer ??= new NetworkPulseSummarizer();
  // A failed call is not cached, so the next view tries again.
  const summary = await summarizer.invoke(input);
  if (!summary) return NONE;
  try {
    await (await cache())?.set<NetworkPulseSummary>(key, summary, { ttl: SUMMARY_TTL_SECONDS });
  } catch (error) {
    logger.warn('Could not cache network summary', { error });
  }
  return summary;
}

/**
 * The cached overviews for a network, computing them when missing.
 * @returns Both texts; each is null when there is none yet, too little to say, or no Redis to keep it in.
 */
export async function getNetworkPulseSummary(networkId: string, input: Input): Promise<NetworkPulseSummary> {
  const store = await cache();
  // Without a cache every public view would call the model; show counts only.
  if (!store) return NONE;
  const key = `network-pulse-summary:v2:${networkId}`;
  try {
    const hit = await store.get<NetworkPulseSummary>(key);
    if (hit) return hit;
  } catch (error) {
    logger.warn('Could not read network summary cache', { error });
  }
  if (input.signals.length < 3 && input.negotiations.length < 2) return NONE;

  let pending = inFlight.get(key);
  if (!pending) {
    pending = compute(key, input)
      .catch((error) => {
        logger.error('Network summary failed', { error });
        return NONE;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const timeout = new Promise<NetworkPulseSummary>((resolve) => setTimeout(() => resolve(NONE), WAIT_MS));
  return Promise.race([pending, timeout]);
}
