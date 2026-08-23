import { EnrichmentGraphFactory } from "../internal/enrichment/enrichment.graph.js";
import { PremiseGraphFactory } from "../internal/premises/premise.graph.js";
import type { EnrichmentGraphDatabase, PremiseGraphDatabase } from "../platform/database.js";
import type { Embedder } from "../platform/discovery/embedder.js";
import type { ProfileEnricher } from "../platform/enrichment/ports.js";
import type { Scraper } from "../platform/discovery/scraper.js";

/** Host ports for premise decomposition graphs used during profile saves. */
export interface ContextsDeps {
  enrichmentDatabase: EnrichmentGraphDatabase;
  premiseDatabase: PremiseGraphDatabase;
  embedder: Embedder;
  scraper: Scraper;
  enricher?: ProfileEnricher;
}

/** Premise decomposition graphs for profile text → premises. */
export class Contexts {
  constructor(private readonly deps: ContextsDeps) {}

  public createPremiseGraph() {
    const { premiseDatabase, embedder } = this.deps;
    return new PremiseGraphFactory(premiseDatabase, embedder).createGraph();
  }

  public createEnrichmentGraph() {
    const { enrichmentDatabase, scraper, enricher } = this.deps;
    return new EnrichmentGraphFactory(enrichmentDatabase, scraper, enricher, this.createPremiseGraph()).createGraph();
  }
}
