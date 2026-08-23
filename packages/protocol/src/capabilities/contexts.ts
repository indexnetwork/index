import { EnrichmentGraphFactory } from "../internal/enrichment/enrichment.graph.js";
import { PremiseGraphFactory } from "../internal/premises/premise.graph.js";
import type { EnrichmentGraphDatabase, PremiseGraphDatabase } from "../platform/database.js";
import type { Embedder } from "../platform/discovery/embedder.js";

/** Host ports for the profile query graph and premise lifecycle graph. */
export interface ContextsDeps {
  enrichmentDatabase: EnrichmentGraphDatabase;
  premiseDatabase: PremiseGraphDatabase;
  embedder: Embedder;
}

/** Profile query graph and premise lifecycle (create/update/query/decompose) graph. */
export class Contexts {
  constructor(private readonly deps: ContextsDeps) {}

  public createPremiseGraph() {
    const { premiseDatabase, embedder } = this.deps;
    return new PremiseGraphFactory(premiseDatabase, embedder).createGraph();
  }

  public createEnrichmentGraph() {
    return new EnrichmentGraphFactory(this.deps.enrichmentDatabase).createGraph();
  }
}
