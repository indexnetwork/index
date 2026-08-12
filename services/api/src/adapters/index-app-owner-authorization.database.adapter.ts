import { and, eq, isNull, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { INDEX_APP_OWNER_AUDIENCE, IndexAppOwnerConflictError, IndexAppOwnerExpiredError, IndexAppOwnerInvalidGrantError, IndexAppOwnerReplayError, type IndexAppOwnerAuthorizationStore, type IndexAppOwnerCredentialMetadata } from '../lib/agent/index-app-owner-authorization';
import { resolveApiKeyUserId } from '../lib/apikey/principal';
import * as schema from '../schemas/database.schema';

function metadata(row: typeof schema.indexAppOwnerCredentials.$inferSelect): IndexAppOwnerCredentialMetadata {
  return {
    ownerId: row.ownerId,
    credentialId: row.id,
    installationId: row.installationId,
    generation: row.generation,
    expiresAt: row.expiresAt,
    activationState: row.activationState,
  };
}

function isStrictLegacyCliCredential(row: typeof schema.apikeys.$inferSelect, ownerId: string): boolean {
  let parsed: unknown;
  try { parsed = row.metadata ? JSON.parse(row.metadata) : null; } catch { return false; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const value = parsed as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'client,enrollmentCapable,protocolVersion') return false;
  if (value.client !== 'cli' || value.enrollmentCapable !== true
      || (value.protocolVersion !== 1 && value.protocolVersion !== 2)) return false;
  try {
    return resolveApiKeyUserId(row) === ownerId
      && row.userId === ownerId
      && row.referenceId === ownerId
      && row.name === 'Index CLI';
  } catch {
    return false;
  }
}

function samePrincipal(
  row: typeof schema.indexAppOwnerCredentials.$inferSelect,
  principal: Parameters<IndexAppOwnerAuthorizationStore['activatePendingCredential']>[0]['principal'],
): boolean {
  return row.id === principal.credentialId
    && row.ownerId === principal.ownerId
    && row.installationId === principal.installationId
    && row.generation === principal.generation
    && row.expiresAt.getTime() === principal.expiresAt.getTime();
}

/** Fail-closed PostgreSQL owner authorization lifecycle for the signed Index app. */
export class IndexAppOwnerAuthorizationDatabaseAdapter implements IndexAppOwnerAuthorizationStore {
  async createAuthorization(input: Parameters<IndexAppOwnerAuthorizationStore['createAuthorization']>[0]) {
    const [row] = await db.insert(schema.indexAppOwnerAuthorizations).values(input).returning({
      requestId: schema.indexAppOwnerAuthorizations.requestId,
      state: schema.indexAppOwnerAuthorizations.state,
      expiresAt: schema.indexAppOwnerAuthorizations.expiresAt,
    });
    return row;
  }

  async getAuthorization(input: Parameters<IndexAppOwnerAuthorizationStore['getAuthorization']>[0]) {
    const [row] = await db.select().from(schema.indexAppOwnerAuthorizations).where(and(
      eq(schema.indexAppOwnerAuthorizations.requestId, input.requestId),
      eq(schema.indexAppOwnerAuthorizations.state, input.state),
    )).limit(1);
    if (!row || row.approvedAt || row.consumedAt) throw new IndexAppOwnerInvalidGrantError();
    if (row.expiresAt <= input.now) throw new IndexAppOwnerExpiredError();
    return {
      requestId: row.requestId,
      installationId: row.installationId,
      redirectUri: row.redirectUri,
      state: row.state,
      legacyKeyId: row.legacyKeyId,
      expiresAt: row.expiresAt,
    };
  }

  async approveAuthorization(input: Parameters<IndexAppOwnerAuthorizationStore['approveAuthorization']>[0]) {
    return db.transaction(async (tx) => {
      const [authorization] = await tx.select().from(schema.indexAppOwnerAuthorizations)
        .where(eq(schema.indexAppOwnerAuthorizations.requestId, input.requestId))
        .limit(1).for('update');
      if (!authorization || authorization.state !== input.state
          || authorization.redirectUri !== input.redirectUri) throw new IndexAppOwnerInvalidGrantError();
      if (authorization.expiresAt <= input.now) throw new IndexAppOwnerExpiredError();
      if (authorization.approvedAt || authorization.consumedAt) throw new IndexAppOwnerConflictError();
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`index-app-owner:${input.ownerId}`}, 0))`);
      const [approved] = await tx.update(schema.indexAppOwnerAuthorizations).set({
        ownerId: input.ownerId,
        codeHash: input.codeHash,
        approvedAt: input.now,
        expiresAt: input.expiresAt,
      }).where(and(
        eq(schema.indexAppOwnerAuthorizations.requestId, input.requestId),
        isNull(schema.indexAppOwnerAuthorizations.approvedAt),
      )).returning({
        state: schema.indexAppOwnerAuthorizations.state,
        redirectUri: schema.indexAppOwnerAuthorizations.redirectUri,
        expiresAt: schema.indexAppOwnerAuthorizations.expiresAt,
      });
      if (!approved) throw new IndexAppOwnerConflictError();
      return approved;
    });
  }

  async exchangeAuthorizationCode(input: Parameters<IndexAppOwnerAuthorizationStore['exchangeAuthorizationCode']>[0]) {
    return db.transaction(async (tx) => {
      const [authorization] = await tx.select().from(schema.indexAppOwnerAuthorizations)
        .where(eq(schema.indexAppOwnerAuthorizations.requestId, input.requestId))
        .limit(1).for('update');
      if (!authorization || !authorization.ownerId || !authorization.approvedAt
          || authorization.state !== input.state
          || authorization.codeHash !== input.codeHash
          || authorization.codeChallenge !== input.verifierChallenge
          || authorization.redirectUri !== input.redirectUri) throw new IndexAppOwnerInvalidGrantError();
      if (authorization.consumedAt) throw new IndexAppOwnerReplayError();
      if (authorization.expiresAt <= input.now) throw new IndexAppOwnerExpiredError();

      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`index-app-owner:${authorization.ownerId}`}, 0))`);

      // Legacy revocation is authoritative and happens before a replacement row
      // exists. Unknown/cross-owner/non-CLI IDs abort the entire transaction.
      if (authorization.legacyKeyId) {
        const [legacy] = await tx.select().from(schema.apikeys)
          .where(eq(schema.apikeys.id, authorization.legacyKeyId)).limit(1).for('update');
        if (!legacy || !isStrictLegacyCliCredential(legacy, authorization.ownerId)) {
          throw new IndexAppOwnerInvalidGrantError();
        }
        if (legacy.enabled) {
          await tx.update(schema.apikeys).set({ enabled: false, updatedAt: input.now })
            .where(eq(schema.apikeys.id, legacy.id));
        }
      }

      // A fresh login retires every unfinished or active generation for this
      // exact owner/installation before creating one unusable pending row.
      await tx.update(schema.indexAppOwnerCredentials).set({
        activationState: 'revoked', revokedAt: input.now, activationProofHash: null,
      }).where(and(
        eq(schema.indexAppOwnerCredentials.ownerId, authorization.ownerId),
        eq(schema.indexAppOwnerCredentials.installationId, authorization.installationId),
        sql`${schema.indexAppOwnerCredentials.activationState} IN ('pending', 'active')`,
      ));

      const [legacyCollision] = await tx.select({ id: schema.apikeys.id }).from(schema.apikeys)
        .where(eq(schema.apikeys.key, input.credentialHash)).limit(1);
      if (legacyCollision) throw new IndexAppOwnerConflictError();

      const [credential] = await tx.insert(schema.indexAppOwnerCredentials).values({
        id: input.credentialId,
        secretHash: input.credentialHash,
        activationProofHash: input.activationProofHash,
        ownerId: authorization.ownerId,
        installationId: authorization.installationId,
        generation: input.generation,
        audience: INDEX_APP_OWNER_AUDIENCE,
        activationState: 'pending',
        issuedAt: input.now,
        expiresAt: input.expiresAt,
      }).returning();

      const consumed = await tx.update(schema.indexAppOwnerAuthorizations).set({
        consumedAt: input.now, replayReceipt: input.replayReceipt,
      }).where(and(
        eq(schema.indexAppOwnerAuthorizations.requestId, input.requestId),
        isNull(schema.indexAppOwnerAuthorizations.consumedAt),
      )).returning({ requestId: schema.indexAppOwnerAuthorizations.requestId });
      if (consumed.length !== 1) throw new IndexAppOwnerReplayError();
      return metadata(credential);
    });
  }

  async authenticatePendingCredential(credentialHash: string) {
    const [row] = await db.select().from(schema.indexAppOwnerCredentials).where(and(
      eq(schema.indexAppOwnerCredentials.secretHash, credentialHash),
      eq(schema.indexAppOwnerCredentials.audience, INDEX_APP_OWNER_AUDIENCE),
      eq(schema.indexAppOwnerCredentials.activationState, 'pending'),
      sql`${schema.indexAppOwnerCredentials.expiresAt} > now()`,
    )).limit(1);
    return row ? metadata(row) : null;
  }

  async authenticateRevocableCredential(credentialHash: string) {
    const [row] = await db.select().from(schema.indexAppOwnerCredentials).where(and(
      eq(schema.indexAppOwnerCredentials.secretHash, credentialHash),
      eq(schema.indexAppOwnerCredentials.audience, INDEX_APP_OWNER_AUDIENCE),
    )).limit(1);
    return row ? metadata(row) : null;
  }

  async activatePendingCredential(input: Parameters<IndexAppOwnerAuthorizationStore['activatePendingCredential']>[0]) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`index-app-owner:${input.principal.ownerId}`}, 0))`);
      const [row] = await tx.select().from(schema.indexAppOwnerCredentials).where(and(
        eq(schema.indexAppOwnerCredentials.id, input.principal.credentialId),
        eq(schema.indexAppOwnerCredentials.ownerId, input.principal.ownerId),
      )).limit(1).for('update');
      if (!row || !samePrincipal(row, input.principal) || row.activationState !== 'pending'
          || row.expiresAt <= input.now || row.activationProofHash !== input.activationProofHash) {
        throw new IndexAppOwnerConflictError();
      }
      const [active] = await tx.update(schema.indexAppOwnerCredentials).set({
        activationState: 'active', activatedAt: input.now, activationProofHash: null,
      }).where(and(
        eq(schema.indexAppOwnerCredentials.id, row.id),
        eq(schema.indexAppOwnerCredentials.activationState, 'pending'),
        eq(schema.indexAppOwnerCredentials.activationProofHash, input.activationProofHash),
      )).returning();
      if (!active) throw new IndexAppOwnerConflictError();
      return metadata(active);
    });
  }

  async rollbackPendingCredential(input: Parameters<IndexAppOwnerAuthorizationStore['rollbackPendingCredential']>[0]) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`index-app-owner:${input.principal.ownerId}`}, 0))`);
      const [row] = await tx.select().from(schema.indexAppOwnerCredentials).where(and(
        eq(schema.indexAppOwnerCredentials.id, input.principal.credentialId),
        eq(schema.indexAppOwnerCredentials.ownerId, input.principal.ownerId),
      )).limit(1).for('update');
      if (!row || !samePrincipal(row, input.principal) || row.activationState !== 'pending'
          || row.activationProofHash !== input.activationProofHash) throw new IndexAppOwnerConflictError();
      const [revoked] = await tx.update(schema.indexAppOwnerCredentials).set({
        activationState: 'revoked', revokedAt: input.now, activationProofHash: null,
      }).where(and(
        eq(schema.indexAppOwnerCredentials.id, row.id),
        eq(schema.indexAppOwnerCredentials.activationState, 'pending'),
      )).returning({ id: schema.indexAppOwnerCredentials.id });
      if (!revoked) throw new IndexAppOwnerConflictError();
      return { revoked: true as const, credentialId: revoked.id };
    });
  }

  async revokeCredential(input: Parameters<IndexAppOwnerAuthorizationStore['revokeCredential']>[0]) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`index-app-owner:${input.principal.ownerId}`}, 0))`);
      const [row] = await tx.select().from(schema.indexAppOwnerCredentials).where(and(
        eq(schema.indexAppOwnerCredentials.id, input.principal.credentialId),
        eq(schema.indexAppOwnerCredentials.ownerId, input.principal.ownerId),
      )).limit(1).for('update');
      if (!row || !samePrincipal(row, input.principal)
          || !['pending', 'active', 'revoked'].includes(row.activationState)) {
        throw new IndexAppOwnerConflictError();
      }
      if (row.activationState !== 'revoked') {
        const [revoked] = await tx.update(schema.indexAppOwnerCredentials).set({
          activationState: 'revoked', revokedAt: input.now, activationProofHash: null,
        }).where(and(
          eq(schema.indexAppOwnerCredentials.id, row.id),
          sql`${schema.indexAppOwnerCredentials.activationState} IN ('pending', 'active')`,
        )).returning({ id: schema.indexAppOwnerCredentials.id });
        if (!revoked) throw new IndexAppOwnerConflictError();
      }
      return { revoked: true as const, credentialId: row.id };
    });
  }
}

export const indexAppOwnerAuthorizationDatabaseAdapter = new IndexAppOwnerAuthorizationDatabaseAdapter();
