import { NegotiationGraphFactory, type NegotiationGraphDeps } from "../internal/negotiations/negotiation.graph.js";

/** Host-supplied composition inputs for bilateral negotiation behavior. */
export type NegotiationsDeps = NegotiationGraphDeps;

/** Executable negotiation capability: owns the negotiation graph. */
export class Negotiations {
  constructor(private readonly deps: NegotiationsDeps) {}

  public createGraph() {
    return new NegotiationGraphFactory(this.deps).createGraph();
  }
}
