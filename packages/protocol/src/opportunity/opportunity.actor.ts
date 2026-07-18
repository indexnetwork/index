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
