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
const main = read('../../../main.ts');
const verdictHost = read('../../agent/negotiator-verdict.host.ts');

describe('matches_ready wiring', () => {
  it('is exported from the one composition site, alongside the graphs it feeds', () => {
    expect(composition).toContain('export const matchesReady: MatchesReadyFn');
    expect(composition).toContain('personalAgentQueue.addMatchesReadyEvent');
  });

  it('reaches the chat/MCP tool factory through protocolDeps and toolDeps', () => {
    // protocolDeps feeds `createChatTools`; toolDeps feeds the MCP surface.
    // Both build an OpportunityGraph, and both were missing this field.
    expect(mcp).toMatch(/protocolDeps = \{[\s\S]*?\n {2}matchesReady:/);
    expect(mcp).toContain('matchesReady: protocolDeps.matchesReady');
  });

  it('reaches the REST/CLI tool service the same way', () => {
    expect(toolService).toContain("import { matchesReadyBestEffort } from '../lib/negotiation/negotiation-graph'");
    expect(toolService).toMatch(/negotiationDatabase: conversationDatabaseAdapter[\s\S]*?matchesReady:/);
  });

  it('fails the wake where a retry exists, and never at a waiting user\'s expense', () => {
    // The from-intent/enrichment queues retry, so `matchesReady` throws: a
    // batch that persisted with nobody woken is not a successful discovery.
    // The chat/MCP tool graphs have NOTHING behind them — the caller is a user
    // waiting on discover_opportunities — so they take the best-effort wake,
    // which retries and then RECORDS the loss rather than failing the call.
    expect(composition).toContain('export const matchesReady: MatchesReadyFn');
    expect(composition).toContain('export const matchesReadyBestEffort: MatchesReadyFn');
    expect(composition).toContain('matches_ready_wake_lost');
    expect(main).toMatch(/setRuntimeDeps\(\{\s*\n\s*matchesReady,/);
    expect(mcp).not.toMatch(/\n {2,4}matchesReady,\n/);
    expect(mcp).toContain('matchesReady: matchesReadyBestEffort');
    expect(toolService).toContain('matchesReadyBestEffort');
    expect(toolService).not.toMatch(/\n {6}matchesReady,\n/);
  });

  it("binds the agent's match list to the read that PROPAGATES a failure", () => {
    // `readActionableCounterparties` swallows to `[]` for the tool surfaces.
    // Bound here it would undo the protocol-side throw entirely: a transient
    // read error becomes a reflect that saw nothing and burned the round.
    expect(composition).toContain('readPersonalAgentMatches(userId, intentId)');
    expect(composition).not.toContain('readActionableCounterparties(');
    // The introducer gate rides along with the match, and the mapping that
    // carries it now lives with the reader rather than at the binding.
    expect(verdictHost).toContain('awaitingIntroducerApproval');
  });

  it('gives BOTH graphs the reflect enqueue and the agent its re-wake', () => {
    // A composition missing either is silent: rounds settle and never reflect,
    // and a batch that lands mid-turn is never picked up. Same class as the
    // missing matchesReady above — no error, just work that stops happening.
    expect(composition).toMatch(/NegotiationGraphFactory\(\{[\s\S]*?reflectEnqueue:/);
    expect(composition).toMatch(/PersonalAgentGraphFactory\(\{[\s\S]*?reflectEnqueue:/);
    expect(composition).toMatch(/PersonalAgentGraphFactory\(\{[\s\S]*?wakeForMatches:/);
  });

  it('is what the discovery queues pass', () => {
    expect(main).toContain('matchesReady,');
  });
});
