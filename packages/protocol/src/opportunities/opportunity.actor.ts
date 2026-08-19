import type { NegotiationCounterpartyBinding } from '../shared/interfaces/database.negotiation.js';
import type { CreateOpportunityData, OpportunityActor } from '../shared/interfaces/database.interface.js';

/**
 * Normalize an actor intent value while preserving protocol string IDs.
 * Null-like model sentinels are represented by absence in persisted actors.
 */
export function normalizeOpportunityActorIntent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.toLowerCase() === 'null'
    || normalized.toLowerCase() === 'undefined'
  ) {
    return undefined;
  }

  return normalized;
}

/** Resolve the normalized intent from either evaluator or persisted actor fields. */
export function resolveOpportunityActorIntent(actor: {
  intentId?: unknown;
  intent?: unknown;
}): string | undefined {
  return normalizeOpportunityActorIntent(actor.intentId)
    ?? normalizeOpportunityActorIntent(actor.intent);
}

/**
 * Resolve the binding an actor actually carries: its intent when it has one,
 * otherwise its premise. Premise discovery produces actors of the second kind,
 * and they are ordinary participants — an opportunity is not required to pair
 * two stated intents.
 */
export function resolveOpportunityActorBinding(actor: {
  intentId?: unknown;
  intent?: unknown;
  premise?: unknown;
}): NegotiationCounterpartyBinding | undefined {
  const intent = resolveOpportunityActorIntent(actor);
  if (intent !== undefined) return { kind: 'intent', id: intent };
  const premise = normalizeOpportunityActorIntent(actor.premise);
  return premise === undefined ? undefined : { kind: 'premise', id: premise };
}

/** Whether an actor still carries the exact binding a parked negotiation pinned. */
export function opportunityActorMatchesBinding(
  actor: { intentId?: unknown; intent?: unknown; premise?: unknown },
  binding: NegotiationCounterpartyBinding | undefined,
): boolean {
  const resolved = resolveOpportunityActorBinding(actor);
  return resolved !== undefined
    && binding !== undefined
    && resolved.kind === binding.kind
    && resolved.id === binding.id;
}

/** Return a non-mutating actor copy with a canonical optional intent. */
export function normalizeOpportunityActors(
  actors: readonly OpportunityActor[],
): OpportunityActor[] {
  return actors.map((actor) => {
    const normalizedActor = { ...actor };
    const normalizedIntent = normalizeOpportunityActorIntent(actor.intent);

    delete normalizedActor.intent;
    if (normalizedIntent !== undefined) {
      normalizedActor.intent = normalizedIntent as NonNullable<OpportunityActor['intent']>;
    }

    return normalizedActor;
  });
}

/** Return non-mutating create data whose actor intents are canonical. */
export function normalizeCreateOpportunityActorIntents(
  data: CreateOpportunityData,
): CreateOpportunityData {
  return {
    ...data,
    actors: normalizeOpportunityActors(data.actors),
  };
}
