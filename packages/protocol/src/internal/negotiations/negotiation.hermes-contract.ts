import { z } from 'zod';

import type { NegotiationTurn } from './negotiation.turn.js';

/**
 * Model-visible directives for the dedicated Hermes negotiation bridge
 * (rewrite, #1494). No model-authored prose crosses this boundary — every
 * action maps to a fixed, privacy-reviewed template. There is no `accept` or
 * `decline` here: Hermes recommends a verdict to its own principal via
 * `recommend_pending` / `recommend_reject`; only IS-A resolves it.
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

/** No model-authored prose is accepted at this boundary. */
export const HermesNegotiationResponseSchema = z.object({
  action: HermesNegotiationActionSchema,
}).strict();
export type HermesNegotiationResponse = z.infer<typeof HermesNegotiationResponseSchema>;

/** Only privacy-reviewed server prose can enter the shared transcript. */
const HERMES_CONTINUE_MESSAGE_TEMPLATES: Readonly<Record<'outreach' | 'counter' | 'question', string>> = Object.freeze({
  outreach: 'Reaching out about this potential match on my principal\'s behalf.',
  counter: 'I would like to adjust the terms before proceeding.',
  question: 'I have a clarifying question before proceeding.',
});

export const HermesOwnerDirectiveSchema = z.enum(['protect_private_context']);
export type HermesOwnerDirective = z.infer<typeof HermesOwnerDirectiveSchema>;
export const HERMES_OWNER_DIRECTIVE: HermesOwnerDirective = 'protect_private_context';

/** Build the complete persisted turn without using any model-authored prose. */
export function buildHermesNegotiationTurn(input: HermesNegotiationResponse): NegotiationTurn {
  switch (input.action) {
    case 'outreach':
    case 'counter':
    case 'question':
      return {
        verb: input.action,
        message: HERMES_CONTINUE_MESSAGE_TEMPLATES[input.action],
        reasoning: `Hermes selected the closed ${input.action} directive.`,
      };
    case 'ask_principal':
      return {
        verb: 'pause',
        reason: 'needs_principal',
        payload: { question: 'The negotiator needs guidance from its principal before continuing.' },
      };
    case 'recommend_pending':
      return {
        verb: 'pause',
        reason: 'ready_for_verdict',
        payload: { recommendation: 'pending', reasoning: 'Hermes recommended proceeding with this match.' },
      };
    case 'recommend_reject':
      return {
        verb: 'pause',
        reason: 'ready_for_verdict',
        payload: { recommendation: 'reject', reasoning: 'Hermes recommended not proceeding with this match.' },
      };
  }
}
