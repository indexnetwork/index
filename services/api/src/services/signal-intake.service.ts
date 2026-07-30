/**
 * Deterministic signal-intake host service.
 *
 * Owns cold-start pack generation, speculative synthesis, and proposal
 * persistence. Speculation is durable: it creates the real `intent_proposals`
 * row early, so a proposal produced while the user picks a community is
 * indistinguishable from one produced on demand.
 */

import crypto from 'crypto';

import { FALLBACK_WHO_QUESTION, normalizeIntentDescription, IntentGraphFactory, SignalIntakeOrchestrator, SignalIntakePackGenerator, type IntakeAnswer, type IntakePackQuestion } from '@indexnetwork/protocol';

import { chatDatabaseAdapter, intentDatabaseAdapter } from '../adapters/database.adapter';
import { signalIntakePackAdapter } from '../adapters/signal-intake-pack.database.adapter';
import { computeAnswersHash, signalIntakeRunAdapter, SIGNAL_INTAKE_RUN_TTL_MS } from '../adapters/signal-intake-run.database.adapter';
import { intentProposalDatabaseAdapter } from '../adapters/intent-proposal.database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { intentQueue } from '../queues/intent.queue';
import { questionerEnqueueIfEnabled } from '../queues/questioner.queue';
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

/** Injection surface; production values default to the real adapters. */
export interface SignalIntakeServiceDeps {
  packStore: typeof signalIntakePackAdapter;
  runStore: typeof signalIntakeRunAdapter;
  proposalStore: Pick<typeof intentProposalDatabaseAdapter, 'createProposals' | 'getProposalForOwner'>;
  orchestrator: Pick<SignalIntakeOrchestrator, 'nextQuestion' | 'synthesize'>;
  packGenerator: Pick<SignalIntakePackGenerator, 'generate'>;
  getPremises: (userId: string) => Promise<Array<{ text: string }>>;
  getNetworkTitles: (userId: string) => Promise<string[]>;
  getGlobalContext: (userId: string) => Promise<string | null>;
  invokeIntentGraph: (input: {
    userId: string;
    userProfile: string;
    inputContent: string;
  }) => Promise<{ verifiedIntents?: Array<Record<string, unknown>> }>;
  recordAnsweredQuestion?: (input: {
    userId: string;
    prompt: string;
    answer: IntakeAnswer;
    stage: 'who' | 'bring';
  }) => Promise<void>;
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
      const pack = await this.deps.packGenerator.generate({ premises, networkTitles, globalContext });
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
      return { brief: '', question: FALLBACK_WHO_QUESTION, packHit: false };
    }
  }

  /**
   * Generate round 2 from the round-1 answer.
   *
   * @param userId - Owner
   * @param whoAnswer - Answer to round 1
   * @returns The round-2 question
   */
  async nextQuestion(userId: string, whoAnswer: IntakeAnswer): Promise<IntakePackQuestion> {
    const started = Date.now();
    const { brief, question: round1 } = await this.getOrCreatePack(userId);
    this.record({ userId, prompt: round1.prompt, answer: whoAnswer, stage: 'who' });
    const question = await this.deps.orchestrator.nextQuestion({ brief, whoAnswer });
    logger.info('signal_intake_stage', {
      stage: 'question', durationMs: Date.now() - started,
      packHit: true, speculationHit: false, whereTextUsed: false, fallbackUsed: false,
    });
    return question;
  }

  /**
   * Claim a run and start speculative synthesis without awaiting it.
   *
   * @param userId - Owner
   * @param answers - Both answered rounds
   * @returns The run handle the client polls with
   */
  async prepare(
    userId: string,
    answers: { whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer; round2Prompt?: string },
  ): Promise<{ runId: string }> {
    const started = Date.now();
    await this.deps.runStore.sweepStaleRuns(userId, new Date(this.now.getTime() - SIGNAL_INTAKE_RUN_TTL_MS));
    this.record({
      userId, prompt: answers.round2Prompt ?? '', answer: answers.bringAnswer, stage: 'bring',
    });

    const answersHash = computeAnswersHash({
      whoAnswer: answers.whoAnswer, bringAnswer: answers.bringAnswer,
    });
    const { run, claimed } = await this.deps.runStore.claimRun(userId, answersHash);

    if (claimed) {
      // Deliberately not awaited: this is the speculation that overlaps the
      // user's community pick. Failures are recorded on the run, never thrown.
      void this.runSynthesis(userId, run.id, answers).catch(() => undefined);
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
   * @param input - Run handle, both answers, and the optional free-text where constraint
   * @returns The proposal to render on the confirmation card
   */
  async resolveProposal(
    userId: string,
    input: { runId: string; whereText?: string; answers: { whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer } },
  ): Promise<IntakeProposal> {
    const started = Date.now();
    const run = await this.deps.runStore.getRunForOwner(input.runId, userId);
    if (!run) throw new IntakeRunNotFoundError();

    const whereTextUsed = Boolean(input.whereText?.trim());

    // A where-constraint invalidates the speculative description, and a failed
    // speculation has nothing to hand back — both synthesize serially here.
    if (whereTextUsed || run.status === 'failed') {
      const proposal = await this.runSynthesis(userId, run.id, {
        ...input.answers,
        ...(input.whereText?.trim() ? { whereText: input.whereText.trim() } : {}),
      });
      logger.info('signal_intake_stage', {
        stage: 'proposal', durationMs: Date.now() - started,
        packHit: true, speculationHit: false, whereTextUsed, fallbackUsed: run.status === 'failed',
      });
      return proposal;
    }

    const ready = run.status === 'ready' ? run : await this.awaitRun(userId, run.id);
    if (ready?.status === 'ready' && ready.proposalId) {
      const stored = await this.deps.proposalStore.getProposalForOwner(ready.proposalId, userId);
      logger.info('signal_intake_stage', {
        stage: 'proposal', durationMs: Date.now() - started,
        packHit: true, speculationHit: run.status === 'ready', whereTextUsed: false, fallbackUsed: false,
      });
      return {
        proposalId: ready.proposalId,
        description: stored?.description ?? '',
        lookingFor: '',
        youBring: '',
      };
    }

    const proposal = await this.runSynthesis(userId, run.id, input.answers);
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
   * @param input - Run handle, feedback text, and the original answers
   * @returns The replacement proposal
   */
  async revise(
    userId: string,
    input: {
      runId: string;
      feedback: string;
      answers: { whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer };
    },
  ): Promise<IntakeProposal> {
    const started = Date.now();
    const run = await this.deps.runStore.getRunForOwner(input.runId, userId);
    if (!run) throw new IntakeRunNotFoundError();

    const proposal = await this.runSynthesis(userId, run.id, {
      ...input.answers,
      whereText: input.feedback,
    });
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
   * @param answers - Answers plus any where constraint
   * @returns The persisted proposal
   * @throws IntakeVerificationRejectedError when nothing verified
   */
  private async runSynthesis(
    userId: string,
    runId: string,
    answers: { whoAnswer: IntakeAnswer; bringAnswer: IntakeAnswer; whereText?: string },
  ): Promise<IntakeProposal> {
    try {
      const { brief } = await this.getOrCreatePack(userId);
      const synthesis = await this.deps.orchestrator.synthesize({ brief, ...answers });

      // The brief stands in for the profile graph here: it is already a
      // distilled identity paragraph, so `propose` skips that leg entirely.
      const graphResult = await this.deps.invokeIntentGraph({
        userId,
        userProfile: brief,
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
      const description = normalizeIntentDescription(first.description);
      await this.deps.proposalStore.createProposals([{
        proposalId,
        userId,
        description,
        analysis: { verifierOutput: first.verification, combinedScore: first.score ?? null },
      }]);
      await this.deps.runStore.markReady(runId, proposalId);

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

  /** Fire-and-forget analytics mirror; never blocks or fails a request. */
  private record(input: { userId: string; prompt: string; answer: IntakeAnswer; stage: 'who' | 'bring' }): void {
    void this.deps.recordAnsweredQuestion?.(input).catch(() => undefined);
  }
}

// -----------------------------------------------------------------------------
// Production wiring
// -----------------------------------------------------------------------------

/** Compiled once and reused: the intent graph always runs in verification-only
 * `propose` mode here, so no DB writes happen from this leg of the funnel. */
const intentGraphFactory = new IntentGraphFactory(
  intentDatabaseAdapter,
  new EmbedderAdapter(),
  intentQueue,
  questionerEnqueueIfEnabled(),
);
const compiledIntentGraph = intentGraphFactory.createGraph();

/** Verify-only invocation of the intent graph, skipping the profile-graph leg
 * by supplying the precomputed pack brief as `userProfile` directly. */
async function invokeIntentGraphProduction(input: {
  userId: string;
  userProfile: string;
  inputContent: string;
}): Promise<{ verifiedIntents?: Array<Record<string, unknown>> }> {
  const result = await compiledIntentGraph.invoke(
    { ...input, operationMode: 'propose' as const },
    { recursionLimit: 100 },
  );
  return result as { verifiedIntents?: Array<Record<string, unknown>> };
}

/** The user's active premises, narrowed to the fields the pack generator needs. */
async function getPremisesProduction(userId: string): Promise<Array<{ text: string }>> {
  const premises = await chatDatabaseAdapter.getPremisesForUser(userId, 'ACTIVE');
  return premises.map((p) => ({ text: p.assertion.text })).filter((p) => p.text.length > 0);
}

/** Titles of every non-personal network the user belongs to. */
async function getNetworkTitlesProduction(userId: string): Promise<string[]> {
  const networkIds = await chatDatabaseAdapter.getNonPersonalNetworkIds(userId);
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
  orchestrator: new SignalIntakeOrchestrator(),
  packGenerator: new SignalIntakePackGenerator(),
  getPremises: getPremisesProduction,
  getNetworkTitles: getNetworkTitlesProduction,
  getGlobalContext: getGlobalContextProduction,
  invokeIntentGraph: invokeIntentGraphProduction,
});
