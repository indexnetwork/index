import { z } from 'zod';

/**
 * Model-visible directives for the dedicated Hermes negotiation bridge
 * (rewrite, #1494). No model-authored prose crosses this boundary: a bridge
 * chooses WHICH action, never WHAT to say. There is no `accept` or `decline`
 * here — a bridge recommends a verdict to its own principal via
 * `recommend_pending` / `recommend_reject`; only IS-A resolves it.
 *
 * Nothing turns one of these into a persisted turn today. External-agent
 * dispatch is offline until it is rebuilt on the new auth model, so the
 * builder that mapped an action to a fixed template message was deleted with
 * the dead route it served (D24); this is the vocabulary the eventual
 * replacement has to honour, and the enum `hermes-plugin` mirrors.
 */
export const HermesNegotiationActionSchema = z.enum([
  'outreach',
  'counter',
  'question',
  'ask_principal',
  'recommend_pending',
  'recommend_reject',
]);
export type HermesNegotiationAction = z.infer<typeof HermesNegotiationActionSchema>;

export const HermesOwnerDirectiveSchema = z.enum(['protect_private_context']);
export type HermesOwnerDirective = z.infer<typeof HermesOwnerDirectiveSchema>;
export const HERMES_OWNER_DIRECTIVE: HermesOwnerDirective = 'protect_private_context';
