/**
 * The candidates discovery writes instead of opportunities.
 *
 * A candidate is a pair, keyed by `pairKey` and unique on it. That uniqueness
 * is the whole dedup story: two discovery runs over the same two intents
 * converge on one row, so nothing downstream has to reconcile duplicates.
 */
import { and, db, discoveryMatchCandidates, eq, inArray, negotiations, networkMembers, opportunities, sql } from './database.shared';

/**
 * API-local structural twin of protocol's `OpenedNegotiation`. Adapters must
 * not import protocol interfaces; TypeScript verifies compatibility where the
 * opportunity port is composed.
 */
export interface OpenedNegotiation {
  opportunityId: string;
  negotiationId: string;
  initiatorUserId: string;
  initiatorIntentId: string;
}

type CandidateRow = typeof discoveryMatchCandidates.$inferSelect;

export interface CreateDiscoveryMatchCandidateInput {
  pairKey: string;
  networkId: string;
  intentA: string;
  intentB: string;
  userA: string;
  userB: string;
  score: number;
  reasoning: string;
  evidence: CandidateRow['evidence'];
}

function toCandidate(row: CandidateRow) {
  return { ...row, score: Number(row.score), evidence: row.evidence ?? [] };
}

export class DiscoveryCandidateDatabaseAdapter {
  /**
   * Upsert on `pair_key`. A pair rediscovered with a fresher read updates in
   * place; a pair already opened is left alone — reopening it is a separate
   * decision, not discovery's.
   */
  async upsertDiscoveryMatchCandidates(items: CreateDiscoveryMatchCandidateInput[]) {
    if (items.length === 0) return [];
    const rows = await db
      .insert(discoveryMatchCandidates)
      .values(items.map((item) => ({
        pairKey: item.pairKey,
        networkId: item.networkId,
        intentA: item.intentA,
        intentB: item.intentB,
        userA: item.userA,
        userB: item.userB,
        score: String(item.score),
        reasoning: item.reasoning,
        evidence: item.evidence,
        updatedAt: new Date(),
      })))
      .onConflictDoUpdate({
        target: discoveryMatchCandidates.pairKey,
        set: {
          score: sql`excluded.score`,
          reasoning: sql`excluded.reasoning`,
          evidence: sql`excluded.evidence`,
          updatedAt: new Date(),
        },
        setWhere: eq(discoveryMatchCandidates.status, 'pending'),
      })
      .returning();
    return rows.map(toCandidate);
  }

  /**
   * Turn every candidate into an opportunity with a negotiation beside it, and
   * report the ones newly opened.
   *
   * NEVER THROWS PER CANDIDATE. One pair that cannot be opened — a revoked
   * membership, a lost race — must not cost the rest of the run its results,
   * so each is its own transaction and a failure is skipped rather than
   * raised.
   *
   * @param candidateIds - Candidates to open.
   * @returns One entry per candidate that became a new opportunity.
   */
  async openCandidates(candidateIds: string[]): Promise<OpenedNegotiation[]> {
    const opened: OpenedNegotiation[] = [];
    for (const candidateId of candidateIds) {
      const result = await this.open(candidateId);
      if (result) opened.push(result);
    }
    return opened;
  }

  /**
   * Open one candidate.
   *
   * The advisory lock is on the PAIR, not the candidate. Both principals'
   * discovery runs can reach this at the same moment; the second one through
   * must find the first one's row rather than write a second opportunity
   * between the same two people.
   *
   * The initiator is side A — whichever side's run recorded the pair. It owes
   * the first turn, and its first turn is the decision to pursue or drop.
   *
   * @param candidateId - The candidate to materialize.
   * @returns The opened negotiation, or null when it was already open or could not be opened.
   */
  private async open(candidateId: string): Promise<OpenedNegotiation | null> {
    try {
      return await db.transaction(async (tx) => {
        const [found] = await tx.select().from(discoveryMatchCandidates)
          .where(eq(discoveryMatchCandidates.id, candidateId)).limit(1);
        if (!found) return null;

        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`opportunity-pair:${found.pairKey}`}, 0)
          )
        `);

        // Re-read under the lock: the other side may have opened this pair
        // between the read above and the lock being granted.
        const [candidate] = await tx.select().from(discoveryMatchCandidates)
          .where(eq(discoveryMatchCandidates.id, candidateId)).limit(1);
        if (!candidate || candidate.status === 'opened') return null;

        // Both parties must still be on the network. The persist node used to
        // hold this (createOpportunityIfNetworkEligible); the row is born here
        // now, so the check belongs here — inside the same transaction, so a
        // membership cannot be revoked between the check and the insert.
        const members = await tx.select({ userId: networkMembers.userId })
          .from(networkMembers)
          .where(and(
            eq(networkMembers.networkId, candidate.networkId),
            inArray(networkMembers.userId, [candidate.userA, candidate.userB]),
          ));
        const present = new Set(members.map((row) => row.userId));
        if (!present.has(candidate.userA) || !present.has(candidate.userB)) return null;

        const score = Number(candidate.score);
        const [row] = await tx.insert(opportunities).values({
          detection: {
            source: 'opportunity_graph',
            createdBy: 'agent-opportunity-finder',
            triggeredBy: candidate.intentA,
            timestamp: new Date().toISOString(),
          },
          actors: [
            { networkId: candidate.networkId, userId: candidate.userA, role: 'party', intent: candidate.intentA },
            { networkId: candidate.networkId, userId: candidate.userB, role: 'party', intent: candidate.intentB },
          ],
          interpretation: {
            category: 'collaboration',
            reasoning: candidate.reasoning,
            confidence: score / 100,
            signals: [{ type: 'intent_match', weight: score / 100, detail: 'Match explainer' }],
          },
          context: { networkId: candidate.networkId },
          confidence: String(score / 100),
          // Born negotiating. There is no pre-kickoff state any more: the row
          // exists because someone is opening it right now.
          status: 'negotiating',
          updatedAt: new Date(),
          metadata: { evidence: candidate.evidence ?? [] },
        } as never).returning();
        if (!row) return null;

        const [negotiation] = await tx.insert(negotiations).values({
          opportunityId: row.id,
          initiatorUserId: candidate.userA,
          initiatorIntentId: candidate.intentA,
          responderUserId: candidate.userB,
          responderIntentId: candidate.intentB,
          awaitingUserId: candidate.userA,
          updatedAt: new Date(),
        }).returning();
        if (!negotiation) return null;

        await tx.update(discoveryMatchCandidates)
          .set({ status: 'opened', openedOpportunityId: row.id, updatedAt: new Date() })
          .where(eq(discoveryMatchCandidates.id, candidateId));

        return {
          opportunityId: row.id,
          negotiationId: negotiation.id,
          initiatorUserId: candidate.userA,
          initiatorIntentId: candidate.intentA,
        };
      });
    } catch {
      return null;
    }
  }
}

export const discoveryCandidateAdapter = new DiscoveryCandidateDatabaseAdapter();
