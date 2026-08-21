import { z } from "zod";

/**
 * negotiations/domain — screen-gate pure contracts (P2.1).
 *
 * Extracted from negotiation.screen.ts so that NegotiationGraphState and the
 * application-layer NegotiationScreener can share types without a domain →
 * application cycle.
 *
 * IND-550: canonical location for screen contract types.
 * Legacy path (negotiations/negotiation.screen.ts shim) re-exports from here
 * via the application layer.
 */

export const NEGOTIATION_SCREEN_MODES = ["off", "shadow", "enforce"] as const;

export type NegotiationScreenMode = (typeof NEGOTIATION_SCREEN_MODES)[number];

/**
 * The mode every new screen decision is stamped with. Kept as a field on the
 * record rather than assumed, because decisions stamped `off` or `shadow`
 * before the cutover are still read by
 * {@link blocksNegotiationBeforeFirstTurn}.
 */
export const SCREEN_MODE: NegotiationScreenMode = "enforce";

/**
 * Structured screen decision — the outreach gate's verdict on whether this
 * match is worth the client's name before any turn is exchanged.
 */
export const ScreenDecisionSchema = z.object({
  decision: z.enum(["reach_out", "pass"]),
  reasoning: z.string(),
  /** Suggested opening angle for the outreach turn (only when reaching out). */
  outreachAngle: z.string().nullable().optional(),
  evidence: z.object({
    /** How well the counterparty's contexts/premises fit the client's need. */
    counterpartyPremiseFit: z.string(),
    /** How the client's intents align with what the counterparty seeks. */
    intentAlignment: z.string(),
    /** Prior-negotiation memory signals (P5.3). Filled only when negotiator memory was injected into the screen prompt. */
    memoryHints: z.string().nullable().optional(),
  }),
});

export type ScreenDecision = z.infer<typeof ScreenDecisionSchema>;

/**
 * The record persisted to `tasks.metadata.screenDecision` and returned into
 * graph state. Extends the LLM decision with operational context so pass-rate
 * queries can group by mode and exclude failed-open rows.
 */
export interface ScreenDecisionRecord extends ScreenDecision {
  mode: NegotiationScreenMode;
  /** True when the screen LLM call failed and the gate defaulted open. */
  failedOpen?: boolean;
  /** Error message when `failedOpen` is set. */
  error?: string;
  screenedAt: string;
  durationMs: number;
}

/**
 * Whether an enforce-mode outreach screen blocks a negotiation before any
 * turn is exchanged. Shadow-mode pass decisions are recorded but never block.
 * Failed-open rows are treated as reach_out regardless of `decision`.
 */
export function blocksNegotiationBeforeFirstTurn(
  decisionRecord: ScreenDecisionRecord | null | undefined,
  turnCount: number,
): boolean {
  if (!decisionRecord) return false;
  return (
    decisionRecord.mode === "enforce" &&
    !decisionRecord.failedOpen &&
    decisionRecord.decision === "pass" &&
    turnCount === 0
  );
}

/**
 * Whether a negotiation has already made contact — the fact the outreach gate
 * exists to decide, and therefore the fact that makes re-deciding it a
 * category error.
 *
 * The screen asks one question: "should we make first contact?". Once an agent
 * message for this negotiation is on the counterparty's thread, that question
 * has been answered by the world, and a `pass` here would end a negotiation the
 * counterparty was never given a chance to answer — while the outreach it
 * denies sits visibly above the notice saying no contact was ever made. This
 * was observed live: an error-stalled negotiation recovered through
 * `negotiation-run-existing` re-screened, passed, and flipped to `rejected`
 * with `screened_out` two hours after its outreach landed.
 *
 * Contact is a PERSISTED TURN, not a screen decision: a screen record is task
 * metadata, so a continuation whose only prior activity is a screen has still
 * sent nothing and is still genuinely pre-contact.
 *
 * `ask_user` is the one persisted turn that is not contact. It parks the
 * negotiation to ask the client's OWN principal a question before deciding to
 * reach out; nothing was ever addressed to the counterparty. This is the same
 * reading `isPreContactConsultResume` already applies to an all-`ask_user`
 * history, and keeping the two in step is what lets a pre-contact consult
 * resume still resolve as the opening decision it is.
 *
 * Scope matters as much as the predicate: callers pass THIS negotiation's turns
 * (`readNegotiationMessages`), never the pair's whole DM. A new match reusing an
 * established `dm_pair` conversation has made no contact of its own and must
 * still be screened (IND-563) — the pair's earlier dialogue reaches the gate as
 * labelled context instead.
 */
export function negotiationHasMadeContact(
  turns: readonly { action: string }[],
): boolean {
  return turns.some((turn) => turn.action !== "ask_user");
}
