import type { ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";

/** Host capabilities consumed by enrichment tools (public profile prefill). */
export type EnrichmentToolDeps = Pick<ToolRegistryCompositionDeps, "userDb" | "enricher">;
