/**
 * The signal cycle has process-wide graph state: a turn author re-enters the
 * PersonalAgent graph and the agent's effects re-enter NegotiationGraph. Keep
 * one compiled instance of each in the host composition root.
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sourceRoot = new URL('../../../', import.meta.url).pathname;
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : productionSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [readFileSync(path, 'utf8')] : [];
  });
}

const composition = read('../negotiation-graph.ts');
const mcp = read('../../../controllers/mcp.controller.ts');
const opportunityService = read('../../../services/opportunity.service.ts');
const personalAgentQueue = read('../../../queues/personal-agent.queue.ts');
const main = read('../../../main.ts');

describe('host graph composition', () => {
  it('constructs each signal-cycle graph once, in the host composition root', () => {
    const sources = productionSources(sourceRoot).join('\n');

    expect(sources.match(/new\s+NegotiationGraphFactory\s*\(/g)).toHaveLength(1);
    expect(sources.match(/new\s+PersonalAgentGraphFactory\s*\(/g)).toHaveLength(1);
    expect(composition).toContain('export const negotiationGraph = new NegotiationGraphFactory');
    expect(composition).toContain('export const personalAgentGraph: PersonalAgentGraphLike = new PersonalAgentGraphFactory');
  });

  it('keeps the graph cycle lazy and routes live host paths through it', () => {
    expect(composition).toMatch(/authorTurn: async[\s\S]*?personalAgentGraph\.invoke/);
    expect(composition).toMatch(/personalAgentGraph[\s\S]*?negotiations: negotiationGraph/);

    expect(personalAgentQueue).toContain("import { personalAgentGraph } from '../lib/negotiation/negotiation-graph'");
    expect(personalAgentQueue).toContain('personalAgentGraph.invoke(input)');
    expect(main).toContain('negotiationWatchdogQueue.setNegotiationGraph(negotiationGraph)');
    expect(main).toContain('negotiationWatchdogQueue.setReflectEnqueue');
    expect(opportunityService).toContain("await import('../lib/negotiation/negotiation-graph')");
    expect(opportunityService).toContain("close: { reason: 'owner_verdict'");
    expect(mcp).toContain("import { matchesReadyBestEffort, negotiationGraph } from '../lib/negotiation/negotiation-graph'");
    expect(mcp).toMatch(/negotiationGraph,\n[\s\S]*?matchesReady: protocolDeps\.matchesReady/);
  });

  it('binds reply text and safe activity to the same per-message transport', () => {
    expect(composition).toContain('replyStream: { publish: publishPersonalAgentReplyChunk }');
    expect(composition).toContain('activity: { publish: publishPersonalAgentActivity }');
  });
});
