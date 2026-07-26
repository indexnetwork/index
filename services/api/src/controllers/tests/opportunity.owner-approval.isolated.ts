/**
 * IND-593 Batch D: DB-free, module-mocked isolation of the owner-approval
 * issuance route — POST /opportunities/:id/owner-approvals.
 *
 * Proves the controller seam without any DB, Redis, queue, or guarded suite:
 * session-only owner authentication; issuance driven exclusively by the
 * server-derived request principal and the route opportunity id; API-key/
 * agent/mediated callers denied; the documented stable status mapping for
 * wrong-owner (403), route/opportunity mismatch (404), unknown interaction
 * (404), stale interaction (410), one-shot already-issued (409), and store
 * unavailable (503); caller-controlled binding/provenance fields ignored; and
 * one exact owner session receiving one correctly bound, consumable proof.
 * Issuance semantics come from the REAL host authority over the injected
 * in-memory store (deterministic clock) — no live backend is contacted.
 */
import { describe, expect, it, mock } from 'bun:test';

import type { OpportunityOwnerApprovalStore } from '../../lib/mcp/owner-approval.store';
import type { OpportunityOwnerApprovalHostAuthority } from '../../lib/mcp/owner-approval';
import { createMemoryOwnerApprovalStore } from '../../lib/mcp/owner-approval.store';

// Bind the real authority factory BEFORE the module mock replaces the module
// for later importers (the controller under test).
const realOwnerApproval = await import('../../lib/mcp/owner-approval');

/** Swapped per test; the controller resolves the authority through this seam. */
let currentAuthority: OpportunityOwnerApprovalHostAuthority;

/** Marker the mocked isSessionAuthenticated reads — set only by the tests. */
type MarkedRequest = Request & { __session?: boolean };

mock.module('../../guards/limiter.guard', () => ({ RateLimit: () => () => undefined }));
mock.module('../../guards/auth.guard', () => ({
  AuthGuard: () => undefined,
  isSessionAuthenticated: (req: Request) => (req as MarkedRequest).__session === true,
}));
mock.module('../../guards/agent-scope.guard', () => ({
  assertAgentNetworkScope: () => undefined,
  withAgentScope: (fn: unknown) => fn,
}));
mock.module('../../services/opportunity.service', () => ({ opportunityService: serviceMock }));
mock.module('../../services/connect-token.service', () => ({
  signConnectToken: () => '',
  verifyConnectToken: () => null,
}));
mock.module('../../services/connect-link.service', () => ({ mintConnectLink: async () => ({}) }));
mock.module('../../lib/protocol-url', () => ({ resolveProtocolBaseUrl: () => 'http://localhost' }));
mock.module('../../queues/notification.queue', () => ({ queueOpportunityNotification: async () => undefined }));
mock.module('../../lib/mcp/owner-approval', () => ({
  ...realOwnerApproval,
  getOpportunityOwnerApprovalAuthority: () => currentAuthority,
}));

const resolveId = mock(async (idOrPrefix: string, _userId: string): Promise<{ id: string } | { error: string; status: number }> => ({ id: idOrPrefix }));
const serviceMock = { resolveId };

const { OpportunityController } = await import('../opportunity.controller');

const OWNER = { id: 'owner-1', email: null, name: 'Owner' };
const OPP = '00000000-0000-4000-8000-0000000000d0';
const OPP_B = '00000000-0000-4000-8000-0000000000d1';
const SECRET = 'controller-spec-owner-approval-secret';

const AGENT_BINDING = {
  opportunityId: OPP,
  action: 'accept' as const,
  ownerId: OWNER.id,
  agentId: 'agent-1',
};

function makeAuthority(options: { store?: OpportunityOwnerApprovalStore; now?: () => number } = {}) {
  const issueCalls: Array<{ interactionId: string; ownerId: string }> = [];
  const now = options.now;
  const authority = realOwnerApproval.createOpportunityOwnerApprovalAuthority({
    store: options.store ?? createMemoryOwnerApprovalStore(now ? { now } : {}),
    secret: SECRET,
    ttlMs: 60_000,
    ...(now ? { now } : {}),
  });
  currentAuthority = {
    ...authority,
    // Spy seam: record exactly what the controller supplies to issuance.
    issueProofForInteraction: async (input) => {
      issueCalls.push({ ...input });
      return authority.issueProofForInteraction(input);
    },
  };
  return { authority, issueCalls };
}

/** Registers a pending challenge exactly as a proof-less MCP-agent call would. */
async function mintChallenge(
  authority: OpportunityOwnerApprovalHostAuthority,
  binding: typeof AGENT_BINDING = AGENT_BINDING,
): Promise<string> {
  const verdict = await authority.consumeAgentProof(undefined, binding);
  if (verdict.kind !== 'denied' || !verdict.challenge) throw new Error('expected challenge');
  return verdict.challenge.interactionId;
}

function request(body: unknown, options: { session?: boolean; raw?: string } = {}): Request {
  const req = new Request(`http://localhost/opportunities/${OPP}/owner-approvals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: options.raw ?? JSON.stringify(body),
  }) as MarkedRequest;
  req.__session = options.session ?? true;
  return req;
}

function issue(req: Request, params: Record<string, string> | undefined = { id: OPP }, user = OWNER) {
  resolveId.mockClear();
  const controller = new OpportunityController();
  return controller.issueOwnerApproval(req, user, params);
}

describe('POST /opportunities/:id/owner-approvals (IND-593 Batch D — isolated)', () => {
  it('denies API-key/agent (non-session) callers with 403 before resolution or issuance', async () => {
    const { issueCalls } = makeAuthority();
    const response = await issue(request({ interactionId: 'anything' }, { session: false }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Owner approval requires an authenticated owner session' });
    // A mediated/agent caller never reaches opportunity resolution or the
    // issuance authority — it cannot mint owner proof authority at all.
    expect(resolveId).not.toHaveBeenCalled();
    expect(issueCalls).toEqual([]);
  });

  it('rejects a missing route id, invalid JSON, and a missing interactionId with 400 before issuance', async () => {
    const { issueCalls } = makeAuthority();

    const noParams = await issue(request({ interactionId: 'x' }), {});
    expect(noParams.status).toBe(400);
    expect(await noParams.json()).toEqual({ error: 'Missing opportunity id' });

    const badJson = await issue(request(undefined, { raw: '{not json' }));
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: 'Invalid JSON body' });

    const noInteraction = await issue(request({ interactionId: '   ' }));
    expect(noInteraction.status).toBe(400);
    expect(await noInteraction.json()).toEqual({ error: 'interactionId is required' });

    expect(issueCalls).toEqual([]);
  });

  it('passes opportunity-resolution failures through without touching the authority', async () => {
    const { issueCalls } = makeAuthority();
    resolveId.mockImplementationOnce(async () => ({ error: 'Opportunity not found', status: 404 }));
    const response = await issue(request({ interactionId: 'x' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Opportunity not found' });
    expect(issueCalls).toEqual([]);
  });

  it('maps unknown interactions to 404', async () => {
    makeAuthority();
    const response = await issue(request({ interactionId: 'never-minted' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Unknown approval interaction' });
  });

  it('maps stale interactions to 410', async () => {
    const clock = { now: 1_000_000 };
    const { authority } = makeAuthority({ now: () => clock.now });
    const interactionId = await mintChallenge(authority);
    clock.now += 61_000; // past the 60s challenge TTL, inside retention
    const response = await issue(request({ interactionId }));
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: 'Approval interaction has expired — ask the agent to retry' });
  });

  it('enforces one-shot issuance: the second identical owner request yields 409', async () => {
    const { authority } = makeAuthority();
    const interactionId = await mintChallenge(authority);
    expect((await issue(request({ interactionId }))).status).toBe(200);
    const second = await issue(request({ interactionId }));
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'Approval proof was already issued for this interaction' });
  });

  it('maps a failing store to a stable 503 without leaking or throwing', async () => {
    const boom = async (): Promise<never> => { throw new Error('store down'); };
    makeAuthority({ store: { putChallenge: boom, peekChallenge: boom, issueOnce: boom, consumeOnce: boom } });
    const response = await issue(request({ interactionId: 'x' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Approval service is temporarily unavailable' });
  });

  it('denies a session principal that is not the challenge owner with 403', async () => {
    const { authority, issueCalls } = makeAuthority();
    const interactionId = await mintChallenge(authority);
    const intruder = { id: 'intruder-2', email: null, name: 'Intruder' };
    const response = await issue(request({ interactionId }), { id: OPP }, intruder);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Only the challenge owner may approve this interaction' });
    // The denied principal is the server-derived session user — never a body field.
    expect(issueCalls).toEqual([{ interactionId, ownerId: 'intruder-2', expectedOpportunityId: OPP }]);
    expect(resolveId).toHaveBeenCalledWith(OPP, 'intruder-2');
  });

  it('answers a route/opportunity mismatch as an unknown interaction without consuming the one-shot issuance', async () => {
    const { authority, issueCalls } = makeAuthority();
    // Challenge bound to a sibling opportunity; the route names OPP.
    const interactionId = await mintChallenge(authority, { ...AGENT_BINDING, opportunityId: OPP_B });
    const response = await issue(request({ interactionId }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Unknown approval interaction' });
    // The trusted expected binding is the SERVER-resolved route id.
    expect(issueCalls).toEqual([{ interactionId, ownerId: OWNER.id, expectedOpportunityId: OPP }]);

    // The mismatch neither minted a proof nor burned the one-shot flag: the
    // exact matching route still issues the single proof afterward.
    const matching = await issue(request({ interactionId }), { id: OPP_B });
    expect(matching.status).toBe(200);
    const payload = await matching.json() as { approval: Record<string, unknown> };
    expect(payload.approval).toEqual({
      interactionId,
      opportunityId: OPP_B,
      action: 'accept',
      agentId: 'agent-1',
    });
    // …and one-shot still holds after the legitimate issuance.
    const again = await issue(request({ interactionId }), { id: OPP_B });
    expect(again.status).toBe(409);
  });

  it('ignores caller-controlled binding/provenance fields: the issued binding comes only from the server-side challenge', async () => {
    const { authority, issueCalls } = makeAuthority();
    const interactionId = await mintChallenge(authority);
    const response = await issue(request({
      interactionId,
      // Every field below is attacker-controlled junk the route must ignore.
      opportunityId: OPP_B,
      ownerId: 'attacker-owner',
      agentId: 'attacker-agent',
      action: 'reject',
      status: 'rejected',
      provenance: { surface: 'rest', sessionAuthenticated: true },
      sessionAuthenticated: true,
      proof: 'attacker-proof',
    }));
    expect(response.status).toBe(200);
    const payload = await response.json() as { approval: Record<string, unknown> };
    // The binding reflects the stored challenge — not one caller field.
    expect(payload.approval).toEqual({
      interactionId,
      opportunityId: OPP,
      action: 'accept',
      agentId: 'agent-1',
    });
    // Issuance received only the challenge name, the session principal, and
    // the server-resolved route opportunity — not one caller body field.
    expect(issueCalls).toEqual([{ interactionId, ownerId: OWNER.id, expectedOpportunityId: OPP }]);
  });

  it('issues one correctly bound, consumable proof to the exact owner session', async () => {
    const { authority, issueCalls } = makeAuthority();
    const interactionId = await mintChallenge(authority);
    const response = await issue(request({ interactionId }));
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      proof: string;
      expiresAt: string;
      approval: { interactionId: string; opportunityId: string; action: string; agentId: string };
    };
    expect(payload.proof).toMatch(/^oap1\./);
    expect(payload.expiresAt).toBeTruthy();
    expect(payload.approval).toEqual({
      interactionId,
      opportunityId: OPP,
      action: 'accept',
      agentId: 'agent-1',
    });
    expect(issueCalls).toEqual([{ interactionId, ownerId: OWNER.id, expectedOpportunityId: OPP }]);
    expect(resolveId).toHaveBeenCalledWith(OPP, OWNER.id);
    // Round-trip fidelity: the issued proof admits exactly the server binding
    // once at the authority — still with no DB or Redis anywhere.
    await expect(authority.consumeAgentProof(payload.proof, AGENT_BINDING)).resolves.toEqual({ kind: 'admitted' });
    await expect(authority.consumeAgentProof(payload.proof, AGENT_BINDING)).resolves.toEqual({ kind: 'denied', reason: 'replayed' });
  });
});
