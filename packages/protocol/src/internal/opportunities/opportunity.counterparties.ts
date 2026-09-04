/**
 * The counterparty side of a pair discovery scored.
 *
 * Discovery does not stage the pair anywhere: it hands the host the pair and
 * the host opens the opportunity and its negotiation. {@link pairKeyOf} is what
 * keeps that idempotent across both principals' runs.
 */

/**
 * Stable identity of a two-intent pair within a network, independent of which
 * side's discovery run found it.
 *
 * Ids are length-prefixed rather than joined on a separator: an id containing
 * the separator would otherwise let two different pairs produce one key, and
 * this key is a uniqueness constraint.
 */
export function pairKeyOf(networkId: string, intentA: string, intentB: string): string {
  const [low, high] = intentA <= intentB ? [intentA, intentB] : [intentB, intentA];
  return [networkId, low, high].map((part) => `${part.length}:${part}`).join('');
}

export type {
  CreateIntentCounterpartyData,
  OpenedNegotiation,
} from '../../platform/database.js';
