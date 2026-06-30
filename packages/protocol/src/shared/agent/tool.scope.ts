/**
 * Request scope primitives for protocol tools.
 *
 * `scopeType`/`scopeId` describe the user's focused scope, not the full set of
 * networks a caller may read or write. Helper functions derive concrete network
 * id sets from the focused scope plus the caller's memberships.
 */
export type ToolScopeType = 'network' | 'intent';

export interface ToolScopeEnvelope {
  scopeType?: ToolScopeType;
  scopeId?: string;
}

export interface ScopeMembership {
  networkId: string;
  isPersonal?: boolean | null;
}

export interface DeriveNetworkScopeInput extends ToolScopeEnvelope {
  memberships: ScopeMembership[];
}

function uniqueNetworkIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function scopeFromNetworkId(networkId: string | null | undefined): ToolScopeEnvelope {
  const scopeId = networkId?.trim();
  return scopeId ? { scopeType: 'network', scopeId } : {};
}

export function scopeFromIntentId(intentId: string | null | undefined): ToolScopeEnvelope {
  const scopeId = intentId?.trim();
  return scopeId ? { scopeType: 'intent', scopeId } : {};
}

export function hasNetworkScope(scope: ToolScopeEnvelope): scope is { scopeType: 'network'; scopeId: string } {
  return scope.scopeType === 'network' && typeof scope.scopeId === 'string' && scope.scopeId.trim().length > 0;
}

export function hasIntentScope(scope: ToolScopeEnvelope): scope is { scopeType: 'intent'; scopeId: string } {
  return scope.scopeType === 'intent' && typeof scope.scopeId === 'string' && scope.scopeId.trim().length > 0;
}

/**
 * Returns the focused network id from the canonical scope envelope.
 *
 * This intentionally does not inspect legacy `networkId` fields; callers that
 * still need a transition fallback should pass `scopeFromNetworkId(networkId)`
 * at the boundary so tool logic remains envelope-driven.
 */
export function focusedNetworkId(scope: ToolScopeEnvelope): string | undefined {
  return hasNetworkScope(scope) ? scope.scopeId.trim() : undefined;
}

export function focusedIntentId(scope: ToolScopeEnvelope): string | undefined {
  return hasIntentScope(scope) ? scope.scopeId.trim() : undefined;
}

/** Human-readable label for a focused scope, used in scope-restriction notes. */
export function focusedNetworkLabel(scope: ToolScopeEnvelope & { indexName?: string }): string {
  return scope.indexName ?? focusedNetworkId(scope) ?? 'this network';
}

export function deriveAllowedNetworkIds(input: DeriveNetworkScopeInput): string[] {
  if (!hasNetworkScope(input)) {
    return uniqueNetworkIds(input.memberships.map((membership) => membership.networkId));
  }

  return uniqueNetworkIds(
    input.memberships
      .filter((membership) => membership.networkId === input.scopeId || membership.isPersonal === true)
      .map((membership) => membership.networkId),
  );
}

export function deriveDiscoveryNetworkIds(input: DeriveNetworkScopeInput): string[] {
  if (!hasNetworkScope(input)) {
    return uniqueNetworkIds(input.memberships.map((membership) => membership.networkId));
  }

  return input.memberships.some((membership) => membership.networkId === input.scopeId)
    ? [input.scopeId]
    : [];
}
