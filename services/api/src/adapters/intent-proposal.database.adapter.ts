import { and, eq, exists, gt, isNull, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { intentProposalAnalysisSchema } from '../lib/intent/intent-proposal';
import { intentProposals, networkMembers, networks, type IntentProposalRow } from '../schemas/database.schema';

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

  /**
   * Attach a community to a still-pending proposal the caller owns.
   *
   * The fast-intake funnel speculates before the user picks a community, so the
   * speculative proposal is written without a `networkId`. `createFromProposal`
   * refuses any confirmation whose `networkId` differs from the stored one, so
   * the pick has to land on the row before confirm — this is that write.
   *
   * The update is guarded in SQL rather than by a prior read: it only matches a
   * row owned by `userId` that is still `pending`, and only when `userId` holds
   * a live owner/member/admin seat in a live network (the same predicate
   * `IntentDatabaseAdapter.isNetworkMember` applies). A client-supplied
   * `networkId` therefore can never be written for a network the user is not in.
   *
   * @param proposalId - Proposal to attach the community to
   * @param userId - Owner; also the membership subject
   * @param networkId - Community the user picked
   * @returns true when the row was updated; false when ownership, pending
   * status, or membership did not hold
   */
  async setProposalNetwork(proposalId: string, userId: string, networkId: string): Promise<boolean> {
    const [updated] = await db
      .update(intentProposals)
      .set({ networkId })
      .where(and(
        eq(intentProposals.id, proposalId),
        eq(intentProposals.userId, userId),
        eq(intentProposals.status, 'pending'),
        exists(
          db
            .select({ one: sql`1` })
            .from(networkMembers)
            .innerJoin(networks, eq(networkMembers.networkId, networks.id))
            .where(and(
              eq(networkMembers.networkId, networkId),
              eq(networkMembers.userId, userId),
              isNull(networkMembers.deletedAt),
              isNull(networks.deletedAt),
              sql`${networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`,
            )),
        ),
      ))
      .returning({ id: intentProposals.id });
    return Boolean(updated);
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
