/**
 * IND-593: host opportunity owner-approval authority (Batch A).
 *
 * Unit proofs for the HMAC-signed, atomically single-use owner-proof
 * verifier/consumer over an injected async OpportunityOwnerApprovalStore:
 * challenge registration on proof-less calls, owner-only atomic one-shot
 * issuance, fail-closed verdicts for forged/generic/stale/wrong-binding/
 * replayed proofs and for store/config errors, exactly-one concurrent
 * consumption across two authority instances sharing one store, TTL/stale
 * retention cleanup, and opaque hashed store keys. The production Redis
 * adapter is proven against a deterministic fake ioredis client — no live
 * Redis is ever contacted.
 */
import { describe, test, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createLazyProductionStore, createOpportunityOwnerApprovalAuthority } from '../owner-approval';
import { createMemoryOwnerApprovalStore, type OpportunityOwnerApprovalStore } from '../owner-approval.store';
import { RedisOwnerApprovalStore } from '../owner-approval.store.redis';
import { FakeOwnerApprovalRedis } from './fake-owner-approval-redis';

const SECRET = 'test-owner-approval-secret';

const BINDING = {
  opportunityId: '00000000-0000-4000-8000-0000000000aa',
  action: 'accept' as const,
  ownerId: 'owner-1',
  agentId: 'agent-1',
};

function authority(options: {
  now?: () => number;
  store?: OpportunityOwnerApprovalStore;
  secret?: string;
} = {}) {
  const now = options.now;
  return createOpportunityOwnerApprovalAuthority({
    store: options.store ?? createMemoryOwnerApprovalStore(now ? { now } : {}),
    secret: options.secret ?? SECRET,
    ttlMs: 60_000,
    ...(now ? { now } : {}),
  });
}

type Authority = ReturnType<typeof authority>;

/** Registers a challenge by making a proof-less call. */
async function challenge(auth: Authority, binding = BINDING) {
  const verdict = await auth.consumeAgentProof(undefined, binding);
  if (verdict.kind !== 'denied' || !verdict.challenge) throw new Error('expected a missing-proof challenge');
  return verdict.challenge;
}

/** Signs an arbitrary payload with the test secret (for generic/tamper cases). */
function signPayload(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(`oap1.${body}`).digest('base64url');
  return `oap1.${body}.${sig}`;
}

/** Store decorator that records every key an authority derives. */
function recordingStore(inner: OpportunityOwnerApprovalStore): { store: OpportunityOwnerApprovalStore; keys: string[] } {
  const keys: string[] = [];
  const remember = (key: string) => { keys.push(key); };
  return {
    keys,
    store: {
      putChallenge: (key, record, ttlMs) => { remember(key); return inner.putChallenge(key, record, ttlMs); },
      peekChallenge: (key) => { remember(key); return inner.peekChallenge(key); },
      issueOnce: (key) => { remember(key); return inner.issueOnce(key); },
      consumeOnce: (key, replayTtlMs) => { remember(key); return inner.consumeOnce(key, replayTtlMs); },
    },
  };
}

/** Store whose every operation fails, for fail-closed proofs. */
function brokenStore(): OpportunityOwnerApprovalStore {
  const boom = async (): Promise<never> => { throw new Error('store unavailable'); };
  return { putChallenge: boom, peekChallenge: boom, issueOnce: boom, consumeOnce: boom };
}

describe('opportunity owner-approval authority (IND-593)', () => {
  test('a missing proof fails closed and registers a fresh server-derived interaction challenge', async () => {
    const auth = authority();
    const verdict = await auth.consumeAgentProof(undefined, BINDING);

    expect(verdict.kind).toBe('denied');
    if (verdict.kind !== 'denied') return;
    expect(verdict.reason).toBe('missing');
    expect(verdict.challenge?.interactionId).toBeTruthy();
    expect(verdict.challenge?.expiresAt).toBeTruthy();

    const second = await auth.consumeAgentProof(undefined, BINDING);
    if (second.kind !== 'denied') throw new Error('expected denial');
    // Each attempt derives its own fresh interaction.
    expect(second.challenge?.interactionId).not.toBe(verdict.challenge?.interactionId);
  });

  test('the exact owner-issued proof admits exactly once; a replay fails closed', async () => {
    const auth = authority();
    const { interactionId } = await challenge(auth);

    const issued = await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    expect(issued.kind).toBe('issued');
    if (issued.kind !== 'issued') return;

    const admitted = await auth.consumeAgentProof(issued.proof, BINDING);
    expect(admitted.kind).toBe('admitted');

    const replayed = await auth.consumeAgentProof(issued.proof, BINDING);
    expect(replayed).toEqual({ kind: 'denied', reason: 'replayed' });
  });

  test('issuance is atomically one-shot: a second issue for the same interaction is denied', async () => {
    const auth = authority();
    const { interactionId } = await challenge(auth);

    const first = await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    expect(first.kind).toBe('issued');
    const second = await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    expect(second).toEqual({ kind: 'denied', reason: 'already_issued' });

    // Concurrent issuance also admits exactly one issuer.
    const { interactionId: fresh } = await challenge(auth);
    const results = await Promise.all([
      auth.issueProofForInteraction({ interactionId: fresh, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId }),
      auth.issueProofForInteraction({ interactionId: fresh, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId }),
    ]);
    expect(results.filter((r) => r.kind === 'issued')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'denied' && r.reason === 'already_issued')).toHaveLength(1);
  });

  test('concurrent consumption of one proof admits exactly one caller', async () => {
    const auth = authority();
    const { interactionId } = await challenge(auth);
    const issued = await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    if (issued.kind !== 'issued') throw new Error('expected issuance');

    const verdicts = await Promise.all([
      auth.consumeAgentProof(issued.proof, BINDING),
      auth.consumeAgentProof(issued.proof, BINDING),
    ]);
    expect(verdicts.filter((v) => v.kind === 'admitted')).toHaveLength(1);
    expect(verdicts.filter((v) => v.kind === 'denied' && v.reason === 'replayed')).toHaveLength(1);
  });

  test('two authority instances sharing one injected store see one challenge lifecycle', async () => {
    // Production shape: the MCP composition and the direct tool composition
    // each hold their own authority instance over one shared async store.
    const store = createMemoryOwnerApprovalStore();
    const mcpAuthority = authority({ store });
    const directAuthority = authority({ store });

    // Challenge registered on instance A is issuable on instance B…
    const { interactionId } = await challenge(mcpAuthority);
    const issued = await directAuthority.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    expect(issued.kind).toBe('issued');
    if (issued.kind !== 'issued') return;
    // …and one-shot issuance holds across instances.
    expect(await mcpAuthority.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId }))
      .toEqual({ kind: 'denied', reason: 'already_issued' });

    // Concurrent consumption across BOTH instances admits exactly one caller.
    const verdicts = await Promise.all([
      mcpAuthority.consumeAgentProof(issued.proof, BINDING),
      directAuthority.consumeAgentProof(issued.proof, BINDING),
    ]);
    expect(verdicts.filter((v) => v.kind === 'admitted')).toHaveLength(1);
    expect(verdicts.filter((v) => v.kind === 'denied' && v.reason === 'replayed')).toHaveLength(1);

    // The consumption is visible to both instances afterwards.
    expect(await mcpAuthority.consumeAgentProof(issued.proof, BINDING)).toEqual({ kind: 'denied', reason: 'replayed' });
    expect(await directAuthority.consumeAgentProof(issued.proof, BINDING)).toEqual({ kind: 'denied', reason: 'replayed' });
  });

  test('store keys are opaque hashes that never contain the raw interaction id', async () => {
    const { store, keys } = recordingStore(createMemoryOwnerApprovalStore());
    const auth = authority({ store });
    const { interactionId } = await challenge(auth);
    const issued = await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    if (issued.kind !== 'issued') throw new Error('expected issuance');
    await auth.consumeAgentProof(issued.proof, BINDING);

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain(interactionId);
    }
    // The same interaction always derives the same opaque key.
    expect(new Set(keys).size).toBe(1);
  });

  test('garbage, tampered, and foreign-secret tokens are forged', async () => {
    const auth = authority();
    const { interactionId } = await challenge(auth);
    const issued = await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    if (issued.kind !== 'issued') throw new Error('expected issuance');

    expect(await auth.consumeAgentProof('garbage', BINDING)).toEqual({ kind: 'denied', reason: 'forged' });
    expect(await auth.consumeAgentProof('oap1.x.y', BINDING)).toEqual({ kind: 'denied', reason: 'forged' });

    // Tampered payload (flip one character of the body, keep the signature).
    const [, body, sig] = issued.proof.split('.');
    const flipped = (body!.startsWith('a') ? 'b' : 'a') + body!.slice(1);
    expect(await auth.consumeAgentProof(`oap1.${flipped}.${sig}`, BINDING)).toEqual({ kind: 'denied', reason: 'forged' });

    // Valid structure signed by a different secret.
    const foreign = authority({ secret: 'other-secret' });
    const foreignChallenge = await foreign.consumeAgentProof(undefined, BINDING);
    if (foreignChallenge.kind !== 'denied' || !foreignChallenge.challenge) throw new Error('expected challenge');
    const foreignIssued = await foreign.issueProofForInteraction({
      interactionId: foreignChallenge.challenge.interactionId,
      ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId
    });
    if (foreignIssued.kind !== 'issued') throw new Error('expected foreign issuance');
    expect(await auth.consumeAgentProof(foreignIssued.proof, BINDING)).toEqual({ kind: 'denied', reason: 'forged' });
  });

  test('a well-signed token without the exact binding fields is generic', async () => {
    const auth = authority();
    const generic = signPayload({ v: 1, interactionId: 'whatever', exp: Date.now() + 60_000 });
    expect(await auth.consumeAgentProof(generic, BINDING)).toEqual({ kind: 'denied', reason: 'generic' });
  });

  test('expired challenges and proofs are stale, and retention cleanup eventually forgets them', async () => {
    let now = 1_000_000;
    const store = createMemoryOwnerApprovalStore({ now: () => now });
    const auth = authority({ now: () => now, store });
    const { interactionId } = await challenge(auth);
    const issued = await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    if (issued.kind !== 'issued') throw new Error('expected issuance');

    now += 61_000; // past the 60s TTL
    expect(await auth.consumeAgentProof(issued.proof, BINDING)).toEqual({ kind: 'denied', reason: 'stale' });

    // Issuance against an expired (but still retained) challenge is stale too.
    const second = await auth.consumeAgentProof(undefined, BINDING);
    if (second.kind !== 'denied' || !second.challenge) throw new Error('expected challenge');
    now += 61_000;
    expect(await auth.issueProofForInteraction({ interactionId: second.challenge.interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId }))
      .toEqual({ kind: 'denied', reason: 'stale' });

    // Once the retention window (2× TTL) fully lapses, the store forgets the
    // challenge entirely: no state accumulates and nothing remains issuable.
    now += 200_000;
    expect(await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId }))
      .toEqual({ kind: 'denied', reason: 'unknown_interaction' });
    expect(await auth.consumeAgentProof(issued.proof, BINDING)).toEqual({ kind: 'denied', reason: 'stale' });
  });

  test('proofs bound to a different opportunity, action, owner, or agent fail closed', async () => {
    const auth = authority();
    const { interactionId } = await challenge(auth);
    const issued = await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    if (issued.kind !== 'issued') throw new Error('expected issuance');

    expect(await auth.consumeAgentProof(issued.proof, { ...BINDING, opportunityId: '00000000-0000-4000-8000-0000000000bb' }))
      .toEqual({ kind: 'denied', reason: 'wrong_opportunity' });
    expect(await auth.consumeAgentProof(issued.proof, { ...BINDING, action: 'reject' as const }))
      .toEqual({ kind: 'denied', reason: 'wrong_action' });
    expect(await auth.consumeAgentProof(issued.proof, { ...BINDING, ownerId: 'owner-2' }))
      .toEqual({ kind: 'denied', reason: 'wrong_owner' });
    expect(await auth.consumeAgentProof(issued.proof, { ...BINDING, agentId: 'agent-2' }))
      .toEqual({ kind: 'denied', reason: 'wrong_agent' });

    // None of the denials consumed the proof — the exact binding still admits.
    expect(await auth.consumeAgentProof(issued.proof, BINDING)).toEqual({ kind: 'admitted' });
  });

  test('issuance is owner-only and requires a pending interaction', async () => {
    const auth = authority();
    expect(await auth.issueProofForInteraction({ interactionId: 'nope', ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId }))
      .toEqual({ kind: 'denied', reason: 'unknown_interaction' });

    const { interactionId } = await challenge(auth);
    expect(await auth.issueProofForInteraction({ interactionId, ownerId: 'someone-else', expectedOpportunityId: BINDING.opportunityId }))
      .toEqual({ kind: 'denied', reason: 'wrong_owner' });

    const issued = await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    expect(issued.kind).toBe('issued');
  });

  test('a route/opportunity mismatch is opaque and never consumes the one-shot issuance', async () => {
    const auth = authority();
    const { interactionId } = await challenge(auth);

    // The server-resolved route names a different opportunity: the outcome is
    // indistinguishable from an unknown interaction (no existence oracle)…
    expect(await auth.issueProofForInteraction({
      interactionId,
      ownerId: BINDING.ownerId,
      expectedOpportunityId: '00000000-0000-4000-8000-0000000000bb',
    })).toEqual({ kind: 'denied', reason: 'unknown_interaction' });

    // …and the challenge's single issuance was NOT burned: the exact matching
    // route still mints the one proof, which admits once.
    const issued = await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    expect(issued.kind).toBe('issued');
    if (issued.kind !== 'issued') return;
    expect(await auth.consumeAgentProof(issued.proof, BINDING)).toEqual({ kind: 'admitted' });
  });

  test('every store failure fails closed as unavailable — never open, never thrown', async () => {
    const auth = authority({ store: brokenStore() });

    // Challenge registration, verification, and issuance all deny.
    expect(await auth.consumeAgentProof(undefined, BINDING)).toEqual({ kind: 'denied', reason: 'unavailable' });

    // A well-signed proof still cannot be admitted while the store is down.
    const healthy = authority();
    const { interactionId } = await challenge(healthy);
    const issued = await healthy.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
    if (issued.kind !== 'issued') throw new Error('expected issuance');
    expect(await auth.consumeAgentProof(issued.proof, BINDING)).toEqual({ kind: 'denied', reason: 'unavailable' });

    expect(await auth.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId }))
      .toEqual({ kind: 'denied', reason: 'unavailable' });
  });

  test('a missing signing secret is a config error: everything fails closed as unavailable', async () => {
    const auth = authority({ secret: '' });
    expect(await auth.consumeAgentProof(undefined, BINDING)).toEqual({ kind: 'denied', reason: 'unavailable' });
    expect(await auth.consumeAgentProof('oap1.x.y', BINDING)).toEqual({ kind: 'denied', reason: 'unavailable' });
    expect(await auth.issueProofForInteraction({ interactionId: 'anything', ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId }))
      .toEqual({ kind: 'denied', reason: 'unavailable' });
  });

  test('only genuine direct owner-session provenance is attested (IND-593 Batch B)', async () => {
    const auth = authority();
    const attest = (provenance?: unknown) => auth.attestOwnerInteraction({
      opportunityId: BINDING.opportunityId,
      action: 'accept',
      ownerId: BINDING.ownerId,
      ...(provenance !== undefined ? { provenance } : {}),
    } as never);

    // Direct authenticated owner sessions on the REST and MCP surfaces are
    // attested without a token — authoritative host derivation, not a bypass.
    await expect(attest({ surface: 'rest', sessionAuthenticated: true })).resolves.toEqual({ kind: 'admitted' });
    await expect(attest({ surface: 'mcp', sessionAuthenticated: true })).resolves.toEqual({ kind: 'admitted' });

    // Chat-orchestrator turns are mediated even inside an owner session.
    await expect(attest({ surface: 'chat', sessionAuthenticated: true }))
      .resolves.toEqual({ kind: 'denied', reason: 'untrusted_provenance' });
    // API-key (CLI-style) and non-session MCP callers hold no owner session.
    await expect(attest({ surface: 'rest', sessionAuthenticated: false }))
      .resolves.toEqual({ kind: 'denied', reason: 'untrusted_provenance' });
    await expect(attest({ surface: 'mcp', sessionAuthenticated: false }))
      .resolves.toEqual({ kind: 'denied', reason: 'untrusted_provenance' });
    // H2A/A2A/internal callers that carry no provenance at all fail closed.
    await expect(attest(undefined)).resolves.toEqual({ kind: 'denied', reason: 'untrusted_provenance' });
    // Forged/generic caller-shaped provenance never mints owner authority.
    await expect(attest({ surface: 'rest', sessionAuthenticated: 'true' }))
      .resolves.toEqual({ kind: 'denied', reason: 'untrusted_provenance' });
    await expect(attest({ surface: 'owner', sessionAuthenticated: true }))
      .resolves.toEqual({ kind: 'denied', reason: 'untrusted_provenance' });
    await expect(attest('direct_owner')).resolves.toEqual({ kind: 'denied', reason: 'untrusted_provenance' });
  });
});

describe('production store resolution (no live Redis, no memory fallback)', () => {
  test('unconfigured Redis fails closed as unavailable — never admitted via a process-local fallback', async () => {
    const saved = { REDIS_URL: process.env.REDIS_URL, REDIS_HOST: process.env.REDIS_HOST };
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    try {
      const auth = authority({ store: createLazyProductionStore() });

      // Challenge registration and issuance both deny.
      expect(await auth.consumeAgentProof(undefined, BINDING)).toEqual({ kind: 'denied', reason: 'unavailable' });
      expect(await auth.issueProofForInteraction({ interactionId: 'anything', ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId }))
        .toEqual({ kind: 'denied', reason: 'unavailable' });

      // Even a well-signed proof is never admitted while the shared store is
      // unreachable — there is no hidden in-memory admission path.
      const healthy = authority();
      const { interactionId } = await challenge(healthy);
      const issued = await healthy.issueProofForInteraction({ interactionId, ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId });
      if (issued.kind !== 'issued') throw new Error('expected issuance');
      expect(await auth.consumeAgentProof(issued.proof, BINDING)).toEqual({ kind: 'denied', reason: 'unavailable' });
    } finally {
      if (saved.REDIS_URL !== undefined) process.env.REDIS_URL = saved.REDIS_URL;
      if (saved.REDIS_HOST !== undefined) process.env.REDIS_HOST = saved.REDIS_HOST;
    }
  });

  test('failed store resolution stays unavailable, is retried per call, and recovers only via the real backing', async () => {
    let attempts = 0;
    let failing = true;
    const backing = createMemoryOwnerApprovalStore();
    const lazy = createLazyProductionStore(async () => {
      attempts += 1;
      if (failing) throw new Error('redis resolution down');
      return backing;
    });
    const auth = authority({ store: lazy });

    expect(await auth.consumeAgentProof(undefined, BINDING)).toEqual({ kind: 'denied', reason: 'unavailable' });
    expect(await auth.consumeAgentProof(undefined, BINDING)).toEqual({ kind: 'denied', reason: 'unavailable' });
    // A failed resolution is never cached — each call retries the backend.
    expect(attempts).toBe(2);

    // Once the real backing resolves, the same store instance serves the
    // normal challenge lifecycle (no state was invented while unavailable).
    failing = false;
    const verdict = await auth.consumeAgentProof(undefined, BINDING);
    if (verdict.kind !== 'denied') throw new Error('expected denial');
    expect(verdict.reason).toBe('missing');
    expect(verdict.challenge?.interactionId).toBeTruthy();
  });
});

describe('Redis owner-approval store (deterministic fake client — no live Redis)', () => {
  const KEY = 'a'.repeat(64);

  function redisStore() {
    const client = new FakeOwnerApprovalRedis();
    return { client, store: new RedisOwnerApprovalStore(client as never) };
  }

  test('put/peek/issue/consume follow the store contract atomically', async () => {
    const { store } = redisStore();
    expect(await store.peekChallenge(KEY)).toEqual({ state: 'absent' });

    await store.putChallenge(KEY, '{"r":1}', 60_000);
    expect(await store.peekChallenge(KEY)).toEqual({ state: 'pending', record: '{"r":1}', issued: false });

    expect(await store.issueOnce(KEY)).toBe('issued');
    expect(await store.issueOnce(KEY)).toBe('already_issued');
    expect(await store.peekChallenge(KEY)).toEqual({ state: 'pending', record: '{"r":1}', issued: true });

    expect(await store.consumeOnce(KEY, 60_000)).toBe('consumed');
    expect(await store.consumeOnce(KEY, 60_000)).toBe('replayed');
    expect(await store.peekChallenge(KEY)).toEqual({ state: 'consumed' });

    expect(await store.issueOnce('b'.repeat(64))).toBe('absent');
    expect(await store.consumeOnce('b'.repeat(64), 60_000)).toBe('absent');
  });

  test('retention TTL evicts challenges and replay markers on the Redis side', async () => {
    const { client, store } = redisStore();
    await store.putChallenge(KEY, '{"r":1}', 60_000);
    // Retention outlives the challenge TTL (2×) so recently-expired
    // challenges still resolve, then eviction forgets them entirely.
    client.now += 61_000;
    expect(await store.peekChallenge(KEY)).toEqual({ state: 'pending', record: '{"r":1}', issued: false });
    client.now += 61_000;
    expect(await store.peekChallenge(KEY)).toEqual({ state: 'absent' });

    // Replay markers expire independently of the challenge retention.
    const other = 'c'.repeat(64);
    await store.putChallenge(other, '{"r":2}', 60_000);
    expect(await store.consumeOnce(other, 30_000)).toBe('consumed');
    expect(await store.consumeOnce(other, 30_000)).toBe('replayed');
    client.now += 31_000;
    expect(await store.consumeOnce(other, 30_000)).toBe('absent');
  });

  test('scripts are preloaded once and retried exactly once after NOSCRIPT', async () => {
    const { client, store } = redisStore();
    await store.putChallenge(KEY, '{"r":1}', 60_000);
    const loadsAfterBootstrap = client.scriptLoads;

    client.noscriptFailures = 1;
    expect(await store.peekChallenge(KEY)).toEqual({ state: 'pending', record: '{"r":1}', issued: false });
    // The NOSCRIPT failure triggered a re-bootstrap and one retry, not a loop.
    expect(client.scriptLoads).toBeGreaterThan(loadsAfterBootstrap);
    expect(client.noscriptFailures).toBe(0);
  });

  test('Redis keys stay namespaced around the opaque hash', async () => {
    const { client, store } = redisStore();
    await store.putChallenge(KEY, '{"r":1}', 60_000);
    await store.peekChallenge(KEY);
    await store.consumeOnce(KEY, 60_000);
    expect(client.touchedKeys.length).toBeGreaterThan(0);
    for (const key of client.touchedKeys) {
      expect(key).toMatch(new RegExp(`^mcp:oap:(c|u):${KEY}$`));
    }
  });

  test('the authority completes a full challenge→issue→consume→replay cycle over the Redis store', async () => {
    const client = new FakeOwnerApprovalRedis();
    client.now = 1_000_000;
    const store = new RedisOwnerApprovalStore(client as never);
    const auth = createOpportunityOwnerApprovalAuthority({
      store,
      secret: SECRET,
      ttlMs: 60_000,
      now: () => client.now,
    });

    const verdict = await auth.consumeAgentProof(undefined, BINDING);
    if (verdict.kind !== 'denied' || !verdict.challenge) throw new Error('expected challenge');

    const issued = await auth.issueProofForInteraction({
      interactionId: verdict.challenge.interactionId,
      ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId
    });
    expect(issued.kind).toBe('issued');
    if (issued.kind !== 'issued') return;
    expect(await auth.issueProofForInteraction({
      interactionId: verdict.challenge.interactionId,
      ownerId: BINDING.ownerId, expectedOpportunityId: BINDING.opportunityId
    })).toEqual({ kind: 'denied', reason: 'already_issued' });

    const outcomes = await Promise.all([
      auth.consumeAgentProof(issued.proof, BINDING),
      auth.consumeAgentProof(issued.proof, BINDING),
    ]);
    expect(outcomes.filter((v) => v.kind === 'admitted')).toHaveLength(1);
    expect(outcomes.filter((v) => v.kind === 'denied' && v.reason === 'replayed')).toHaveLength(1);
  });
});
