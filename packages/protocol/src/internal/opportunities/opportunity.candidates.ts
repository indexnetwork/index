/**
 * A pair discovery found and has not yet opened.
 *
 * Discovery does not create opportunities. It records the pair, once, keyed by
 * {@link pairKeyOf}; opening one is a separate decision. The pair key IS the
 * dedup: both principals'
 * discovery runs converge on the same candidate instead of racing to persist
 * two opportunities between the same two people.
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
  CreateDiscoveryMatchCandidateData,
  DiscoveryMatchCandidate,
  DiscoveryMatchCandidateStatus,
  OpenedNegotiation,
} from '../../platform/database.js';
