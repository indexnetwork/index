import { z } from 'zod';

import type { NegotiationAction, NegotiationTurn } from '../../shared/schemas/negotiation-state.schema.js';

/** Model-visible directives for the dedicated Hermes negotiation bridge. */
export const HermesNegotiationActionSchema = z.enum([
  'accept',
  'decline',
  'request_time',
  'continue',
]);
export type HermesNegotiationAction = z.infer<typeof HermesNegotiationActionSchema>;

export const HermesRoleAlignmentSchema = z.enum([
  'peers',
  'owner_leads',
  'counterparty_leads',
]);
export type HermesRoleAlignment = z.infer<typeof HermesRoleAlignmentSchema>;

/**
 * No model-authored prose is accepted at this boundary. Strict parsing also
 * prevents model-selected run IDs or capabilities from entering tool arguments.
 */
export const HermesNegotiationResponseSchema = z.object({
  action: HermesNegotiationActionSchema,
  roleAlignment: HermesRoleAlignmentSchema,
}).strict();
export type HermesNegotiationResponse = z.infer<typeof HermesNegotiationResponseSchema>;

/** Only privacy-reviewed server prose can enter the shared transcript. */
export const HERMES_SHARED_MESSAGE_TEMPLATES: Readonly<Record<HermesNegotiationAction, string>> = Object.freeze({
  accept: 'I am ready to proceed with this opportunity.',
  decline: 'I am going to decline this opportunity.',
  request_time: 'I need more time before deciding.',
  continue: 'I am open to continuing within the current scope.',
});

export const HermesOwnerDirectiveSchema = z.enum(['protect_private_context']);
export type HermesOwnerDirective = z.infer<typeof HermesOwnerDirectiveSchema>;
export const HERMES_OWNER_DIRECTIVE: HermesOwnerDirective = 'protect_private_context';

const ACTION_CANDIDATES: Readonly<Record<HermesNegotiationAction, readonly NegotiationAction[]>> = Object.freeze({
  accept: ['accept'],
  decline: ['decline', 'withdraw', 'reject'],
  request_time: ['counter', 'outreach', 'propose'],
  continue: ['question', 'outreach', 'propose', 'counter'],
});

const ACTION_ORDER: readonly HermesNegotiationAction[] = [
  'accept',
  'decline',
  'request_time',
  'continue',
];

/** Project exact seat/version actions into the closed Hermes vocabulary. */
export function allowedHermesActionsFor(
  allowedActions: readonly NegotiationAction[],
): HermesNegotiationAction[] {
  const allowed = new Set(allowedActions);
  return ACTION_ORDER.filter((action) => ACTION_CANDIDATES[action].some((candidate) => allowed.has(candidate)));
}

function protocolActionFor(
  action: HermesNegotiationAction,
  allowedActions: readonly NegotiationAction[],
): NegotiationAction | null {
  const allowed = new Set(allowedActions);
  return ACTION_CANDIDATES[action].find((candidate) => allowed.has(candidate)) ?? null;
}

function suggestedRolesFor(alignment: HermesRoleAlignment): NegotiationTurn['assessment']['suggestedRoles'] {
  if (alignment === 'owner_leads') return { ownUser: 'agent', otherUser: 'patient' };
  if (alignment === 'counterparty_leads') return { ownUser: 'patient', otherUser: 'agent' };
  return { ownUser: 'peer', otherUser: 'peer' };
}

/** Build the complete persisted turn without using any model-authored prose. */
export function buildHermesNegotiationTurn(
  input: HermesNegotiationResponse,
  allowedActions: readonly NegotiationAction[],
): NegotiationTurn | null {
  const action = protocolActionFor(input.action, allowedActions);
  if (!action) return null;
  return {
    action,
    message: HERMES_SHARED_MESSAGE_TEMPLATES[input.action],
    assessment: {
      reasoning: `Hermes selected the closed ${input.action} directive.`,
      suggestedRoles: suggestedRolesFor(input.roleAlignment),
    },
  };
}
