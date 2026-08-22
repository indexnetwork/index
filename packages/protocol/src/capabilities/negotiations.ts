import { NegotiationGraphFactory } from "../internal/negotiations/negotiation.graph.js";

/** Host-supplied composition inputs for bilateral negotiation behavior. */
export type NegotiationsDeps = ConstructorParameters<typeof NegotiationGraphFactory>;

/** Executable negotiation capability: owns the bilateral negotiation graph. */
export class Negotiations {
  constructor(private readonly deps: NegotiationsDeps) {}

  public createGraph() {
    return new NegotiationGraphFactory(...this.deps).createGraph();
  }
}
