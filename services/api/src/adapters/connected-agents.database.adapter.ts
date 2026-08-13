import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import type { HermesActivationState } from '../lib/agent/hermes-credential';
import type { HermesCapability } from '../lib/agent/hermes-capabilities';
import { HERMES_NEGOTIATOR_AUDIENCE } from '../lib/agent/hermes-credential';
import * as schema from '../schemas/database.schema';

type OwnerInput = { ownerId: string; installationId: string };
type HermesConnectionRecord = {
  installationId: string;
  agentId: string;
  actions: readonly HermesCapability[];
  activationState: HermesActivationState;
  selected: boolean;
  lastHeartbeatAt: Date | null;
  expiresAt: Date;
};

function capabilities(value: string[] | null): readonly HermesCapability[] {
  return (value ?? []) as HermesCapability[];
}

/** Owner-locked persistence for browser-visible standalone Hermes controls. */
export class ConnectedAgentsDatabaseAdapter {
  async listHermesConnections(ownerId: string): Promise<HermesConnectionRecord[]> {
    return db.transaction(async (tx) => {
      await this.acquireOwnerLock(tx, ownerId);
      const rows = await tx.select({
        installationId: schema.agents.installationId,
        agentId: schema.agents.id,
        selected: schema.agents.handleNegotiations,
        lastHeartbeatAt: schema.agents.lastNegotiationPickupAt,
        actions: schema.agentPermissions.actions,
        keyEnabled: schema.apikeys.enabled,
        keyExpiresAt: schema.apikeys.expiresAt,
        updatedAt: schema.agents.updatedAt,
      }).from(schema.agents)
        .leftJoin(schema.agentPermissions, and(
          eq(schema.agentPermissions.agentId, schema.agents.id),
          eq(schema.agentPermissions.userId, ownerId),
          eq(schema.agentPermissions.scope, 'global'),
        ))
        .leftJoin(schema.apikeys, and(
          sql`${schema.apikeys.metadata} IS NOT NULL AND ${schema.apikeys.metadata}::jsonb->>'agentId' = ${schema.agents.id}`,
          sql`${schema.apikeys.metadata}::jsonb->>'audience' = ${HERMES_NEGOTIATOR_AUDIENCE}`,
        ))
        .where(and(
          eq(schema.agents.ownerId, ownerId),
          eq(schema.agents.type, 'external'),
          eq(schema.agents.runtimeKind, 'hermes'),
          isNull(schema.agents.deletedAt),
        ))
        .orderBy(desc(schema.agents.updatedAt), desc(schema.agents.id));

      const latest = new Map<string, HermesConnectionRecord>();
      for (const row of rows) {
        if (!row.installationId || latest.has(row.installationId)) continue;
        const live = Boolean(row.keyEnabled)
          && row.keyExpiresAt !== null
          && row.keyExpiresAt.getTime() > Date.now();
        latest.set(row.installationId, {
          installationId: row.installationId,
          agentId: row.agentId,
          actions: capabilities(row.actions),
          activationState: live ? 'active' : 'revoked',
          selected: row.selected,
          lastHeartbeatAt: row.lastHeartbeatAt,
          expiresAt: row.keyExpiresAt ?? new Date(0),
        });
      }
      return [...latest.values()];
    });
  }

  /** Deselect Hermes without altering its active credential or canonical permission row. */
  async pauseHermesConnection(input: OwnerInput): Promise<'paused' | 'absent' | 'owner_mismatch'> {
    return db.transaction(async (tx) => {
      await this.acquireOwnerLock(tx, input.ownerId);
      const target = await this.lockOwnedInstallation(tx, input);
      if (!target) return this.absenceOutcome(tx, input);

      await tx.update(schema.agents).set({
        handleNegotiations: false,
        updatedAt: new Date(),
      }).where(and(
        eq(schema.agents.ownerId, input.ownerId),
        eq(schema.agents.type, 'external'),
        isNull(schema.agents.deletedAt),
      ));
      return 'paused';
    });
  }

  /** Select Index, delete every installation credential, and remove target authority. */
  async revokeHermesConnection(input: OwnerInput): Promise<'revoked' | 'absent' | 'owner_mismatch'> {
    return db.transaction(async (tx) => {
      await this.acquireOwnerLock(tx, input.ownerId);
      const target = await this.lockOwnedInstallation(tx, input);
      if (!target) return this.absenceOutcome(tx, input);

      const revokedAt = new Date();
      await tx.update(schema.agents).set({
        handleNegotiations: false,
        updatedAt: revokedAt,
      }).where(and(
        eq(schema.agents.ownerId, input.ownerId),
        eq(schema.agents.type, 'external'),
        isNull(schema.agents.deletedAt),
      ));
      await tx.delete(schema.agentPermissions).where(eq(schema.agentPermissions.agentId, target.id));
      await tx.delete(schema.apikeys).where(sql`
        ${schema.apikeys.metadata} IS NOT NULL
        AND ${schema.apikeys.metadata}::jsonb->>'agentId' = ${target.id}
      `);
      await tx.update(schema.agents).set({
        status: 'inactive',
        handleNegotiations: false,
        runtimeSetupAttemptId: null,
        updatedAt: revokedAt,
      }).where(eq(schema.agents.id, target.id));
      return 'revoked';
    });
  }

  private async acquireOwnerLock(tx: typeof db, ownerId: string): Promise<void> {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${ownerId}`}, 0))
    `);
  }

  private async lockOwnedInstallation(tx: typeof db, input: OwnerInput) {
    const [target] = await tx.select({ id: schema.agents.id }).from(schema.agents).where(and(
      eq(schema.agents.ownerId, input.ownerId),
      eq(schema.agents.type, 'external'),
      eq(schema.agents.runtimeKind, 'hermes'),
      eq(schema.agents.installationId, input.installationId),
      isNull(schema.agents.deletedAt),
    )).limit(1).for('update');
    return target ?? null;
  }

  private async absenceOutcome(tx: typeof db, input: OwnerInput): Promise<'absent' | 'owner_mismatch'> {
    const [otherOwner] = await tx.select({ id: schema.agents.id }).from(schema.agents).where(and(
      ne(schema.agents.ownerId, input.ownerId),
      eq(schema.agents.type, 'external'),
      eq(schema.agents.runtimeKind, 'hermes'),
      eq(schema.agents.installationId, input.installationId),
      isNull(schema.agents.deletedAt),
    )).limit(1);
    return otherOwner ? 'owner_mismatch' : 'absent';
  }
}

export const connectedAgentsDatabaseAdapter = new ConnectedAgentsDatabaseAdapter();
