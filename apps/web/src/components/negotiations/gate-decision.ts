import type { ConversationNegotiationLifecycle } from '@/services/conversation';

/** The owner-only outreach-gate decision, as projected by the API (IND-610). */
export type GateDecision = NonNullable<ConversationNegotiationLifecycle['screenDecision']>;

/**
 * Whether the negotiation show page should replace its zero-turn dead end with
 * the gate card, and with which decision.
 *
 * Kept pure and separate from rendering so the branch that decides to expose a
 * private decision is directly testable. Three conditions, all required:
 * - **no turns** — the only branch where the transcript has nothing to show;
 *   a negotiation that produced turns tells its own story through the rail,
 *   and a "did not reach out" card there would flatly contradict it;
 * - **`screened_out`** — the outcome that means no contact was ever made. The
 *   live route is the opening-turn withdraw; the removed outreach gate is the
 *   other, still present on historical rows. Gating on the OUTCOME rather than
 *   on `screenDecision.decision` is what keeps a stored non-blocking `pass`
 *   from ever rendering as a refusal;
 * - **reasoning present** — a card with nothing to say is worse than the
 *   existing generic resolved banner, so we fall back to that instead.
 *
 * The owner check is deliberately not repeated here: `screenDecision` is absent
 * for a non-owner because the API never projects it to one. That guarantee is
 * enforced server-side, where it cannot be bypassed by a crafted request.
 */
export function resolveGateDecision(params: {
  turnCount: number;
  outcomeReason: string | null;
  screenDecision: ConversationNegotiationLifecycle['screenDecision'];
}): GateDecision | null {
  const { turnCount, outcomeReason, screenDecision } = params;
  if (turnCount !== 0) return null;
  if (outcomeReason !== 'screened_out') return null;
  if (!screenDecision || screenDecision.reasoning.trim() === '') return null;
  return screenDecision;
}
