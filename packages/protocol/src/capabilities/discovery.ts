import { HydeGraphFactory } from "../internal/discovery/hyde.graph.js";

import type { HydeGraphDatabase } from "../platform/database.js";
import type { EmbeddingGenerator } from "../platform/embedder.js";
import type { HydeCache } from "../platform/cache.js";
import type { HydeGeneratorLike, HydeGraphOptions, HydeLensInferrerLike } from "../internal/discovery/hyde.graph.js";

/** Host ports and model-backed collaborators required for HyDE generation. */
export interface DiscoveryDeps {
  database: HydeGraphDatabase;
  embedder: EmbeddingGenerator;
  cache: HydeCache;
  inferrer: HydeLensInferrerLike;
  generator: HydeGeneratorLike;
  options?: HydeGraphOptions;
}

/** Executable discovery capability: builds the HyDE retrieval graph. */
export class Discovery {
  constructor(private readonly deps: DiscoveryDeps) {}

  public createHydeGraph() {
    const { database, embedder, cache, inferrer, generator, options } = this.deps;
    return new HydeGraphFactory(database, embedder, cache, inferrer, generator, options).createGraph();
  }
}
