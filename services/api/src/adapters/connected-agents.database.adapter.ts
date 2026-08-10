import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { HERMES_AGENT_AUDIENCE, type HermesActivationState } from '../lib/agent/hermes-authorization';
import type { HermesCapability } from '../lib/agent/hermes-capabilities';
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

function capabilities(value: string[]): readonly HermesCapability[] {
  return value as HermesCapability[];
}

/** Owner-locked persistence for browser-visible standalone Hermes controls. */
export class ConnectedAgentsDatabaseAdapter {
  async listHermesConnections(ownerId: string): Promise<HermesConnectionRecord[]> {
    return db.transaction(async (tx) => {
      await this.acquireOwnerLock(tx, ownerId);
      const rows = await tx.select({
        installationId: schema.hermesAgentCredentials.installationId,
        agentId: schema.hermesAgentCredentials.agentId,
        actions: schema.hermesAgentCredentials.actions,
        activationState: schema.hermesAgentCredentials.activationState,
        expiresAt: schema.hermesAgentCredentials.expiresAt,
        issuedAt: schema.hermesAgentCredentials.issuedAt,
        selected: schema.agents.handleNegotiations,
        lastHeartbeatAt: schema.agents.lastNegotiationPickupAt,
      }).from(schema.hermesAgentCredentials)
        .innerJoin(schema.agents, and(
          eq(schema.agents.id, schema.hermesAgentCredentials.agentId),
          eq(schema.agents.ownerId, ownerId),
          eq(schema.agents.type, 'external'),
          eq(schema.agents.runtimeKind, 'hermes'),
          isNull(schema.agents.deletedAt),
        ))
        .where(and(
          eq(schema.hermesAgentCredentials.ownerId, ownerId),
          eq(schema.hermesAgentCredentials.audience, HERMES_AGENT_AUDIENCE),
        ))
        .orderBy(desc(schema.hermesAgentCredentials.issuedAt), desc(schema.hermesAgentCredentials.id));

      const latest = new Map<string, HermesConnectionRecord>();
      for (const row of rows) {
        if (latest.has(row.installationId)) continue;
        latest.set(row.installationId, {
          installationId: row.installationId,
          agentId: row.agentId,
          actions: capabilities(row.actions),
          activationState: row.activationState as HermesActivationState,
          selected: row.selected,
          lastHeartbeatAt: row.lastHeartbeatAt,
          expiresAt: row.expiresAt,
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

  /** Select Index, revoke every installation credential, and remove target authority. */
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
      await tx.update(schema.hermesAgentCredentials).set({
        activationState: 'revoked',
        revokedAt,
      }).where(and(
        eq(schema.hermesAgentCredentials.ownerId, input.ownerId),
        eq(schema.hermesAgentCredentials.installationId, input.installationId),
        eq(schema.hermesAgentCredentials.audience, HERMES_AGENT_AUDIENCE),
        sql`${schema.hermesAgentCredentials.activationState} IN ('pending', 'active')`,
      ));
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
