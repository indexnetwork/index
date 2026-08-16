import type { Opportunity, OpportunityActor, OpportunityGraphDatabase } from '../../shared/interfaces/database.interface.js';

/** The mutation result shape returned by opportunity lifecycle graph nodes. */
export interface OpportunityMutationResult {
  success: boolean;
  message?: string;
  opportunityId?: string;
  notified?: string[];
  conversationId?: string;
  error?: string;
}

/** Narrow persistence boundary for user-driven opportunity lifecycle actions. */
export type OpportunityLifecyclePort = Pick<
  OpportunityGraphDatabase,
  | 'getOpportunity'
  | 'getOrCreateDM'
  | 'stampOpportunityActorAction'
  | 'updateOpportunityActorApproval'
  | 'updateOpportunityStatus'
>;

/** Host callback used to notify an actor after an opportunity becomes visible to them. */
export type QueueOpportunityNotificationFn = (
  opportunityId: string,
  recipientId: string,
  priority: 'immediate' | 'high' | 'low',
) => Promise<unknown>;

type StatusTransitionPlan =
  | { kind: 'stamp_accepted'; counterpartUserId?: string }
  | { kind: 'set_terminal_status'; status: 'rejected' | 'expired' };

type SendOpportunityPlan = {
  sender: OpportunityActor;
  recipients: OpportunityActor[];
};

/**
 * Applies status-transition admission rules before lifecycle persistence.
 * Acceptance is a two-party action: an actor that already acted cannot accept
 * again, while rejection and expiry remain available to any participating actor.
 */
export function assessOpportunityStatusTransition(
  opportunity: Opportunity,
  actorUserId: string,
  newStatus: string | undefined,
): StatusTransitionPlan | OpportunityMutationResult {
  if (newStatus !== 'accepted' && newStatus !== 'rejected' && newStatus !== 'expired') {
    return { success: false, error: 'newStatus must be one of: accepted, rejected, expired.' };
  }

  const callerActor = opportunity.actors.find((actor) => actor.userId === actorUserId);
  if (!callerActor) {
    return { success: false, error: 'You are not part of this opportunity.' };
  }

  if (newStatus === 'accepted') {
    if (callerActor.actedAt) {
      return {
        success: false,
        error: 'You have already acted on this opportunity. The other party must accept.',
      };
    }
    return {
      kind: 'stamp_accepted',
      counterpartUserId: opportunity.actors.find(
        (actor) => actor.userId !== actorUserId && actor.role !== 'introducer',
      )?.userId,
    };
  }

  return { kind: 'set_terminal_status', status: newStatus };
}

/**
 * Applies send admission and recipient-routing rules without performing writes.
 * Introducers, peers, and direct patient/party flows each reveal the next tier
 * to a distinct audience.
 */
export function assessOpportunitySend(
  opportunity: Opportunity,
  actorUserId: string,
): SendOpportunityPlan | OpportunityMutationResult {
  if (opportunity.status !== 'latent' && opportunity.status !== 'draft') {
    return {
      success: false,
      error: `Opportunity is already ${opportunity.status}; only latent or draft opportunities can be sent.`,
    };
  }

  const sender = opportunity.actors.find((actor) => actor.userId === actorUserId);
  if (!sender) {
    return { success: false, error: 'You are not part of this opportunity.' };
  }

  const hasIntroducer = opportunity.actors.some((actor) => actor.role === 'introducer');
  const canSend =
    sender.role === 'introducer'
    || sender.role === 'peer'
    || (sender.role === 'patient' && !hasIntroducer)
    || (sender.role === 'party' && !hasIntroducer);
  if (!canSend) {
    return { success: false, error: 'You cannot send this opportunity.' };
  }

  const recipients = sender.role === 'introducer'
    ? opportunity.actors.filter((actor) => actor.role === 'patient' || actor.role === 'party')
    : sender.role === 'peer'
      ? opportunity.actors.filter((actor) => actor.role === 'peer' && actor.userId !== actorUserId)
      : opportunity.actors.filter((actor) => actor.role === 'agent');
  return { sender, recipients };
}

/** Checks whether a caller may approve this opportunity's introducer gate. */
export function assessIntroductionApproval(
  opportunity: Opportunity,
  actorUserId: string,
): OpportunityMutationResult | { kind: 'approve' } {
  const introducerActor = opportunity.actors.find(
    (actor) => actor.role === 'introducer' && actor.userId === actorUserId,
  );
  if (!introducerActor) {
    return { success: false, error: 'You are not the introducer for this opportunity' };
  }
  if (introducerActor.approved === true) {
    return { success: false, error: 'Introduction already approved' };
  }
  return { kind: 'approve' };
}

function isMutationResult(
  value: StatusTransitionPlan | SendOpportunityPlan | OpportunityMutationResult | { kind: 'approve' },
): value is OpportunityMutationResult {
  return 'success' in value;
}

/** Persists an admitted status transition, preserving accept-before-write DM ordering. */
export async function updateOpportunityLifecycle(
  database: OpportunityLifecyclePort,
  input: { opportunityId?: string; actorUserId: string; newStatus?: string },
): Promise<OpportunityMutationResult> {
  if (!input.opportunityId) {
    return { success: false, error: 'opportunityId is required.' };
  }
  // Preserve the graph's legacy validation order: invalid transitions do not
  // read persistence and always return the input error before actor checks.
  if (input.newStatus !== 'accepted' && input.newStatus !== 'rejected' && input.newStatus !== 'expired') {
    return { success: false, error: 'newStatus must be one of: accepted, rejected, expired.' };
  }

  const opportunity = await database.getOpportunity(input.opportunityId);
  if (!opportunity) {
    return { success: false, error: 'Opportunity not found.' };
  }

  const plan = assessOpportunityStatusTransition(opportunity, input.actorUserId, input.newStatus);
  if (isMutationResult(plan)) return plan;

  let conversationId: string | undefined;
  if (plan.kind === 'stamp_accepted') {
    if (plan.counterpartUserId) {
      const dm = await database.getOrCreateDM(input.actorUserId, plan.counterpartUserId);
      conversationId = dm.id;
    }
    await database.stampOpportunityActorAction(
      input.opportunityId,
      input.actorUserId,
      'accepted',
      input.actorUserId,
    );
  } else {
    await database.updateOpportunityStatus(input.opportunityId, plan.status);
  }

  return {
    success: true,
    opportunityId: input.opportunityId,
    message: `Opportunity status updated to ${input.newStatus}.`,
    ...(conversationId && { conversationId }),
  };
}

/** Expires an opportunity after verifying the caller is one of its actors. */
export async function deleteOpportunityLifecycle(
  database: OpportunityLifecyclePort,
  input: { opportunityId?: string; actorUserId: string },
): Promise<OpportunityMutationResult> {
  if (!input.opportunityId) {
    return { success: false, error: 'opportunityId is required.' };
  }

  const opportunity = await database.getOpportunity(input.opportunityId);
  if (!opportunity) {
    return { success: false, error: 'Opportunity not found.' };
  }
  if (!opportunity.actors.some((actor) => actor.userId === input.actorUserId)) {
    return { success: false, error: 'You are not part of this opportunity.' };
  }

  await database.updateOpportunityStatus(input.opportunityId, 'expired');
  return {
    success: true,
    opportunityId: input.opportunityId,
    message: 'Opportunity archived (expired).',
  };
}

/** Persists a send transition, then notifies only the actors exposed by its routing policy. */
export async function sendOpportunityLifecycle(
  database: OpportunityLifecyclePort,
  input: { opportunityId?: string; actorUserId: string },
  queueNotification?: QueueOpportunityNotificationFn,
): Promise<OpportunityMutationResult> {
  if (!input.opportunityId) {
    return { success: false, error: 'opportunityId is required.' };
  }

  const opportunity = await database.getOpportunity(input.opportunityId);
  if (!opportunity) {
    return { success: false, error: 'Opportunity not found.' };
  }

  const plan = assessOpportunitySend(opportunity, input.actorUserId);
  if (isMutationResult(plan)) return plan;

  await database.stampOpportunityActorAction(input.opportunityId, input.actorUserId, 'pending');
  if (queueNotification) {
    for (const recipient of plan.recipients) {
      await queueNotification(opportunity.id, recipient.userId, 'high');
    }
  }

  return {
    success: true,
    opportunityId: opportunity.id,
    notified: plan.recipients.map((actor) => actor.userId),
    message: 'Opportunity sent. The other person has been notified.',
  };
}

/** Approves an introducer gate before enqueuing the existing-opportunity negotiation. */
export async function approveOpportunityIntroduction(
  database: OpportunityLifecyclePort,
  input: { opportunityId?: string; actorUserId: string },
  queueNegotiateExisting?: (opportunityId: string, userId: string) => Promise<void>,
): Promise<OpportunityMutationResult> {
  if (!input.opportunityId) {
    return { success: false, error: 'opportunityId required for approve_introduction' };
  }

  let opportunity: Opportunity | null;
  try {
    opportunity = await database.getOpportunity(input.opportunityId);
  } catch (error) {
    return {
      success: false,
      error: `Failed to load opportunity: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!opportunity) {
    return { success: false, error: 'Opportunity not found' };
  }

  const admission = assessIntroductionApproval(opportunity, input.actorUserId);
  if (isMutationResult(admission)) return admission;

  const updated = await database.updateOpportunityActorApproval(input.opportunityId, input.actorUserId, true);
  if (!updated) {
    return { success: false, error: 'Failed to update approval' };
  }
  if (queueNegotiateExisting) {
    await queueNegotiateExisting(input.opportunityId, input.actorUserId);
  }
  return { success: true, opportunityId: input.opportunityId };
}
