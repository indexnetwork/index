/**
 * Discovery pipeline, final stage: matches_ready.
 *
 * Discovery no longer opens negotiations, and no longer creates opportunities.
 * It records candidates and emits ONE `matches_ready` event per SEAT that got
 * one; that seat's PersonalAgent decides whether to reach out at all, writes
 * the strategy into the DM, derives a brief per match and kicks them off
 * itself (docs/plans/2026-08-23-personal-agent-and-negotiation-graphs.md,
 * "IS-A decides to kick off negotiations; they are not automatically kicked
 * off").
 *
 * BOTH sides of every pair are woken, not just the user whose discovery run
 * found it. A candidate is one row shared by two signals, and each principal's
 * agent decides for itself. That is also why `createAndOpen` locks on the
 * pair: two agents can now reach the same candidate at once.
 *
 * One event per signal, not per candidate: kickoff is a batch, and a
 * per-candidate event would give the agent one round of one negotiation each
 * time — reflect would then fire at the very first pause.
 */

import { matchesReadyLog, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

export async function matchesReadyNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  if (!deps.matchesReady) return {};
  const candidates = state.candidatesEmitted ?? [];
  if (candidates.length === 0) return {};

  // Keyed by intent: a seat woken twice in one batch is one wake.
  const seats = new Map<string, { userId: string; intentId: string }>();
  for (const candidate of candidates) {
    seats.set(candidate.intentA, { userId: candidate.userA, intentId: candidate.intentA });
    seats.set(candidate.intentB, { userId: candidate.userB, intentId: candidate.intentB });
  }

  // A swallowed failure here is a batch that recorded and an agent that was
  // never woken — discovery reporting success for the one thing it exists to
  // hand off. Let it fail so the discovery job retries: the candidate upsert
  // is idempotent on the pair key, and the wake coalesces on the signal.
  matchesReadyLog.info('Emitting matches_ready', {
    seats: seats.size,
    candidates: candidates.length,
  });
  const emitted = await Promise.allSettled(
    [...seats.values()].map((seat) => deps.matchesReady!(seat)),
  );
  const failed = emitted.filter((result) => result.status === 'rejected');
  if (failed.length > 0) {
    matchesReadyLog.error('Failed to emit matches_ready', {
      seats: seats.size,
      failed: failed.length,
      error: (failed[0] as PromiseRejectedResult).reason,
    });
    throw new Error(`Could not wake ${failed.length} of ${seats.size} signal(s) for their new matches`);
  }

  return {
    trace: [{
      node: 'matches_ready',
      detail: `${seats.size} signal(s) notified for ${candidates.length} candidate(s)`,
      data: { candidateCount: candidates.length, seats: seats.size },
    }],
  };
}
