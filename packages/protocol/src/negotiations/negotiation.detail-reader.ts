import type { NegotiationOpportunityLifecycle } from '../shared/interfaces/database.interface.js';
import type { ListingOpenQuestion } from '../shared/interfaces/negotiation-listing-park.interface.js';
import { classifyInflightPark, classifyPostStallPark } from './negotiation.answer-consumption.js';
import { expectedNegotiationSpeaker } from './negotiation.expected-speaker.js';
import { buildLifecycleNarration, parkLifecycleLabel } from './negotiation.lifecycle-narration.js';
import type { NegotiationParkNarration } from './negotiation.lifecycle-narration.js';
import { allowedActionsFor, readProtocolVersion, resolveSeat } from './negotiation.protocol.js';
import type { SeedAssessment, UserNegotiationContext } from './negotiation.state.js';

export interface AuthorizedNegotiationDetailTask {
  id: string;
  conversationId: string;
  state: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthorizedNegotiationDetailMetadata {
  sourceUserId?: string;
  candidateUserId?: string;
  initiatorUserId?: string;
  protocolVersion?: string;
  maxTurns?: number;
  opportunityId?: string;
  isContinuation?: boolean;
  priorTurnCount?: number;
  turnContext?: {
    sourceUser: UserNegotiationContext;
    candidateUser: UserNegotiationContext;
    indexContext: { networkId: string; prompt?: string };
    seedAssessment: SeedAssessment;
    discoveryQuery?: string;
  };
}

export interface NegotiationDetailMessage {
  senderId: string;
  parts: unknown[];
  createdAt: Date;
  /** Originating negotiation task; used by post-stall park classification. */
  taskId?: string | null;
}

export interface NegotiationDetailArtifact {
  name: string | null;
  parts: unknown[];
}

export interface AuthorizedNegotiationDetailReaderInput {
  task: AuthorizedNegotiationDetailTask;
  metadata: AuthorizedNegotiationDetailMetadata;
  callerUserId: string;
  callerRole: 'source' | 'candidate';
  readMessages: (conversationId: string) => Promise<NegotiationDetailMessage[]>;
  readArtifacts: (taskId: string) => Promise<NegotiationDetailArtifact[]>;
  readLifecycleEvidence: (
    opportunityIds: string[],
    ownerUserId: string,
  ) => Promise<Record<string, NegotiationOpportunityLifecycle>>;
  /**
   * The open question this negotiation's park is asking of the CALLER,
   * resolved through the shared question record (#1472, one level down: the
   * detail must say the park out of the same record the listing and
   * `answer_pending_question` read, so the numbers cannot drift). Optional:
   * without it the detail still says whether the negotiation is parked and on
   * whose side, it just cannot name the question's number.
   */
  readOpenQuestion?: (opportunityId: string) => Promise<ListingOpenQuestion | undefined>;
}

/**
 * Projects an already-authorized negotiation task into the caller's detail
 * response. Admission and scope/privacy decisions stay in the tools facade;
 * this reader owns only parallel reads and deterministic response shaping.
 */
export async function readAuthorizedNegotiationDetail(
  input: AuthorizedNegotiationDetailReaderInput,
) {
  const { task, metadata, callerUserId, callerRole } = input;
  const isSource = callerRole === 'source';
  const counterpartyId = isSource ? metadata.candidateUserId : metadata.sourceUserId;
  const lifecycleOpportunityId = metadata.opportunityId?.trim() || undefined;

  // These independent reads must stay concurrent: message/artifact latency must
  // not delay lifecycle evidence, and missing lifecycle evidence remains fail-open.
  const [messages, artifacts, opportunityLifecycles] = await Promise.all([
    input.readMessages(task.conversationId),
    input.readArtifacts(task.id),
    input.readLifecycleEvidence(lifecycleOpportunityId ? [lifecycleOpportunityId] : [], callerUserId),
  ]);

  // Persisted turnContext, projected into the caller's perspective.
  const ownUser = metadata.turnContext
    ? (isSource ? metadata.turnContext.sourceUser : metadata.turnContext.candidateUser)
    : null;
  const negotiationContext = metadata.turnContext && ownUser
    ? {
        ownUser,
        otherUser: isSource ? metadata.turnContext.candidateUser : metadata.turnContext.sourceUser,
        indexContext: metadata.turnContext.indexContext,
        seedAssessment: metadata.turnContext.seedAssessment,
        isDiscoverer: isSource,
        ...(metadata.turnContext.discoveryQuery && { discoveryQuery: metadata.turnContext.discoveryQuery }),
      }
    : null;

  // #1472, one level down: this is the tool the poller prompt says to call
  // FIRST, so on a parked negotiation the detail must say the park — through
  // the SAME canonical predicate the listing runs over the task and messages
  // it already holds, with the question's number resolved through the shared
  // question record. A park on the counterparty's side is narrated but never
  // quoted; that question is not this caller's to read.
  let park: NegotiationParkNarration | null = null;
  if (lifecycleOpportunityId && task.state === 'input_required') {
    const classification = classifyInflightPark(
      // Callers pass the full runtime metadata object (the typed shape above is
      // a projection of it), so the ask-user binding is present for the
      // classifier even though this reader never names it.
      { id: task.id, state: task.state, metadata: metadata as unknown as Record<string, unknown> },
      { opportunityId: lifecycleOpportunityId, userId: callerUserId },
    );
    if (classification.kind === 'wrong_recipient') park = { waitingOn: 'counterparty', kind: 'mid_flight' };
    else if (classification.kind === 'inflight') park = { waitingOn: 'you', kind: 'mid_flight' };
  } else if (lifecycleOpportunityId && task.state === 'completed') {
    const classification = classifyPostStallPark(task, messages, { userId: callerUserId });
    if (classification.kind === 'wrong_recipient') park = { waitingOn: 'counterparty', kind: 'post_stall' };
    else if (classification.kind === 'post_stall') park = { waitingOn: 'you', kind: 'post_stall' };
  }
  if (park?.waitingOn === 'you' && lifecycleOpportunityId && input.readOpenQuestion) {
    const openQuestion = await input.readOpenQuestion(lifecycleOpportunityId).catch(() => undefined);
    if (openQuestion) park = { ...park, question: openQuestion.question, questionLabel: openQuestion.label };
  }

  // Sender IDs, rather than parity, determine continuation turns. The parity
  // fallback is retained for legacy rows that do not record a sender ID.
  const turns = messages.map((message, index) => {
    const dataPart = (message.parts as Array<{ kind?: string; data?: unknown }>)?.find((part) => part.kind === 'data');
    const turnData = dataPart?.data as {
      action?: string;
      assessment?: { reasoning?: string; suggestedRoles?: unknown };
      message?: string;
      askUser?: unknown;
      checklist?: unknown;
    } | undefined;
    const turnNumber = index + 1;
    const speaker = message.senderId
      ? (message.senderId === `agent:${metadata.sourceUserId}` ? 'source' : 'candidate')
      : (turnNumber % 2 === 1 ? 'source' : 'candidate');

    return {
      turnNumber,
      speaker,
      senderId: message.senderId,
      action: turnData?.action ?? 'unknown',
      actionActor: 'agent' as const,
      reasoning: turnData?.assessment?.reasoning ?? null,
      suggestedRoles: turnData?.assessment?.suggestedRoles ?? null,
      message: turnData?.message ?? null,
      // The persisted ask/checklist payloads, verbatim and only when present:
      // an external seat cannot see the consult's dimensions or a checklist's
      // `settles` declarations without them, and turns that never carried
      // either keep their prior shape byte-for-byte.
      ...(turnData?.askUser != null ? { askUser: turnData.askUser } : {}),
      ...(turnData?.checklist != null ? { checklist: turnData.checklist } : {}),
      createdAt: message.createdAt,
    };
  });

  const outcomeArtifact = artifacts.find((artifact) => artifact.name === 'negotiation-outcome');
  const outcome = outcomeArtifact
    ? (outcomeArtifact.parts as Array<{ kind?: string; data?: unknown }>)?.find((part) => part.kind === 'data')?.data
    : null;
  const turnCount = messages.length;
  const expectedSpeaker = expectedNegotiationSpeaker(metadata, messages);
  const status = task.state === 'working' ? 'active'
    : task.state === 'waiting_for_agent' ? 'waiting_for_agent'
    : task.state === 'completed' ? 'completed'
    : task.state;
  const isUsersTurn = status !== 'completed' && expectedSpeaker === callerUserId;
  const protocolVersion = readProtocolVersion(metadata) ?? 'v1';
  const seat = resolveSeat(callerUserId, metadata);
  const priorTurnCount = metadata.priorTurnCount ?? 0;

  return {
    id: task.id,
    conversationId: task.conversationId,
    conversationType: 'agent_negotiation' as const,
    status,
    role: callerRole,
    seat,
    protocolVersion,
    allowedActions: allowedActionsFor(protocolVersion, seat),
    counterpartyId: counterpartyId ?? 'unknown',
    turnCount,
    isUsersTurn,
    isContinuation: metadata.isContinuation ?? false,
    priorTurnCount,
    // Clamped: `turnCount` is match-scoped, but a task stamped before that
    // change carries a conversation-wide `priorTurnCount`, which would other-
    // wise report a negative delta for negotiations in flight across the deploy.
    turnsAdded: Math.max(0, turnCount - priorTurnCount),
    turns,
    outcome,
    // Top-level and inside `lifecycle` both, mirroring the listing: a park is
    // the first thing that must be true about a negotiation that holds one.
    ...(park ? { park: { ...park, label: parkLifecycleLabel(park) } } : {}),
    lifecycle: buildLifecycleNarration(
      status,
      lifecycleOpportunityId ? opportunityLifecycles[lifecycleOpportunityId] : undefined,
      park ?? undefined,
    ),
    context: negotiationContext,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
