import type { NegotiationCounterpartyBinding } from '@indexnetwork/protocol';
import { assessConsultationEligibility, configuredQuestionBudgetPerPrincipal, isNegotiationTurnCapReached, NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY, NEGOTIATION_QUESTION_GENERIC_NETWORK, type ConsultationEligibility, type ConsultationEligibilityInput, type NegotiationAction, type NegotiationConsultationPolicyMode, type NegotiationConsultationReason, type NegotiationProtocolVersion, type NegotiationSeat, type QuestionerInput } from '@indexnetwork/protocol';

export { consultationExpiryReadiness } from './consultation-expiry';
export type { ConsultationExpiryReadinessInput } from './consultation-expiry';

export type ExternalConsultationCoordinates = {
  opportunityId: string;
  recipientIntentId: string;
  networkId: string;
  /** Internal identity fences; never copied into Questioner disclosure context. */
  counterpartyUserId: string;
  /**
   * Always intent-bound on this path: the external-agent coordinates are
   * derived from `metadata.participantBindings`, which carries only
   * intent-bound participants. Typed as the shared binding so the durable
   * coordinates and these compare without a shape conversion.
   */
  counterpartyBinding: NegotiationCounterpartyBinding;
};

type ConsultationOpportunityActor = {
  userId?: string;
  intent?: string;
  premise?: string;
  networkId?: string;
  role?: string;
};

export type ExternalConsultationPersistedTurn = {
  senderId: string;
  turn: {
    action: string;
    assessment?: {
      suggestedRoles?: {
        ownUser?: string;
        otherUser?: string;
      };
    };
  };
};

export type ExternalConsultationEligibilityInput = {
  task: {
    id: string;
    state: string;
    claimedByAgentId: string | null;
    metadata: Record<string, unknown>;
  };
  messages: ExternalConsultationPersistedTurn[];
  userId: string;
  agentId: string;
  policyMode: NegotiationConsultationPolicyMode;
  wiring: {
    askUserEnabled: boolean;
    questionerEnabled: boolean;
    expiryEnabled: boolean;
  };
};

export type ExternalConsultationEligibility = {
  eligible: boolean;
  structuralEligible: boolean;
  policy: ConsultationEligibility;
  policyInput?: ConsultationEligibilityInput;
  coordinates?: ExternalConsultationCoordinates;
  seat?: NegotiationSeat;
};

const NEGOTIATION_ACTIONS = new Set<NegotiationAction>([
  'propose', 'accept', 'reject', 'counter', 'question', 'ask_user',
  'outreach', 'withdraw', 'decline',
]);
const ROLE_VALUES = new Set(['agent', 'patient', 'peer'] as const);

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function actionValue(value: unknown): NegotiationAction | null {
  return typeof value === 'string' && NEGOTIATION_ACTIONS.has(value as NegotiationAction)
    ? value as NegotiationAction
    : null;
}

function roleValue(value: unknown): 'agent' | 'patient' | 'peer' | undefined {
  return typeof value === 'string' && ROLE_VALUES.has(value as 'agent' | 'patient' | 'peer')
    ? value as 'agent' | 'patient' | 'peer'
    : undefined;
}

export function externalConsultationCoordinatesFor(
  metadata: Record<string, unknown>,
  userId: string,
): ExternalConsultationCoordinates | null {
  const opportunityId = stringValue(metadata.opportunityId);
  const networkId = stringValue(metadata.networkId);
  const bindings = Array.isArray(metadata.participantBindings) ? metadata.participantBindings : [];
  const exactBindings = bindings.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const binding = value as Record<string, unknown>;
    const boundUserId = stringValue(binding.userId);
    const intentId = stringValue(binding.intentId);
    const boundNetworkId = stringValue(binding.networkId);
    return boundUserId && intentId && boundNetworkId
      ? [{ userId: boundUserId, intentId, networkId: boundNetworkId }]
      : [];
  }).filter((binding) => binding.networkId === networkId);
  const recipient = exactBindings.filter((binding) => binding.userId === userId);
  const counterparties = exactBindings.filter((binding) => binding.userId !== userId);
  if (
    !opportunityId
    || !networkId
    || recipient.length !== 1
    || counterparties.length !== 1
    || recipient[0].userId === counterparties[0].userId
  ) return null;
  return {
    opportunityId,
    recipientIntentId: recipient[0].intentId,
    networkId,
    counterpartyUserId: counterparties[0].userId,
    counterpartyBinding: { kind: 'intent', id: counterparties[0].intentId },
  };
}

/**
 * Mirrors Questioner's authoritative non-uptake actor predicate, then adds the
 * exact task-binding fence needed by consultation. Questioner permits repeated
 * rows for the sole counterparty user, so those rows do not change cardinality;
 * at least one must carry the exact bound intent used by expiry and settlement.
 */
export function consultationActorSetMatchesBinding(input: {
  actors: unknown;
  recipientUserId: string;
  recipientIntentId: string;
  networkId: string;
  counterpartyUserId: string;
  counterpartyBinding: NegotiationCounterpartyBinding;
}): boolean {
  if (!Array.isArray(input.actors)) return false;
  const participants = (input.actors as ConsultationOpportunityActor[])
    .filter((actor) => actor.role !== 'introducer');
  const recipientActors = participants.filter((actor) => actor.userId === input.recipientUserId);
  if (
    recipientActors.length !== 1
    || recipientActors[0].intent !== input.recipientIntentId
    || recipientActors[0].networkId !== input.networkId
    || participants.some((actor) => actor.networkId !== input.networkId)
  ) return false;

  const participantUserIds = new Set(participants.flatMap((actor) =>
    typeof actor.userId === 'string' ? [actor.userId] : []));
  if (
    participantUserIds.size !== 2
    || !participantUserIds.has(input.recipientUserId)
    || !participantUserIds.has(input.counterpartyUserId)
  ) return false;

  // Matched on the key the actor carries, so a premise-bound counterparty is
  // checked against its premise rather than against an intent it never had.
  return participants.some((actor) =>
    actor.userId === input.counterpartyUserId
    && (input.counterpartyBinding.kind === 'intent'
      ? actor.intent === input.counterpartyBinding.id
      : actor.premise === input.counterpartyBinding.id)
    && actor.networkId === input.networkId);
}

function seatFor(metadata: Record<string, unknown>, userId: string): NegotiationSeat | null {
  const sourceUserId = stringValue(metadata.sourceUserId);
  const candidateUserId = stringValue(metadata.candidateUserId);
  const initiatorUserId = stringValue(metadata.initiatorUserId);
  if (!sourceUserId || !candidateUserId || (userId !== sourceUserId && userId !== candidateUserId)) return null;
  return initiatorUserId === userId ? 'initiator' : 'counterparty';
}

/**
 * Pure eligibility shared by pickup advertisement and consultation admission.
 * It accepts only persisted enum/lifecycle data; caller-provided disclosure text
 * is deliberately absent from this boundary.
 */
export function assessExternalConsultationEligibility(
  input: ExternalConsultationEligibilityInput,
): ExternalConsultationEligibility {
  const metadata = input.task.metadata;
  const protocolVersion = stringValue(metadata.protocolVersion) as NegotiationProtocolVersion | null;
  const coordinates = externalConsultationCoordinatesFor(metadata, input.userId);
  const seat = seatFor(metadata, input.userId);
  const maxTurns = typeof metadata.maxTurns === 'number' ? metadata.maxTurns : undefined;
  const isOpeningTurn = input.messages.length === 0;
  const isFinalTurn = isNegotiationTurnCapReached(input.messages.length + 1, maxTurns);
  const last = input.messages.at(-1);
  const lastAction = actionValue(last?.turn.action);
  const counterpartyTurn = Boolean(
    last
    && coordinates
    && last.senderId === `agent:${coordinates.counterpartyUserId}`,
  );
  const supportedTrigger = lastAction === 'counter' || lastAction === 'question';
  // The acting principal's question budget for this negotiation (checklist
  // plan §3 rule 5), counted off the same message record the graph reads.
  const consultationsSpent = input.messages.filter((message) =>
    message.senderId === `agent:${input.userId}` && message.turn.action === 'ask_user').length;
  const consultationBudgetSpent = consultationsSpent >= configuredQuestionBudgetPerPrincipal();
  const exactWiring = input.wiring.askUserEnabled && input.wiring.questionerEnabled && input.wiring.expiryEnabled;
  const lifecycleValid = input.task.state === 'claimed'
    && input.task.claimedByAgentId === input.agentId
    && metadata.type === 'negotiation'
    && Boolean(coordinates && seat);
  const structuralEligible = protocolVersion === 'v2'
    && !isOpeningTurn
    && !isFinalTurn
    && counterpartyTurn
    && supportedTrigger
    && !consultationBudgetSpent
    && lifecycleValid
    && exactWiring;

  if (!lastAction || !seat) {
    return { eligible: false, structuralEligible: false, policy: { eligible: false } };
  }

  const priorActions = input.messages.slice(0, -1)
    .map((message) => actionValue(message.turn.action))
    .filter((action): action is NegotiationAction => action !== null);
  const policyInput: ConsultationEligibilityInput = {
    protocolVersion: protocolVersion ?? 'v1',
    seat,
    isOpeningTurn,
    isFinalTurn,
    action: lastAction,
    // The final persisted turn is authored by the counterparty. From that
    // turn's perspective, `otherUser` is the currently claiming owner.
    ownSuggestedRole: roleValue(last?.turn.assessment?.suggestedRoles?.otherUser),
    priorActions,
    consultationBudgetSpent,
    hasExactResumeCoordinate: Boolean(coordinates && exactWiring),
    lifecycleValid,
  };
  const policy = assessConsultationEligibility(policyInput);
  const eligible = structuralEligible && (input.policyMode !== 'on' || policy.eligible);
  return {
    eligible,
    structuralEligible,
    policy,
    policyInput,
    ...(coordinates ? { coordinates } : {}),
    seat,
  };
}

export function buildExternalConsultationQuestionerPayload(input: {
  negotiationId: string;
  userId: string;
  coordinates: ExternalConsultationCoordinates;
  reason: NegotiationConsultationReason;
}): QuestionerInput {
  return {
    mode: 'negotiation_inflight',
    purpose: 'inflight_consultation',
    userId: input.userId,
    sourceType: 'opportunity',
    sourceId: input.coordinates.opportunityId,
    negotiation: {
      purpose: 'inflight_consultation',
      recipientUserId: input.userId,
      recipientIntentId: input.coordinates.recipientIntentId,
      opportunityId: input.coordinates.opportunityId,
      taskId: input.negotiationId,
      networkId: input.coordinates.networkId,
    },
    context: {
      negotiationId: input.negotiationId,
      counterpartyHint: NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
      indexContext: NEGOTIATION_QUESTION_GENERIC_NETWORK,
      consultationPolicyReason: input.reason,
    },
  };
}
