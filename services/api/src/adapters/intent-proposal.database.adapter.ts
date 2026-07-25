import { and, eq, gt } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { intentProposalAnalysisSchema } from '../lib/intent/intent-proposal';
import { intentProposals, type IntentProposalRow } from '../schemas/database.schema';

export interface CreateIntentProposalInput {
  proposalId: string;
  userId: string;
  description: string;
  networkId?: string;
  analysis: unknown;
}

/** Default lifetime for a proposal awaiting explicit owner confirmation. */
export const INTENT_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

/** Durable storage for verified, owner-scoped intent proposals. */
export class IntentProposalDatabaseAdapter {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs: number = INTENT_PROPOSAL_TTL_MS,
  ) {}

  /**
   * Atomically persist a verified proposal batch before any cards are emitted.
   *
   * @param proposals - Owner-scoped proposals with complete verifier output.
   */
  async createProposals(proposals: CreateIntentProposalInput[]): Promise<void> {
    if (proposals.length === 0) return;
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.ttlMs);
    const rows = proposals.map((proposal) => ({
      id: proposal.proposalId,
      userId: proposal.userId,
      description: proposal.description,
      ...(proposal.networkId ? { networkId: proposal.networkId } : {}),
      analysis: intentProposalAnalysisSchema.parse(proposal.analysis),
      createdAt,
      expiresAt,
    }));
    await db.transaction(async (tx) => {
      await tx.insert(intentProposals).values(rows);
    });
  }

  /** Resolve a proposal without exposing records owned by another user. */
  async getProposalForOwner(proposalId: string, userId: string): Promise<IntentProposalRow | null> {
    const [proposal] = await db
      .select()
      .from(intentProposals)
      .where(and(eq(intentProposals.id, proposalId), eq(intentProposals.userId, userId)))
      .limit(1);
    return proposal ?? null;
  }

  /** Mark a still-pending, unexpired owner proposal as rejected. */
  async rejectProposal(proposalId: string, userId: string): Promise<boolean> {
    const [rejected] = await db
      .update(intentProposals)
      .set({ status: 'rejected', consumedAt: this.now() })
      .where(and(
        eq(intentProposals.id, proposalId),
        eq(intentProposals.userId, userId),
        eq(intentProposals.status, 'pending'),
        gt(intentProposals.expiresAt, this.now()),
      ))
      .returning({ id: intentProposals.id });
    return Boolean(rejected);
  }
}

export const intentProposalDatabaseAdapter = new IntentProposalDatabaseAdapter();
