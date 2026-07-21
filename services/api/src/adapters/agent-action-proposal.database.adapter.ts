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

/** Durable proposal storage and single-use claim protocol for Agent actions. */
export class AgentActionProposalDatabaseAdapter {
  async createProposal(input: CreateAgentActionProposalInput): Promise<void> {
    await db.insert(agentActionProposals).values({
      id: input.proposalId,
      userId: input.userId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      actions: input.actions,
    });
  }

  async claimProposal(proposalId: string, userId: string): Promise<AgentActionProposalClaim> {
    return db.transaction(async (tx) => {
      const [proposal] = await tx
        .select()
        .from(agentActionProposals)
        .where(and(
          eq(agentActionProposals.id, proposalId),
          eq(agentActionProposals.userId, userId),
        ))
        .limit(1)
        .for('update');
      if (!proposal) return { kind: 'missing' } as const;
      if (proposal.status === 'consumed') {
        return { kind: 'replay', result: proposal.result ?? [] } as const;
      }
      if (proposal.status === 'executing') return { kind: 'in_progress' } as const;

      const [claimed] = await tx
        .update(agentActionProposals)
        .set({ status: 'executing' })
        .where(and(
          eq(agentActionProposals.id, proposalId),
          eq(agentActionProposals.userId, userId),
          eq(agentActionProposals.status, 'pending'),
        ))
        .returning();
      if (!claimed) return { kind: 'in_progress' } as const;
      return { kind: 'claimed', proposal: claimed } as const;
    });
  }

  async consumeProposal(
    proposalId: string,
    userId: string,
    result: AgentActionProposalResultRecord[],
  ): Promise<void> {
    await db
      .update(agentActionProposals)
      .set({ status: 'consumed', result, consumedAt: new Date() })
      .where(and(
        eq(agentActionProposals.id, proposalId),
        eq(agentActionProposals.userId, userId),
        eq(agentActionProposals.status, 'executing'),
      ));
  }
}

export const agentActionProposalDatabaseAdapter = new AgentActionProposalDatabaseAdapter();
