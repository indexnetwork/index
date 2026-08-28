/**
 * The candidates discovery writes instead of opportunities.
 *
 * A candidate is a pair, keyed by `pairKey` and unique on it. That uniqueness
 * is the whole dedup story: two discovery runs over the same two intents
 * converge on one row, so nothing downstream has to reconcile duplicates.
 */
import { and, asc, db, discoveryMatchCandidates, eq, inArray, networkMembers, opportunities, or, sql, users } from './database.shared';

/**
 * API-local structural twin of protocol's `CreateAndOpenResult`. Adapters must
 * not import protocol interfaces; TypeScript verifies compatibility where the
 * PersonalAgent's opportunity port is composed.
 */
export type CreateAndOpenResult =
  | { status: 'created' | 'existing'; opportunityId: string }
  | { status: 'raced' | 'failed'; reason: string };

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
   * place; a pair already opened is left alone — reopening it is the
   * PersonalAgent's decision, not discovery's.
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
   * This signal's not-yet-opened pairs, oldest first.
   *
   * Oldest-first is a contract, not a preference: the caller numbers this list
   * in a prompt and resolves a tool call back to a position, so a new arrival
   * must append rather than renumber what the agent already read.
   */
  async listPendingCandidatesForIntent(userId: string, intentId: string) {
    const rows = await db
      .select()
      .from(discoveryMatchCandidates)
      .where(and(
        eq(discoveryMatchCandidates.status, 'pending'),
        or(
          eq(discoveryMatchCandidates.intentA, intentId),
          eq(discoveryMatchCandidates.intentB, intentId),
        ),
      ))
      .orderBy(asc(discoveryMatchCandidates.createdAt), asc(discoveryMatchCandidates.id));

    // The counterparty is whichever side is not the caller. One lookup, not
    // one per row.
    const otherIds = [...new Set(rows.map((row) => row.userA === userId ? row.userB : row.userA))];
    const names = otherIds.length === 0 ? [] : await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, otherIds));
    const nameById = new Map(names.map((row) => [row.id, row.name]));

    return rows.map((row) => ({
      ...toCandidate(row),
      counterpartName: nameById.get(row.userA === userId ? row.userB : row.userA),
    }));
  }

  /**
   * Turn a candidate into an opportunity and hand back its id.
   *
   * RETURNS, NEVER THROWS. This runs below the kickoff round bump, where the
   * turn has already written a principal-visible strategy message and opened
   * a round — a throw here would be retried into a second of each. The caller
   * compensates on `failed`.
   *
   * The advisory lock is on the PAIR, not the candidate. Both principals'
   * agents wake on the same candidate and can reach this at the same moment;
   * the second one through must find the first one's row rather than write a
   * second opportunity between the same two people.
   */
  async createAndOpen(candidateId: string): Promise<CreateAndOpenResult> {
    try {
      return await db.transaction(async (tx) => {
        const [candidate] = await tx.select().from(discoveryMatchCandidates)
          .where(eq(discoveryMatchCandidates.id, candidateId)).limit(1);
        if (!candidate) return { status: 'failed', reason: 'candidate_not_found' } as const;

        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`opportunity-pair:${candidate.pairKey}`}, 0)
          )
        `);

        // Re-read under the lock: the other side may have opened this pair
        // between the read above and the lock being granted.
        const [locked] = await tx.select().from(discoveryMatchCandidates)
          .where(eq(discoveryMatchCandidates.id, candidateId)).limit(1);
        if (locked?.status === 'opened') {
          return locked.openedOpportunityId
            ? { status: 'existing', opportunityId: locked.openedOpportunityId } as const
            : { status: 'raced', reason: 'pair_opened_without_row' } as const;
        }

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
        if (!present.has(candidate.userA) || !present.has(candidate.userB)) {
          return { status: 'failed', reason: 'participant_left_network' } as const;
        }

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
        if (!row) return { status: 'failed', reason: 'insert_returned_no_row' } as const;

        await tx.update(discoveryMatchCandidates)
          .set({ status: 'opened', openedOpportunityId: row.id, updatedAt: new Date() })
          .where(eq(discoveryMatchCandidates.id, candidateId));

        return { status: 'created', opportunityId: row.id } as const;
      });
    } catch (error) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

export const discoveryCandidateAdapter = new DiscoveryCandidateDatabaseAdapter();
