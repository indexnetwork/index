import { and, eq, isNull, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { RuntimeNotFoundError } from '../lib/agent/runtime-errors';
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

export interface CreateAgentInput {
  id?: string;
  ownerId: string;
  name: string;
  description?: string | null;
  type: AgentType;
  status?: AgentStatus;
  metadata?: Record<string, unknown>;
}

export interface AgentSystemIds {
  negotiator: string;
}

export interface AgentRegistryStore {
  createAgent(input: CreateAgentInput): Promise<AgentRow>;
  getAgent(agentId: string): Promise<AgentRow | null>;
  updateAgent(
    agentId: string,
    updates: Partial<Pick<AgentRow, 'name' | 'description' | 'status' | 'metadata' | 'notifyOnOpportunity' | 'dailySummaryEnabled' | 'handleNegotiations'>>,
  ): Promise<AgentRow | null>;
  deleteAgent(agentId: string): Promise<void>;
  listAgentsForUser(userId: string): Promise<AgentRow[]>;
  getSelectedNegotiator(ownerId: string): Promise<AgentRow | null>;
  getSystemAgentIds(): AgentSystemIds;
  touchLastSeen(agentId: string): Promise<void>;
  setNegotiationExecutorBinding(input: {
    ownerId: string;
    targetAgentId: string | null;
    disableTargetAgentId?: string;
  }): Promise<AgentRow | null>;
}

export const SYSTEM_AGENT_IDS: AgentSystemIds = {
  negotiator: '00000000-0000-0000-0000-000000000002',
};

/**
 * AgentDatabaseAdapter
 *
 * Database adapter for agent registry CRUD.
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
    await db
      .update(schema.agents)
      .set({
        deletedAt: new Date(),
        status: 'inactive',
        updatedAt: new Date(),
      })
      .where(and(eq(schema.agents.id, agentId), isNull(schema.agents.deletedAt)));

    logger.info('Soft-deleted agent', { agentId });
  }

  async listAgentsForUser(userId: string): Promise<AgentRow[]> {
    const rows = await db
      .select()
      .from(schema.agents)
      .where(
        and(
          eq(schema.agents.ownerId, userId),
          isNull(schema.agents.deletedAt),
        ),
      );

    return rows
      .map((row) => this.toAgentRow(row))
      .sort((left, right) => {
        if (left.type === right.type) {
          return right.createdAt.getTime() - left.createdAt.getTime();
        }

        return left.type === 'external' ? -1 : 1;
      });
  }

  /**
   * Read the single agent the owner selected to handle negotiations.
   *
   * @param ownerId - Owner whose negotiator is resolved.
   * @returns The selected negotiator, or null when none is selected.
   */
  async getSelectedNegotiator(ownerId: string): Promise<AgentRow | null> {
    const [row] = await db
      .select()
      .from(schema.agents)
      .where(and(
        eq(schema.agents.ownerId, ownerId),
        eq(schema.agents.type, 'external'),
        eq(schema.agents.handleNegotiations, true),
        isNull(schema.agents.deletedAt),
      ))
      .limit(1);

    return row ? this.toAgentRow(row) : null;
  }

  /**
   * Atomically choose the sole negotiation executor for an owner. The unique
   * partial index `uniq_agents_selected_negotiation_executor` enforces one.
   *
   * @param input - Owner, the agent to select (or null to clear), and the
   *   agent a `false` write is trying to disable.
   * @returns The newly selected negotiator, or null when the owner has none.
   * @throws RuntimeNotFoundError when the target is not an active owned agent.
   */
  async setNegotiationExecutorBinding(input: {
    ownerId: string;
    targetAgentId: string | null;
    disableTargetAgentId?: string;
  }): Promise<AgentRow | null> {
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
        target = candidate;
      }

      await tx
        .update(schema.agents)
        .set({ handleNegotiations: false, updatedAt: new Date() })
        .where(and(
          eq(schema.agents.ownerId, input.ownerId),
          eq(schema.agents.type, 'external'),
          isNull(schema.agents.deletedAt),
        ));

      if (!target) return null;

      await tx
        .update(schema.agents)
        .set({ handleNegotiations: true, status: 'active', updatedAt: new Date() })
        .where(eq(schema.agents.id, target.id));
      return target.id;
    });

    return selectedId ? this.getAgent(selectedId) : null;
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
}

export const agentDatabaseAdapter = new AgentDatabaseAdapter();
