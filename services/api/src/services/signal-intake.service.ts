/**
 * Deterministic signal-intake host service.
 *
 * Owns cold-start pack generation, speculative synthesis, and proposal
 * persistence. Speculation is durable: it creates the real `intent_proposals`
 * row early, so a proposal produced while the user picks a community is
 * indistinguishable from one produced on demand.
 */

import crypto from 'crypto';

import { Intents, type IntakeAnswer, type IntakePackQuestion, type IntakeRound } from '@indexnetwork/protocol';

import { chatDatabaseAdapter, intentDatabaseAdapter } from '../adapters/database.adapter';
import { signalIntakePackAdapter } from '../adapters/signal-intake-pack.database.adapter';
import { computeAnswersHash, signalIntakeRunAdapter, SIGNAL_INTAKE_RUN_TTL_MS } from '../adapters/signal-intake-run.database.adapter';
import { intentProposalDatabaseAdapter } from '../adapters/intent-proposal.database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { intentQueue } from '../queues/intent.queue';
import { getSignalIntakeConfig } from '../lib/fast-intake-feature';
import { log } from '../lib/log';

const logger = log.service.from('signal-intake');

/** Proposal as the intake surfaces render it. */
export interface IntakeProposal {
  proposalId: string;
  description: string;
  lookingFor: string;
  youBring: string;
}

/** Raised when synthesis produced nothing specific enough to persist. */
export class IntakeVerificationRejectedError extends Error {
  /**
   * @param clarification - Question to ask the user before retrying
   */
  constructor(readonly clarification: IntakePackQuestion) {
    super('verification_rejected');
    this.name = 'IntakeVerificationRejectedError';
  }
}

/** Raised when a run does not exist for this owner. */
export class IntakeRunNotFoundError extends Error {
  constructor() {
    super('run_not_found');
    this.name = 'IntakeRunNotFoundError';
  }
}

/** Raised when the picked community is not one the user belongs to. */
export class IntakeNetworkMembershipError extends Error {
  /**
   * @param networkId - Community the client asked for
   */
  constructor(readonly networkId: string) {
    super('network_membership_required');
    this.name = 'IntakeNetworkMembershipError';
  }
}

/** Injection surface; production values default to the real adapters. */
export interface SignalIntakeServiceDeps {
  packStore: typeof signalIntakePackAdapter;
  runStore: typeof signalIntakeRunAdapter;
  proposalStore: Pick<
    typeof intentProposalDatabaseAdapter,
    'createProposals' | 'getProposalForOwner' | 'setProposalNetwork'
  >;
  /** Server-side authority for the client-supplied `networkId`. */
  isNetworkMember: (networkId: string, userId: string) => Promise<boolean>;
  /** The intents module: intake pack, follow-up planning, and synthesis. */
  intents: Pick<Intents, 'generateIntakePack' | 'generateIntakeFollowUps' | 'synthesizeIntake'>;
  /** Intake knobs; production reads the env accessors, tests inject fixed values. */
  intakeConfig?: () => { maxQuestions: number };
  getPremises: (userId: string) => Promise<Array<{ text: string }>>;
  getNetworkTitles: (userId: string) => Promise<string[]>;
  getGlobalContext: (userId: string) => Promise<string | null>;
  /**
   * Verify-only intent-graph invocation. Deliberately profile-blind: the
   * propose path verifies exactly what the person answered.
   */
  invokeIntentGraph: (input: {
    userId: string;
    inputContent: string;
  }) => Promise<{ verifiedIntents?: Array<Record<string, unknown>> }>;
  now?: () => Date;
}

/** Poll cadence and ceiling while awaiting a speculative run. */
const POLL_INTERVAL_MS = 250;
const POLL_CEILING_MS = 20_000;

/** Clarification shown when verification rejects the synthesized signal. */
const CLARIFICATION_QUESTION: IntakePackQuestion = {
  title: 'One more detail',
  prompt: 'That was a little broad to match on. What would make it concrete?',
  options: [
    { label: 'A specific role or skill', description: 'Name what they actually do' },
    { label: 'A specific outcome', description: 'What should happen if this works' },
    { label: 'A timeframe', description: 'When you need this to happen' },
    { label: 'A domain or industry', description: 'Where they should come from' },
  ],
  multiSelect: true,
};

/** Drives the deterministic intake funnel. */
export class SignalIntakeService {
  private readonly deps: SignalIntakeServiceDeps;

  /**
   * @param deps - Injected collaborators; tests pass fakes.
   */
  constructor(deps: SignalIntakeServiceDeps) {
    this.deps = deps;
  }

  private get now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * Read the user's pack, generating it synchronously on a cold miss.
   *
   * @param userId - Owner
   * @returns Brief, round-1 question, and whether the pack was already warm
   */
  async getOrCreatePack(userId: string): Promise<{ brief: string; question: IntakePackQuestion; packHit: boolean }> {
    const started = Date.now();
    const stored = await this.deps.packStore.getPack(userId);
    if (stored) {
      logger.info('signal_intake_stage', {
        stage: 'start', durationMs: Date.now() - started,
        packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
      });
      return { brief: stored.brief, question: stored.question, packHit: true };
    }

    try {
      const [premises, networkTitles, globalContext] = await Promise.all([
        this.deps.getPremises(userId),
        this.deps.getNetworkTitles(userId),
        this.deps.getGlobalContext(userId),
      ]);
      const pack = await this.deps.intents.generateIntakePack({ premises, networkTitles, globalContext });
      // premiseHash is owned by the background job; a cold-start write stores an
      // empty key so the next regen always refreshes rather than short-circuiting.
      await this.deps.packStore.upsertPack({
        userId, brief: pack.brief, question: pack.question, premiseHash: '',
      });
      logger.info('signal_intake_stage', {
        stage: 'start', durationMs: Date.now() - started,
        packHit: false, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
      });
      return { brief: pack.brief, question: pack.question, packHit: false };
    } catch (error) {
      logger.error('Intake pack generation failed', { userId, error });
      logger.info('signal_intake_stage', {
        stage: 'start', durationMs: Date.now() - started,
        packHit: false, speculationHit: false, whereTextUsed: false, fallbackUsed: true,
      });
      return { brief: '', question: Intents.FALLBACK_INTAKE_QUESTION, packHit: false };
    }
  }

  /**
   * Plan and serve the next follow-up question batch.
   *
   * The total interview length is fixed by the first call's plan (or the
   * budget when the plan is smaller) and locked: continuation calls echo the
   * client-carried `plannedTotal`, clamped to the configured budget. Singular
   * mode serves one question per call; plural mode serves the remaining
   * batch in one call.
   *
   * @param userId - Owner
   * @param input - Answered rounds (round 1 first) and the locked total when continuing
   * @returns The next question batch (empty when the budget is spent) and the locked total
   */
  async followUpQuestions(
    userId: string,
    input: { rounds: IntakeRound[]; plannedTotal?: number },
  ): Promise<{ questions: IntakePackQuestion[]; total: number }> {
    const started = Date.now();
    const { maxQuestions } = this.deps.intakeConfig?.() ?? getSignalIntakeConfig();
    const { brief, question: round1 } = await this.getOrCreatePack(userId);
    const remaining = Math.max(0, maxQuestions - input.rounds.length);
    if (remaining === 0) {
      logger.info('signal_intake_stage', {
        stage: 'question', durationMs: Date.now() - started,
        packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
      });
      return { questions: [], total: input.rounds.length };
    }

    const lockedTotal = input.plannedTotal !== undefined
      ? Math.min(Math.max(Math.trunc(input.plannedTotal), 1), maxQuestions)
      : undefined;
    const budget = lockedTotal === undefined ? remaining : 1;
    const plan = await this.deps.intents.generateIntakeFollowUps({
      brief,
      rounds: input.rounds,
      maxFollowUps: budget,
      ...(lockedTotal !== undefined
        ? { plannedFollowUpCount: Math.max(0, lockedTotal - input.rounds.length) }
        : {}),
    });

    const questions = plan.questions.slice(0, 1);
    const total = lockedTotal
      ?? input.rounds.length + Math.min(Math.max(plan.plannedFollowUpCount, questions.length), remaining);

    logger.info('signal_intake_stage', {
      stage: 'question', durationMs: Date.now() - started,
      packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
    });
    return { questions, total };
  }

  /**
   * Claim a run and start speculative synthesis without awaiting it.
   *
   * @param userId - Owner
   * @param input - Every answered round, in order (round 1 first)
   * @returns The run handle the client polls with
   */
  async prepare(
    userId: string,
    input: { rounds: IntakeRound[] },
  ): Promise<{ runId: string }> {
    const started = Date.now();
    await this.deps.runStore.sweepStaleRuns(userId, new Date(this.now.getTime() - SIGNAL_INTAKE_RUN_TTL_MS));
    const answersHash = computeAnswersHash({ rounds: input.rounds });
    const { run, claimed } = await this.deps.runStore.claimRun(userId, answersHash);

    // The hash keys only on the answers, and each round offers a handful of
    // canned options, so a user creating a second signal within the run TTL can
    // legitimately collide with their first. Reusing that run would replay a
    // proposal that was already confirmed (or rejected, or expired) and hand the
    // user back their existing intent, so reopen it and speculate again.
    const stale = !claimed && !(await this.isRunReusable(userId, run));
    if (stale) await this.deps.runStore.resetRun(run.id);

    if (claimed || stale) {
      // Deliberately not awaited: this is the speculation that overlaps the
      // user's community pick. Failures are recorded on the run, never thrown.
      void this.runSynthesis(userId, run.id, { rounds: input.rounds }).catch(() => undefined);
    }

    logger.info('signal_intake_stage', {
      stage: 'prepare', durationMs: Date.now() - started,
      packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
    });
    return { runId: run.id };
  }

  /**
   * Resolve the proposal for a run, awaiting or redoing synthesis as needed.
   *
   * @param userId - Owner
   * @param input - Run handle, answered rounds, and the optional free-text where constraint
   * @returns The proposal to render on the confirmation card
   */
  async resolveProposal(
    userId: string,
    input: {
      runId: string;
      rounds: IntakeRound[];
      whereText?: string;
      networkId?: string;
    },
  ): Promise<IntakeProposal> {
    const started = Date.now();
    const run = await this.deps.runStore.getRunForOwner(input.runId, userId);
    if (!run) throw new IntakeRunNotFoundError();

    // The picked community must land on the proposal row: `createFromProposal`
    // refuses any confirmation whose `networkId` differs from the stored one.
    // The client's value is never trusted — membership is checked here, and
    // again in SQL by `setProposalNetwork`.
    const networkId = await this.authorizeNetwork(userId, input.networkId);
    const whereTextUsed = Boolean(input.whereText?.trim());

    // A where-constraint invalidates the speculative description, and a failed
    // speculation has nothing to hand back — both synthesize serially here.
    if (whereTextUsed || run.status === 'failed') {
      const proposal = await this.runSynthesis(userId, run.id, {
        rounds: input.rounds,
        ...(input.whereText?.trim() ? { whereText: input.whereText.trim() } : {}),
      }, networkId);
      logger.info('signal_intake_stage', {
        stage: 'proposal', durationMs: Date.now() - started,
        packHit: true, speculationHit: false, whereTextUsed, fallbackUsed: run.status === 'failed',
      });
      return proposal;
    }

    const ready = run.status === 'ready' ? run : await this.awaitRun(userId, run.id);
    const speculative = ready?.status === 'ready' && ready.proposalId
      ? await this.claimSpeculativeProposal(userId, ready.proposalId, ready, networkId)
      : null;
    if (speculative) {
      logger.info('signal_intake_stage', {
        stage: 'proposal', durationMs: Date.now() - started,
        packHit: true, speculationHit: run.status === 'ready', whereTextUsed: false, fallbackUsed: false,
      });
      return speculative;
    }

    const proposal = await this.runSynthesis(userId, run.id, { rounds: input.rounds }, networkId);
    logger.info('signal_intake_stage', {
      stage: 'proposal', durationMs: Date.now() - started,
      packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: true,
    });
    return proposal;
  }

  /**
   * Replace a run's proposal from user feedback on the visible draft.
   *
   * @param userId - Owner
   * @param input - Run handle, feedback text, and the answered rounds
   * @returns The replacement proposal
   */
  async revise(
    userId: string,
    input: {
      runId: string;
      feedback: string;
      rounds: IntakeRound[];
      networkId?: string;
    },
  ): Promise<IntakeProposal> {
    const started = Date.now();
    const run = await this.deps.runStore.getRunForOwner(input.runId, userId);
    if (!run) throw new IntakeRunNotFoundError();

    // Revise replaces the proposal row, so the already-picked community has to
    // be re-attached to the replacement or confirm would reject it.
    const networkId = await this.authorizeNetwork(userId, input.networkId);
    // Feedback is a correction to the whole draft, not a place constraint: it
    // travels in its own synthesis slot.
    const proposal = await this.runSynthesis(userId, run.id, {
      rounds: input.rounds,
      feedback: input.feedback,
    }, networkId);
    logger.info('signal_intake_stage', {
      stage: 'revise', durationMs: Date.now() - started,
      packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
    });
    return proposal;
  }

  /**
   * Synthesize, verify, persist a proposal, and settle the run.
   *
   * @param userId - Owner
   * @param runId - Run to settle
   * @param answers - Answered rounds plus any where constraint or feedback
   * @returns The persisted proposal
   * @throws IntakeVerificationRejectedError when nothing verified
   */
  private async runSynthesis(
    userId: string,
    runId: string,
    answers: { rounds: IntakeRound[]; whereText?: string; feedback?: string },
    networkId?: string,
  ): Promise<IntakeProposal> {
    try {
      // Synthesis and verification both run on the answers alone. The pack
      // brief sources the questions upstream; it never reaches the signal.
      const synthesis = await this.deps.intents.synthesizeIntake(answers);

      const graphResult = await this.deps.invokeIntentGraph({
        userId,
        inputContent: synthesis.description,
      });

      const verified = graphResult.verifiedIntents ?? [];
      if (verified.length === 0) {
        await this.deps.runStore.markFailed(runId, 'verification_rejected');
        throw new IntakeVerificationRejectedError(CLARIFICATION_QUESTION);
      }

      const first = verified[0] as {
        description: string;
        score?: number | null;
        verification?: unknown;
      };
      if (!first.verification) {
        await this.deps.runStore.markFailed(runId, 'missing_verifier_analysis');
        throw new IntakeVerificationRejectedError(CLARIFICATION_QUESTION);
      }

      const proposalId = crypto.randomUUID();
      const description = Intents.normalizeDescription(first.description);
      await this.deps.proposalStore.createProposals([{
        proposalId,
        userId,
        description,
        ...(networkId ? { networkId } : {}),
        analysis: { verifierOutput: first.verification, combinedScore: first.score ?? null },
      }]);
      await this.deps.runStore.markReady(runId, proposalId, {
        lookingFor: synthesis.lookingFor,
        youBring: synthesis.youBring,
      });

      return {
        proposalId,
        description,
        lookingFor: synthesis.lookingFor,
        youBring: synthesis.youBring,
      };
    } catch (error) {
      if (error instanceof IntakeVerificationRejectedError) throw error;
      await this.deps.runStore.markFailed(runId, error instanceof Error ? error.message : 'synthesis_failed');
      throw error;
    }
  }

  /**
   * Verify a client-supplied community server-side.
   *
   * @param userId - Owner
   * @param networkId - Community the client claims the user picked
   * @returns The community when the user is a member, undefined when none was sent
   * @throws IntakeNetworkMembershipError when the user is not a member
   */
  private async authorizeNetwork(userId: string, networkId?: string): Promise<string | undefined> {
    if (!networkId) return undefined;
    if (!await this.deps.isNetworkMember(networkId, userId)) {
      throw new IntakeNetworkMembershipError(networkId);
    }
    return networkId;
  }

  /**
   * Hand back a speculative proposal, attaching the picked community to it.
   *
   * @param userId - Owner
   * @param proposalId - Proposal the run settled on
   * @param run - The settled run, carrying the synthesized card summaries
   * @param networkId - Already-authorized community, when one was picked
   * @returns The proposal, or null when the row cannot be reused and the caller
   * must synthesize a fresh one
   */
  private async claimSpeculativeProposal(
    userId: string,
    proposalId: string,
    run: { lookingFor: string | null; youBring: string | null },
    networkId?: string,
  ): Promise<IntakeProposal | null> {
    const stored = await this.deps.proposalStore.getProposalForOwner(proposalId, userId);
    if (!stored || !this.isProposalUsable(stored)) return null;

    if (networkId && stored.networkId !== networkId) {
      // Loses only to a concurrent confirm/reject; re-synthesizing is the right
      // answer there, since a consumed proposal must never be handed back.
      const attached = await this.deps.proposalStore.setProposalNetwork(proposalId, userId, networkId);
      if (!attached) return null;
    }

    return {
      proposalId,
      description: stored.description ?? '',
      // Persisted by the speculative synthesis so the expected (hit) path shows
      // the model's copy rather than the raw option labels the user clicked.
      lookingFor: run.lookingFor ?? '',
      youBring: run.youBring ?? '',
    };
  }

  /** Whether an existing run's proposal can still be confirmed by its owner. */
  private async isRunReusable(
    userId: string,
    run: { status: string; proposalId: string | null },
  ): Promise<boolean> {
    if (run.status !== 'ready') return true;
    if (!run.proposalId) return false;
    const stored = await this.deps.proposalStore.getProposalForOwner(run.proposalId, userId);
    if (!stored) return false;
    return this.isProposalUsable(stored);
  }

  /** A proposal is usable while it is still pending and unexpired. */
  private isProposalUsable(proposal: { status: string; expiresAt: Date }): boolean {
    return proposal.status === 'pending' && proposal.expiresAt.getTime() > this.now.getTime();
  }

  /** Poll a pending run until it settles or the ceiling elapses. */
  private async awaitRun(userId: string, runId: string) {
    const deadline = Date.now() + POLL_CEILING_MS;
    while (Date.now() < deadline) {
      const run = await this.deps.runStore.getRunForOwner(runId, userId);
      if (run && run.status !== 'pending') return run;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return null;
  }

}

// -----------------------------------------------------------------------------
// Production wiring
// -----------------------------------------------------------------------------

/** Compiled once and reused: the intent graph always runs with `dryRun: true`
 * here, so no DB writes happen from this leg of the funnel. */
const productionIntents = new Intents({
  database: intentDatabaseAdapter,
  embedder: new EmbedderAdapter(),
  queue: intentQueue,
});
const compiledIntentGraph = productionIntents.createGraph();

/** Verify-only invocation of the intent graph. The profile-graph leg is skipped
 * and nothing is supplied in its place: an intent derives only from the person's
 * answers, so inference and verification see the synthesized signal alone. */
async function invokeIntentGraphProduction(input: {
  userId: string;
  inputContent: string;
}): Promise<{ verifiedIntents?: Array<Record<string, unknown>> }> {
  const result = await compiledIntentGraph.invoke(
    { ...input, userProfile: '', dryRun: true },
    { recursionLimit: 100 },
  );
  return result as { verifiedIntents?: Array<Record<string, unknown>> };
}

/** The user's active premises, narrowed to the fields the pack generator needs. */
async function getPremisesProduction(userId: string): Promise<Array<{ text: string }>> {
  const premises = await chatDatabaseAdapter.getPremisesForUser(userId, 'ACTIVE');
  return premises.map((p) => ({ text: p.assertion.text })).filter((p) => p.text.length > 0);
}

/** Titles of every network the user belongs to. */
async function getNetworkTitlesProduction(userId: string): Promise<string[]> {
  const networkIds = await chatDatabaseAdapter.getUserIndexIds(userId);
  const networks = await Promise.all(networkIds.map((id) => chatDatabaseAdapter.getNetwork(id)));
  return networks.filter((network): network is NonNullable<typeof network> => Boolean(network)).map((network) => network.title);
}

/** The user's global (network-agnostic) context paragraph, if generated. */
async function getGlobalContextProduction(userId: string): Promise<string | null> {
  const context = await chatDatabaseAdapter.getUserContext(userId, null);
  return context?.text ?? null;
}

/** Production singleton wired to the real adapters, compiled intent graph, and
 * context readers. Task 7's controller consumes this directly. */
export const signalIntakeService = new SignalIntakeService({
  packStore: signalIntakePackAdapter,
  runStore: signalIntakeRunAdapter,
  proposalStore: intentProposalDatabaseAdapter,
  isNetworkMember: (networkId, userId) => intentDatabaseAdapter.isNetworkMember(networkId, userId),
  intents: productionIntents,
  getPremises: getPremisesProduction,
  getNetworkTitles: getNetworkTitlesProduction,
  getGlobalContext: getGlobalContextProduction,
  invokeIntentGraph: invokeIntentGraphProduction,
  intakeConfig: getSignalIntakeConfig,
});
