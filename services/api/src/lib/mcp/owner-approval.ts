/**
 * IND-593: host opportunity owner-approval authority.
 *
 * Concrete implementation of the protocol-owned OpportunityOwnerApprovalAuthority
 * port. Every registered MCP-agent opportunity send/accept/reject requires an
 * explicit owner-issued, fresh, atomically single-use proof bound to the exact
 * opportunity, target action, owner principal, acting agent, and current
 * server-derived interaction:
 *
 * - A proof-less agent call registers a fresh interaction challenge
 *   (server-derived binding + expiry) and denies with reason `missing`.
 * - The owner explicitly approves that exact interaction via the authenticated
 *   REST issuance route (see opportunity.controller.ts), which mints an
 *   HMAC-signed single-use proof through `issueProofForInteraction`.
 * - `consumeAgentProof` verifies authenticity, freshness, and exact binding,
 *   then consumes the proof through the store's atomic consume — single-use
 *   even under concurrent calls and across authority instances/replicas.
 *
 * Direct authenticated-owner interactions (REST/chat/CLI tool calls) traverse
 * the same boundary via `attestOwnerInteraction`: the host has already
 * authenticated the owner session, so attestation is authoritative host
 * derivation, not a bypass.
 *
 * Batch A (this file): the authority holds NO process-local state. All
 * challenge lifecycle state lives in an injected async
 * OpportunityOwnerApprovalStore (owner-approval.store.ts) shared by the two
 * production authority instances — the MCP composition and the direct tool
 * composition — and backed EXCLUSIVELY by Redis in production
 * (owner-approval.store.redis.ts, atomic Lua scripts). There is deliberately
 * no environment-selected in-memory fallback: a silent process-local store
 * would void the cross-replica single-use guarantee, so unconfigured or
 * failing Redis surfaces as store errors that fail closed with the stable
 * `unavailable` denial — never open, never thrown, never admitted. The memory
 * adapter exists only as an explicitly injected deterministic test double.
 * Store keys are opaque SHA-256 hashes of the interaction id.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { OpportunityOwnerApprovalAttestation, OpportunityOwnerApprovalAuthority, OpportunityOwnerApprovalBinding, OpportunityOwnerApprovalChallenge, OpportunityOwnerApprovalVerdict } from '@indexnetwork/protocol';

import type { OpportunityOwnerApprovalStore } from './owner-approval.store';
import { log } from '../log';

const logger = log.server.from('owner-approval');

const TOKEN_PREFIX = 'oap1';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

const REQUIRED_PAYLOAD_FIELDS = [
  'interactionId',
  'opportunityId',
  'action',
  'ownerId',
  'agentId',
  'jti',
  'exp',
] as const;

type AgentBinding = OpportunityOwnerApprovalBinding & { agentId: string };

/** Opaque authority-owned challenge record persisted in the store. */
type ChallengeRecord = {
  binding: AgentBinding;
  expiresAtMs: number;
};

type ProofPayload = {
  interactionId: string;
  opportunityId: string;
  action: string;
  ownerId: string;
  agentId: string;
  jti: string;
  exp: number;
};

export type OwnerApprovalIssuance =
  | {
      kind: 'issued';
      proof: string;
      expiresAt: string;
      /** Server-side challenge binding the proof was minted for (for owner confirmation display). */
      binding: AgentBinding;
    }
  | {
      kind: 'denied';
      reason: 'unknown_interaction' | 'stale' | 'wrong_owner' | 'already_issued' | 'unavailable';
    };

export interface OpportunityOwnerApprovalHostAuthority extends OpportunityOwnerApprovalAuthority {
  /**
   * Owner-session issuance: mint a single-use proof for a pending challenge.
   * The binding comes from the server-side challenge store — never from
   * caller-supplied fields. Only the challenge's owner principal may issue,
   * and issuance is atomically one-shot per challenge.
   *
   * `expectedOpportunityId` is the SERVER-RESOLVED route opportunity (never a
   * caller body field). A challenge bound to a different opportunity is
   * answered with the opaque `unknown_interaction` outcome BEFORE the one-shot
   * flag is touched — a mismatched route can neither mint a proof nor consume
   * the challenge's single issuance.
   */
  issueProofForInteraction(input: {
    interactionId: string;
    ownerId: string;
    expectedOpportunityId: string;
  }): Promise<OwnerApprovalIssuance>;
}

export interface OwnerApprovalAuthorityOptions {
  /** Injected async challenge store (required — the authority is stateless). */
  store: OpportunityOwnerApprovalStore;
  /** HMAC secret. Falls back to OPPORTUNITY_OWNER_APPROVAL_SECRET, then BETTER_AUTH_SECRET. */
  secret?: string;
  /** Challenge/proof lifetime. Default 10 minutes. */
  ttlMs?: number;
  /** Clock override for tests. */
  now?: () => number;
}

/** Opaque store key: challenge state is never keyed by the raw interaction id. */
function challengeKey(interactionId: string): string {
  return createHash('sha256').update(`${TOKEN_PREFIX}:${interactionId}`).digest('hex');
}

export function createOpportunityOwnerApprovalAuthority(
  options: OwnerApprovalAuthorityOptions,
): OpportunityOwnerApprovalHostAuthority {
  const { store } = options;
  const secret = options.secret
    ?? process.env.OPPORTUNITY_OWNER_APPROVAL_SECRET
    ?? process.env.BETTER_AUTH_SECRET
    ?? '';
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());

  function sign(body: string): string {
    return createHmac('sha256', secret).update(`${TOKEN_PREFIX}.${body}`).digest('base64url');
  }

  function parseProof(proof: string): { payload: ProofPayload; error?: never } | { error: 'forged' | 'generic' } {
    const parts = proof.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !parts[1] || !parts[2]) {
      return { error: 'forged' };
    }
    const expected = sign(parts[1]);
    const actual = Buffer.from(parts[2]);
    const reference = Buffer.from(expected);
    if (actual.length !== reference.length || !timingSafeEqual(actual, reference)) {
      return { error: 'forged' };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      return { error: 'forged' };
    }
    if (typeof payload !== 'object' || payload === null) return { error: 'generic' };
    const record = payload as Record<string, unknown>;
    for (const field of REQUIRED_PAYLOAD_FIELDS) {
      if (typeof record[field] !== (field === 'exp' ? 'number' : 'string') || record[field] === '') {
        return { error: 'generic' };
      }
    }
    return { payload: payload as ProofPayload };
  }

  function parseRecord(raw: string): ChallengeRecord | null {
    try {
      const parsed = JSON.parse(raw) as ChallengeRecord;
      if (!parsed?.binding || typeof parsed.expiresAtMs !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** Fail closed on any store/backend failure: deny, never throw, never admit. */
  function unavailable(scope: string, err: unknown): { kind: 'denied'; reason: 'unavailable' } {
    logger.error(`Owner-approval store failure (${scope}) — failing closed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'denied', reason: 'unavailable' };
  }

  return {
    async consumeAgentProof(proof: string | undefined, binding: AgentBinding): Promise<OpportunityOwnerApprovalVerdict> {
      // Missing signing secret is a configuration error: nothing can ever be
      // verifiably owner-issued, so every outcome fails closed.
      if (!secret) return { kind: 'denied', reason: 'unavailable' };

      if (proof === undefined) {
        // Register the current server-derived interaction as a fresh challenge.
        const challenge: OpportunityOwnerApprovalChallenge = {
          interactionId: randomUUID(),
          expiresAt: new Date(now() + ttlMs).toISOString(),
        };
        const record: ChallengeRecord = { binding, expiresAtMs: now() + ttlMs };
        try {
          await store.putChallenge(challengeKey(challenge.interactionId), JSON.stringify(record), ttlMs);
        } catch (err) {
          return unavailable('putChallenge', err);
        }
        return { kind: 'denied', reason: 'missing', challenge };
      }

      const parsed = parseProof(proof);
      if (parsed.error) return { kind: 'denied', reason: parsed.error };
      const { payload } = parsed;
      const key = challengeKey(payload.interactionId);

      try {
        const peeked = await store.peekChallenge(key);
        if (peeked.state === 'consumed') return { kind: 'denied', reason: 'replayed' };
        // A validly signed proof was necessarily issued here; an absent
        // challenge means it expired past its retention window.
        if (peeked.state === 'absent') return { kind: 'denied', reason: 'stale' };

        const challenge = parseRecord(peeked.record);
        if (!challenge) return unavailable('peekChallenge', new Error('malformed challenge record'));
        if (challenge.expiresAtMs <= now() || payload.exp <= now()) {
          return { kind: 'denied', reason: 'stale' };
        }
        if (challenge.binding.opportunityId !== binding.opportunityId
          || payload.opportunityId !== binding.opportunityId) {
          return { kind: 'denied', reason: 'wrong_opportunity' };
        }
        if (challenge.binding.action !== binding.action || payload.action !== binding.action) {
          return { kind: 'denied', reason: 'wrong_action' };
        }
        if (challenge.binding.ownerId !== binding.ownerId || payload.ownerId !== binding.ownerId) {
          return { kind: 'denied', reason: 'wrong_owner' };
        }
        if (challenge.binding.agentId !== binding.agentId || payload.agentId !== binding.agentId) {
          return { kind: 'denied', reason: 'wrong_agent' };
        }

        // Denied verifications above never consume. The store's atomic
        // consume arbitrates concurrent winners: exactly one caller is
        // admitted; the rest observe the replay marker.
        const outcome = await store.consumeOnce(key, ttlMs);
        if (outcome === 'consumed') return { kind: 'admitted' };
        if (outcome === 'replayed') return { kind: 'denied', reason: 'replayed' };
        return { kind: 'denied', reason: 'stale' };
      } catch (err) {
        return unavailable('consumeAgentProof', err);
      }
    },

    async attestOwnerInteraction(
      binding: OpportunityOwnerApprovalAttestation,
    ): Promise<OpportunityOwnerApprovalVerdict> {
      // IND-593 Batch B: only a genuine direct authenticated owner SESSION may
      // satisfy the boundary without an owner-issued proof. The provenance is
      // server-derived at the host seams (MCP identity resolution, REST tool
      // controller) and never caller-supplied. API-key/CLI callers hold no
      // session; H2A/A2A/internal callers carry no provenance at all. All of
      // those fail closed — they need the exact owner-issued proof path.
      // Attestation of a genuine session is authoritative host derivation, not
      // a bypass: nothing is issued or consumed, so no token exists to replay.
      const provenance: unknown = binding.provenance;
      const direct = typeof provenance === 'object'
        && provenance !== null
        && (provenance as { sessionAuthenticated?: unknown }).sessionAuthenticated === true
        && ((provenance as { surface?: unknown }).surface === 'rest'
          || (provenance as { surface?: unknown }).surface === 'mcp');
      if (!direct) return { kind: 'denied', reason: 'untrusted_provenance' };
      return { kind: 'admitted' };
    },

    async issueProofForInteraction({ interactionId, ownerId, expectedOpportunityId }): Promise<OwnerApprovalIssuance> {
      if (!secret) return { kind: 'denied', reason: 'unavailable' };
      const key = challengeKey(interactionId);
      try {
        const peeked = await store.peekChallenge(key);
        // Consumed or evicted challenges are not issuable; report them
        // uniformly as unknown (no existence oracle).
        if (peeked.state !== 'pending') return { kind: 'denied', reason: 'unknown_interaction' };
        const challenge = parseRecord(peeked.record);
        if (!challenge) return { kind: 'denied', reason: 'unavailable' };
        // A recently-expired challenge (still inside the store's retention
        // window) must report stale, not unknown.
        if (challenge.expiresAtMs <= now()) return { kind: 'denied', reason: 'stale' };
        // The server-resolved route opportunity must be the challenge's
        // opportunity. A mismatch is answered opaquely (no existence oracle)
        // BEFORE the one-shot flag — it neither mints nor consumes issuance.
        if (challenge.binding.opportunityId !== expectedOpportunityId) {
          return { kind: 'denied', reason: 'unknown_interaction' };
        }
        // Owner-only issuance: the authenticated session principal must be the
        // challenge's owner. Caller-supplied binding fields are never consulted.
        if (challenge.binding.ownerId !== ownerId) return { kind: 'denied', reason: 'wrong_owner' };

        // Atomic one-shot: exactly one issuance per challenge, ever.
        const issued = await store.issueOnce(key);
        if (issued === 'already_issued') return { kind: 'denied', reason: 'already_issued' };
        if (issued === 'absent') return { kind: 'denied', reason: 'unknown_interaction' };

        const expiresAtMs = challenge.expiresAtMs;
        const payload: ProofPayload = {
          interactionId,
          opportunityId: challenge.binding.opportunityId,
          action: challenge.binding.action,
          ownerId: challenge.binding.ownerId,
          agentId: challenge.binding.agentId,
          jti: randomUUID(),
          exp: expiresAtMs,
        };
        const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
        return {
          kind: 'issued',
          proof: `${TOKEN_PREFIX}.${body}.${sign(body)}`,
          expiresAt: new Date(expiresAtMs).toISOString(),
          binding: { ...challenge.binding },
        };
      } catch (err) {
        return unavailable('issueProofForInteraction', err);
      }
    },
  };
}

/**
 * Resolve the production store backing: the shared Redis adapter is REQUIRED.
 * There is deliberately no in-memory fallback — a silent process-local store
 * would break the cross-replica single-use guarantee — so an unconfigured or
 * unreachable Redis throws here and the authority converts it into the stable
 * fail-closed `unavailable` denial. Never admits through a local substitute.
 * @throws when Redis is not configured or the client/adapter cannot be built.
 */
async function resolveProductionRedisStore(): Promise<OpportunityOwnerApprovalStore> {
  // Check via the side-effect-free env detector BEFORE importing
  // cache.adapter (which eagerly constructs Redis-backed singletons).
  const { isRedisConfigured } = await import('../redis-env');
  if (!isRedisConfigured()) {
    throw new Error('Owner-approval store requires Redis (REDIS_URL/REDIS_HOST); refusing process-local fallback');
  }
  const { getRedisClient } = await import('../../adapters/cache.adapter');
  const { RedisOwnerApprovalStore } = await import('./owner-approval.store.redis');
  const redisStore = new RedisOwnerApprovalStore(getRedisClient());
  logger.info('Owner-approval store using shared Redis adapter');
  return redisStore;
}

/**
 * Lazily-resolved production store wrapper. Resolution is deferred to the
 * first store call so importing this module never eagerly constructs Redis
 * clients (mirrors lib/limiter/index.ts). A failed resolution propagates to
 * the authority (which fails closed as `unavailable`) and is retried on the
 * next call. Exported — with an injectable resolver — only so DB-free tests
 * can prove unconfigured/failed resolution behavior without any live Redis.
 */
export function createLazyProductionStore(
  resolveBacking: () => Promise<OpportunityOwnerApprovalStore> = resolveProductionRedisStore,
): OpportunityOwnerApprovalStore {
  let backing: Promise<OpportunityOwnerApprovalStore> | null = null;

  const resolve = (): Promise<OpportunityOwnerApprovalStore> => {
    if (!backing) {
      backing = resolveBacking().catch((err) => {
        backing = null; // allow the next call to retry
        throw err;
      });
    }
    return backing;
  };

  return {
    putChallenge: async (key, record, ttlMs) => (await resolve()).putChallenge(key, record, ttlMs),
    peekChallenge: async (key) => (await resolve()).peekChallenge(key),
    issueOnce: async (key) => (await resolve()).issueOnce(key),
    consumeOnce: async (key, replayTtlMs) => (await resolve()).consumeOnce(key, replayTtlMs),
  };
}

let sharedStore: OpportunityOwnerApprovalStore | undefined;
let mcpAuthority: OpportunityOwnerApprovalHostAuthority | undefined;
let directAuthority: OpportunityOwnerApprovalHostAuthority | undefined;

function getSharedOwnerApprovalStore(): OpportunityOwnerApprovalStore {
  sharedStore ??= createLazyProductionStore();
  return sharedStore;
}

/**
 * Authority instance for the MCP composition and the REST issuance route.
 * Shares one store with the direct-tool authority, so challenges registered
 * over MCP are issuable from the owner's REST session and consumed exactly
 * once regardless of which instance observes the proof.
 */
export function getOpportunityOwnerApprovalAuthority(): OpportunityOwnerApprovalHostAuthority {
  mcpAuthority ??= createOpportunityOwnerApprovalAuthority({ store: getSharedOwnerApprovalStore() });
  return mcpAuthority;
}

/** Authority instance for the direct (REST tool / chat / CLI) composition, over the same shared store. */
export function getDirectOpportunityOwnerApprovalAuthority(): OpportunityOwnerApprovalHostAuthority {
  directAuthority ??= createOpportunityOwnerApprovalAuthority({ store: getSharedOwnerApprovalStore() });
  return directAuthority;
}

/** Test hook: drop the process-wide singletons so env changes take effect. */
export function resetOpportunityOwnerApprovalAuthorityForTests(): void {
  sharedStore = undefined;
  mcpAuthority = undefined;
  directAuthority = undefined;
}
