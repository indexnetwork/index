/**
 * Discovery's hand-off to the signal's agent must be wired at EVERY
 * composition root, not just the queue one.
 *
 * `tool.factory` builds its own OpportunityGraph from `deps.matchesReady`. If
 * a host leaves that field unset the graph's matches_ready edge ends at END:
 * a user runs discovery from chat or MCP, the matches persist, and the agent
 * is never woken — nothing is kicked off, and nothing says so. There is no
 * runtime error to notice, which is why this is pinned statically.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const composition = read('../negotiation-graph.ts');
const mcp = read('../../../controllers/mcp.controller.ts');
const toolService = read('../../../services/tool.service.ts');

describe('matches_ready wiring', () => {
  it('is exported from the one composition site, alongside the graphs it feeds', () => {
    expect(composition).toContain('export const matchesReady: MatchesReadyFn');
    expect(composition).toContain('personalAgentQueue.addMatchesReadyEvent');
  });

  it('reaches the chat/MCP tool factory through protocolDeps and toolDeps', () => {
    // protocolDeps feeds `createChatTools`; toolDeps feeds the MCP surface.
    // Both build an OpportunityGraph, and both were missing this field.
    expect(mcp).toMatch(/protocolDeps = \{[\s\S]*?\n {2}matchesReady,/);
    expect(mcp).toContain('matchesReady: protocolDeps.matchesReady');
  });

  it('reaches the REST/CLI tool service the same way', () => {
    expect(toolService).toContain("import { matchesReady } from '../lib/negotiation/negotiation-graph'");
    expect(toolService).toMatch(/negotiationDatabase: conversationDatabaseAdapter[\s\S]*?matchesReady,/);
  });

  it('is what the discovery queues pass, so one callback serves every path', () => {
    const main = read('../../../main.ts');
    expect(main).toContain('matchesReady,');
  });
});
