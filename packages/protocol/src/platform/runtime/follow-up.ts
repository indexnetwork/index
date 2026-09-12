/**
 * Host follow-up work the intent graph starts after a persist.
 */

import type { ScopeType } from "../../protocol/core.js";

export interface IntentFollowUpScope {
  scopeType?: ScopeType;
  scopeId?: string;
  /** @deprecated networkScopeId is legacy; use `scopeType: 'network'` + `scopeId`. */
  networkScopeId?: string;
}

/**
 * Operations the Intent Graph needs after it writes or resumes an intent. Implemented by the host.
 */
export interface IntentFollowUp {
  /** Measure edited text after persistence. Must never gate, rewrite, archive, or undo the intent, including on failure. Apply metadata only if the owner and payload still match. */
  scoreIntent(data: { intentId: string; userId: string; payload: string }): Promise<unknown>;
  /** Schedule post-save matching work. Failures must not undo the saved intent. */
  onIntentSaved(data: { intentId: string; userId: string } & IntentFollowUpScope): Promise<unknown>;
  /** Schedule post-archive follow-up. Failures must not undo archival. */
  onIntentArchived(data: { intentId: string }): Promise<unknown>;
  /** Start discovery for an intent resumed from PAUSED back to ACTIVE. */
  onIntentResumed(data: { intentId: string; userId: string; lifecycleVersionMs: number }): Promise<unknown>;
}
