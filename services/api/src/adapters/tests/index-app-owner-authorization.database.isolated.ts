import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm/sql';

import { IndexAppOwnerAuthorizationDatabaseAdapter } from '../index-app-owner-authorization.database.adapter';
import db from '../../lib/drizzle/drizzle';
import { IndexAppOwnerConflictError, IndexAppOwnerInvalidGrantError, deriveIndexAppOwnerPkceS256Challenge, hashIndexAppOwnerSecret } from '../../lib/agent/index-app-owner-authorization';
import { IndexAppOwnerAuthorizationService } from '../../services/index-app-owner-authorization.service';
import * as schema from '../../schemas/database.schema';

const ownerId = crypto.randomUUID();
const otherOwnerId = crypto.randomUUID();
const installationId = crypto.randomUUID();
const otherInstallationId = crypto.randomUUID();
const legacyId = crypto.randomUUID();
const otherLegacyId = crypto.randomUUID();
const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const redirectUri = 'http://127.0.0.1:49152/callback';
const adapter = new IndexAppOwnerAuthorizationDatabaseAdapter();
const service = new IndexAppOwnerAuthorizationService(adapter);

async function cleanup() {
  await db.delete(schema.indexAppOwnerAuthorizations).where(eq(schema.indexAppOwnerAuthorizations.installationId, installationId));
  await db.delete(schema.indexAppOwnerAuthorizations).where(eq(schema.indexAppOwnerAuthorizations.installationId, otherInstallationId));
  await db.delete(schema.indexAppOwnerCredentials).where(eq(schema.indexAppOwnerCredentials.ownerId, ownerId));
  await db.delete(schema.indexAppOwnerCredentials).where(eq(schema.indexAppOwnerCredentials.ownerId, otherOwnerId));
  await db.delete(schema.apikeys).where(eq(schema.apikeys.id, legacyId));
  await db.delete(schema.apikeys).where(eq(schema.apikeys.id, otherLegacyId));
  await db.delete(schema.users).where(eq(schema.users.id, ownerId));
  await db.delete(schema.users).where(eq(schema.users.id, otherOwnerId));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(schema.users).values([
    { id: ownerId, email: `index-owner-${ownerId}@example.test`, name: 'Owner' },
    { id: otherOwnerId, email: `index-owner-${otherOwnerId}@example.test`, name: 'Other' },
  ]);
  const metadata = JSON.stringify({ client: 'cli', protocolVersion: 2, enrollmentCapable: true });
  await db.insert(schema.apikeys).values([
    { id: legacyId, key: await hashIndexAppOwnerSecret('legacy-owner-secret'), userId: ownerId,
      referenceId: ownerId, configId: 'default', name: 'Index CLI', enabled: true, metadata },
    { id: otherLegacyId, key: await hashIndexAppOwnerSecret('legacy-other-secret'), userId: otherOwnerId,
      referenceId: otherOwnerId, configId: 'default', name: 'Index CLI', enabled: true, metadata },
  ]);
});
afterAll(cleanup);

async function begin(installation: string, legacyKeyId: string | null) {
  return service.createAuthorization({
    installationId: installation,
    redirectUri,
    state: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
    codeChallenge: await deriveIndexAppOwnerPkceS256Challenge(verifier),
    legacyKeyId,
  });
}

describe('IndexAppOwnerAuthorizationDatabaseAdapter lifecycle', () => {
  it('revokes legacy before pending issuance, stores only hashes, activates once, and revokes before denial', async () => {
    const request = await begin(installationId, legacyId);
    const approved = await service.approveAuthorization(ownerId, request.requestId, request.state, redirectUri);
    const exchanged = await service.exchangeAuthorizationCode({
      requestId: request.requestId, code: approved.code, state: request.state, verifier, redirectUri,
    });
    expect(exchanged.credential.startsWith('idxo_')).toBe(true);
    expect(exchanged.activationState).toBe('pending');

    const [legacy] = await db.select().from(schema.apikeys).where(eq(schema.apikeys.id, legacyId));
    expect(legacy.enabled).toBe(false);
    const [pending] = await db.select().from(schema.indexAppOwnerCredentials)
      .where(eq(schema.indexAppOwnerCredentials.id, exchanged.credentialId));
    expect(pending.secretHash).toBe(await hashIndexAppOwnerSecret(exchanged.credential));
    expect(pending.secretHash).not.toBe(exchanged.credential);
    expect(pending.activationProofHash).toBe(await hashIndexAppOwnerSecret(exchanged.activationProof));
    const [legacyCollision] = await db.select({ id: schema.apikeys.id }).from(schema.apikeys)
      .where(eq(schema.apikeys.key, pending.secretHash)).limit(1);
    expect(legacyCollision).toBeUndefined();

    const principal = await service.authenticatePendingCredential(exchanged.credential);
    const active = await service.activatePendingCredential(principal, exchanged.activationProof);
    expect(active.activationState).toBe('active');
    const [activated] = await db.select().from(schema.indexAppOwnerCredentials)
      .where(eq(schema.indexAppOwnerCredentials.id, exchanged.credentialId));
    expect(activated.activationProofHash).toBeNull();
    await expect(service.activatePendingCredential(principal, exchanged.activationProof))
      .rejects.toBeInstanceOf(IndexAppOwnerConflictError);

    const revocable = await service.authenticateRevocableCredential(exchanged.credential);
    await service.revokeCredential(revocable);
    const [revoked] = await db.select().from(schema.indexAppOwnerCredentials)
      .where(eq(schema.indexAppOwnerCredentials.id, exchanged.credentialId));
    expect(revoked.activationState).toBe('revoked');
    await expect(service.authenticateRevocableCredential('idxo_unknown'))
      .rejects.toThrow('invalid_credential');

    // The durable legacy ID remains valid revocation evidence after the row is
    // already disabled; recovery can issue a new pending replacement safely.
    const retryRequest = await begin(installationId, legacyId);
    const retryApproval = await service.approveAuthorization(
      ownerId, retryRequest.requestId, retryRequest.state, redirectUri,
    );
    const retryExchange = await service.exchangeAuthorizationCode({
      requestId: retryRequest.requestId, code: retryApproval.code,
      state: retryRequest.state, verifier, redirectUri,
    });
    expect(retryExchange.activationState).toBe('pending');
    const retryPrincipal = await service.authenticatePendingCredential(retryExchange.credential);
    await service.rollbackPendingCredential(retryPrincipal, retryExchange.activationProof);
  });

  it('fails the whole exchange for a cross-owner legacy key ID', async () => {
    const request = await begin(otherInstallationId, otherLegacyId);
    const approved = await service.approveAuthorization(ownerId, request.requestId, request.state, redirectUri);
    await expect(service.exchangeAuthorizationCode({
      requestId: request.requestId, code: approved.code, state: request.state, verifier, redirectUri,
    })).rejects.toBeInstanceOf(IndexAppOwnerInvalidGrantError);
    const pending = await db.select().from(schema.indexAppOwnerCredentials).where(and(
      eq(schema.indexAppOwnerCredentials.ownerId, ownerId),
      eq(schema.indexAppOwnerCredentials.installationId, otherInstallationId),
    ));
    expect(pending).toEqual([]);
    const [otherLegacy] = await db.select().from(schema.apikeys).where(eq(schema.apikeys.id, otherLegacyId));
    expect(otherLegacy.enabled).toBe(true);
  });
});
