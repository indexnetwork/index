import type { NegotiationGraphDatabase } from "../../platform/database/negotiation.js";
import type { NegotiationGraphLike } from "./negotiation.graph.js";

/**
 * Host capabilities consumed by the negotiation tool factory.
 *
 * Defined inline here (not derived from ToolRegistryCompositionDeps) to avoid
 * a negotiation → interaction-composition capability dependency, following the
 * same narrow-port pattern as the other tool contracts.
 */
export interface NegotiationToolDeps {
  negotiationDatabase: NegotiationGraphDatabase;
  negotiationGraph: NegotiationGraphLike;
}
