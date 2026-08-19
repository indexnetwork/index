import type { NegotiationCounterpartyBinding } from '@indexnetwork/protocol';
export type ConsultationExpiryReadinessInput = {
  taskState: string;
  taskClaimedByAgentId: string | null;
  taskMetadata: Record<string, unknown>;
  coordinates: {
    consultationAttemptId?: string;
    claimedByAgentId?: string;
    userId: string;
    recipientIntentId: string;
    opportunityId: string;
    networkId: string;
    counterpartyUserId: string;
    counterpartyBinding: NegotiationCounterpartyBinding;
  };
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Classifies the only null-settlement state that is retryable: an exact
 * attempt-specific expiry raced ahead of its still-claimed pause commit.
 */
export function consultationExpiryReadiness(
  input: ConsultationExpiryReadinessInput,
): 'pending_pause' | 'terminal_stale' {
  const { coordinates, taskMetadata } = input;
  if (
    input.taskState !== 'claimed'
    || !nonEmptyString(coordinates.consultationAttemptId)
    || !nonEmptyString(coordinates.claimedByAgentId)
    || input.taskClaimedByAgentId !== coordinates.claimedByAgentId
    || taskMetadata.type !== 'negotiation'
    || taskMetadata.opportunityId !== coordinates.opportunityId
    || taskMetadata.networkId !== coordinates.networkId
    || taskMetadata.questionSettlement !== undefined
  ) return 'terminal_stale';

  const turnContext = taskMetadata.turnContext;
  if (
    turnContext
    && typeof turnContext === 'object'
    && !Array.isArray(turnContext)
    && (turnContext as Record<string, unknown>).askUserBinding !== undefined
  ) return 'terminal_stale';

  const bindings = Array.isArray(taskMetadata.participantBindings)
    ? taskMetadata.participantBindings
    : [];
  const exactBindings = bindings.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const binding = value as Record<string, unknown>;
    const userId = nonEmptyString(binding.userId) ? binding.userId : null;
    const intentId = nonEmptyString(binding.intentId) ? binding.intentId : null;
    const networkId = nonEmptyString(binding.networkId) ? binding.networkId : null;
    return userId && intentId && networkId ? [{ userId, intentId, networkId }] : [];
  });
  const recipient = exactBindings.filter((binding) =>
    binding.userId === coordinates.userId
    && binding.intentId === coordinates.recipientIntentId
    && binding.networkId === coordinates.networkId);
  // `participantBindings` records intent-bound participants only — it is built
  // from the two sides' intent ids at init — so a premise-bound counterparty
  // has no entry here by construction. Requiring one would mark every
  // premise-bound park terminally stale at expiry, closing a pause whose
  // answer was still coming. The pair is verified at resume against the
  // opportunity's own actors and network membership either way.
  const counterpartyBound = coordinates.counterpartyBinding.kind === 'premise'
    || exactBindings.filter((binding) =>
      binding.userId === coordinates.counterpartyUserId
      && binding.intentId === coordinates.counterpartyBinding.id
      && binding.networkId === coordinates.networkId).length === 1;
  return recipient.length === 1 && counterpartyBound
    ? 'pending_pause'
    : 'terminal_stale';
}
