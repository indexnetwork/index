/**
 * Interaction-wide composition contract.
 *
 * The physical tool-factory implementation remains in shared/agent during the
 * in-place phase. It is classified as this conceptual capability by the
 * architecture gate, which is the only explicitly allowed all-capability point.
 */
export const interactionCompositionCapability = "interaction-composition" as const;
export { MaintenanceGraphFactory } from "../maintenance/maintenance.graph.js";
export type { MaintenanceGraphDatabase, MaintenanceGraphCache, MaintenanceGraphQueue } from "../maintenance/maintenance.graph.js";
