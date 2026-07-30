import { describe, expect, test } from 'bun:test';

import { buildSystemContent } from '../chat.prompt.js';
import type { ResolvedToolContext } from '../../shared/agent/tool.factory.js';

const context = {
  userId: 'user-1', userName: 'User', userEmail: 'user@example.com', user: {}, userProfile: {},
  userNetworks: [], isOnboarding: false, hasName: true,
} as unknown as ResolvedToolContext;

describe('background-only chat prompt', () => {
  test('directs connection seeking toward signal creation and background matching', () => {
    const prompt = buildSystemContent(context, { recentTools: [], currentMessage: 'find me a mentor', ctx: context });
    expect(prompt).toContain('background matching');
    expect(prompt).not.toContain('discover_opportunities');
  });

  test('retains persisted opportunity list and update guidance', () => {
    const prompt = buildSystemContent(context, { recentTools: [{ name: 'list_opportunities', args: {} }], currentMessage: 'review my matches', ctx: context });
    expect(prompt).toContain('list_opportunities');
    expect(prompt).toContain('update_opportunity');
  });
});
