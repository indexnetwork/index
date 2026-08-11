import { afterAll, describe, expect, it as bunIt } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm/sql';

import { agentDatabaseAdapter } from '../src/adapters/agent.database.adapter';
import { ConnectedAgentsDatabaseAdapter } from '../src/adapters/connected-agents.database.adapter';
import { HermesAuthorizationDatabaseAdapter } from '../src/adapters/hermes-authorization.database.adapter';
import { resolveHermesAgentCredential } from '../src/guards/auth.guard';
import { HERMES_CANONICAL_ACTIONS } from '../src/lib/agent/hermes-capabilities';
import { AuthorizationConflictError, hashHermesSecret, type HermesActivationPrincipal } from '../src/lib/agent/hermes-authorization';
import { authorizeNegotiationMutationInTransaction } from '../src/lib/agent/negotiation-runtime-authority';
import { withMinimumDatabaseTestBudget } from '../src/lib/testing/database-test-budget';
import db from '../src/lib/drizzle/drizzle';
import * as schema from '../src/schemas/database.schema';
import { AgentRuntimeService, NEGOTIATION_EXECUTOR_FRESHNESS_MS } from '../src/services/agent-runtime.service';
import { ConnectedAgentsService } from '../src/services/connected-agents.service';
import { HermesAuthorizationService } from '../src/services/hermes-authorization.service';

const it = withMinimumDatabaseTestBudget(bunIt, 60_000);
const authorization = new HermesAuthorizationService(new HermesAuthorizationDatabaseAdapter());
const runtime = new AgentRuntimeService(agentDatabaseAdapter);
const connected = new ConnectedAgentsService(new ConnectedAgentsDatabaseAdapter());
const redirectUri = 'http://127.0.0.1:49152/callback';
const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const cleanupUsers: string[] = [];
const cleanupRequests: string[] = [];

/** Release all callers together without using elapsed time as synchronization evidence. */
function createBarrier(parties: number): () => Promise<void> {
  if (!Number.isInteger(parties) || parties < 1) throw new Error('Barrier parties must be positive');
  let arrived = 0;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    arrived += 1;
    if (arrived === parties) release();
    if (arrived > parties) throw new Error('Barrier received too many callers');
    await opened;
  };
}

type PendingGeneration = {
  ownerId: string;
  installationId: string;
  rawCredential: string;
  principal: HermesActivationPrincipal;
};

type ActiveGeneration = PendingGeneration & {
  agentId: string;
  credentialId: string;
  setupAttemptId: string;
};

async function createOwner(label: string): Promise<string> {
  const [owner] = await db.insert(schema.users).values({
    email: `hermes-lifecycle-${label}-${randomUUID()}@test.local`,
    name: `Hermes lifecycle ${label}`,
  }).returning({ id: schema.users.id });
  cleanupUsers.push(owner.id);
  return owner.id;
}

async function createAuthorizationRequest(installationId: string) {
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const request = await authorization.createAuthorization({
    installationId,
    redirectUri,
    state,
    codeChallenge: await hashHermesSecret(verifier),
    actions: HERMES_CANONICAL_ACTIONS,
  });
  cleanupRequests.push(request.requestId);
  return { requestId: request.requestId, state };
}

async function preparePending(
  ownerId: string,
  installationId: string,
  request?: Awaited<ReturnType<typeof createAuthorizationRequest>>,
): Promise<PendingGeneration> {
  const resolvedRequest = request ?? await createAuthorizationRequest(installationId);
  const approved = await authorization.approveAuthorization(
    ownerId,
    resolvedRequest.requestId,
    resolvedRequest.state,
    redirectUri,
  );
  const exchange = await authorization.exchangeAuthorizationCode({
    requestId: resolvedRequest.requestId,
    code: approved.code,
    verifier,
    redirectUri,
  });
  expect(exchange.credential.startsWith('idxh_')).toBe(true);
  const principal = await authorization.authenticatePendingHermesCredential(exchange.credential);
  return { ownerId, installationId, rawCredential: exchange.credential, principal };
}

async function activateAndSelect(pending: PendingGeneration): Promise<ActiveGeneration> {
  const active = await authorization.activatePendingHermesCredential(pending.principal);
  await runtime.setRuntime(pending.ownerId, {
    runtime: 'hermes',
    installationId: active.installationId,
    executorId: active.agentId,
    setupAttemptId: active.setupAttemptId,
  });
  return {
    ...pending,
    agentId: active.agentId,
    credentialId: active.credentialId,
    setupAttemptId: active.setupAttemptId,
  };
}

async function prepareAndActivate(
  ownerId: string,
  installationId: string,
  request?: Awaited<ReturnType<typeof createAuthorizationRequest>>,
): Promise<ActiveGeneration> {
  const resolvedRequest = request ?? await createAuthorizationRequest(installationId);
  return activateAndSelect(await preparePending(ownerId, installationId, resolvedRequest));
}

async function selectedHermesCount(ownerId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM agents
    WHERE owner_id = ${ownerId}
      AND type = 'external'
      AND runtime_kind = 'hermes'
      AND handle_negotiations = true
      AND deleted_at IS NULL
  `);
  return Number((rows as unknown as Array<{ count: number }>)[0]?.count ?? 0);
}

async function validGenerationCount(ownerId: string, installationId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM hermes_agent_credentials
    WHERE owner_id = ${ownerId}
      AND installation_id = ${installationId}
      AND activation_state IN ('pending', 'active')
  `);
  return Number((rows as unknown as Array<{ count: number }>)[0]?.count ?? 0);
}

async function credentialState(credentialId: string): Promise<string | null> {
  const [row] = await db.select({ activationState: schema.hermesAgentCredentials.activationState })
    .from(schema.hermesAgentCredentials)
    .where(eq(schema.hermesAgentCredentials.id, credentialId));
  return row?.activationState ?? null;
}

async function holdOwnerRuntimeLock(ownerId: string): Promise<{
  backendPid: number;
  release: () => void;
  done: Promise<void>;
}> {
  let acquired!: (pid: number) => void;
  let release!: () => void;
  const acquiredPromise = new Promise<number>((resolve) => { acquired = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const done = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${ownerId}`}, 0))`);
    const rows = await tx.execute(sql`SELECT pg_backend_pid()::int AS pid`);
    acquired(Number((rows as unknown as Array<{ pid: number }>)[0]?.pid));
    await releasePromise;
  });
  return { backendPid: await acquiredPromise, release, done };
}

async function ownerRuntimeWaiters(holderPid: number): Promise<number[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT waiter.pid AS pid
    FROM pg_locks holder
    JOIN pg_locks waiter
      ON waiter.locktype = holder.locktype
     AND waiter.database IS NOT DISTINCT FROM holder.database
     AND waiter.classid IS NOT DISTINCT FROM holder.classid
     AND waiter.objid IS NOT DISTINCT FROM holder.objid
     AND waiter.objsubid IS NOT DISTINCT FROM holder.objsubid
    WHERE holder.pid = ${holderPid}
      AND holder.locktype = 'advisory'
      AND holder.granted = true
      AND waiter.pid <> holder.pid
      AND waiter.granted = false
    ORDER BY waiter.pid
  `);
  return (rows as unknown as Array<{ pid: number }>).map((row) => Number(row.pid));
}

async function waitForOwnerRuntimeWaiters(holderPid: number, expected: number): Promise<number[]> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiters = await ownerRuntimeWaiters(holderPid);
    if (waiters.length >= expected) return waiters;
  }
  throw new Error(`Owner advisory lock did not expose ${expected} waiter(s)`);
}

async function mutationAuthorized(ownerId: string, principal: HermesActivationPrincipal): Promise<boolean> {
  return db.transaction((tx) => authorizeNegotiationMutationInTransaction(tx, ownerId, {
    ownerId,
    credentialId: principal.credentialId,
    audience: principal.audience,
    agentId: principal.agentId,
    installationId: principal.installationId,
    setupAttemptId: principal.setupAttemptId,
    actions: [...principal.actions],
    expiresAt: principal.expiresAt,
    activationState: 'active',
  }));
}

afterAll(async () => {
  if (cleanupRequests.length) {
    await db.delete(schema.hermesAuthorizations)
      .where(inArray(schema.hermesAuthorizations.requestId, cleanupRequests))
      .catch(() => undefined);
  }
  for (const ownerId of cleanupUsers) {
    await db.delete(schema.users).where(eq(schema.users.id, ownerId)).catch(() => undefined);
  }
});

describe('real dedicated Hermes credential lifecycle', () => {
  it('serializes same-owner prepare/activate against disconnect with one selected live generation', async () => {
    const ownerId = await createOwner('same-owner-race');
    const installationId = randomUUID();
    const oldGeneration = await prepareAndActivate(ownerId, installationId);
    const nextRequest = await createAuthorizationRequest(installationId);
    const gate = createBarrier(2);

    const results = await Promise.allSettled([
      (async () => {
        await gate();
        return prepareAndActivate(ownerId, installationId, nextRequest);
      })(),
      (async () => {
        await gate();
        return authorization.disconnectHermesCredential(oldGeneration.principal);
      })(),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(await selectedHermesCount(ownerId)).toBeLessThanOrEqual(1);
    expect(await validGenerationCount(ownerId, installationId)).toBeLessThanOrEqual(1);
    expect(await credentialState(oldGeneration.credentialId)).toBe('revoked');
    expect((await connected.list(ownerId)).connections).toEqual([
      expect.objectContaining({ activationState: 'active', selected: true }),
    ]);
  });

  it('lets a different owner commit while the first owner remains blocked on its advisory key', async () => {
    const [ownerA, ownerB] = await Promise.all([
      createOwner('different-owner-a'),
      createOwner('different-owner-b'),
    ]);
    const [pendingA, pendingB] = await Promise.all([
      preparePending(ownerA, randomUUID()),
      preparePending(ownerB, randomUUID()),
    ]);
    const held = await holdOwnerRuntimeLock(ownerA);
    const gate = createBarrier(2);
    let activationA: Promise<ActiveGeneration> | undefined;
    try {
      activationA = (async () => {
        await gate();
        return activateAndSelect(pendingA);
      })();
      const activationB = (async () => {
        await gate();
        return activateAndSelect(pendingB);
      })();

      const waiters = await waitForOwnerRuntimeWaiters(held.backendPid, 1);
      const completedB = await activationB;
      expect(waiters).toHaveLength(1);
      expect(await ownerRuntimeWaiters(held.backendPid)).toContain(waiters[0]);
      expect(await selectedHermesCount(ownerA)).toBe(0);
      expect(await selectedHermesCount(ownerB)).toBe(1);
      expect(await credentialState(completedB.credentialId)).toBe('active');
    } finally {
      held.release();
      await held.done;
    }
    await expect(activationA).resolves.toBeDefined();
    expect(await selectedHermesCount(ownerA)).toBe(1);
  });

  it('denies pending, rotated, mismatched, and disconnected dedicated rows through production authority', async () => {
    const ownerId = await createOwner('denials');
    const installationId = randomUUID();
    const pending = await preparePending(ownerId, installationId);

    await expect(resolveHermesAgentCredential(pending.rawCredential)).rejects.toThrow('Invalid API key');
    const first = await activateAndSelect(pending);
    await expect(resolveHermesAgentCredential(first.rawCredential)).resolves.toMatchObject({
      user: { id: ownerId },
      principal: { credentialId: first.credentialId, setupAttemptId: first.setupAttemptId },
    });

    const secondPending = await preparePending(ownerId, installationId);
    await expect(resolveHermesAgentCredential(first.rawCredential)).rejects.toThrow('Invalid API key');
    const second = await activateAndSelect(secondPending);
    expect(await credentialState(first.credentialId)).toBe('revoked');

    const otherOwnerId = await createOwner('exact-row-mismatch');
    const otherActive = await prepareAndActivate(otherOwnerId, randomUUID());
    expect(await credentialState(otherActive.credentialId)).toBe('active');
    const exactRowMismatch = {
      ...second.principal,
      credentialId: otherActive.credentialId,
    };
    await expect(authorization.activatePendingHermesCredential(exactRowMismatch))
      .rejects.toBeInstanceOf(AuthorizationConflictError);
    await expect(mutationAuthorized(ownerId, exactRowMismatch)).resolves.toBe(false);

    await expect(authorization.disconnectHermesCredential(second.principal)).resolves.toMatchObject({ revoked: true });
    await expect(resolveHermesAgentCredential(second.rawCredential)).rejects.toThrow('Invalid API key');
    await expect(mutationAuthorized(ownerId, second.principal)).resolves.toBe(false);
    expect(await credentialState(second.credentialId)).toBe('revoked');
    expect(await selectedHermesCount(ownerId)).toBe(0);
  });

  it('denies expiresAt equal to PostgreSQL now and returns stale then expired Index-covering views', async () => {
    const ownerId = await createOwner('expiry-view');
    const installationId = randomUUID();
    const active = await prepareAndActivate(ownerId, installationId);

    await db.update(schema.agents).set({
      lastNegotiationPickupAt: sql`now()`,
    }).where(eq(schema.agents.id, active.agentId));
    expect(await runtime.getRuntime(ownerId, installationId)).toMatchObject({
      selectedRuntime: 'hermes',
      health: 'active',
      indexCovering: false,
    });

    await db.update(schema.agents).set({
      lastNegotiationPickupAt: sql`now() - (${NEGOTIATION_EXECUTOR_FRESHNESS_MS + 1} * interval '1 millisecond')`,
    }).where(eq(schema.agents.id, active.agentId));
    expect(await runtime.getRuntime(ownerId, installationId)).toMatchObject({
      selectedRuntime: 'hermes',
      health: 'stale',
      indexCovering: true,
    });
    expect((await connected.list(ownerId)).connections[0]).toMatchObject({
      health: 'stale',
      selected: true,
      indexCovering: true,
    });

    await db.update(schema.hermesAgentCredentials).set({ expiresAt: sql`now()` })
      .where(eq(schema.hermesAgentCredentials.id, active.credentialId));
    const [expiredAtDatabaseBoundary] = await db.select({ id: schema.hermesAgentCredentials.id })
      .from(schema.hermesAgentCredentials)
      .where(and(
        eq(schema.hermesAgentCredentials.id, active.credentialId),
        sql`${schema.hermesAgentCredentials.expiresAt} <= now()`,
      ));
    expect(expiredAtDatabaseBoundary?.id).toBe(active.credentialId);
    await expect(resolveHermesAgentCredential(active.rawCredential)).rejects.toThrow('Invalid API key');
    await expect(mutationAuthorized(ownerId, active.principal)).resolves.toBe(false);

    expect(await runtime.getRuntime(ownerId, installationId)).toMatchObject({
      selectedRuntime: 'index',
      executor: null,
      indexCovering: true,
    });
    expect((await connected.list(ownerId)).connections[0]).toMatchObject({
      health: 'expired',
      selected: false,
      indexCovering: true,
    });
    expect(await selectedHermesCount(ownerId)).toBe(0);
  });
});
