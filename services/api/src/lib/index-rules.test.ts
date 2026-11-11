import { describe, expect, it } from 'bun:test';

import { AGENT_TOOL_RULES, INDEX_RULES, INTENT_RULES } from './index-rules';
import { MCP_INSTRUCTIONS } from './mcp/mcp.instructions';

describe('INDEX_RULES', () => {
  it('is what MCP clients already read, word for word', () => {
    expect(MCP_INSTRUCTIONS).toContain(INTENT_RULES);
    expect(MCP_INSTRUCTIONS).toContain(AGENT_TOOL_RULES);
    expect(INDEX_RULES).toBe(`${INTENT_RULES}\n\n${AGENT_TOOL_RULES}`);
  });

  it('carries no client-only guidance', () => {
    expect(INDEX_RULES).not.toContain("I'm Index");
    expect(INDEX_RULES).not.toContain('I keep working after');
    expect(INDEX_RULES).not.toContain('choice prompt');
    expect(MCP_INSTRUCTIONS).toContain('I keep working after');
  });
});
