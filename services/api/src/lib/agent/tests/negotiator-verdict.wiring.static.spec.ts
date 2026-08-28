/**
 * Static invariants of the owner-verdict WIRING (#1471).
 *
 * The mapping and the writes are unit-tested in `negotiator-verdict.host.spec.ts`.
 * What this pins is what no unit test can reach.
 *
 * Two things, both load-bearing:
 *
 * 1. The verdict reaches the model ONLY through the pinned-signal path — the
 *    composition root injects the host, the persona registers the tools only
 *    with a pinned intent, and the prompt gets its numbered list from the same
 *    reader the host maps against. Break any link and the tools either vanish
 *    (back to the 2026-08-20 gap, where "reject them" had no lever) or come
 *    back with numbers pointing at a different list than the host resolves.
 *
 * 2. A rejected pairing's open question retires because
 *    `OpportunityEvents.onTransition` runs the exhaustion evaluator on EVERY
 *    committed status transition — owner reject included. That arrow already
 *    existed; this lane relies on it rather than re-invoking retirement, which
 *    is why it touches nothing under `lib/question/`. If that wiring is ever
 *    cut, a declined pairing keeps asking its client about itself.
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const composition = read('../../../controllers/mcp.controller.ts');
const agentComposition = read('../../negotiation/negotiation-graph.ts');
const main = read('../../../main.ts');
const host = read('../negotiator-verdict.host.ts');

describe('owner-verdict wiring', () => {
  it('registers the verdict host at the composition root, ungated', () => {
    expect(composition).toContain('negotiatorVerdictTools: negotiatorVerdictToolsHost');
    // No flag: a verdict lever that is sometimes absent is a lever the client
    // cannot rely on, and the persona would silently fall back to words.
    expect(composition).not.toMatch(/isNegotiatorVerdict\w*Enabled/);
  });

  it('keeps the MCP surface registered on the shared host — the persona registration is chat-dead, not the lane', () => {
    // Phase 2 retired the negotiator persona from chat, and with it the
    // persona-side tool registration; the claude.ai connector's path is a
    // DIFFERENT registration (McpToolDeps) and must keep working.
    expect(composition).toContain('negotiatorVerdictTools: protocolDeps.negotiatorVerdictTools');
    // The persona-collapse deleted the negotiator persona module wholesale —
    // the chat-side registration cannot come back through a file that no
    // longer exists.
    expect(existsSync(
      new URL('../../../../../../packages/protocol/src/internal/chat/negotiator.persona.ts', import.meta.url),
    )).toBe(false);
  });

  it('feeds the agent context from the same reader the host maps against', () => {
    // One ordering, two consumers. A second enumeration would be a second
    // order, and the number the client's agent read would resolve elsewhere.
    // The AgentGraph step moved both consumers into the one host composition
    // that binds the PersonalAgent's opportunity port: the same reader feeds
    // the numbered match list, and accept executes back through this host's
    // id-keyed lane.
    // `readPersonalAgentMatches`, not the degrading wrapper: the agent's turns are
    // ABOUT this list, so a read failure must fail the turn.
    expect(agentComposition).toContain('readPersonalAgentMatches(userId, intentId)');
    expect(agentComposition).toContain("passVerdictOnOpportunity(userId, input, 'accepted'");
    expect(host).toContain('export async function readActionableCounterparties');
    expect(host).toContain('export async function passVerdictOnOpportunity');
  });

  it('executes the verdict through the same owner status path the Radar card uses', () => {
    expect(host).toContain('opportunityService.updateOpportunityStatus(opportunityId, status, uid, options)');
    // Never the MCP `update_opportunity` lane: its admission refuses a
    // `negotiating` pairing outright and its owner-approval boundary fails
    // closed on the chat surface.
    expect(host).not.toContain('admitOpportunityUpdate');
    expect(host).not.toContain('ownerApprovalProof');
    // Outcome capture stays reserved for a verified first-party click: the
    // field is discussed in a comment and never passed.
    expect(host).not.toMatch(/actionProvenance\s*:/);
  });

  it('retires a dismissed pairing\'s question through the transition hook that already exists', () => {
    expect(main).toContain('OpportunityEvents.onTransition');
    expect(main).toContain('evaluateOpportunityTransition({ opportunityId: opportunity.id, status: opportunity.status })');
    // This lane calls that machinery, it does not reimplement or edit it.
    expect(host).not.toContain('lib/question');
  });
});
