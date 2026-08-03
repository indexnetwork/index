import crypto from 'crypto';

import { and, eq, lt } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { signalIntakeRuns } from '../schemas/database.schema';

// Adapters must not import from @indexnetwork/protocol (see eslint boundary rule);
// this mirrors the shape of protocol's `IntakeAnswer` structurally, verified
// at the composition root via TypeScript duck typing.
/** One answered intake round, structurally aligned with protocol's `IntakeAnswer`. */
export interface IntakeAnswer {
  selectedOptions: string[];
  freeText?: string;
}

/** One answered intake round in order, structurally aligned with protocol's `IntakeRound`. */
export interface IntakeRound {
  prompt: string;
  answer: IntakeAnswer;
}

/** One speculative or on-demand synthesis run. */
export interface SignalIntakeRunRecord {
  id: string;
  userId: string;
  answersHash: string;
  status: 'pending' | 'ready' | 'failed';
  proposalId: string | null;
  /** Card summary from the synthesis that settled this run, when it succeeded. */
  lookingFor: string | null;
  /** Card summary from the synthesis that settled this run, when it succeeded. */
  youBring: string | null;
  error: string | null;
  createdAt: Date;
}

/**
 * Stable hash of the full answered round list plus the optional where
 * constraint. Order matters across rounds (round 1 first); option order
 * within one round does not.
 *
 * @param input - Ordered answered rounds plus the optional where constraint
 * @returns A 16-char hex digest, stable across option ordering
 */
export function computeAnswersHash(input: {
  rounds: IntakeRound[];
  whereText?: string;
}): string {
  const part = (answer: IntakeAnswer) =>
    [...answer.selectedOptions].sort().join('|') + '::' + (answer.freeText?.trim() ?? '');
  const payload = [
    ...input.rounds.map((round) => part(round.answer)),
    input.whereText?.trim() ?? '',
  ].join('###');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/** Durable single-flight storage for intake synthesis runs. */
export class SignalIntakeRunDatabaseAdapter {
  /**
   * Claim a run for this answer set, or return the existing one.
   *
   * @param userId - Owner
   * @param answersHash - Key from {@link computeAnswersHash}
   * @returns The run and whether this caller created it (and must do the work)
   */
  async claimRun(userId: string, answersHash: string): Promise<{ run: SignalIntakeRunRecord; claimed: boolean }> {
    const [inserted] = await db
      .insert(signalIntakeRuns)
      .values({ userId, answersHash, status: 'pending' })
      .onConflictDoNothing({ target: [signalIntakeRuns.userId, signalIntakeRuns.answersHash] })
      .returning();
    if (inserted) return { run: inserted as SignalIntakeRunRecord, claimed: true };

    const [existing] = await db
      .select()
      .from(signalIntakeRuns)
      .where(and(eq(signalIntakeRuns.userId, userId), eq(signalIntakeRuns.answersHash, answersHash)))
      .limit(1);
    return { run: existing as SignalIntakeRunRecord, claimed: false };
  }

  /**
   * Record a completed proposal against the run. Also used by revise.
   *
   * The synthesized card summaries are stored alongside the proposal id so the
   * speculative-hit path can return the copy the model wrote instead of falling
   * back to the raw option labels the user clicked.
   *
   * @param runId - Run to settle
   * @param proposalId - Proposal the synthesis persisted
   * @param summary - Card summaries from that synthesis
   */
  async markReady(
    runId: string,
    proposalId: string,
    summary?: { lookingFor: string; youBring: string },
  ): Promise<void> {
    await db
      .update(signalIntakeRuns)
      .set({
        status: 'ready',
        proposalId,
        error: null,
        lookingFor: summary?.lookingFor ?? null,
        youBring: summary?.youBring ?? null,
      })
      .where(eq(signalIntakeRuns.id, runId));
  }

  /**
   * Return a settled run to `pending` so it can be synthesized again.
   *
   * Used when an answer-hash match resolves to a run whose proposal is no longer
   * usable (already confirmed, rejected, or expired). Replaying that run would
   * hand the user back their previous signal instead of creating a new one.
   *
   * @param runId - Run to reopen
   */
  async resetRun(runId: string): Promise<void> {
    await db
      .update(signalIntakeRuns)
      .set({ status: 'pending', proposalId: null, error: null, lookingFor: null, youBring: null })
      .where(eq(signalIntakeRuns.id, runId));
  }

  /** Record a synthesis failure so the proposal call can retry serially. */
  async markFailed(runId: string, error: string): Promise<void> {
    await db
      .update(signalIntakeRuns)
      .set({ status: 'failed', error: error.slice(0, 500) })
      .where(eq(signalIntakeRuns.id, runId));
  }

  /** Resolve a run without exposing another user's records. */
  async getRunForOwner(runId: string, userId: string): Promise<SignalIntakeRunRecord | null> {
    const [run] = await db
      .select()
      .from(signalIntakeRuns)
      .where(and(eq(signalIntakeRuns.id, runId), eq(signalIntakeRuns.userId, userId)))
      .limit(1);
    return (run as SignalIntakeRunRecord) ?? null;
  }

  /**
   * Delete this user's runs older than the retention window.
   *
   * Called opportunistically from `claimRun` rather than from a dedicated job:
   * abandoned runs are tiny, per-user, and only ever read by their owner, so a
   * sweep at claim time bounds growth without new queue infrastructure.
   *
   * @param userId - Owner whose stale runs are removed
   * @param olderThan - Cutoff timestamp
   */
  async sweepStaleRuns(userId: string, olderThan: Date): Promise<void> {
    await db
      .delete(signalIntakeRuns)
      .where(and(eq(signalIntakeRuns.userId, userId), lt(signalIntakeRuns.createdAt, olderThan)));
  }
}

/** Abandoned-run retention window, matching the proposal TTL. */
export const SIGNAL_INTAKE_RUN_TTL_MS = 24 * 60 * 60 * 1000;

export const signalIntakeRunAdapter = new SignalIntakeRunDatabaseAdapter();
