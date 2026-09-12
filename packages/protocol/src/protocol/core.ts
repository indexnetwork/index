/** Portable vocabulary for a request's focused protocol scope. */
export type ScopeType = "network" | "intent";

export interface ScopeMembership {
  networkId: string;
}

/** One model-backed operation recorded within a graph invocation. */
export interface DebugMetaAgent {
  name: string;
  durationMs: number;
}
