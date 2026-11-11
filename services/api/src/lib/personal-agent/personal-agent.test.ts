import { describe, expect, it } from 'bun:test';

import { INDEX_RULES } from '../index-rules';

import { PERSONAL_INSTRUCTIONS, PERSONAL_PAST_SCOPE, PERSONAL_SCOPE } from './personal-agent.instructions';

describe('PERSONAL_INSTRUCTIONS', () => {
  it('carries the shared rules but none of the MCP client guidance', () => {
    expect(PERSONAL_INSTRUCTIONS).toContain(INDEX_RULES);
    expect(PERSONAL_INSTRUCTIONS).not.toContain("I'm Index");
    expect(PERSONAL_INSTRUCTIONS).not.toContain('I keep working after');
    expect(PERSONAL_INSTRUCTIONS).not.toContain('choice prompt');
  });

  it('says it is the only agent that talks to them', () => {
    expect(PERSONAL_INSTRUCTIONS).toContain('the only agent that talks to them');
  });
});

describe('stored scopes', () => {
  it('keep the values existing messages were written with', () => {
    expect(PERSONAL_SCOPE).toBe('home');
    expect(PERSONAL_PAST_SCOPE).toBe('home-past');
  });
});
