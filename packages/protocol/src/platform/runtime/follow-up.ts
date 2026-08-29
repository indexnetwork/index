/**
 * Host follow-up work the intent graph starts after a persist.
 */

import type { ToolScopeType } from "../../protocol/core.js";

export interface IntentFollowUpScope {
  scopeType?: ToolScopeType;
  scopeId?: string;
  /** @deprecated networkScopeId is legacy; use `scopeType: 'network'` + `scopeId`. */
  networkScopeId?: string;
}

/**
 * Operations the Intent Graph needs after it writes an intent (HyDE
 * generation/deletion, resume discovery). Implemented by the host.
 */
export interface IntentFollowUp {
  generateHyde(data: { intentId: string; userId: string } & IntentFollowUpScope): Promise<unknown>;
  deleteHyde(data: { intentId: string }): Promise<unknown>;
  /** Start discovery for an intent resumed from PAUSED back to ACTIVE. */
  resumeDiscovery(data: { intentId: string; userId: string; lifecycleVersionMs: number }): Promise<unknown>;
}
