/**
 * Host bridge for the negotiator persona's `remember`/`forget` chat tools
 * (P5.4 / IND-408).
 *
 * The negotiator's private memory store lives on the host (API) side; the
 * protocol package only ever sees this narrow surface. The bridge is
 * injected by the composition root ONLY into the negotiator persona's
 * toolset — the orchestrator registry never registers these tools — and
 * only when the host's memory write flag is on.
 */

/** Memory kinds the client can create directly from chat. Deliberately
 *  excludes `counterparty_dossier`: dossiers are distilled from negotiation
 *  transcripts, not dictated. */
export type RememberableMemoryKind = "disclosure_rule" | "playbook" | "threshold";

export interface NegotiatorMemoryRememberInput {
  kind: RememberableMemoryKind;
  /** The rule as one self-contained sentence (what the client actually said). */
  content: string;
  /** Chat session the instruction came from (provenance). */
  sessionId?: string;
}

/** A remembered/deleted row, shaped for chat rendering (no embedding, no refs). */
export interface NegotiatorMemoryToolView {
  id: string;
  kind: string;
  content: string;
}

export type NegotiatorMemoryForgetResult =
  /** Exactly one memory matched and was deleted. */
  | { status: "deleted"; memory: NegotiatorMemoryToolView }
  /** Several memories matched; the client must pick one (re-call with memoryId). */
  | { status: "ambiguous"; candidates: NegotiatorMemoryToolView[] }
  /** Nothing matched the reference/description. */
  | { status: "not_found" };

export interface NegotiatorMemoryToolsHost {
  /**
   * Persist a standing rule the client just stated in chat.
   * Returns null when memory writes are disabled on the host.
   */
  remember(
    userId: string,
    input: NegotiatorMemoryRememberInput,
  ): Promise<NegotiatorMemoryToolView | null>;
  /**
   * Delete a memory by id or by the client's description of it.
   * Deletion is always honored regardless of the write flag — forgetting is
   * the client's standing right.
   */
  forget(
    userId: string,
    input: { memoryId?: string; description?: string },
  ): Promise<NegotiatorMemoryForgetResult>;
}
