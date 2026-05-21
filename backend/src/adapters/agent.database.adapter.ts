import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';


import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { log } from '../lib/log';

const logger = log.lib.from('agent.database.adapter');

export type AgentType = 'personal' | 'system';
export type AgentStatus = 'active' | 'inactive';
export type TransportChannel = 'mcp';
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
  lastSeenAt: Date | null;
  notifyOnOpportunity: boolean;
  dailySummaryEnabled: boolean;
  handleNegotiations: boolean;
  lastDailySummaryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentTransportRow {
  id: string;
  agentId: string;
  channel: TransportChannel;
  config: Record<string, unknown>;
  priority: number;
  active: boolean;
  failureCount: number;
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
  transports: AgentTransportRow[];
  permissions: AgentPermissionRow[];
}

export interface CreateAgentInput {
  id?: string;
  ownerId: string;
  name: string;
  description?: string | null;
  type?: AgentType;
  status?: AgentStatus;
  metadata?: Record<string, unknown>;
}

export interface CreateTransportInput {
  agentId: string;
  channel: TransportChannel;
  config?: Record<string, unknown>;
  priority?: number;
  active?: boolean;
}

export interface GrantPermissionInput {
  agentId: string;
  userId: string;
  scope?: PermissionScope;
  scopeId?: string | null;
  actions: string[];
}

export interface AgentSystemIds {
  chatOrchestrator: string;
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
  createTransport(input: CreateTransportInput): Promise<AgentTransportRow>;
  deleteTransport(transportId: string): Promise<void>;
  recordTransportFailure(transportId: string): Promise<void>;
  recordTransportSuccess(transportId: string): Promise<void>;
  grantPermission(input: GrantPermissionInput): Promise<AgentPermissionRow>;
  upsertGlobalPermission(input: { agentId: string; userId: string; actions: string[] }): Promise<AgentPermissionRow>;
  revokePermission(permissionId: string): Promise<void>;
  revokeGlobalPermission(agentId: string, userId: string): Promise<void>;
  hasPermission(agentId: string, userId: string, action: string, scope?: AgentScope): Promise<boolean>;
  findAuthorizedAgents(userId: string, action: string, scope?: AgentScope): Promise<AgentWithRelations[]>;
  getSystemAgentIds(): AgentSystemIds;
  touchLastSeen(agentId: string): Promise<void>;
}

export const SYSTEM_AGENT_IDS: AgentSystemIds = {
  chatOrchestrator: '00000000-0000-0000-0000-000000000001',
  negotiator: '00000000-0000-0000-0000-000000000002',
};

/**
 * AgentDatabaseAdapter
 *
 * Database adapter for agent registry CRUD, transport management, and
 * permission queries.
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
        type: input.type ?? 'personal',
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

    const [transportRows, permissionRows] = await Promise.all([
      db
        .select()
        .from(schema.agentTransports)
        .where(eq(schema.agentTransports.agentId, agentId))
        .orderBy(desc(schema.agentTransports.priority)),
      db
        .select()
        .from(schema.agentPermissions)
        .where(eq(schema.agentPermissions.agentId, agentId)),
    ]);

    return this.mapAgentWithRelations(agent, transportRows, permissionRows);
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

      await tx
        .update(schema.agentTransports)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(schema.agentTransports.agentId, agentId));

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
        .where(and(eq(schema.agents.ownerId, userId), isNull(schema.agents.deletedAt))),
      db
        .select({ agentId: schema.agentPermissions.agentId })
        .from(schema.agentPermissions)
        .where(eq(schema.agentPermissions.userId, userId)),
    ]);

    const agentIds = [...new Set([...ownedRows.map((row) => row.id), ...permittedRows.map((row) => row.agentId)])];
    if (agentIds.length === 0) {
      return [];
    }

    const [agentRows, transportRows, permissionRows] = await Promise.all([
      db
        .select()
        .from(schema.agents)
        .where(and(inArray(schema.agents.id, agentIds), isNull(schema.agents.deletedAt))),
      db
        .select()
        .from(schema.agentTransports)
        .where(inArray(schema.agentTransports.agentId, agentIds))
        .orderBy(desc(schema.agentTransports.priority)),
      db
        .select()
        .from(schema.agentPermissions)
        .where(inArray(schema.agentPermissions.agentId, agentIds)),
    ]);

    return this.mapAgentsWithRelations(agentRows, transportRows, permissionRows);
  }

  async createTransport(input: CreateTransportInput): Promise<AgentTransportRow> {
    const [row] = await db
      .insert(schema.agentTransports)
      .values({
        agentId: input.agentId,
        channel: input.channel,
        config: input.config ?? {},
        priority: input.priority ?? 0,
        active: input.active ?? true,
      })
      .returning();

    logger.info('Created agent transport', { agentId: input.agentId, transportId: row.id, channel: row.channel });
    return this.toTransportRow(row);
  }

  async deleteTransport(transportId: string): Promise<void> {
    await db.delete(schema.agentTransports).where(eq(schema.agentTransports.id, transportId));
    logger.info('Deleted agent transport', { transportId });
  }

  async recordTransportFailure(transportId: string): Promise<void> {
    const [row] = await db
      .update(schema.agentTransports)
      .set({
        failureCount: sql`${schema.agentTransports.failureCount} + 1`,
        active: sql`CASE WHEN ${schema.agentTransports.failureCount} + 1 >= 10 THEN false ELSE ${schema.agentTransports.active} END`,
        updatedAt: new Date(),
      })
      .where(eq(schema.agentTransports.id, transportId))
      .returning();

    if (row && !row.active) {
      logger.warn('Auto-deactivated transport after repeated failures', {
        transportId,
        failureCount: row.failureCount,
      });
    }
  }

  async recordTransportSuccess(transportId: string): Promise<void> {
    await db
      .update(schema.agentTransports)
      .set({
        failureCount: 0,
        updatedAt: new Date(),
      })
      .where(eq(schema.agentTransports.id, transportId));
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

    if (isGlobal) {
      const [row] = await db
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
        .returning();

      logger.info('Granted agent permission', {
        agentId: input.agentId,
        permissionId: row.id,
        userId: input.userId,
      });
      return this.toPermissionRow(row);
    }

    const [row] = await db
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
    const result = await db.execute(sql`
      INSERT INTO agent_permissions (agent_id, user_id, scope, scope_id, actions)
      VALUES (${input.agentId}, ${input.userId}, 'global', NULL, ${input.actions})
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

  async findAuthorizedAgents(
    userId: string,
    action: string,
    scope?: AgentScope,
  ): Promise<AgentWithRelations[]> {
    const scopeCondition = this.buildScopeCondition(scope);
    const permissionRows = await db
      .select({ agentId: schema.agentPermissions.agentId })
      .from(schema.agentPermissions)
      .where(
        and(
          eq(schema.agentPermissions.userId, userId),
          sql`${action} = ANY(${schema.agentPermissions.actions})`,
          scopeCondition,
        ),
      );

    const agentIds = [...new Set(permissionRows.map((row) => row.agentId))];
    if (agentIds.length === 0) {
      return [];
    }

    const [agentRows, transportRows, allPermissionRows, credentialedPersonalAgentIds] = await Promise.all([
      db
        .select()
        .from(schema.agents)
        .where(
          and(
            inArray(schema.agents.id, agentIds),
            isNull(schema.agents.deletedAt),
            eq(schema.agents.status, 'active'),
          ),
        ),
      db
        .select()
        .from(schema.agentTransports)
        .where(
          and(
            inArray(schema.agentTransports.agentId, agentIds),
            eq(schema.agentTransports.active, true),
          ),
        )
        .orderBy(desc(schema.agentTransports.priority)),
      db
        .select()
        .from(schema.agentPermissions)
        .where(inArray(schema.agentPermissions.agentId, agentIds)),
      this.findPersonalAgentIdsWithValidCredentials(agentIds),
    ]);

    // Polling model: personal agents authenticate to /agents/:id/pickup with their API
    // key and do not require a DB-registered transport row. A personal agent is only
    // dispatch-eligible if it has at least one enabled, unexpired API key — otherwise
    // parking a turn for pickup would strand it until the 24h timeout. System agents
    // are always eligible; they execute in-process and never poll.
    const dispatchableAgentRows = agentRows.filter((row) => {
      if (row.type !== 'personal') return true;
      return credentialedPersonalAgentIds.has(row.id);
    });
    return this.mapAgentsWithRelations(dispatchableAgentRows, transportRows, allPermissionRows);
  }

  private async findPersonalAgentIdsWithValidCredentials(agentIds: string[]): Promise<Set<string>> {
    if (agentIds.length === 0) {
      return new Set();
    }
    const rows = await db
      .select({ agentId: sql<string>`(${schema.apikeys.metadata}::jsonb ->> 'agentId')` })
      .from(schema.apikeys)
      .where(
        and(
          eq(schema.apikeys.enabled, true),
          or(
            isNull(schema.apikeys.expiresAt),
            sql`${schema.apikeys.expiresAt} > now()`,
          ),
          inArray(sql`(${schema.apikeys.metadata}::jsonb ->> 'agentId')`, agentIds),
        ),
      );
    return new Set(rows.map((r) => r.agentId).filter((id): id is string => !!id));
  }

  getSystemAgentIds(): AgentSystemIds {
    return SYSTEM_AGENT_IDS;
  }

  /**
   * Update the agent's lastSeenAt timestamp. Called on every personal-agent pickup
   * poll so the dispatcher can tell whether the agent is actively running.
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
    transportRows: Array<typeof schema.agentTransports.$inferSelect>,
    permissionRows: Array<typeof schema.agentPermissions.$inferSelect>,
  ): AgentWithRelations[] {
    const transportsByAgent = this.groupTransportsByAgent(transportRows);
    const permissionsByAgent = this.groupPermissionsByAgent(permissionRows);

    return agentRows
      .map((row) => ({
        ...this.toAgentRow(row),
        transports: transportsByAgent.get(row.id) ?? [],
        permissions: permissionsByAgent.get(row.id) ?? [],
      }))
      .sort((left, right) => {
        if (left.type === right.type) {
          return right.createdAt.getTime() - left.createdAt.getTime();
        }

        return left.type === 'personal' ? -1 : 1;
      });
  }

  private mapAgentWithRelations(
    agent: AgentRow,
    transportRows: Array<typeof schema.agentTransports.$inferSelect>,
    permissionRows: Array<typeof schema.agentPermissions.$inferSelect>,
  ): AgentWithRelations {
    return {
      ...agent,
      transports: transportRows.map((row) => this.toTransportRow(row)),
      permissions: permissionRows.map((row) => this.toPermissionRow(row)),
    };
  }

  private groupTransportsByAgent(
    rows: Array<typeof schema.agentTransports.$inferSelect>,
  ): Map<string, AgentTransportRow[]> {
    const result = new Map<string, AgentTransportRow[]>();

    for (const row of rows) {
      const current = result.get(row.agentId) ?? [];
      current.push(this.toTransportRow(row));
      result.set(row.agentId, current);
    }

    return result;
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
      lastSeenAt: row.lastSeenAt ?? null,
      notifyOnOpportunity: row.notifyOnOpportunity,
      dailySummaryEnabled: row.dailySummaryEnabled,
      handleNegotiations: row.handleNegotiations,
      lastDailySummaryAt: row.lastDailySummaryAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toTransportRow(
    row: typeof schema.agentTransports.$inferSelect,
  ): AgentTransportRow {
    const config = ((row.config ?? {}) as Record<string, unknown>);

    return {
      id: row.id,
      agentId: row.agentId,
      channel: row.channel,
      config,
      priority: row.priority,
      active: row.active,
      failureCount: row.failureCount,
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
