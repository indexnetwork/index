import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { RuntimeConflictError, RuntimeNotFoundError } from '../lib/agent/runtime-errors';
import * as schema from '../schemas/database.schema';
import { log } from '../lib/log';

const logger = log.lib.from('agent.database.adapter');

/**
 * Agent type semantics:
 * - `external`: a registered third-party poller runtime.
 * - `system`: seeded builtin agents.
 */
export type AgentType = 'external' | 'system';
export type AgentStatus = 'active' | 'inactive';
export type PermissionScope = 'global' | 'node' | 'network';

export interface AgentScope {
  type: PermissionScope;
  id?: string;
}

export interface AgentRow {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  type: AgentType;
  status: AgentStatus;
  metadata: Record<string, unknown>;
  installationId: string | null;
  lastSeenAt: Date | null;
  notifyOnOpportunity: boolean;
  dailySummaryEnabled: boolean;
  handleNegotiations: boolean;
  lastDailySummaryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentPermissionRow {
  id: string;
  agentId: string;
  userId: string;
  scope: PermissionScope;
  scopeId: string | null;
  actions: string[];
  createdAt: Date;
}

export interface AgentWithRelations extends AgentRow {
  permissions: AgentPermissionRow[];
}

export interface CreateAgentInput {
  id?: string;
  ownerId: string;
  name: string;
  description?: string | null;
  type: AgentType;
  status?: AgentStatus;
  metadata?: Record<string, unknown>;
}

export interface GrantPermissionInput {
  agentId: string;
  userId: string;
  scope?: PermissionScope;
  scopeId?: string | null;
  actions: string[];
}

export interface AgentSystemIds {
  negotiator: string;
}

export interface AgentRegistryStore {
  createAgent(input: CreateAgentInput): Promise<AgentRow>;
  getAgent(agentId: string): Promise<AgentRow | null>;
  getAgentWithRelations(agentId: string): Promise<AgentWithRelations | null>;
  updateAgent(
    agentId: string,
    updates: Partial<Pick<AgentRow, 'name' | 'description' | 'status' | 'metadata' | 'notifyOnOpportunity' | 'dailySummaryEnabled' | 'handleNegotiations'>>,
  ): Promise<AgentRow | null>;
  deleteAgent(agentId: string): Promise<void>;
  listAgentsForUser(userId: string): Promise<AgentWithRelations[]>;
  grantPermission(input: GrantPermissionInput): Promise<AgentPermissionRow>;
  upsertGlobalPermission(input: { agentId: string; userId: string; actions: string[] }): Promise<AgentPermissionRow>;
  revokePermission(permissionId: string): Promise<void>;
  revokeGlobalPermission(agentId: string, userId: string): Promise<void>;
  hasPermission(agentId: string, userId: string, action: string, scope?: AgentScope): Promise<boolean>;
  getSystemAgentIds(): AgentSystemIds;
  touchLastSeen(agentId: string): Promise<void>;
  setNegotiationExecutorBinding(input: {
    ownerId: string;
    targetAgentId: string | null;
    disableTargetAgentId?: string;
  }): Promise<AgentWithRelations | null>;
}

export const SYSTEM_AGENT_IDS: AgentSystemIds = {
  negotiator: '00000000-0000-0000-0000-000000000002',
};

/**
 * AgentDatabaseAdapter
 *
 * Database adapter for agent registry CRUD and permission queries.
 */
export class AgentDatabaseAdapter implements AgentRegistryStore {
  async createAgent(input: CreateAgentInput): Promise<AgentRow> {
    const [row] = await db
      .insert(schema.agents)
      .values({
        id: input.id,
        ownerId: input.ownerId,
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        status: input.status ?? 'active',
        metadata: input.metadata ?? {},
      })
      .returning();

    logger.info('Created agent', { agentId: row.id, ownerId: row.ownerId, type: row.type });
    return this.toAgentRow(row);
  }

  async getAgent(agentId: string): Promise<AgentRow | null> {
    const [row] = await db
      .select()
      .from(schema.agents)
      .where(and(eq(schema.agents.id, agentId), isNull(schema.agents.deletedAt)))
      .limit(1);

    return row ? this.toAgentRow(row) : null;
  }

  async getAgentWithRelations(agentId: string): Promise<AgentWithRelations | null> {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      return null;
    }

    const permissionRows = await db
      .select()
      .from(schema.agentPermissions)
      .where(eq(schema.agentPermissions.agentId, agentId));

    return this.mapAgentWithRelations(agent, permissionRows);
  }

  async updateAgent(
    agentId: string,
    updates: Partial<Pick<AgentRow, 'name' | 'description' | 'status' | 'metadata' | 'notifyOnOpportunity' | 'dailySummaryEnabled' | 'handleNegotiations'>>,
  ): Promise<AgentRow | null> {
    const [row] = await db
      .update(schema.agents)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.agents.id, agentId), isNull(schema.agents.deletedAt)))
      .returning();

    if (!row) {
      return null;
    }

    logger.info('Updated agent', { agentId });
    return this.toAgentRow(row);
  }

  async deleteAgent(agentId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.agents)
        .set({
          deletedAt: new Date(),
          status: 'inactive',
          updatedAt: new Date(),
        })
        .where(and(eq(schema.agents.id, agentId), isNull(schema.agents.deletedAt)));

      await tx.delete(schema.apikeys).where(
        sql`${schema.apikeys.metadata} IS NOT NULL AND ${schema.apikeys.metadata}::jsonb->>'agentId' = ${agentId}`,
      );
    });

    logger.info('Soft-deleted agent and revoked linked tokens', { agentId });
  }

  async listAgentsForUser(userId: string): Promise<AgentWithRelations[]> {
    const [ownedRows, permittedRows] = await Promise.all([
      db
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(
          and(
            eq(schema.agents.ownerId, userId),
            isNull(schema.agents.deletedAt),
          ),
        ),
      db
        .select({ agentId: schema.agentPermissions.agentId })
        .from(schema.agentPermissions)
        .where(eq(schema.agentPermissions.userId, userId)),
    ]);

    const agentIds = [...new Set([...ownedRows.map((row) => row.id), ...permittedRows.map((row) => row.agentId)])];
    if (agentIds.length === 0) {
      return [];
    }

    const [agentRows, permissionRows] = await Promise.all([
      db
        .select()
        .from(schema.agents)
        .where(
          and(
            inArray(schema.agents.id, agentIds),
            isNull(schema.agents.deletedAt),
          ),
        ),
      db
        .select()
        .from(schema.agentPermissions)
        .where(inArray(schema.agentPermissions.agentId, agentIds)),
    ]);

    return this.mapAgentsWithRelations(agentRows, permissionRows);
  }

  /**
   * Grant a permission to an agent for a user. Global-scope permissions are upserted
   * (actions updated on conflict via partial unique index). Non-global scopes have no
   * unique constraint — repeated calls create additional rows.
   * @param input - permission details including agentId, userId, scope, and actions
   * @returns the created or updated permission row
   */
  async grantPermission(input: GrantPermissionInput): Promise<AgentPermissionRow> {
    const isGlobal = (input.scope ?? 'global') === 'global';

    const [row] = isGlobal
      ? await db
          .insert(schema.agentPermissions)
          .values({
            agentId: input.agentId,
            userId: input.userId,
            scope: 'global',
            scopeId: null,
            actions: input.actions,
          })
          .onConflictDoUpdate({
            target: [schema.agentPermissions.agentId, schema.agentPermissions.userId],
            targetWhere: sql`${schema.agentPermissions.scope} = 'global'`,
            set: { actions: input.actions },
          })
          .returning()
      : await db
          .insert(schema.agentPermissions)
          .values({
            agentId: input.agentId,
            userId: input.userId,
            scope: input.scope!,
            scopeId: input.scopeId ?? null,
            actions: input.actions,
          })
          .returning();

    logger.info('Granted agent permission', {
      agentId: input.agentId,
      permissionId: row.id,
      userId: input.userId,
    });
    return this.toPermissionRow(row);
  }

  async upsertGlobalPermission(input: {
    agentId: string;
    userId: string;
    actions: string[];
  }): Promise<AgentPermissionRow> {
    // id has no DB default; Postgres checks NOT NULL before ON CONFLICT.
    const permissionId = crypto.randomUUID();
    const result = await db.execute(sql`
      INSERT INTO agent_permissions (id, agent_id, user_id, scope, scope_id, actions)
      VALUES (${permissionId}, ${input.agentId}, ${input.userId}, 'global', NULL, ${input.actions})
      ON CONFLICT (agent_id, user_id) WHERE scope = 'global'
      DO UPDATE SET actions = EXCLUDED.actions
      RETURNING id,
                agent_id AS "agentId",
                user_id AS "userId",
                scope,
                scope_id AS "scopeId",
                actions,
                created_at AS "createdAt"
    `);
    const [row] = result as unknown as Array<{
      id: string;
      agentId: string;
      userId: string;
      scope: PermissionScope;
      scopeId: string | null;
      actions: string[];
      createdAt: Date;
    }>;

    logger.info('Upserted agent permission', {
      agentId: input.agentId,
      permissionId: row.id,
      userId: input.userId,
    });
    return row;
  }

  async revokePermission(permissionId: string): Promise<void> {
    await db.delete(schema.agentPermissions).where(eq(schema.agentPermissions.id, permissionId));
    logger.info('Revoked agent permission', { permissionId });
  }

  async revokeGlobalPermission(agentId: string, userId: string): Promise<void> {
    await db
      .delete(schema.agentPermissions)
      .where(
        and(
          eq(schema.agentPermissions.agentId, agentId),
          eq(schema.agentPermissions.userId, userId),
          eq(schema.agentPermissions.scope, 'global'),
        ),
      );
    logger.info('Revoked global agent permission', { agentId, userId });
  }

  async hasPermission(
    agentId: string,
    userId: string,
    action: string,
    scope?: AgentScope,
  ): Promise<boolean> {
    const scopeCondition = this.buildScopeCondition(scope);
    const [row] = await db
      .select({ id: schema.agentPermissions.id })
      .from(schema.agentPermissions)
      .innerJoin(schema.agents, eq(schema.agents.id, schema.agentPermissions.agentId))
      .where(
        and(
          eq(schema.agentPermissions.agentId, agentId),
          eq(schema.agentPermissions.userId, userId),
          sql`${action} = ANY(${schema.agentPermissions.actions})`,
          isNull(schema.agents.deletedAt),
          eq(schema.agents.status, 'active'),
          scopeCondition,
        ),
      )
      .limit(1);

    return !!row;
  }

  /**
   * Atomically choose the sole external negotiation executor for an owner.
   * Other actions on the target agent are preserved.
   */
  async setNegotiationExecutorBinding(input: {
    ownerId: string;
    targetAgentId: string | null;
    disableTargetAgentId?: string;
  }): Promise<AgentWithRelations | null> {
    const selectedId = await db.transaction(async (tx) => {
      await this.acquireOwnerRuntimeLock(tx, input.ownerId);

      const [currentlySelected] = await tx
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(and(
          eq(schema.agents.ownerId, input.ownerId),
          eq(schema.agents.type, 'external'),
          eq(schema.agents.handleNegotiations, true),
          isNull(schema.agents.deletedAt),
        ))
        .limit(1)
        .for('update');

      // Generic `false` updates are conditional: disabling an unselected agent
      // must not clear the owner's actual selected executor.
      if (
        input.targetAgentId === null
        && input.disableTargetAgentId
        && currentlySelected?.id !== input.disableTargetAgentId
      ) {
        return currentlySelected?.id ?? null;
      }

      let target: typeof schema.agents.$inferSelect | null = null;
      if (input.targetAgentId) {
        const [candidate] = await tx
          .select()
          .from(schema.agents)
          .where(and(
            eq(schema.agents.id, input.targetAgentId),
            eq(schema.agents.ownerId, input.ownerId),
            eq(schema.agents.type, 'external'),
            eq(schema.agents.status, 'active'),
            isNull(schema.agents.deletedAt),
          ))
          .limit(1)
          .for('update');
        if (!candidate) throw new RuntimeNotFoundError();
        const [credential] = await tx.select({ id: schema.apikeys.id })
          .from(schema.apikeys)
          .where(and(
            eq(schema.apikeys.enabled, true),
            or(isNull(schema.apikeys.expiresAt), sql`${schema.apikeys.expiresAt} > now()`),
            sql`${schema.apikeys.metadata} IS NOT NULL AND ${schema.apikeys.metadata}::jsonb->>'agentId' = ${candidate.id}`,
          ))
          .limit(1);
        if (!credential) throw new RuntimeConflictError();
        target = candidate;
      }

      const excludedTarget = target?.id ?? '';
      await tx.execute(sql`
        UPDATE agent_permissions
        SET actions = array_remove(actions, 'manage:negotiations')
        WHERE agent_id IN (
          SELECT id FROM agents
          WHERE owner_id = ${input.ownerId}
            AND type = 'external'
            AND deleted_at IS NULL
        )
          AND agent_id <> ${excludedTarget}
          AND 'manage:negotiations' = ANY(actions)
      `);
      await tx.execute(sql`
        DELETE FROM agent_permissions
        WHERE cardinality(actions) = 0
          AND agent_id IN (
            SELECT id FROM agents
            WHERE owner_id = ${input.ownerId}
              AND type = 'external'
              AND deleted_at IS NULL
          )
      `);
      await tx
        .update(schema.agents)
        .set({ handleNegotiations: false, updatedAt: new Date() })
        .where(and(
          eq(schema.agents.ownerId, input.ownerId),
          eq(schema.agents.type, 'external'),
          isNull(schema.agents.deletedAt),
        ));

      if (!target) return null;

      // id has no DB default; Postgres checks NOT NULL before ON CONFLICT.
      const permissionId = crypto.randomUUID();
      await tx.execute(sql`
        INSERT INTO agent_permissions (id, agent_id, user_id, scope, scope_id, actions)
        VALUES (${permissionId}, ${target.id}, ${input.ownerId}, 'global', NULL, ARRAY['manage:negotiations']::text[])
        ON CONFLICT (agent_id, user_id) WHERE scope = 'global'
        DO UPDATE SET actions = CASE
          WHEN 'manage:negotiations' = ANY(agent_permissions.actions)
            THEN agent_permissions.actions
          ELSE array_append(agent_permissions.actions, 'manage:negotiations')
        END
      `);

      await tx
        .update(schema.agents)
        .set({ handleNegotiations: true, status: 'active', updatedAt: new Date() })
        .where(eq(schema.agents.id, target.id));
      return target.id;
    });

    return selectedId ? this.getAgentWithRelations(selectedId) : null;
  }

  getSystemAgentIds(): AgentSystemIds {
    return SYSTEM_AGENT_IDS;
  }

  /**
   * Update the agent's lastSeenAt timestamp. Called on every agent pickup poll
   * so callers can tell whether the agent is actively running.
   *
   * Silently no-ops when the agent doesn't exist — callers invoke this from pickup
   * endpoints that already validated the agent, and we don't want to leak 404s
   * from a heartbeat update.
   */
  async touchLastSeen(agentId: string): Promise<void> {
    try {
      await db
        .update(schema.agents)
        .set({ lastSeenAt: new Date() })
        .where(and(eq(schema.agents.id, agentId), isNull(schema.agents.deletedAt)));
    } catch (err: unknown) {
      logger.warn('touchLastSeen failed', {
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async acquireOwnerRuntimeLock(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ownerId: string,
  ): Promise<void> {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`agent-runtime:${ownerId}`}, 0)
      )
    `);
  }

  private buildScopeCondition(scope?: AgentScope) {
    if (!scope || scope.type === 'global') {
      return eq(schema.agentPermissions.scope, 'global');
    }

    return or(
      eq(schema.agentPermissions.scope, 'global'),
      and(
        eq(schema.agentPermissions.scope, scope.type),
        eq(schema.agentPermissions.scopeId, scope.id ?? ''),
      )!,
    );
  }

  private mapAgentsWithRelations(
    agentRows: Array<typeof schema.agents.$inferSelect>,
    permissionRows: Array<typeof schema.agentPermissions.$inferSelect>,
  ): AgentWithRelations[] {
    const permissionsByAgent = this.groupPermissionsByAgent(permissionRows);

    return agentRows
      .map((row) => ({
        ...this.toAgentRow(row),
        permissions: permissionsByAgent.get(row.id) ?? [],
      }))
      .sort((left, right) => {
        if (left.type === right.type) {
          return right.createdAt.getTime() - left.createdAt.getTime();
        }

        return left.type === 'external' ? -1 : 1;
      });
  }

  private mapAgentWithRelations(
    agent: AgentRow,
    permissionRows: Array<typeof schema.agentPermissions.$inferSelect>,
  ): AgentWithRelations {
    return {
      ...agent,
      permissions: permissionRows.map((row) => this.toPermissionRow(row)),
    };
  }

  private groupPermissionsByAgent(
    rows: Array<typeof schema.agentPermissions.$inferSelect>,
  ): Map<string, AgentPermissionRow[]> {
    const result = new Map<string, AgentPermissionRow[]>();

    for (const row of rows) {
      const current = result.get(row.agentId) ?? [];
      current.push(this.toPermissionRow(row));
      result.set(row.agentId, current);
    }

    return result;
  }

  private toAgentRow(row: typeof schema.agents.$inferSelect): AgentRow {
    return {
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      description: row.description,
      type: row.type,
      status: row.status,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      installationId: row.installationId ?? null,
      lastSeenAt: row.lastSeenAt ?? null,
      notifyOnOpportunity: row.notifyOnOpportunity,
      dailySummaryEnabled: row.dailySummaryEnabled,
      handleNegotiations: row.handleNegotiations,
      lastDailySummaryAt: row.lastDailySummaryAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toPermissionRow(row: typeof schema.agentPermissions.$inferSelect): AgentPermissionRow {
    return {
      id: row.id,
      agentId: row.agentId,
      userId: row.userId,
      scope: row.scope,
      scopeId: row.scopeId,
      actions: row.actions ?? [],
      createdAt: row.createdAt,
    };
  }

}

export const agentDatabaseAdapter = new AgentDatabaseAdapter();
