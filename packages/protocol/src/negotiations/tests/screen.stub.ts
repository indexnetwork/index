import { NegotiationScreener, type ScreenDecision } from "../negotiation.screen.js";

/**
 * The outreach screen now runs before first contact on every negotiation —
 * there is no mode that skips it. Graph specs that are not about the screen
 * stub it to a deterministic `reach_out` so they exercise the turns they are
 * actually about, instead of a live model call.
 *
 * @returns A restore function for `afterAll`.
 */
export function stubScreenerReachOut(): () => void {
  const original = NegotiationScreener.prototype.invoke;
  NegotiationScreener.prototype.invoke = async (): Promise<ScreenDecision> => ({
    decision: "reach_out",
    reasoning: "stubbed screen",
    evidence: { counterpartyPremiseFit: "", intentAlignment: "" },
  });
  return () => { NegotiationScreener.prototype.invoke = original; };
}
