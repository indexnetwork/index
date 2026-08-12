import { createHash } from 'node:crypto';

import type { CacheOptions, HydeCache } from '@indexnetwork/protocol';

export interface HistoricalQualityCacheNamespaceSeed {
  readonly runId: string;
  readonly slotId: string;
  readonly configurationId: 'a';
}

/**
 * Restricts the historical-quality child to its own bounded HyDE keyspace.
 * The deliberately narrow public surface cannot scan, flush, or delete by pattern.
 */
export class NamespacedHydeCache implements HydeCache {
  readonly #inner: HydeCache;
  readonly #prefix: string;

  constructor(inner: HydeCache, namespaceSeed: HistoricalQualityCacheNamespaceSeed) {
    this.#inner = inner;
    const canonicalSeed = JSON.stringify({
      configurationId: namespaceSeed.configurationId,
      runId: namespaceSeed.runId,
      slotId: namespaceSeed.slotId,
    });
    const digest = createHash('sha256').update(canonicalSeed).digest('hex');
    this.#prefix = `historical-quality:v1:${digest}:`;
  }

  #key(key: string): string {
    if (key.includes('\n') || key.includes('\r') || key.includes('\0') || key.length > 1024) {
      throw new Error('Historical quality cache key is invalid');
    }
    return `${this.#prefix}${key}`;
  }

  get<T>(key: string): Promise<T | null> {
    return this.#inner.get<T>(this.#key(key));
  }

  set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    return this.#inner.set(this.#key(key), value, options);
  }

  delete(key: string): Promise<boolean> {
    return this.#inner.delete(this.#key(key));
  }

  exists(key: string): Promise<boolean> {
    return this.#inner.exists(this.#key(key));
  }
}
