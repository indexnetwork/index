/**
 * Queue types for protocol layer.
 */

import type { ToolScopeType } from "../agent/tool.scope.js";

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
}
