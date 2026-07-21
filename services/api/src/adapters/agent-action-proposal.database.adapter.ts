import { and, eq } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { agentActionProposals, type AgentActionProposalActionRecord, type AgentActionProposalResultRecord, type AgentActionProposalRow } from '../schemas/database.schema';

export interface CreateAgentActionProposalInput {
  proposalId: string;
  userId: string;
  conversationId?: string;
  actions: AgentActionProposalActionRecord[];
}

export type AgentActionProposalClaim =
  | { kind: 'missing' }
  | { kind: 'in_progress' }
  | { kind: 'replay'; result: AgentActionProposalResultRecord[] }
  | { kind: 'claimed'; proposal: AgentActionProposalRow };

/** Executing proposals hold a bounded lease so interrupted confirmations can recover. */
export const AGENT_ACTION_EXECUTION_LEASE_MS = 5 * 60 * 1000;

export type AgentActionProposalDisplay = {
  id: string;
  actions: Array<Omit<AgentActionProposalActionRecord, 'snapshot'>>;
  status: AgentActionProposalRow['status'];
  result: AgentActionProposalResultRecord[] | null;
};

function toDisplayAction(
  action: AgentActionProposalActionRecord,
): AgentActionProposalDisplay['actions'][number] {
  return {
    type: action.type,
    entityId: action.entityId,
    currentState: action.currentState,
    proposedOperation: action.proposedOperation,
    ...(action.evidence !== undefined ? { evidence: action.evidence } : {}),
    ...(action.skipped !== undefined ? { skipped: action.skipped } : {}),
    ...(action.reason !== undefined ? { reason: action.reason } : {}),
    ...(action.description !== undefined ? { description: action.description } : {}),
  };
}

function toDisplayResult(result: AgentActionProposalResultRecord): AgentActionProposalResultRecord {
  return {
    type: result.type,
    entityId: result.entityId,
    operation: result.operation,
    previousState: result.previousState,
    resultingState: result.resultingState,
    ...(result.evidence !== undefined ? { evidence: result.evidence } : {}),
    outcome: result.outcome,
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
  };
}

/** Durable proposal storage and recoverable single-use claim protocol for Agent actions. */
export class AgentActionProposalDatabaseAdapter {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async createProposal(input: CreateAgentActionProposalInput): Promise<void> {
    await db.insert(agentActionProposals).values({
      id: input.proposalId,
      userId: input.userId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      actions: input.actions,
    });
  }

  /** Returns one conversation- and owner-scoped proposal projected to display-safe fields. */
  async getProposal(proposalId: string, userId: string, conversationId: string): Promise<AgentActionProposalDisplay | null> {
    const [proposal] = await db
      .select()
      .from(agentActionProposals)
      .where(and(
        eq(agentActionProposals.id, proposalId),
        eq(agentActionProposals.userId, userId),
        eq(agentActionProposals.conversationId, conversationId),
      ))
      .limit(1);
    if (!proposal) return null;

    return {
      id: proposal.id,
      actions: proposal.actions.map(toDisplayAction),
      status: proposal.status,
      result: proposal.result?.map(toDisplayResult) ?? null,
    };
  }

  async claimProposal(proposalId: string, userId: string, conversationId: string): Promise<AgentActionProposalClaim> {
    return db.transaction(async (tx) => {
      const [proposal] = await tx
        .select()
        .from(agentActionProposals)
        .where(and(
          eq(agentActionProposals.id, proposalId),
          eq(agentActionProposals.userId, userId),
          eq(agentActionProposals.conversationId, conversationId),
        ))
        .limit(1)
        .for('update');
      if (!proposal) return { kind: 'missing' } as const;
      if (proposal.status === 'consumed') {
        return { kind: 'replay', result: proposal.result ?? [] } as const;
      }

      const claimedAt = this.now();
      const leaseIsFresh = proposal.status === 'executing'
        && proposal.executionLeaseAt !== null
        && proposal.executionLeaseAt.getTime() > claimedAt.getTime() - AGENT_ACTION_EXECUTION_LEASE_MS;
      if (leaseIsFresh) return { kind: 'in_progress' } as const;

      const [claimed] = await tx
        .update(agentActionProposals)
        .set({ status: 'executing', executionLeaseAt: claimedAt })
        .where(and(
          eq(agentActionProposals.id, proposalId),
          eq(agentActionProposals.userId, userId),
          eq(agentActionProposals.conversationId, conversationId),
          eq(agentActionProposals.status, proposal.status),
        ))
        .returning();
      if (!claimed) return { kind: 'in_progress' } as const;
      return { kind: 'claimed', proposal: claimed } as const;
    });
  }

  async consumeProposal(
    proposalId: string,
    userId: string,
    conversationId: string,
    result: AgentActionProposalResultRecord[],
  ): Promise<void> {
    await db
      .update(agentActionProposals)
      .set({ status: 'consumed', result, executionLeaseAt: null, consumedAt: this.now() })
      .where(and(
        eq(agentActionProposals.id, proposalId),
        eq(agentActionProposals.userId, userId),
        eq(agentActionProposals.conversationId, conversationId),
        eq(agentActionProposals.status, 'executing'),
      ));
  }
}

export const agentActionProposalDatabaseAdapter = new AgentActionProposalDatabaseAdapter();
