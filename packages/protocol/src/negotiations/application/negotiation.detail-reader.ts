import type { NegotiationOpportunityLifecycle } from '../../shared/interfaces/database.interface.js';
import { expectedNegotiationSpeaker } from '../domain/negotiation.expected-speaker.js';
import { buildLifecycleNarration } from '../domain/negotiation.lifecycle-narration.js';
import { allowedActionsFor, readProtocolVersion, resolveSeat } from '../domain/negotiation.protocol.js';
import type { SeedAssessment, UserNegotiationContext } from '../domain/negotiation.state.js';

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
  const negotiationContext = metadata.turnContext
    ? {
        ownUser: isSource ? metadata.turnContext.sourceUser : metadata.turnContext.candidateUser,
        otherUser: isSource ? metadata.turnContext.candidateUser : metadata.turnContext.sourceUser,
        indexContext: metadata.turnContext.indexContext,
        seedAssessment: metadata.turnContext.seedAssessment,
        isDiscoverer: isSource,
        ...(metadata.turnContext.discoveryQuery && { discoveryQuery: metadata.turnContext.discoveryQuery }),
      }
    : null;
  const lifecycleOpportunityId = metadata.opportunityId?.trim() || undefined;

  // These independent reads must stay concurrent: message/artifact latency must
  // not delay lifecycle evidence, and missing lifecycle evidence remains fail-open.
  const [messages, artifacts, opportunityLifecycles] = await Promise.all([
    input.readMessages(task.conversationId),
    input.readArtifacts(task.id),
    input.readLifecycleEvidence(lifecycleOpportunityId ? [lifecycleOpportunityId] : [], callerUserId),
  ]);

  // Sender IDs, rather than parity, determine continuation turns. The parity
  // fallback is retained for legacy rows that do not record a sender ID.
  const turns = messages.map((message, index) => {
    const dataPart = (message.parts as Array<{ kind?: string; data?: unknown }>)?.find((part) => part.kind === 'data');
    const turnData = dataPart?.data as {
      action?: string;
      assessment?: { reasoning?: string; suggestedRoles?: unknown };
      message?: string;
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
    turnsAdded: turnCount - priorTurnCount,
    turns,
    outcome,
    lifecycle: buildLifecycleNarration(
      status,
      lifecycleOpportunityId ? opportunityLifecycles[lifecycleOpportunityId] : undefined,
    ),
    context: negotiationContext,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
