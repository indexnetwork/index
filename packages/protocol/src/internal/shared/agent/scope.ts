/**
 * Request scope primitives.
 *
 * `scopeType`/`scopeId` describe the caller's focused scope, not the full set of
 * networks they may read or write. The helpers here derive concrete network id
 * sets from the focused scope and the caller's memberships.
 */
import type { ScopeMembership, ScopeType } from '../../../protocol/core.js';
export type { ScopeMembership, ScopeType } from '../../../protocol/core.js';

export interface ScopeEnvelope {
  scopeType?: ScopeType;
  scopeId?: string;
}

export interface DeriveNetworkScopeInput extends ScopeEnvelope {
  memberships: ScopeMembership[];
}

function uniqueNetworkIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function hasNetworkScope(scope: ScopeEnvelope): scope is { scopeType: 'network'; scopeId: string } {
  return scope.scopeType === 'network' && typeof scope.scopeId === 'string' && scope.scopeId.trim().length > 0;
}

/** Every network the caller may read within their focused scope. */
export function deriveAllowedNetworkIds(input: DeriveNetworkScopeInput): string[] {
  if (!hasNetworkScope(input)) {
    return uniqueNetworkIds(input.memberships.map((membership) => membership.networkId));
  }

  return uniqueNetworkIds(
    input.memberships
      .filter((membership) => membership.networkId === input.scopeId)
      .map((membership) => membership.networkId),
  );
}

/** The networks discovery may draw counterparties from. Empty when the focused network is not one of the caller's. */
export function deriveDiscoveryNetworkIds(input: DeriveNetworkScopeInput): string[] {
  if (!hasNetworkScope(input)) {
    return uniqueNetworkIds(input.memberships.map((membership) => membership.networkId));
  }

  return input.memberships.some((membership) => membership.networkId === input.scopeId)
    ? [input.scopeId]
    : [];
}
