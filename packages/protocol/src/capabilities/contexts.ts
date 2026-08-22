import { EnrichmentGraphFactory } from "../internal/enrichment/enrichment.graph.js";
import { PremiseGraphFactory } from "../internal/premises/premise.graph.js";
import { createEnrichmentTools } from "../internal/enrichment/enrichment.tools.js";
import type { DefineTool } from "../internal/shared/agent/tool.helpers.js";
import type { EnrichmentToolDeps } from "../internal/contexts/context.tools.port.js";
import type { EnrichmentGraphDatabase, PremiseGraphDatabase } from "../platform/database.js";
import type { Embedder } from "../platform/embedder.js";
import type { ProfileEnricher } from "../platform/enrichment.js";
import type { Scraper } from "../platform/scraper.js";

/** Host ports required for profile enrichment and premise lifecycle behavior. */
export interface ContextsDeps {
  enrichmentDatabase: EnrichmentGraphDatabase;
  premiseDatabase: PremiseGraphDatabase;
  embedder: Embedder;
  scraper: Scraper;
  enricher?: ProfileEnricher;
}

/** Executable user-context capability: composes premise and enrichment graphs. */
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

  public static createTools(defineTool: DefineTool, deps: EnrichmentToolDeps) {
    return createEnrichmentTools(defineTool, deps);
  }
}
