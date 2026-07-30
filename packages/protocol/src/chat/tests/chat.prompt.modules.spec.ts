import { describe, expect, test } from 'bun:test';

import { PROMPT_MODULES, resolveModules, type IterationContext } from '../chat.prompt.modules.js';

describe('background-only prompt modules', () => {
  const ctx = {
    userId: 'user-1', userEmail: 'user@example.com', userName: 'User', user: {}, userProfile: {},
    userNetworks: [], scopedIndex: null, scopedMembershipRole: null, networkId: null, indexName: null,
    isOwner: false, isOnboarding: false, hasName: true, contactsEnabled: true,
  } as IterationContext['ctx'];

  test('registers retained signal and persisted-opportunity modules only', () => {
    const ids = PROMPT_MODULES.map((module) => module.id);
    expect(ids).not.toContain('discovery');
    expect(ids).not.toContain('introduction');
    expect(ids).toContain('intent-creation');
    expect(ids).toContain('intent-management');
  });

  test('does not inject a direct-discovery instruction for connection seeking', () => {
    const output = resolveModules({ recentTools: [], currentMessage: 'find me a mentor', ctx });
    expect(output).not.toContain('discover_opportunities');
  });

  test('keeps persisted opportunity actions available after list/update calls', () => {
    const output = resolveModules({
      recentTools: [{ name: 'list_opportunities', args: {} }, { name: 'update_opportunity', args: {} }],
      currentMessage: 'review my matches', ctx,
    });
    expect(output).not.toContain('discover_opportunities');
  });
});
