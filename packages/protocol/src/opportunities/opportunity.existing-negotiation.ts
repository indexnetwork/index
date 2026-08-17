import type { ActiveIntent, NegotiationContinuationExecution, NegotiationContinuationReceipt, Opportunity, OpportunityGraphDatabase } from '../shared/interfaces/database.interface.js';
import { resolveOpportunityActorIntent } from './opportunity.actor.js';
import type { QueueOpportunityNotificationFn } from "./opportunity.lifecycle.js";

const NEGOTIATION_INTENT_LIMIT = 5;

/** Default-compatible deployment policy for autonomous opportunity negotiation. */
export function negotiationIncludesOtherIntents(): boolean {
  return process.env.NEGOTIATION_INCLUDE_OTHER_INTENTS !== 'false';
}

interface NegotiationIntentSource {
  id?: string | null;
  summary?: string | null;
  payload?: string | null;
}

interface ExistingOpportunityNegotiationUser {
  id: string;
  intents: Array<{ id: string; title: string; description: string; confidence: number }>;
  profile: { name?: string; bio?: string; location?: string; interests?: string[]; skills?: string[] };
}

interface ExistingOpportunityNegotiationCandidate {
  userId: string;
  sourceIntentId?: string;
  candidateIntentId?: string;
  opportunityId?: string;
  opportunityStatus?: Opportunity['status'];
  opportunityUpdatedAt?: Date;
  reasoning: string;
  valencyRole: string;
  networkId?: string;
  candidateUser: ExistingOpportunityNegotiationUser;
}

/** Put an opportunity actor's exact intent first, then fill the bounded context without duplicates. */
export function buildPrioritizedNegotiationIntents(
  activeIntents: readonly NegotiationIntentSource[],
  exactIntentId?: string | null,
  fallbackIntent?: NegotiationIntentSource | null,
  includeOtherIntents = true,
): ExistingOpportunityNegotiationUser['intents'] {
  const exactId = typeof exactIntentId === 'string' && exactIntentId.trim().length > 0 ? exactIntentId : null;
  const exactActive = exactId ? activeIntents.find((intent) => intent.id === exactId) : undefined;
  const ordered = [
    ...(exactActive ? [exactActive] : []),
    ...(!exactActive && fallbackIntent?.id === exactId ? [fallbackIntent] : []),
    ...(includeOtherIntents ? activeIntents : []),
  ];
  const seen = new Set<string>();
  const intents: ExistingOpportunityNegotiationUser['intents'] = [];
  for (const intent of ordered) {
    if (typeof intent.id !== 'string' || intent.id.trim().length === 0 || seen.has(intent.id)) continue;
    seen.add(intent.id);
    intents.push({ id: intent.id, title: intent.summary ?? '', description: intent.payload ?? '', confidence: 1 });
    if (intents.length === NEGOTIATION_INTENT_LIMIT) break;
  }
  return intents;
}

/** Narrow port for translating one persisted opportunity into a negotiation invocation. */
export type ExistingOpportunityNegotiationPort = Pick<
  OpportunityGraphDatabase,
  'getActiveIntents' | 'getIntent' | 'getNetworkMemberContext' | 'getOpportunity' | 'getProfile' | 'getUser'
>;

export interface ExistingOpportunityNegotiationInput {
  opportunityId: string;
  actorUserId: string;
  continuation?: NegotiationContinuationExecution;
}

/** Graph-owned execution port: the handler prepares policy-bound input, while the graph retains negotiation orchestration. */
export type ExecuteExistingOpportunityNegotiation = (input: {
  sourceUser: ExistingOpportunityNegotiationUser;
  candidate: ExistingOpportunityNegotiationCandidate;
  indexContextOverrides: Map<string, string>;
  continuation?: NegotiationContinuationExecution;
}) => Promise<{ accepted: boolean; receipt?: NegotiationContinuationReceipt }>;

export type ExistingOpportunityNegotiationOutcome =
  | { kind: 'skipped'; reason: 'not_found' | 'stale_continuation' | 'no_source_actor' | 'no_candidate_actor' }
  | { kind: 'completed'; opportunityId: string; accepted: boolean; continuationFence?: number; receipt?: NegotiationContinuationReceipt };

export interface ExistingOpportunityNegotiationObserver {
  onNotificationFailure?: (details: { actorId: string; error: unknown }) => void;
}

/**
 * Revalidates continuation actor bindings, builds exact intent-prioritized
 * bilateral negotiation input, and notifies the non-introducer actors only
 * after an accepted non-continuation negotiation.
 */
export async function negotiateExistingOpportunity(
  database: ExistingOpportunityNegotiationPort,
  executeNegotiation: ExecuteExistingOpportunityNegotiation,
  input: ExistingOpportunityNegotiationInput,
  queueNotification?: QueueOpportunityNotificationFn,
  observer?: ExistingOpportunityNegotiationObserver,
): Promise<ExistingOpportunityNegotiationOutcome> {
  const opportunity = await database.getOpportunity(input.opportunityId);
  if (!opportunity) return { kind: 'skipped', reason: 'not_found' };

  const nonIntroducerActors = opportunity.actors.filter((actor) => actor.role !== 'introducer');
  const continuation = input.continuation;
  if (continuation) {
    const recipientActor = nonIntroducerActors.find((actor) => actor.userId === input.actorUserId);
    const counterpartyActor = nonIntroducerActors.find((actor) => actor.userId === continuation.counterpartyUserId);
    if (
      !recipientActor
      || resolveOpportunityActorIntent(recipientActor) !== continuation.recipientIntentId
      || recipientActor.networkId !== continuation.networkId
      || !counterpartyActor
      || resolveOpportunityActorIntent(counterpartyActor) !== continuation.counterpartyIntentId
      || counterpartyActor.networkId !== continuation.networkId
    ) return { kind: 'skipped', reason: 'stale_continuation' };
  }

  const sourceActor = nonIntroducerActors.find((actor) => actor.role === 'patient' || actor.role === 'party') ?? nonIntroducerActors[0];
  if (!sourceActor) return { kind: 'skipped', reason: 'no_source_actor' };
  const candidateActor = nonIntroducerActors.find((actor) => actor.userId !== sourceActor.userId);
  if (!candidateActor) return { kind: 'skipped', reason: 'no_candidate_actor' };

  const sourceIntentId = resolveOpportunityActorIntent(sourceActor);
  const candidateIntentId = resolveOpportunityActorIntent(candidateActor);
  const includeOtherIntents = negotiationIncludesOtherIntents();
  const [sourceAccount, sourceProfile, sourceIntents, candidateAccount, candidateProfile, candidateIntents] = await Promise.all([
    database.getUser(sourceActor.userId).catch(() => null),
    database.getProfile(sourceActor.userId).catch(() => null),
    includeOtherIntents
      ? database.getActiveIntents(sourceActor.userId).catch(() => [] as ActiveIntent[])
      : Promise.resolve([] as ActiveIntent[]),
    database.getUser(candidateActor.userId).catch(() => null),
    database.getProfile(candidateActor.userId).catch(() => null),
    includeOtherIntents
      ? database.getActiveIntents(candidateActor.userId).catch(() => [] as ActiveIntent[])
      : Promise.resolve([] as ActiveIntent[]),
  ]);
  const [sourceFallbackIntent, candidateFallbackIntent] = await Promise.all([
    sourceIntentId && !sourceIntents.some((intent) => intent.id === sourceIntentId) ? database.getIntent(sourceIntentId).catch(() => null) : null,
    candidateIntentId && !candidateIntents.some((intent) => intent.id === candidateIntentId) ? database.getIntent(candidateIntentId).catch(() => null) : null,
  ]);
  const sourceUser = {
    id: sourceActor.userId,
    intents: buildPrioritizedNegotiationIntents(
      sourceIntents,
      sourceIntentId,
      sourceFallbackIntent?.userId === sourceActor.userId ? sourceFallbackIntent : null,
      includeOtherIntents,
    ),
    profile: {
      name: sourceProfile?.identity?.name ?? sourceAccount?.name,
      bio: sourceProfile?.identity?.bio ?? sourceAccount?.intro ?? undefined,
      location: sourceProfile?.identity?.location ?? sourceAccount?.location ?? undefined,
    },
  };
  const candidate: ExistingOpportunityNegotiationCandidate = {
    userId: candidateActor.userId,
    ...(sourceIntentId ? { sourceIntentId } : {}),
    ...(candidateIntentId ? { candidateIntentId } : {}),
    opportunityId: opportunity.id,
    opportunityStatus: opportunity.status,
    opportunityUpdatedAt: opportunity.updatedAt,
    reasoning: (opportunity.interpretation as { reasoning?: string } | null)?.reasoning ?? '',
    valencyRole: candidateActor.role ?? 'peer',
    networkId: candidateActor.networkId,
    candidateUser: {
      id: candidateActor.userId,
      intents: buildPrioritizedNegotiationIntents(
        candidateIntents,
        candidateIntentId,
        candidateFallbackIntent?.userId === candidateActor.userId ? candidateFallbackIntent : null,
        includeOtherIntents,
      ),
      profile: {
        name: candidateProfile?.identity?.name ?? candidateAccount?.name,
        bio: candidateProfile?.identity?.bio ?? candidateAccount?.intro ?? undefined,
        location: candidateProfile?.identity?.location ?? candidateAccount?.location ?? undefined,
      },
    },
  };
  const indexContextMap = new Map<string, string>();
  if (candidate.networkId) {
    const context = await database.getNetworkMemberContext(candidate.networkId, sourceActor.userId).catch(() => null);
    const prompt = [context?.indexPrompt, context?.memberPrompt].filter((value): value is string => !!value?.trim()).join('\n\n');
    if (prompt) indexContextMap.set(candidate.networkId, prompt);
  }
  const execution = await executeNegotiation({ sourceUser, candidate, indexContextOverrides: indexContextMap, continuation });
  if (execution.accepted && queueNotification && !continuation) {
    for (const actor of nonIntroducerActors) {
      await queueNotification(opportunity.id, actor.userId, 'high').catch((error) => observer?.onNotificationFailure?.({ actorId: actor.userId, error }));
    }
  }
  return { kind: 'completed', opportunityId: opportunity.id, accepted: execution.accepted, continuationFence: continuation?.fence, ...(execution.receipt ? { receipt: execution.receipt } : {}) };
}
