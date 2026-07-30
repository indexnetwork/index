import { describe, expect, it, mock } from 'bun:test';

import { SignalIntakeService } from '../signal-intake.service';

const question = {
  title: 'Question 1',
  prompt: 'Who do you want to meet?',
  options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
  multiSelect: false,
};

const verifiedIntent = {
  description: 'Looking for a design partner.',
  score: 0.8,
  verification: {
    reasoning: 'clear',
    classification: 'DIRECTIVE',
    felicity_scores: { clarity: 0.9, authority: 0.9, sincerity: 0.9 },
    semantic_entropy: 0.2,
    referential_anchor: 'design partner',
    referential_breadth: 'narrow',
    missing_selectional_constraints: [],
    specificity_warning: null,
    flags: [],
  },
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    packStore: {
      getPack: mock(async () => ({
        userId: 'u1', brief: 'Ada builds tools.', question, premiseHash: 'h', generatedAt: new Date(),
      })),
      upsertPack: mock(async () => undefined),
    },
    runStore: {
      claimRun: mock(async () => ({
        run: { id: 'run-1', userId: 'u1', answersHash: 'h', status: 'pending', proposalId: null, error: null, createdAt: new Date() },
        claimed: true,
      })),
      markReady: mock(async () => undefined),
      markFailed: mock(async () => undefined),
      sweepStaleRuns: mock(async () => undefined),
      getRunForOwner: mock(async () => ({
        id: 'run-1', userId: 'u1', answersHash: 'h', status: 'ready', proposalId: 'prop-1', error: null, createdAt: new Date(),
      })),
    },
    proposalStore: {
      createProposals: mock(async () => undefined),
      getProposalForOwner: mock(async () => ({ id: 'prop-1', description: 'Looking for a design partner.' })),
    },
    orchestrator: {
      nextQuestion: mock(async () => question),
      synthesize: mock(async () => ({ description: 'Looking for a design partner.', lookingFor: 'A design partner', youBring: 'Depth' })),
    },
    packGenerator: { generate: mock(async () => ({ brief: 'generated brief', question })) },
    getPremises: mock(async () => [{ text: 'Ada builds tools.' }]),
    getNetworkTitles: mock(async () => ['Builders']),
    getGlobalContext: mock(async () => 'Ada is a founder.'),
    invokeIntentGraph: mock(async () => ({ verifiedIntents: [verifiedIntent], trace: [] })),
    ...overrides,
  };
}

describe('SignalIntakeService.getOrCreatePack', () => {
  it('reads the stored pack without generating', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    const result = await service.getOrCreatePack('u1');

    expect(result.packHit).toBe(true);
    expect(result.brief).toBe('Ada builds tools.');
    expect(deps.packGenerator.generate).not.toHaveBeenCalled();
  });

  it('generates and persists synchronously on a cold miss', async () => {
    const deps = makeDeps({ packStore: { getPack: mock(async () => null), upsertPack: mock(async () => undefined) } });
    const service = new SignalIntakeService(deps as never);

    const result = await service.getOrCreatePack('u1');

    expect(result.packHit).toBe(false);
    expect(result.brief).toBe('generated brief');
    expect(deps.packStore.upsertPack).toHaveBeenCalledTimes(1);
  });

  it('falls back to the static question when generation fails', async () => {
    const deps = makeDeps({
      packStore: { getPack: mock(async () => null), upsertPack: mock(async () => undefined) },
      packGenerator: { generate: mock(async () => { throw new Error('model down'); }) },
    });
    const service = new SignalIntakeService(deps as never);

    const result = await service.getOrCreatePack('u1');

    expect(result.packHit).toBe(false);
    expect(result.question.options.length).toBeGreaterThanOrEqual(2);
  });
});

describe('SignalIntakeService.resolveProposal', () => {
  const answers = {
    whoAnswer: { selectedOptions: ['A design partner'] },
    bringAnswer: { selectedOptions: ['Engineering depth'] },
  };

  it('returns the speculative proposal without re-synthesizing', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    const result = await service.resolveProposal('u1', { runId: 'run-1', answers });

    expect(result.proposalId).toBe('prop-1');
    expect(deps.orchestrator.synthesize).not.toHaveBeenCalled();
  });

  it('re-synthesizes when whereText is supplied', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    await service.resolveProposal('u1', { runId: 'run-1', whereText: 'Berlin only', answers });

    expect(deps.orchestrator.synthesize).toHaveBeenCalledTimes(1);
    expect(deps.proposalStore.createProposals).toHaveBeenCalledTimes(1);
  });

  it('returns before speculative synthesis settles', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = makeDeps({
      orchestrator: {
        nextQuestion: mock(async () => question),
        synthesize: mock(async () => {
          await gate;
          return { description: 'd', lookingFor: 'l', youBring: 'y' };
        }),
      },
    });
    const service = new SignalIntakeService(deps as never);

    const result = await service.prepare('u1', answers);

    expect(result.runId).toBe('run-1');
    expect(deps.proposalStore.createProposals).not.toHaveBeenCalled();
    release?.();
  });

  it('synthesizes serially when the speculative run failed', async () => {
    const deps = makeDeps({
      runStore: {
        ...makeDeps().runStore,
        getRunForOwner: mock(async () => ({
          id: 'run-1', userId: 'u1', answersHash: 'h', status: 'failed', proposalId: null, error: 'boom', createdAt: new Date(),
        })),
      },
    });
    const service = new SignalIntakeService(deps as never);

    const result = await service.resolveProposal('u1', { runId: 'run-1', answers });

    expect(deps.orchestrator.synthesize).toHaveBeenCalledTimes(1);
    // normalizeIntentDescription strips trailing sentence punctuation from the
    // verified intent's description, so the fixture's trailing period is gone.
    expect(result.description).toBe('Looking for a design partner');
  });

  it('rejects a run owned by another user', async () => {
    const deps = makeDeps({
      runStore: { ...makeDeps().runStore, getRunForOwner: mock(async () => null) },
    });
    const service = new SignalIntakeService(deps as never);

    await expect(service.resolveProposal('u1', { runId: 'run-1', answers })).rejects.toThrow('run_not_found');
  });

  it('surfaces verification rejection with a clarification question', async () => {
    const deps = makeDeps({
      runStore: {
        ...makeDeps().runStore,
        getRunForOwner: mock(async () => ({
          id: 'run-1', userId: 'u1', answersHash: 'h', status: 'failed', proposalId: null, error: 'x', createdAt: new Date(),
        })),
      },
      invokeIntentGraph: mock(async () => ({ verifiedIntents: [], trace: [] })),
    });
    const service = new SignalIntakeService(deps as never);

    const call = service.resolveProposal('u1', { runId: 'run-1', answers });

    await expect(call).rejects.toThrow('verification_rejected');
    await call.catch((error: { clarification?: { options: unknown[] } }) => {
      expect(error.clarification?.options.length).toBeGreaterThanOrEqual(2);
    });
    expect(deps.runStore.markFailed).toHaveBeenCalled();
  });
});
