/** Portable vocabulary for a request's focused protocol scope. */
export type ToolScopeType = "network" | "intent";

export interface ScopeMembership {
  networkId: string;
  isPersonal?: boolean | null;
}
