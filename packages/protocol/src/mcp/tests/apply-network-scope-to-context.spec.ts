import { describe, expect, test } from 'bun:test';

import { applyNetworkScopeToContext, computeAgentAllowedNetworkIds } from '../mcp.server.js';
import type { ResolvedToolContext } from '../../shared/agent/tool.helpers.js';

const memberships = [
  {
    networkId: 'personal-1',
    networkTitle: 'Personal',
    indexPrompt: null,
    permissions: ['owner'],
    memberPrompt: null,
    autoAssign: true,
    isPersonal: true,
    joinedAt: new Date('2026-01-01'),
  },
  {
    networkId: 'experiment-net',
    networkTitle: 'Edge City',
    indexPrompt: 'Builders shipping at the edge',
    permissions: ['member'],
    memberPrompt: null,
    autoAssign: true,
    isPersonal: false,
    joinedAt: new Date('2026-01-02'),
  },
  {
    networkId: 'community-B',
    networkTitle: 'Other Community',
    indexPrompt: 'Something else',
    permissions: ['owner'],
    memberPrompt: null,
    autoAssign: true,
    isPersonal: false,
    joinedAt: new Date('2026-01-03'),
  },
];

const baseContext = (): ResolvedToolContext => ({
  userId: 'user-1',
  userName: 'Alice',
  userEmail: 'alice@test',
  user: { id: 'user-1', name: 'Alice', email: 'alice@test' } as never,
  userProfile: null as never,
  userNetworks: memberships,
  indexScope: ['personal-1', 'experiment-net', 'community-B'],
  isOnboarding: false,
  hasName: true,
  isMcp: true,
});

describe('applyNetworkScopeToContext', () => {
  test('no-op when scope is null', () => {
    const ctx = baseContext();
    applyNetworkScopeToContext(ctx, null);
    expect(ctx.networkId).toBeUndefined();
    expect(ctx.indexName).toBeUndefined();
    expect(ctx.scopedIndex).toBeUndefined();
    expect(ctx.scopedMembershipRole).toBeUndefined();
    expect(ctx.isOwner).toBeUndefined();
  });

  test('no-op when scope is undefined', () => {
    const ctx = baseContext();
    applyNetworkScopeToContext(ctx, undefined);
    expect(ctx.networkId).toBeUndefined();
  });

  test('preserves an explicit chat scope when one is already set', () => {
    const ctx = baseContext();
    ctx.networkId = 'community-B';
    ctx.scopeType = 'network';
    ctx.scopeId = 'community-B';
    ctx.indexName = 'Other Community';
    applyNetworkScopeToContext(ctx, 'experiment-net');
    expect(ctx.networkId).toBe('community-B');
    expect(ctx.scopeType).toBe('network');
    expect(ctx.scopeId).toBe('community-B');
    expect(ctx.indexName).toBe('Other Community');
  });

  test('promotes networkScopeId into scope envelope when bound network is in memberships', () => {
    const ctx = baseContext();
    applyNetworkScopeToContext(ctx, 'experiment-net');

    expect(ctx.networkId).toBeUndefined();
    expect(ctx.scopeType).toBe('network');
    expect(ctx.scopeId).toBe('experiment-net');
    expect(ctx.indexName).toBe('Edge City');
    expect(ctx.scopedIndex).toEqual({
      id: 'experiment-net',
      title: 'Edge City',
      prompt: 'Builders shipping at the edge',
    });
    expect(ctx.scopedMembershipRole).toBe('member');
    expect(ctx.isOwner).toBe(false);
  });

  test('marks owner when permissions include owner', () => {
    const ctx = baseContext();
    applyNetworkScopeToContext(ctx, 'community-B');

    expect(ctx.networkId).toBeUndefined();
    expect(ctx.scopeId).toBe('community-B');
    expect(ctx.scopedMembershipRole).toBe('owner');
    expect(ctx.isOwner).toBe(true);
  });

  test('promotes scope envelope even when bound network is not in memberships (defensive)', () => {
    const ctx = baseContext();
    applyNetworkScopeToContext(ctx, 'unknown-network');

    // We still apply the network scope so downstream tools refuse cross-scope access.
    // indexName/scopedIndex remain unset because we have no authoritative title/prompt.
    expect(ctx.networkId).toBeUndefined();
    expect(ctx.scopeType).toBe('network');
    expect(ctx.scopeId).toBe('unknown-network');
    expect(ctx.indexName).toBeUndefined();
    expect(ctx.scopedIndex).toBeUndefined();
  });

  test('derives allowed network IDs as [boundNetwork, personalIndex] when scoped', () => {
    const ctx = baseContext();
    applyNetworkScopeToContext(ctx, 'experiment-net');
    expect(computeAgentAllowedNetworkIds(ctx.userNetworks, ctx.scopeType, ctx.scopeId).sort()).toEqual(['experiment-net', 'personal-1'].sort());
    expect(ctx.indexScope.sort()).toEqual(['personal-1', 'experiment-net', 'community-B'].sort());
  });

  test('leaves indexScope unchanged when scope is null (already set by resolveChatContext)', () => {
    const ctx = baseContext();
    ctx.indexScope = ['personal-1', 'experiment-net', 'community-B'];
    applyNetworkScopeToContext(ctx, null);
    expect(ctx.indexScope).toEqual(['personal-1', 'experiment-net', 'community-B']);
  });
});
