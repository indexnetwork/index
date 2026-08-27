/**
 * The candidates discovery writes instead of opportunities.
 *
 * A candidate is a pair, keyed by `pairKey` and unique on it. That uniqueness
 * is the whole dedup story: two discovery runs over the same two intents
 * converge on one row, so nothing downstream has to reconcile duplicates.
 */
import { and, asc, db, discoveryMatchCandidates, eq, inArray, or, sql, users } from './database.shared';

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
  evidence: unknown[];
}

function toCandidate(row: CandidateRow) {
  return { ...row, score: Number(row.score), evidence: (row.evidence ?? []) as unknown[] };
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
}

export const discoveryCandidateAdapter = new DiscoveryCandidateDatabaseAdapter();
