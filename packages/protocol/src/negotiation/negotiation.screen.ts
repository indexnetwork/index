/**
 * Thin backward-compat shim — IND-550.
 * Canonical location:
 *   - NegotiationScreener, NegotiationScreenerInput → negotiation/application/negotiation.screen.ts
 *   - Screen contract types (NegotiationScreenMode, ScreenDecisionRecord, etc.)
 *     → negotiation/domain/negotiation.screen.contracts.ts (re-exported via application)
 */
export * from "./application/negotiation.screen.js";
