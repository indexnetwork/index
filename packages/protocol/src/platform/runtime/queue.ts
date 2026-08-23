/**
 * Queue types for protocol layer.
 */

import type { ToolScopeType } from "../../protocol/core.js";

export interface IntentGraphQueueScope {
  scopeType?: ToolScopeType;
  scopeId?: string;
  /** @deprecated networkScopeId is legacy; use `scopeType: 'network'` + `scopeId`. */
  networkScopeId?: string;
}

/**
 * Operations the Intent Graph needs to enqueue follow-up work (e.g. HyDE generation/deletion).
 * Implemented by the intent queue; protocol layer depends only on this interface.
 */
export interface IntentGraphQueue {
  addGenerateHydeJob(data: { intentId: string; userId: string } & IntentGraphQueueScope): Promise<unknown>;
  addDeleteHydeJob(data: { intentId: string }): Promise<unknown>;
  /** Enqueue discovery for an intent resumed from PAUSED back to ACTIVE. */
  addResumeDiscoveryJob(data: { intentId: string; userId: string; lifecycleVersionMs: number }): Promise<unknown>;
}
