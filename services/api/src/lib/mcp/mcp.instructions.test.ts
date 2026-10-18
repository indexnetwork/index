import { describe, expect, test } from 'bun:test';

import { mcpInstructions } from './mcp.instructions';

describe('MCP instructions', () => {
  test('follow the morning brief and do not ask clients to poll', () => {
    const text = mcpInstructions(true);
    expect(text).not.toContain('every 5 minutes');
    expect(text).not.toContain("as often as you're allowed");
    expect(text).toContain('check once a day in the 8am hour of their profile timezone');
    expect(text).toContain('one or two minutes after they create or change an intent');
    expect(text).toContain('I only write when I need them, and so should you.');
    expect(text).toContain('A waiting question must go to them as a choice prompt');
  });
});
