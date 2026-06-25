import { describe, expect, test } from 'bun:test';

import { computeAgentAllowedNetworkIds } from '../mcp.server.js';

describe('computeAgentAllowedNetworkIds', () => {
  const memberships = [
    { networkId: 'personal-1', isPersonal: true },
    { networkId: 'community-A', isPersonal: false },
    { networkId: 'community-B', isPersonal: false },
    { networkId: 'community-C', isPersonal: false },
  ];

  test('returns all networks when scope is null', () => {
    const scope = computeAgentAllowedNetworkIds(memberships, undefined, null);
    expect(scope).toEqual(['personal-1', 'community-A', 'community-B', 'community-C']);
  });

  test('returns all networks when scope is undefined', () => {
    const scope = computeAgentAllowedNetworkIds(memberships, undefined, undefined);
    expect(scope).toEqual(['personal-1', 'community-A', 'community-B', 'community-C']);
  });

  test('clamps to scope + personal index when scope is set', () => {
    const scope = computeAgentAllowedNetworkIds(memberships, 'network', 'community-B');
    expect(scope.sort()).toEqual(['community-B', 'personal-1'].sort());
  });

  test('returns only the personal index when scope is set but not in memberships', () => {
    const scope = computeAgentAllowedNetworkIds(memberships, 'network', 'community-XYZ');
    expect(scope).toEqual(['personal-1']);
  });

  test('returns empty array when scope is set, no match, and no personal index', () => {
    const scope = computeAgentAllowedNetworkIds(
      [{ networkId: 'community-A', isPersonal: false }],
      'network',
      'community-XYZ',
    );
    expect(scope).toEqual([]);
  });

  test('handles isPersonal as null (treats as non-personal)', () => {
    const scope = computeAgentAllowedNetworkIds(
      [{ networkId: 'community-A', isPersonal: null }],
      undefined,
      null,
    );
    expect(scope).toEqual(['community-A']);
  });
});
