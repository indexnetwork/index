import { and, eq, isNull, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { AuthorizationConflictError, AuthorizationExpiredError, AuthorizationInvalidGrantError, AuthorizationReplayError, HERMES_AGENT_AUDIENCE, type ApproveHermesAuthorizationRecord, type CreateHermesAuthorizationRecord, type ExchangeHermesAuthorizationRecord, type HermesActivationPrincipal, type HermesAuthorizationStore, type HermesCredentialMetadata } from '../lib/agent/hermes-authorization';
import type { HermesCapability } from '../lib/agent/hermes-capabilities';
import * as schema from '../schemas/database.schema';

function actions(value: string[]): readonly HermesCapability[] {
  return value as HermesCapability[];
}

function metadata(row: typeof schema.hermesAgentCredentials.$inferSelect): HermesCredentialMetadata {
  return {
    ownerId: row.ownerId,
    audience: HERMES_AGENT_AUDIENCE,
    agentId: row.agentId,
    installationId: row.installationId,
    setupAttemptId: row.setupAttemptId,
    credentialId: row.id,
    actions: actions(row.actions),
    expiresAt: row.expiresAt,
    activationState: row.activationState,
  };
}

function sameActions(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((action, index) => action === right[index]);
}

/** PostgreSQL transactions for one-time Hermes browser authorization. */
export class HermesAuthorizationDatabaseAdapter implements HermesAuthorizationStore {
  /** Insert a verifier-free ten-minute authorization request. */
  async createAuthorization(input: CreateHermesAuthorizationRecord) {
    const [row] = await db.insert(schema.hermesAuthorizations).values({
      ...input,
      actions: [...input.actions],
    }).returning({
      requestId: schema.hermesAuthorizations.requestId,
      state: schema.hermesAuthorizations.state,
      expiresAt: schema.hermesAuthorizations.expiresAt,
    });
    return row;
  }

  /**
   * Owner-lock approval, Index fallback, installation revocation, and pending
   * generation creation are one transaction. No raw code enters the adapter.
   */
  async approveAuthorization(input: ApproveHermesAuthorizationRecord) {
    return db.transaction(async (tx) => {
      const [authorization] = await tx.select()
        .from(schema.hermesAuthorizations)
        .where(eq(schema.hermesAuthorizations.requestId, input.requestId))
        .limit(1)
        .for('update');
      if (!authorization) throw new AuthorizationInvalidGrantError();
      if (authorization.expiresAt <= input.now) throw new AuthorizationExpiredError();
      if (authorization.approvedAt) throw new AuthorizationConflictError();

      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${input.ownerId}`}, 0))
      `);

      // Approval always returns the owner to Index before rotating installation
      // authority. All external negotiation grants are removed under the same
      // lock so no former executor remains selected.
      await tx.update(schema.agents)
        .set({ handleNegotiations: false, updatedAt: input.now })
        .where(and(
          eq(schema.agents.ownerId, input.ownerId),
          eq(schema.agents.type, 'external'),
          isNull(schema.agents.deletedAt),
        ));
      await tx.execute(sql`
        UPDATE agent_permissions
        SET actions = array_remove(actions, 'manage:negotiations')
        WHERE agent_id IN (
          SELECT id FROM agents
          WHERE owner_id = ${input.ownerId} AND type = 'external' AND deleted_at IS NULL
        ) AND 'manage:negotiations' = ANY(actions)
      `);
      await tx.execute(sql`
        DELETE FROM agent_permissions
        WHERE cardinality(actions) = 0
          AND agent_id IN (
            SELECT id FROM agents
            WHERE owner_id = ${input.ownerId} AND type = 'external' AND deleted_at IS NULL
          )
      `);

      let [agent] = await tx.select()
        .from(schema.agents)
        .where(and(
          eq(schema.agents.ownerId, input.ownerId),
          eq(schema.agents.type, 'external'),
          eq(schema.agents.runtimeKind, 'hermes'),
          eq(schema.agents.installationId, authorization.installationId),
          isNull(schema.agents.deletedAt),
        ))
        .limit(1)
        .for('update');

      if (!agent) {
        [agent] = await tx.insert(schema.agents).values({
          ownerId: input.ownerId,
          name: 'Hermes Agent',
          description: 'Standalone Hermes agent',
          type: 'external',
          status: 'active',
          metadata: {},
          runtimeKind: 'hermes',
          installationId: authorization.installationId,
          runtimeSetupAttemptId: input.setupAttemptId,
          notifyOnOpportunity: false,
          dailySummaryEnabled: false,
          handleNegotiations: false,
        }).returning();
      } else {
        [agent] = await tx.update(schema.agents).set({
          status: 'active',
          runtimeSetupAttemptId: input.setupAttemptId,
          handleNegotiations: false,
          updatedAt: input.now,
        }).where(eq(schema.agents.id, agent.id)).returning();
      }

      // A newly approved generation has no product authority until activation.
      await tx.delete(schema.agentPermissions).where(eq(schema.agentPermissions.agentId, agent.id));
      await tx.update(schema.hermesAgentCredentials).set({
        activationState: 'revoked',
        revokedAt: input.now,
      }).where(and(
        eq(schema.hermesAgentCredentials.ownerId, input.ownerId),
        eq(schema.hermesAgentCredentials.installationId, authorization.installationId),
        sql`${schema.hermesAgentCredentials.activationState} IN ('pending', 'active')`,
      ));
      // Revoke the PR #1348-era negotiator key too; dedicated `idxh_` material
      // is never inserted here or into any other legacy API-key operation.
      await tx.delete(schema.apikeys).where(sql`
        ${schema.apikeys.metadata} IS NOT NULL
        AND ${schema.apikeys.metadata}::jsonb->>'agentId' = ${agent.id}
      `);

      const [approved] = await tx.update(schema.hermesAuthorizations).set({
        ownerId: input.ownerId,
        agentId: agent.id,
        setupAttemptId: input.setupAttemptId,
        codeHash: input.codeHash,
        approvedAt: input.now,
        expiresAt: input.expiresAt,
      }).where(and(
        eq(schema.hermesAuthorizations.requestId, input.requestId),
        isNull(schema.hermesAuthorizations.approvedAt),
      )).returning({
        redirectUri: schema.hermesAuthorizations.redirectUri,
        state: schema.hermesAuthorizations.state,
        expiresAt: schema.hermesAuthorizations.expiresAt,
      });
      if (!approved) throw new AuthorizationConflictError();
      return approved;
    });
  }

  /** Verify and consume one code while creating exactly one pending credential. */
  async exchangeAuthorizationCode(input: ExchangeHermesAuthorizationRecord) {
    return db.transaction(async (tx) => {
      const [authorization] = await tx.select()
        .from(schema.hermesAuthorizations)
        .where(eq(schema.hermesAuthorizations.requestId, input.requestId))
        .limit(1)
        .for('update');
      if (
        !authorization
        || !authorization.approvedAt
        || !authorization.ownerId
        || !authorization.agentId
        || !authorization.setupAttemptId
        || authorization.codeHash !== input.codeHash
        || authorization.codeChallenge !== input.verifierChallenge
        || authorization.redirectUri !== input.redirectUri
      ) throw new AuthorizationInvalidGrantError();
      if (authorization.consumedAt) throw new AuthorizationReplayError();
      if (authorization.expiresAt <= input.now) throw new AuthorizationExpiredError();

      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${authorization.ownerId}`}, 0))
      `);
      const [currentGeneration] = await tx.select({ id: schema.agents.id })
        .from(schema.agents)
        .where(and(
          eq(schema.agents.id, authorization.agentId),
          eq(schema.agents.ownerId, authorization.ownerId),
          eq(schema.agents.runtimeKind, 'hermes'),
          eq(schema.agents.installationId, authorization.installationId),
          eq(schema.agents.runtimeSetupAttemptId, authorization.setupAttemptId),
          eq(schema.agents.status, 'active'),
          isNull(schema.agents.deletedAt),
        ))
        .limit(1)
        .for('update');
      if (!currentGeneration) throw new AuthorizationConflictError();

      const [legacyCollision] = await tx.select({ id: schema.apikeys.id })
        .from(schema.apikeys)
        .where(eq(schema.apikeys.key, input.credentialHash))
        .limit(1);
      if (legacyCollision) throw new AuthorizationConflictError();

      const [credential] = await tx.insert(schema.hermesAgentCredentials).values({
        id: input.credentialId,
        secretHash: input.credentialHash,
        ownerId: authorization.ownerId,
        agentId: authorization.agentId,
        installationId: authorization.installationId,
        setupAttemptId: authorization.setupAttemptId,
        audience: HERMES_AGENT_AUDIENCE,
        actions: authorization.actions,
        activationState: 'pending',
        issuedAt: input.now,
        expiresAt: input.expiresAt,
      }).returning();

      await tx.update(schema.hermesAuthorizations).set({
        consumedAt: input.now,
        replayReceipt: input.replayReceipt,
      }).where(and(
        eq(schema.hermesAuthorizations.requestId, input.requestId),
        isNull(schema.hermesAuthorizations.consumedAt),
      ));
      return metadata(credential);
    });
  }

  /** Resolve only an unexpired pending dedicated credential hash. */
  async authenticatePendingCredential(credentialHash: string) {
    const [row] = await db.select().from(schema.hermesAgentCredentials).where(and(
      eq(schema.hermesAgentCredentials.secretHash, credentialHash),
      eq(schema.hermesAgentCredentials.audience, HERMES_AGENT_AUDIENCE),
      eq(schema.hermesAgentCredentials.activationState, 'pending'),
      sql`${schema.hermesAgentCredentials.expiresAt} > now()`,
    )).limit(1);
    return row ? metadata(row) : null;
  }

  /** Resolve one exact row regardless of expiry/state for self-revocation only. */
  async authenticateRevocableCredential(credentialHash: string) {
    const [row] = await db.select().from(schema.hermesAgentCredentials).where(and(
      eq(schema.hermesAgentCredentials.secretHash, credentialHash),
      eq(schema.hermesAgentCredentials.audience, HERMES_AGENT_AUDIENCE),
    )).limit(1);
    return row ? metadata(row) : null;
  }

  /** Compare-and-activate the exact row, generation, and canonical actions. */
  async activatePendingCredential(input: HermesActivationPrincipal) {
    return db.transaction(async (tx) => {
      const activatedAt = new Date();
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${input.ownerId}`}, 0))
      `);
      const [credential] = await tx.select().from(schema.hermesAgentCredentials).where(and(
        eq(schema.hermesAgentCredentials.id, input.credentialId),
        eq(schema.hermesAgentCredentials.ownerId, input.ownerId),
      )).limit(1).for('update');
      if (
        !credential
        || credential.activationState === 'revoked'
        || credential.expiresAt <= activatedAt
        || credential.audience !== input.audience
        || credential.agentId !== input.agentId
        || credential.installationId !== input.installationId
        || credential.setupAttemptId !== input.setupAttemptId
        || credential.expiresAt.getTime() !== input.expiresAt.getTime()
        || !sameActions(credential.actions, input.actions)
      ) throw new AuthorizationConflictError();

      const [agent] = await tx.select({
        id: schema.agents.id,
        ownerId: schema.agents.ownerId,
      }).from(schema.agents).where(and(
        eq(schema.agents.id, input.agentId),
        eq(schema.agents.runtimeKind, 'hermes'),
        eq(schema.agents.installationId, input.installationId),
        eq(schema.agents.runtimeSetupAttemptId, input.setupAttemptId),
        eq(schema.agents.status, 'active'),
        isNull(schema.agents.deletedAt),
      )).limit(1).for('update');
      if (!agent || agent.ownerId !== credential.ownerId) throw new AuthorizationConflictError();

      await tx.delete(schema.agentPermissions).where(and(
        eq(schema.agentPermissions.agentId, credential.agentId),
        eq(schema.agentPermissions.userId, credential.ownerId),
        eq(schema.agentPermissions.scope, 'global'),
      ));
      await tx.insert(schema.agentPermissions).values({
        agentId: credential.agentId,
        userId: credential.ownerId,
        scope: 'global',
        scopeId: null,
        actions: credential.actions,
      });
      if (credential.activationState === 'active') return metadata(credential);

      const [activated] = await tx.update(schema.hermesAgentCredentials).set({
        activationState: 'active',
        activatedAt,
      }).where(and(
        eq(schema.hermesAgentCredentials.id, credential.id),
        eq(schema.hermesAgentCredentials.activationState, 'pending'),
      )).returning();
      if (!activated) throw new AuthorizationConflictError();
      return metadata(activated);
    });
  }

  /** Idempotently revoke one exact row without disturbing a newer generation. */
  async disconnectCredential(input: HermesActivationPrincipal): Promise<{
    revoked: true;
    credentialId: string;
    setupAttemptId: string;
  }> {
    return db.transaction(async (tx) => {
      const revokedAt = new Date();
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${input.ownerId}`}, 0))
      `);
      const [credential] = await tx.select().from(schema.hermesAgentCredentials).where(and(
        eq(schema.hermesAgentCredentials.id, input.credentialId),
        eq(schema.hermesAgentCredentials.ownerId, input.ownerId),
      )).limit(1).for('update');
      if (
        !credential
        || credential.audience !== input.audience
        || credential.agentId !== input.agentId
        || credential.installationId !== input.installationId
        || credential.setupAttemptId !== input.setupAttemptId
        || credential.expiresAt.getTime() !== input.expiresAt.getTime()
        || !sameActions(credential.actions, input.actions)
      ) throw new AuthorizationConflictError();
      const receipt = {
        revoked: true as const,
        credentialId: credential.id,
        setupAttemptId: credential.setupAttemptId,
      };
      if (credential.activationState === 'revoked') return receipt;
      if (credential.activationState !== 'pending' && credential.activationState !== 'active') {
        throw new AuthorizationConflictError();
      }

      const [currentGeneration] = await tx.select({ id: schema.agents.id }).from(schema.agents).where(and(
        eq(schema.agents.id, input.agentId),
        eq(schema.agents.ownerId, input.ownerId),
        eq(schema.agents.type, 'external'),
        eq(schema.agents.runtimeKind, 'hermes'),
        eq(schema.agents.installationId, input.installationId),
        eq(schema.agents.runtimeSetupAttemptId, input.setupAttemptId),
        eq(schema.agents.status, 'active'),
        isNull(schema.agents.deletedAt),
      )).limit(1).for('update');

      if (currentGeneration) {
        await tx.execute(sql`
          UPDATE agent_permissions
          SET actions = array_remove(actions, 'manage:negotiations')
          WHERE agent_id IN (
            SELECT id FROM agents
            WHERE owner_id = ${input.ownerId} AND type = 'external' AND deleted_at IS NULL
          ) AND 'manage:negotiations' = ANY(actions)
        `);
        await tx.execute(sql`
          DELETE FROM agent_permissions
          WHERE cardinality(actions) = 0
            AND agent_id IN (
              SELECT id FROM agents
              WHERE owner_id = ${input.ownerId} AND type = 'external' AND deleted_at IS NULL
            )
        `);
        await tx.update(schema.agents).set({
          handleNegotiations: false,
          updatedAt: revokedAt,
        }).where(and(
          eq(schema.agents.ownerId, input.ownerId),
          eq(schema.agents.type, 'external'),
          isNull(schema.agents.deletedAt),
        ));
        await tx.delete(schema.agentPermissions).where(eq(schema.agentPermissions.agentId, input.agentId));
        await tx.update(schema.agents).set({
          status: 'inactive',
          runtimeSetupAttemptId: null,
          updatedAt: revokedAt,
        }).where(eq(schema.agents.id, input.agentId));
        await tx.delete(schema.apikeys).where(sql`
          ${schema.apikeys.metadata} IS NOT NULL
          AND ${schema.apikeys.metadata}::jsonb->>'agentId' = ${input.agentId}
        `);
      }

      const [revoked] = await tx.update(schema.hermesAgentCredentials).set({
        activationState: 'revoked',
        revokedAt,
      }).where(and(
        eq(schema.hermesAgentCredentials.id, input.credentialId),
        eq(schema.hermesAgentCredentials.setupAttemptId, input.setupAttemptId),
        sql`${schema.hermesAgentCredentials.activationState} IN ('pending', 'active')`,
      )).returning({ id: schema.hermesAgentCredentials.id });
      if (!revoked) throw new AuthorizationConflictError();
      return receipt;
    });
  }
}

export const hermesAuthorizationDatabaseAdapter = new HermesAuthorizationDatabaseAdapter();
