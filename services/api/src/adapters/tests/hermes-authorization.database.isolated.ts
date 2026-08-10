import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm/sql';

import { ConnectedAgentsDatabaseAdapter } from '../connected-agents.database.adapter';
import { HermesAuthorizationDatabaseAdapter } from '../hermes-authorization.database.adapter';
import db from '../../lib/drizzle/drizzle';
import { AuthorizationExpiredError, AuthorizationReplayError, HERMES_AGENT_AUDIENCE, hashHermesSecret } from '../../lib/agent/hermes-authorization';
import { HERMES_CANONICAL_ACTIONS } from '../../lib/agent/hermes-capabilities';
import { ConnectedAgentsService } from '../../services/connected-agents.service';
import { HermesAuthorizationService } from '../../services/hermes-authorization.service';
import * as schema from '../../schemas/database.schema';

const ownerId = crypto.randomUUID();
const installationId = crypto.randomUUID();
const adapter = new HermesAuthorizationDatabaseAdapter();
const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const redirectUri = 'http://127.0.0.1:49152/callback';
const requestIds: string[] = [];

async function pkce(value: string): Promise<string> {
  return hashHermesSecret(value);
}

function authorizationInput(state: string) {
  return {
    installationId,
    redirectUri,
    state,
    actions: HERMES_CANONICAL_ACTIONS,
  };
}

async function cleanup(): Promise<void> {
  if (requestIds.length) {
    await db.delete(schema.hermesAuthorizations)
      .where(eq(schema.hermesAuthorizations.installationId, installationId));
  }
  await db.delete(schema.hermesAgentCredentials)
    .where(eq(schema.hermesAgentCredentials.ownerId, ownerId));
  await db.delete(schema.agents).where(eq(schema.agents.ownerId, ownerId));
  await db.delete(schema.users).where(eq(schema.users.id, ownerId));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(schema.users).values({
    id: ownerId,
    email: `hermes-authorization-${ownerId}@example.com`,
    name: 'Hermes Authorization Owner',
  });
});
afterAll(cleanup);

describe('HermesAuthorizationDatabaseAdapter transactions', () => {
  it('rotates to Index fallback, consumes once, stays pending, activates exactly, and never enters legacy apikey', async () => {
    const firstService = new HermesAuthorizationService(adapter);
    const first = await firstService.createAuthorization({
      ...(authorizationInput(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))),
      codeChallenge: await pkce(verifier),
    });
    requestIds.push(first.requestId);
    const firstApproval = await firstService.approveAuthorization(ownerId, first.requestId, first.state, redirectUri);
    const firstExchange = await firstService.exchangeAuthorizationCode({
      requestId: first.requestId,
      code: firstApproval.code,
      verifier,
      redirectUri,
    });

    expect(firstExchange.credential.startsWith('idxh_')).toBe(true);
    expect(firstExchange.activationState).toBe('pending');
    expect(firstExchange.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    const firstHash = await hashHermesSecret(firstExchange.credential);
    const [legacyCollision] = await db.select({ id: schema.apikeys.id })
      .from(schema.apikeys)
      .where(eq(schema.apikeys.key, firstHash))
      .limit(1);
    expect(legacyCollision).toBeUndefined();

    const [pending] = await db.select().from(schema.hermesAgentCredentials)
      .where(eq(schema.hermesAgentCredentials.id, firstExchange.credentialId));
    expect(pending.secretHash).toBe(firstHash);
    expect(pending.secretHash).not.toBe(firstExchange.credential);
    expect(pending.activationState).toBe('pending');
    const permissionsBefore = await db.select().from(schema.agentPermissions)
      .where(eq(schema.agentPermissions.agentId, firstExchange.agentId));
    expect(permissionsBefore).toEqual([]);

    const principal = await firstService.authenticatePendingHermesCredential(firstExchange.credential);
    const active = await firstService.activatePendingHermesCredential(principal);
    expect(active.activationState).toBe('active');
    const idempotent = await firstService.activatePendingHermesCredential(principal);
    expect(idempotent.activationState).toBe('active');
    const [permission] = await db.select().from(schema.agentPermissions)
      .where(eq(schema.agentPermissions.agentId, firstExchange.agentId));
    expect(permission.actions).toEqual(HERMES_CANONICAL_ACTIONS);

    // Simulate a currently selected installation. A fresh owner approval must
    // select Index and revoke both its permission and live dedicated credential.
    await db.update(schema.agents).set({ handleNegotiations: true })
      .where(eq(schema.agents.id, firstExchange.agentId));
    const second = await firstService.createAuthorization({
      ...(authorizationInput(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))),
      codeChallenge: await pkce(verifier),
    });
    requestIds.push(second.requestId);
    const secondApproval = await firstService.approveAuthorization(ownerId, second.requestId, second.state, redirectUri);
    const [fallbackAgent] = await db.select().from(schema.agents)
      .where(eq(schema.agents.id, firstExchange.agentId));
    expect(fallbackAgent.handleNegotiations).toBe(false);
    const authorityAfterApproval = await db.select().from(schema.agentPermissions)
      .where(eq(schema.agentPermissions.agentId, firstExchange.agentId));
    expect(authorityAfterApproval).toEqual([]);
    const [revoked] = await db.select().from(schema.hermesAgentCredentials)
      .where(eq(schema.hermesAgentCredentials.id, firstExchange.credentialId));
    expect(revoked.activationState).toBe('revoked');

    const secondExchange = await firstService.exchangeAuthorizationCode({
      requestId: second.requestId,
      code: secondApproval.code,
      verifier,
      redirectUri,
    });
    expect(secondExchange.activationState).toBe('pending');
    await expect(firstService.exchangeAuthorizationCode({
      requestId: second.requestId,
      code: secondApproval.code,
      verifier,
      redirectUri,
    })).rejects.toBeInstanceOf(AuthorizationReplayError);

    const [authorization] = await db.select().from(schema.hermesAuthorizations)
      .where(eq(schema.hermesAuthorizations.requestId, second.requestId));
    expect(authorization.codeHash).not.toBe(secondApproval.code);
    expect(authorization.consumedAt).not.toBeNull();
    expect(authorization.replayReceipt).not.toBeNull();
    expect(JSON.stringify(authorization)).not.toContain(verifier);
    expect(JSON.stringify(authorization)).not.toContain(secondExchange.credential);
  });

  it('lists, pauses without revocation, then owner-revokes all installation authority', async () => {
    const authorization = new HermesAuthorizationService(adapter);
    const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const created = await authorization.createAuthorization({
      ...authorizationInput(state),
      codeChallenge: await pkce(verifier),
    });
    requestIds.push(created.requestId);
    const approval = await authorization.approveAuthorization(ownerId, created.requestId, state, redirectUri);
    const exchange = await authorization.exchangeAuthorizationCode({
      requestId: created.requestId,
      code: approval.code,
      verifier,
      redirectUri,
    });
    const principal = await authorization.authenticatePendingHermesCredential(exchange.credential);
    await authorization.activatePendingHermesCredential(principal);
    await db.update(schema.agents).set({ handleNegotiations: true })
      .where(eq(schema.agents.id, exchange.agentId));

    const connected = new ConnectedAgentsService(new ConnectedAgentsDatabaseAdapter());
    expect((await connected.list(ownerId)).connections[0]).toMatchObject({
      installationId,
      agentId: exchange.agentId,
      activationState: 'active',
      selected: true,
    });

    const paused = await connected.pause(ownerId, installationId);
    expect(paused).toMatchObject({ activationState: 'active', selected: false, indexCovering: true });
    const [credentialAfterPause] = await db.select().from(schema.hermesAgentCredentials)
      .where(eq(schema.hermesAgentCredentials.id, exchange.credentialId));
    expect(credentialAfterPause.activationState).toBe('active');
    const [permissionAfterPause] = await db.select().from(schema.agentPermissions)
      .where(eq(schema.agentPermissions.agentId, exchange.agentId));
    expect(permissionAfterPause.actions).toEqual(HERMES_CANONICAL_ACTIONS);

    await expect(connected.revoke(ownerId, installationId)).resolves.toEqual({ revoked: true });
    const credentials = await db.select().from(schema.hermesAgentCredentials)
      .where(eq(schema.hermesAgentCredentials.installationId, installationId));
    expect(credentials.every((row) => row.activationState === 'revoked')).toBe(true);
    expect(await db.select().from(schema.agentPermissions)
      .where(eq(schema.agentPermissions.agentId, exchange.agentId))).toEqual([]);
    const [inactive] = await db.select().from(schema.agents).where(eq(schema.agents.id, exchange.agentId));
    expect(inactive).toMatchObject({ status: 'inactive', handleNegotiations: false, runtimeSetupAttemptId: null });
    await expect(connected.revoke(ownerId, installationId)).resolves.toEqual({ revoked: true });
  });

  it('rejects an expired request before approval', async () => {
    const oldNow = new Date(Date.now() - 20 * 60 * 1000);
    const expiredService = new HermesAuthorizationService(adapter, {
      now: () => oldNow,
      randomId: () => crypto.randomUUID(),
      randomSecret: () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
    });
    const expired = await expiredService.createAuthorization({
      ...(authorizationInput(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))),
      codeChallenge: await pkce(verifier),
    });
    requestIds.push(expired.requestId);
    const approvalService = new HermesAuthorizationService(adapter);
    await expect(approvalService.approveAuthorization(ownerId, expired.requestId, expired.state, redirectUri))
      .rejects.toBeInstanceOf(AuthorizationExpiredError);
  });

  it('stores the dedicated audience and exact canonical actions only', async () => {
    const rows = await db.select().from(schema.hermesAgentCredentials)
      .where(eq(schema.hermesAgentCredentials.ownerId, ownerId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.audience === HERMES_AGENT_AUDIENCE)).toBe(true);
    expect(rows.every((row) => JSON.stringify(row.actions) === JSON.stringify(HERMES_CANONICAL_ACTIONS))).toBe(true);
  });
});
