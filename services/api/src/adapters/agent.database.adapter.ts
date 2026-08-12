import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { RuntimeConflictError, RuntimeNotFoundError } from '../lib/agent/runtime-errors';
import { API_KEY_START_LENGTH, generateApiKey, hashApiKey } from '../lib/apikey/credential';
import * as schema from '../schemas/database.schema';
import { log } from '../lib/log';
import { HERMES_AGENT_AUDIENCE } from '../lib/agent/hermes-authorization';
import { HERMES_CANONICAL_ACTIONS } from '../lib/agent/hermes-capabilities';
import { HERMES_NEGOTIATOR_AUDIENCE, HERMES_NEGOTIATOR_CREDENTIAL_KIND, HERMES_NEGOTIATOR_CREDENTIAL_TTL_MS } from '../lib/agent/hermes-credential';
import { hermesRuntimeTelemetry, observeHermesAdvisoryLockWait } from '../lib/agent/hermes-runtime-telemetry';

const logger = log.lib.from('agent.database.adapter');

/**
 * Agent type semantics (IND-410):
 * - `personal`: the user's own negotiator — one active row per user, auto-provisioned.
 * - `external`: a registered third-party poller runtime (delegate of the negotiator).
 * - `system`: seeded builtin agents.
 */
export type AgentType = 'personal' | 'external' | 'system';
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
  runtimeKind: 'hermes' | null;
  installationId: string | null;
  runtimeSetupAttemptId: string | null;
  lastSeenAt: Date | null;
  lastNegotiationPickupAt: Date | null;
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
  /** Required: an accidental default-typed create would collide with the one-personal-per-owner unique index. */
  type: AgentType;
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
  touchNegotiationPickup(agentId: string): Promise<void>;
  setNegotiationExecutorBinding(input: {
    ownerId: string;
    targetAgentId: string | null;
    exactTargetPermissions: boolean;
    expectedSetupAttemptId?: string;
    disableTargetAgentId?: string;
  }): Promise<AgentWithRelations | null>;
  ensureNegotiatorAgent(userId: string): Promise<string | null>;
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
      await tx.update(schema.hermesAgentCredentials).set({
        activationState: 'revoked',
        revokedAt: new Date(),
      }).where(and(
        eq(schema.hermesAgentCredentials.agentId, agentId),
        sql`${schema.hermesAgentCredentials.activationState} IN ('pending', 'active')`,
      ));
    });

    logger.info('Soft-deleted agent and revoked linked tokens', { agentId });
  }

  async listAgentsForUser(userId: string): Promise<AgentWithRelations[]> {
    // Personal negotiator rows are excluded: they carry no API key or transports and
    // get their own surfaces (sidebar chat, memory panel) — not the agents page.
    const [ownedRows, permittedRows] = await Promise.all([
      db
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(
          and(
            eq(schema.agents.ownerId, userId),
            isNull(schema.agents.deletedAt),
            ne(schema.agents.type, 'personal'),
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

    const [agentRows, transportRows, permissionRows] = await Promise.all([
      db
        .select()
        .from(schema.agents)
        .where(
          and(
            inArray(schema.agents.id, agentIds),
            isNull(schema.agents.deletedAt),
            ne(schema.agents.type, 'personal'),
          ),
        ),
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

    const [agentRows, transportRows, allPermissionRows, credentialedExternalAgentIds] = await Promise.all([
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
      this.findExternalAgentIdsWithValidCredentials(agentIds),
    ]);

    // Polling model: external (poller) agents authenticate to /agents/:id/pickup with
    // their API key and do not require a DB-registered transport row. An external agent
    // is only dispatch-eligible if it has at least one enabled, unexpired API key —
    // otherwise parking a turn for pickup would strand it until the 24h timeout. System
    // agents are always eligible; they execute in-process and never poll.
    const dispatchableAgentRows = agentRows.filter((row) => {
      if (row.type !== 'external') return true;
      return credentialedExternalAgentIds.has(row.id);
    });
    return this.mapAgentsWithRelations(dispatchableAgentRows, transportRows, allPermissionRows);
  }

  private async findExternalAgentIdsWithValidCredentials(agentIds: string[]): Promise<Set<string>> {
    if (agentIds.length === 0) {
      return new Set();
    }
    const [legacyRows, dedicatedRows] = await Promise.all([
      db
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
        ),
      db.select({ agentId: schema.hermesAgentCredentials.agentId })
        .from(schema.hermesAgentCredentials)
        .where(and(
          inArray(schema.hermesAgentCredentials.agentId, agentIds),
          eq(schema.hermesAgentCredentials.audience, HERMES_AGENT_AUDIENCE),
          eq(schema.hermesAgentCredentials.activationState, 'active'),
          sql`${schema.hermesAgentCredentials.expiresAt} > now()`,
        )),
    ]);
    return new Set(
      [...legacyRows, ...dedicatedRows].map((row) => row.agentId).filter((id): id is string => !!id),
    );
  }

  /**
   * Create or rotate one Hermes installation credential under the owner's
   * runtime lock. Preparation deliberately removes negotiation authority; the
   * matching setup generation must be activated separately.
   */
  async prepareHermesInstallation(input: {
    ownerId: string;
    installationId: string;
    setupAttemptId: string;
  }): Promise<{ agent: AgentWithRelations; credential: { id: string; key: string; expiresAt: string } }> {
    const prepared = await db.transaction(async (tx) => {
      await this.acquireOwnerRuntimeLock(tx, input.ownerId);

      let [row] = await tx
        .select()
        .from(schema.agents)
        .where(and(
          eq(schema.agents.ownerId, input.ownerId),
          eq(schema.agents.type, 'external'),
          eq(schema.agents.runtimeKind, 'hermes'),
          eq(schema.agents.installationId, input.installationId),
          isNull(schema.agents.deletedAt),
        ))
        .limit(1)
        .for('update');

      if (!row) {
        [row] = await tx
          .insert(schema.agents)
          .values({
            ownerId: input.ownerId,
            name: 'Hermes Negotiator',
            description: 'Negotiation-only Hermes runtime',
            type: 'external',
            status: 'active',
            metadata: {},
            runtimeKind: 'hermes',
            installationId: input.installationId,
            runtimeSetupAttemptId: input.setupAttemptId,
            notifyOnOpportunity: false,
            dailySummaryEnabled: false,
            handleNegotiations: false,
          })
          .returning();
      } else {
        [row] = await tx
          .update(schema.agents)
          .set({
            status: 'active',
            runtimeSetupAttemptId: input.setupAttemptId,
            handleNegotiations: false,
            updatedAt: new Date(),
          })
          .where(eq(schema.agents.id, row.id))
          .returning();
      }

      // A prepared principal has no authority until the exact generation is
      // selected. Hermes permissions are replaced, not merged.
      await tx.delete(schema.agentPermissions).where(eq(schema.agentPermissions.agentId, row.id));
      await tx.delete(schema.apikeys).where(
        sql`${schema.apikeys.metadata} IS NOT NULL AND ${schema.apikeys.metadata}::jsonb->>'agentId' = ${row.id}`,
      );

      const plainKey = generateApiKey();
      const hashedKey = await hashApiKey(plainKey);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + HERMES_NEGOTIATOR_CREDENTIAL_TTL_MS);
      const [credential] = await tx
        .insert(schema.apikeys)
        .values({
          key: hashedKey,
          userId: input.ownerId,
          referenceId: input.ownerId,
          name: 'Hermes Negotiator API Key',
          start: plainKey.substring(0, API_KEY_START_LENGTH),
          metadata: JSON.stringify({
            agentId: row.id,
            setupAttemptId: input.setupAttemptId,
            audience: HERMES_NEGOTIATOR_AUDIENCE,
            kind: HERMES_NEGOTIATOR_CREDENTIAL_KIND,
            expiresAt: expiresAt.toISOString(),
          }),
          createdAt: now,
          updatedAt: now,
          enabled: true,
          expiresAt,
        })
        .returning({ id: schema.apikeys.id });

      return { row, credential: { id: credential.id, key: plainKey, expiresAt: expiresAt.toISOString() } };
    });

    const agent = await this.getAgentWithRelations(prepared.row.id);
    if (!agent) throw new Error('Prepared Hermes executor not found');
    return { agent, credential: prepared.credential };
  }

  /**
   * Atomically choose the sole external negotiation executor for an owner.
   * Negotiator credentials retain negotiation-only authority; an active full
   * dedicated row retains its exact canonical actions. The generic legacy path
   * preserves other actions.
   */
  async setNegotiationExecutorBinding(input: {
    ownerId: string;
    targetAgentId: string | null;
    exactTargetPermissions: boolean;
    expectedSetupAttemptId?: string;
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
      let exactTargetActions: readonly string[] = ['manage:negotiations'];
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
        if (input.exactTargetPermissions && (
          candidate.runtimeKind !== 'hermes'
          || !input.expectedSetupAttemptId
          || candidate.runtimeSetupAttemptId !== input.expectedSetupAttemptId
        )) {
          throw new RuntimeConflictError();
        }
        const [[legacyCredential], [dedicatedCredential]] = await Promise.all([
          tx.select({ id: schema.apikeys.id })
            .from(schema.apikeys)
            .where(and(
              eq(schema.apikeys.enabled, true),
              or(isNull(schema.apikeys.expiresAt), sql`${schema.apikeys.expiresAt} > now()`),
              sql`${schema.apikeys.metadata} IS NOT NULL AND ${schema.apikeys.metadata}::jsonb->>'agentId' = ${candidate.id}`,
              input.exactTargetPermissions
                ? and(
                    isNotNull(schema.apikeys.expiresAt),
                    sql`${schema.apikeys.metadata}::jsonb->>'setupAttemptId' = ${input.expectedSetupAttemptId}`,
                    sql`${schema.apikeys.metadata}::jsonb->>'audience' = ${HERMES_NEGOTIATOR_AUDIENCE}`,
                    sql`${schema.apikeys.metadata}::jsonb->>'kind' = ${HERMES_NEGOTIATOR_CREDENTIAL_KIND}`,
                  )
                : undefined,
            ))
            .limit(1),
          tx.select({ id: schema.hermesAgentCredentials.id, actions: schema.hermesAgentCredentials.actions })
            .from(schema.hermesAgentCredentials)
            .where(and(
              eq(schema.hermesAgentCredentials.ownerId, input.ownerId),
              eq(schema.hermesAgentCredentials.agentId, candidate.id),
              eq(schema.hermesAgentCredentials.audience, HERMES_AGENT_AUDIENCE),
              eq(schema.hermesAgentCredentials.activationState, 'active'),
              sql`${schema.hermesAgentCredentials.expiresAt} > now()`,
              eq(schema.hermesAgentCredentials.installationId, candidate.installationId ?? ''),
              input.exactTargetPermissions
                ? eq(schema.hermesAgentCredentials.setupAttemptId, input.expectedSetupAttemptId ?? '')
                : undefined,
            ))
            .limit(1),
        ]);
        if (!legacyCredential && !dedicatedCredential) throw new RuntimeConflictError();
        if (input.exactTargetPermissions && dedicatedCredential && !legacyCredential) {
          if (
            dedicatedCredential.actions.length !== HERMES_CANONICAL_ACTIONS.length
            || !HERMES_CANONICAL_ACTIONS.every((action, index) => dedicatedCredential.actions[index] === action)
            || !dedicatedCredential.actions.includes('manage:negotiations')
          ) throw new RuntimeConflictError();
          exactTargetActions = dedicatedCredential.actions;
        }
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

      if (input.exactTargetPermissions) {
        await tx.delete(schema.agentPermissions).where(eq(schema.agentPermissions.agentId, target.id));
        await tx.insert(schema.agentPermissions).values({
          agentId: target.id,
          userId: input.ownerId,
          scope: 'global',
          scopeId: null,
          actions: [...exactTargetActions],
        });
      } else {
        await tx.execute(sql`
          INSERT INTO agent_permissions (agent_id, user_id, scope, scope_id, actions)
          VALUES (${target.id}, ${input.ownerId}, 'global', NULL, ARRAY['manage:negotiations']::text[])
          ON CONFLICT (agent_id, user_id) WHERE scope = 'global'
          DO UPDATE SET actions = CASE
            WHEN 'manage:negotiations' = ANY(agent_permissions.actions)
              THEN agent_permissions.actions
            ELSE array_append(agent_permissions.actions, 'manage:negotiations')
          END
        `);
      }

      await tx
        .update(schema.agents)
        .set({ handleNegotiations: true, status: 'active', updatedAt: new Date() })
        .where(eq(schema.agents.id, target.id));
      return target.id;
    });

    return selectedId ? this.getAgentWithRelations(selectedId) : null;
  }

  /** Owner-locked CAS that can only deselect the exact observed Hermes authority. */
  async compareAndSelectIndex(input: {
    ownerId: string;
    expectedAgentId: string;
    expectedInstallationId: string;
    expectedSetupAttemptId: string;
  }): Promise<'selected' | 'already_index' | 'preserved'> {
    return db.transaction(async (tx) => {
      await this.acquireOwnerRuntimeLock(tx, input.ownerId);
      const [selected] = await tx.select().from(schema.agents).where(and(
        eq(schema.agents.ownerId, input.ownerId),
        eq(schema.agents.type, 'external'),
        eq(schema.agents.handleNegotiations, true),
        isNull(schema.agents.deletedAt),
      )).limit(1).for('update');
      if (!selected) return 'already_index';
      if (selected.id !== input.expectedAgentId
        || selected.runtimeKind !== 'hermes'
        || selected.installationId !== input.expectedInstallationId
        || selected.runtimeSetupAttemptId !== input.expectedSetupAttemptId) {
        return 'preserved';
      }
      await tx.update(schema.agents).set({
        handleNegotiations: false,
        updatedAt: new Date(),
      }).where(and(
        eq(schema.agents.id, input.expectedAgentId),
        eq(schema.agents.handleNegotiations, true),
        eq(schema.agents.installationId, input.expectedInstallationId),
        eq(schema.agents.runtimeSetupAttemptId, input.expectedSetupAttemptId),
      ));
      await tx.execute(sql`
        UPDATE agent_permissions
        SET actions = array_remove(actions, 'manage:negotiations')
        WHERE agent_id = ${input.expectedAgentId}
          AND 'manage:negotiations' = ANY(actions)
      `);
      await tx.execute(sql`
        DELETE FROM agent_permissions
        WHERE agent_id = ${input.expectedAgentId} AND cardinality(actions) = 0
      `);
      return 'selected';
    });
  }

  /** Compare-and-clear one current legacy setup generation and only its token. */
  async rollbackHermesSetup(input: { ownerId: string; expectedSetupAttemptId: string }): Promise<boolean> {
    return db.transaction(async (tx) => {
      await this.acquireOwnerRuntimeLock(tx, input.ownerId);
      const [target] = await tx
        .select()
        .from(schema.agents)
        .where(and(
          eq(schema.agents.ownerId, input.ownerId),
          eq(schema.agents.type, 'external'),
          eq(schema.agents.runtimeKind, 'hermes'),
          eq(schema.agents.runtimeSetupAttemptId, input.expectedSetupAttemptId),
          isNull(schema.agents.deletedAt),
        ))
        .orderBy(desc(schema.agents.updatedAt), desc(schema.agents.id))
        .limit(1)
        .for('update');
      if (!target) return false;

      await tx
        .update(schema.agents)
        .set({
          handleNegotiations: false,
          status: 'inactive',
          runtimeSetupAttemptId: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.agents.id, target.id),
          eq(schema.agents.runtimeSetupAttemptId, input.expectedSetupAttemptId),
        ));
      await tx.delete(schema.agentPermissions).where(eq(schema.agentPermissions.agentId, target.id));
      await tx.delete(schema.apikeys).where(sql`
        ${schema.apikeys.metadata} IS NOT NULL
        AND ${schema.apikeys.metadata}::jsonb->>'agentId' = ${target.id}
        AND ${schema.apikeys.metadata}::jsonb->>'setupAttemptId' = ${input.expectedSetupAttemptId}
      `);
      await tx.update(schema.hermesAgentCredentials).set({
        activationState: 'revoked',
        revokedAt: new Date(),
      }).where(and(
        eq(schema.hermesAgentCredentials.agentId, target.id),
        eq(schema.hermesAgentCredentials.setupAttemptId, input.expectedSetupAttemptId),
        sql`${schema.hermesAgentCredentials.activationState} IN ('pending', 'active')`,
      ));
      return true;
    });
  }

  /** Return the one admitted selected executor, clearing stale authority atomically. */
  async getNegotiationExecutorBinding(ownerId: string): Promise<AgentWithRelations | null> {
    return db.transaction(async (tx) => {
      await this.acquireOwnerRuntimeLock(tx, ownerId);
      const [selected] = await tx
        .select()
        .from(schema.agents)
        .where(and(
          eq(schema.agents.ownerId, ownerId),
          eq(schema.agents.type, 'external'),
          eq(schema.agents.handleNegotiations, true),
          isNull(schema.agents.deletedAt),
        ))
        .limit(1)
        .for('update');
      if (!selected) return null;

      const permissionRows = await tx
        .select()
        .from(schema.agentPermissions)
        .where(eq(schema.agentPermissions.agentId, selected.id));
      const hasGlobalAuthority = permissionRows.some((permission) =>
        permission.userId === ownerId
        && permission.scope === 'global'
        && permission.actions.includes('manage:negotiations'));
      const [[legacyCredential], [dedicatedCredential]] = await Promise.all([
        tx.select({ id: schema.apikeys.id })
          .from(schema.apikeys)
          .where(and(
            eq(schema.apikeys.enabled, true),
            or(isNull(schema.apikeys.expiresAt), sql`${schema.apikeys.expiresAt} > now()`),
            sql`${schema.apikeys.metadata} IS NOT NULL AND ${schema.apikeys.metadata}::jsonb->>'agentId' = ${selected.id}`,
            selected.runtimeKind === 'hermes'
              ? and(
                  isNotNull(schema.apikeys.expiresAt),
                  sql`${schema.apikeys.metadata}::jsonb->>'setupAttemptId' = ${selected.runtimeSetupAttemptId}`,
                  sql`${schema.apikeys.metadata}::jsonb->>'audience' = ${HERMES_NEGOTIATOR_AUDIENCE}`,
                  sql`${schema.apikeys.metadata}::jsonb->>'kind' = ${HERMES_NEGOTIATOR_CREDENTIAL_KIND}`,
                )
              : undefined,
          ))
          .limit(1),
        tx.select({ id: schema.hermesAgentCredentials.id, actions: schema.hermesAgentCredentials.actions })
          .from(schema.hermesAgentCredentials)
          .where(and(
            eq(schema.hermesAgentCredentials.ownerId, ownerId),
            eq(schema.hermesAgentCredentials.agentId, selected.id),
            eq(schema.hermesAgentCredentials.audience, HERMES_AGENT_AUDIENCE),
            eq(schema.hermesAgentCredentials.activationState, 'active'),
            eq(schema.hermesAgentCredentials.installationId, selected.installationId ?? ''),
            eq(schema.hermesAgentCredentials.setupAttemptId, selected.runtimeSetupAttemptId ?? ''),
            sql`${schema.hermesAgentCredentials.expiresAt} > now()`,
          ))
          .limit(1),
      ]);
      const fullPermission = permissionRows.find((permission) =>
        permission.userId === ownerId && permission.scope === 'global');
      const dedicatedValid = Boolean(
        dedicatedCredential
        && dedicatedCredential.actions.length === HERMES_CANONICAL_ACTIONS.length
        && HERMES_CANONICAL_ACTIONS.every((action, index) => dedicatedCredential.actions[index] === action)
        && fullPermission?.actions.length === HERMES_CANONICAL_ACTIONS.length
        && HERMES_CANONICAL_ACTIONS.every((action, index) => fullPermission.actions[index] === action)
      );

      if (selected.status !== 'active' || !hasGlobalAuthority || (!legacyCredential && !dedicatedValid)) {
        await tx.execute(sql`
          UPDATE agent_permissions
          SET actions = array_remove(actions, 'manage:negotiations')
          WHERE agent_id = ${selected.id}
            AND 'manage:negotiations' = ANY(actions)
        `);
        await tx.execute(sql`
          DELETE FROM agent_permissions
          WHERE agent_id = ${selected.id} AND cardinality(actions) = 0
        `);
        await tx
          .update(schema.agents)
          .set({ handleNegotiations: false, updatedAt: new Date() })
          .where(eq(schema.agents.id, selected.id));
        return null;
      }

      const transportRows = await tx
        .select()
        .from(schema.agentTransports)
        .where(eq(schema.agentTransports.agentId, selected.id))
        .orderBy(desc(schema.agentTransports.priority));
      return this.mapAgentWithRelations(this.toAgentRow(selected), transportRows, permissionRows);
    });
  }

  /** Resolve one owned Hermes installation independently of current selection. */
  async getHermesInstallation(ownerId: string, installationId: string): Promise<AgentWithRelations | null> {
    const [row] = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(
        eq(schema.agents.ownerId, ownerId),
        eq(schema.agents.type, 'external'),
        eq(schema.agents.runtimeKind, 'hermes'),
        eq(schema.agents.installationId, installationId),
        isNull(schema.agents.deletedAt),
      ))
      .limit(1);
    return row ? this.getAgentWithRelations(row.id) : null;
  }

  /** Select Index and remove one installation and all of its credentials. */
  async disconnectHermesInstallation(input: { ownerId: string; installationId: string }): Promise<'disconnected' | 'absent' | 'owner_mismatch'> {
    return db.transaction(async (tx) => {
      await this.acquireOwnerRuntimeLock(tx, input.ownerId);
      // First resolve and lock only this owner's exact installation. Installation
      // UUIDs may coincide across owners, so if it is absent, a separate
      // non-locking existence read distinguishes proven global absence (safe
      // idempotent logout) from a cross-owner target (non-enumerating 404).
      const [target] = await tx
        .select()
        .from(schema.agents)
        .where(and(
          eq(schema.agents.ownerId, input.ownerId),
          eq(schema.agents.type, 'external'),
          eq(schema.agents.runtimeKind, 'hermes'),
          eq(schema.agents.installationId, input.installationId),
          isNull(schema.agents.deletedAt),
        ))
        .limit(1)
        .for('update');
      if (!target) {
        const [otherOwner] = await tx.select({ id: schema.agents.id }).from(schema.agents)
          .where(and(
            ne(schema.agents.ownerId, input.ownerId),
            eq(schema.agents.type, 'external'),
            eq(schema.agents.runtimeKind, 'hermes'),
            eq(schema.agents.installationId, input.installationId),
            isNull(schema.agents.deletedAt),
          ))
          .limit(1);
        return otherOwner ? 'owner_mismatch' : 'absent';
      }

      await tx.execute(sql`
        UPDATE agent_permissions
        SET actions = array_remove(actions, 'manage:negotiations')
        WHERE agent_id IN (
          SELECT id FROM agents
          WHERE owner_id = ${input.ownerId} AND type = 'external' AND deleted_at IS NULL
        )
          AND 'manage:negotiations' = ANY(actions)
      `);
      await tx.execute(sql`
        DELETE FROM agent_permissions
        WHERE cardinality(actions) = 0
          AND agent_id IN (
            SELECT id FROM agents
            WHERE owner_id = ${input.ownerId} AND type = 'external' AND deleted_at IS NULL
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
      await tx
        .update(schema.agents)
        .set({ status: 'inactive', runtimeSetupAttemptId: null, updatedAt: new Date() })
        .where(eq(schema.agents.id, target.id));
      await tx.delete(schema.apikeys).where(
        sql`${schema.apikeys.metadata} IS NOT NULL AND ${schema.apikeys.metadata}::jsonb->>'agentId' = ${target.id}`,
      );
      await tx.update(schema.hermesAgentCredentials).set({
        activationState: 'revoked',
        revokedAt: new Date(),
      }).where(and(
        eq(schema.hermesAgentCredentials.ownerId, input.ownerId),
        eq(schema.hermesAgentCredentials.agentId, target.id),
        eq(schema.hermesAgentCredentials.installationId, input.installationId),
        sql`${schema.hermesAgentCredentials.activationState} IN ('pending', 'active')`,
      ));
      return 'disconnected';
    });
  }

  getSystemAgentIds(): AgentSystemIds {
    return SYSTEM_AGENT_IDS;
  }

  /**
   * Ensure the user has a personal negotiator agent row (one per user).
   * Idempotent — safe to call on every sign-in; follows the ensurePersonalNetwork
   * setup-side-effect pattern. Ghost users are skipped: they never signed up and
   * must not get negotiator rows (a later real sign-in de-ghosts and provisions).
   *
   * @param userId - The user to provision a negotiator for
   * @returns The negotiator agent id, or null when the user is missing or a ghost
   */
  async ensureNegotiatorAgent(userId: string): Promise<string | null> {
    const findExisting = () =>
      db
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(
          and(
            eq(schema.agents.ownerId, userId),
            eq(schema.agents.type, 'personal'),
            isNull(schema.agents.deletedAt),
          ),
        )
        .limit(1);

    // Fast path: already provisioned.
    const [existing] = await findExisting();
    if (existing) {
      return existing.id;
    }

    const [user] = await db
      .select({ name: schema.users.name, isGhost: schema.users.isGhost })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user || user.isGhost) {
      return null;
    }

    const firstName = (user.name ?? '').trim().split(/\s+/)[0] ?? '';
    const name = firstName ? `${firstName}'s Negotiator` : 'Your Negotiator';

    await db
      .insert(schema.agents)
      .values({
        ownerId: userId,
        name,
        description: 'Negotiates on your behalf across the network.',
        type: 'personal',
        status: 'active',
        metadata: {},
      })
      .onConflictDoNothing();

    // Re-query rather than trusting RETURNING — a concurrent sign-in may have won
    // the insert race (onConflictDoNothing returns no row in that case).
    const [row] = await findExisting();
    if (row) {
      logger.info('Ensured negotiator agent', { userId, agentId: row.id });
    }
    return row?.id ?? null;
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

  /** Stamp the negotiation-specific polling heartbeat used for runtime health. */
  async touchNegotiationPickup(agentId: string): Promise<void> {
    try {
      await db
        .update(schema.agents)
        .set({ lastNegotiationPickupAt: new Date() })
        .where(and(eq(schema.agents.id, agentId), isNull(schema.agents.deletedAt)));
    } catch (err: unknown) {
      logger.warn('touchNegotiationPickup failed', {
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async acquireOwnerRuntimeLock(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ownerId: string,
  ): Promise<void> {
    await observeHermesAdvisoryLockWait(
      hermesRuntimeTelemetry,
      () => tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`agent-runtime:${ownerId}`}, 0)
        )
      `),
    );
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

        return left.type === 'external' ? -1 : 1;
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
      runtimeKind: row.runtimeKind ?? null,
      installationId: row.installationId ?? null,
      runtimeSetupAttemptId: row.runtimeSetupAttemptId ?? null,
      lastSeenAt: row.lastSeenAt ?? null,
      lastNegotiationPickupAt: row.lastNegotiationPickupAt ?? null,
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
