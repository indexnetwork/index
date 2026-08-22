import { OpportunityGraphFactory } from "../internal/opportunities/opportunity.graph.js";

/** Host-supplied composition inputs for opportunity discovery and its modes. */
export type OpportunitiesDeps = ConstructorParameters<typeof OpportunityGraphFactory>;

/** Executable opportunity capability: owns one discovery/mutation graph factory. */
export class Opportunities {
  private readonly factory: OpportunityGraphFactory;

  constructor(...deps: OpportunitiesDeps) {
    this.factory = new OpportunityGraphFactory(...deps);
  }

  public createGraph() { return this.factory.createGraph(); }
  public read(request: Parameters<OpportunityGraphFactory["readOpportunities"]>[0]) { return this.factory.readOpportunities(request); }
  public update(request: Parameters<OpportunityGraphFactory["updateOpportunityStatus"]>[0]) { return this.factory.updateOpportunityStatus(request); }
  public remove(request: Parameters<OpportunityGraphFactory["deleteOpportunity"]>[0]) { return this.factory.deleteOpportunity(request); }
  public send(request: Parameters<OpportunityGraphFactory["sendOpportunity"]>[0]) { return this.factory.sendOpportunity(request); }
}
