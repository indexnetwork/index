import { describe, expect, it, mock } from 'bun:test';

import { IntakeNetworkMembershipError, SignalIntakeService } from '../signal-intake.service';

const NETWORK_ID = '22222222-2222-4222-8222-222222222222';

/** A pending, unexpired proposal row as the adapter returns it. */
function storedProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop-1',
    userId: 'u1',
    description: 'Looking for a design partner.',
    networkId: null,
    status: 'pending',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  };
}

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
      resetRun: mock(async () => undefined),
      sweepStaleRuns: mock(async () => undefined),
      getRunForOwner: mock(async () => ({
        id: 'run-1', userId: 'u1', answersHash: 'h', status: 'ready', proposalId: 'prop-1',
        lookingFor: 'A hands-on design partner', youBring: 'Engineering depth on developer tooling',
        error: null, createdAt: new Date(),
      })),
    },
    proposalStore: {
      createProposals: mock(async () => undefined),
      getProposalForOwner: mock(async () => storedProposal()),
      setProposalNetwork: mock(async () => true),
    },
    isNetworkMember: mock(async () => true),
    orchestrator: {
      generateFollowUps: mock(async () => ({ questions: [question], plannedFollowUpCount: 1 })),
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

describe('SignalIntakeService.followUpQuestions', () => {
  const followUp = { title: 'Q2', prompt: 'What do you bring?', options: [{ label: 'X', description: 'x' }], multiSelect: false };

  it('singular: returns one question and locks the total from the plan', async () => {
    const service = new SignalIntakeService(makeDeps({
      intakeConfig: () => ({ maxQuestions: 4, mode: 'singular' as const }),
      orchestrator: {
        generateFollowUps: mock(async () => ({ questions: [followUp, { ...followUp, prompt: 'q3' }], plannedFollowUpCount: 2 })),
        synthesize: mock(async () => ({ description: 'd', lookingFor: 'l', youBring: 'y' })),
      },
    }));

    const result = await service.followUpQuestions('u1', {
      rounds: [{ prompt: 'Who?', answer: { selectedOptions: ['A design partner'] } }],
    });

    expect(result.questions).toHaveLength(1);
    expect(result.total).toBe(3);
  });

  it('plural: returns the whole batch and totals rounds + batch', async () => {
    const service = new SignalIntakeService(makeDeps({
      intakeConfig: () => ({ maxQuestions: 5, mode: 'plural' as const }),
      orchestrator: {
        generateFollowUps: mock(async () => ({ questions: [followUp, { ...followUp, prompt: 'q3' }, { ...followUp, prompt: 'q4' }], plannedFollowUpCount: 3 })),
        synthesize: mock(async () => ({ description: 'd', lookingFor: 'l', youBring: 'y' })),
      },
    }));

    const result = await service.followUpQuestions('u1', {
      rounds: [{ prompt: 'Who?', answer: { selectedOptions: ['A'] } }],
    });

    expect(result.questions).toHaveLength(3);
    expect(result.total).toBe(4);
  });

  it('caps the planning budget at maxQuestions - answered rounds', async () => {
    const generateFollowUps = mock(async () => ({ questions: [followUp], plannedFollowUpCount: 9 }));
    const service = new SignalIntakeService(makeDeps({
      intakeConfig: () => ({ maxQuestions: 3, mode: 'singular' as const }),
      orchestrator: { generateFollowUps, synthesize: mock(async () => ({ description: 'd', lookingFor: 'l', youBring: 'y' })) },
    }));

    const result = await service.followUpQuestions('u1', {
      rounds: [{ prompt: 'Who?', answer: { selectedOptions: ['A'] } }],
    });

    expect(generateFollowUps).toHaveBeenCalledWith(expect.objectContaining({ maxFollowUps: 2 }));
    expect(result.total).toBe(3); // plan of 9 follow-ups clamps to the configured budget
  });

  it('singular continuation: echoes a clamped client-carried plannedTotal', async () => {
    const service = new SignalIntakeService(makeDeps({
      intakeConfig: () => ({ maxQuestions: 4, mode: 'singular' as const }),
      orchestrator: {
        generateFollowUps: mock(async () => ({ questions: [followUp], plannedFollowUpCount: 1 })),
        synthesize: mock(async () => ({ description: 'd', lookingFor: 'l', youBring: 'y' })),
      },
    }));

    const result = await service.followUpQuestions('u1', {
      rounds: [
        { prompt: 'Who?', answer: { selectedOptions: ['A'] } },
        { prompt: 'Bring?', answer: { selectedOptions: ['B'] } },
      ],
      plannedTotal: 99,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.total).toBe(4);
  });

  it('returns an empty batch with total = answered rounds when the budget is spent', async () => {
    const service = new SignalIntakeService(makeDeps({
      intakeConfig: () => ({ maxQuestions: 1, mode: 'plural' as const }),
    }));

    const result = await service.followUpQuestions('u1', {
      rounds: [{ prompt: 'Who?', answer: { selectedOptions: ['A'] } }],
    });

    expect(result).toEqual({ questions: [], total: 1 });
  });
});

describe('SignalIntakeService.resolveProposal', () => {
  const rounds = [
    { prompt: 'Who do you want to meet?', answer: { selectedOptions: ['A design partner'] } },
    { prompt: 'What do you bring?', answer: { selectedOptions: ['Engineering depth'] } },
  ];

  it('returns the speculative proposal without re-synthesizing', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    const result = await service.resolveProposal('u1', { runId: 'run-1', rounds });

    expect(result.proposalId).toBe('prop-1');
    expect(deps.orchestrator.synthesize).not.toHaveBeenCalled();
  });

  it('re-synthesizes when whereText is supplied', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    await service.resolveProposal('u1', { runId: 'run-1', whereText: 'Berlin only', rounds });

    expect(deps.orchestrator.synthesize).toHaveBeenCalledTimes(1);
    expect(deps.proposalStore.createProposals).toHaveBeenCalledTimes(1);
  });

  it('returns before speculative synthesis settles', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = makeDeps({
      orchestrator: {
        generateFollowUps: mock(async () => ({ questions: [question], plannedFollowUpCount: 1 })),
        synthesize: mock(async () => {
          await gate;
          return { description: 'd', lookingFor: 'l', youBring: 'y' };
        }),
      },
    });
    const service = new SignalIntakeService(deps as never);

    const result = await service.prepare('u1', { rounds });

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

    const result = await service.resolveProposal('u1', { runId: 'run-1', rounds });

    expect(deps.orchestrator.synthesize).toHaveBeenCalledTimes(1);
    // normalizeIntentDescription strips trailing sentence punctuation from the
    // verified intent's description, so the fixture's trailing period is gone.
    expect(result.description).toBe('Looking for a design partner');
  });

  it('returns the summaries the speculative synthesis persisted, not empty strings', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    const result = await service.resolveProposal('u1', { runId: 'run-1', rounds });

    // The hit path is the design's expected outcome, so it must carry the
    // synthesized copy; returning '' here made the client fall back to the raw
    // option labels the user clicked on almost every real run.
    expect(result.lookingFor).toBe('A hands-on design partner');
    expect(result.youBring).toBe('Engineering depth on developer tooling');
    expect(deps.orchestrator.synthesize).not.toHaveBeenCalled();
  });

  it('attaches the picked community to the speculative proposal', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    await service.resolveProposal('u1', { runId: 'run-1', networkId: NETWORK_ID, rounds });

    expect(deps.isNetworkMember).toHaveBeenCalledWith(NETWORK_ID, 'u1');
    expect(deps.proposalStore.setProposalNetwork).toHaveBeenCalledWith('prop-1', 'u1', NETWORK_ID);
  });

  it('creates the serial proposal with the picked community already on it', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    await service.resolveProposal('u1', {
      runId: 'run-1', networkId: NETWORK_ID, whereText: 'Berlin only', rounds,
    });

    const [[created]] = deps.proposalStore.createProposals.mock.calls as [[Array<{ networkId?: string }>]];
    expect(created[0]?.networkId).toBe(NETWORK_ID);
  });

  it('refuses a community the user does not belong to', async () => {
    const deps = makeDeps({ isNetworkMember: mock(async () => false) });
    const service = new SignalIntakeService(deps as never);

    await expect(service.resolveProposal('u1', { runId: 'run-1', networkId: NETWORK_ID, rounds }))
      .rejects.toBeInstanceOf(IntakeNetworkMembershipError);
    expect(deps.proposalStore.setProposalNetwork).not.toHaveBeenCalled();
  });

  it('re-synthesizes instead of replaying a proposal that was already consumed', async () => {
    const deps = makeDeps({
      proposalStore: {
        createProposals: mock(async () => undefined),
        getProposalForOwner: mock(async () => storedProposal({ status: 'consumed' })),
        setProposalNetwork: mock(async () => true),
      },
    });
    const service = new SignalIntakeService(deps as never);

    const result = await service.resolveProposal('u1', { runId: 'run-1', rounds });

    expect(deps.orchestrator.synthesize).toHaveBeenCalledTimes(1);
    expect(result.proposalId).not.toBe('prop-1');
  });

  it('rejects a run owned by another user', async () => {
    const deps = makeDeps({
      runStore: { ...makeDeps().runStore, getRunForOwner: mock(async () => null) },
    });
    const service = new SignalIntakeService(deps as never);

    await expect(service.resolveProposal('u1', { runId: 'run-1', rounds })).rejects.toThrow('run_not_found');
  });

  it('re-synthesizes when the community can no longer be attached', async () => {
    const deps = makeDeps({
      proposalStore: {
        createProposals: mock(async () => undefined),
        getProposalForOwner: mock(async () => storedProposal()),
        // Lost a race with a concurrent confirm/reject: the row is no longer pending.
        setProposalNetwork: mock(async () => false),
      },
    });
    const service = new SignalIntakeService(deps as never);

    const result = await service.resolveProposal('u1', { runId: 'run-1', networkId: NETWORK_ID, rounds });

    expect(deps.orchestrator.synthesize).toHaveBeenCalledTimes(1);
    expect(result.proposalId).not.toBe('prop-1');
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

    const call = service.resolveProposal('u1', { runId: 'run-1', rounds });

    await expect(call).rejects.toThrow('verification_rejected');
    await call.catch((error: { clarification?: { options: unknown[] } }) => {
      expect(error.clarification?.options.length).toBeGreaterThanOrEqual(2);
    });
    expect(deps.runStore.markFailed).toHaveBeenCalled();
  });
});

describe('SignalIntakeService.prepare run reuse', () => {
  const rounds = [
    { prompt: 'Who do you want to meet?', answer: { selectedOptions: ['A design partner'] } },
    { prompt: 'What do you bring?', answer: { selectedOptions: ['Engineering depth'] } },
  ];

  it('records every follow-up round with its client-sent prompt', async () => {
    const recordAnsweredQuestion = mock(async () => undefined);
    const service = new SignalIntakeService(makeDeps({ recordAnsweredQuestion }));

    await service.prepare('u1', {
      rounds: [
        { prompt: 'Who?', answer: { selectedOptions: ['A'] } },
        { prompt: 'Bring?', answer: { selectedOptions: ['B'] } },
        { prompt: 'When?', answer: { selectedOptions: [], freeText: 'Now' } },
      ],
    });

    const stages = recordAnsweredQuestion.mock.calls.map((call) => (call[0] as { stage: string }).stage);
    expect(stages).toEqual(['followup-2', 'followup-3']);
    const prompts = recordAnsweredQuestion.mock.calls.map((call) => (call[0] as { prompt: string }).prompt);
    expect(prompts).toEqual(['Bring?', 'When?']);
  });

  function readyRun(proposalId: string | null = 'prop-1') {
    return {
      id: 'run-1', userId: 'u1', answersHash: 'h', status: 'ready', proposalId,
      lookingFor: 'l', youBring: 'y', error: null, createdAt: new Date(),
    };
  }

  it('reopens a matched run whose proposal was already consumed', async () => {
    // The hash keys only on the two answers and each round offers a handful of
    // canned options, so a user creating a second signal within the 24h TTL can
    // hash to their first run. Replaying it returned the FIRST intent at confirm
    // while the user believed they had created a second signal.
    const deps = makeDeps({
      runStore: {
        ...makeDeps().runStore,
        claimRun: mock(async () => ({ run: readyRun(), claimed: false })),
      },
      proposalStore: {
        createProposals: mock(async () => undefined),
        getProposalForOwner: mock(async () => storedProposal({ status: 'consumed' })),
        setProposalNetwork: mock(async () => true),
      },
    });
    const service = new SignalIntakeService(deps as never);

    await service.prepare('u1', { rounds });
    // Speculation is deliberately not awaited; let the microtask chain drain.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.runStore.resetRun).toHaveBeenCalledWith('run-1');
    expect(deps.orchestrator.synthesize).toHaveBeenCalledTimes(1);
  });

  it('reuses a matched run whose proposal is still pending', async () => {
    const deps = makeDeps({
      runStore: {
        ...makeDeps().runStore,
        claimRun: mock(async () => ({ run: readyRun(), claimed: false })),
      },
    });
    const service = new SignalIntakeService(deps as never);

    await service.prepare('u1', { rounds });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.runStore.resetRun).not.toHaveBeenCalled();
    expect(deps.orchestrator.synthesize).not.toHaveBeenCalled();
  });

  it('leaves an in-flight run alone so concurrent tabs single-flight', async () => {
    const deps = makeDeps({
      runStore: {
        ...makeDeps().runStore,
        claimRun: mock(async () => ({
          run: {
            id: 'run-1', userId: 'u1', answersHash: 'h', status: 'pending', proposalId: null,
            lookingFor: null, youBring: null, error: null, createdAt: new Date(),
          },
          claimed: false,
        })),
      },
    });
    const service = new SignalIntakeService(deps as never);

    await service.prepare('u1', { rounds });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.runStore.resetRun).not.toHaveBeenCalled();
    expect(deps.orchestrator.synthesize).not.toHaveBeenCalled();
  });
});

describe('SignalIntakeService.revise', () => {
  const rounds = [
    { prompt: 'Who do you want to meet?', answer: { selectedOptions: ['A design partner'] } },
    { prompt: 'What do you bring?', answer: { selectedOptions: ['Engineering depth'] } },
  ];

  it('sends feedback in its own slot rather than as a where constraint', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    await service.revise('u1', {
      runId: 'run-1', feedback: 'make it about hardware, not software', rounds,
    });

    const [input] = deps.orchestrator.synthesize.mock.calls[0] as [{ feedback?: string; whereText?: string }];
    expect(input.feedback).toBe('make it about hardware, not software');
    expect(input.whereText).toBeUndefined();
  });

  it('carries the already-picked community onto the replacement proposal', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    await service.revise('u1', {
      runId: 'run-1', feedback: 'more senior', networkId: NETWORK_ID, rounds,
    });

    const [[created]] = deps.proposalStore.createProposals.mock.calls as [[Array<{ networkId?: string }>]];
    expect(created[0]?.networkId).toBe(NETWORK_ID);
  });

  it('stores the synthesized summaries on the run it settles', async () => {
    const deps = makeDeps();
    const service = new SignalIntakeService(deps as never);

    await service.revise('u1', { runId: 'run-1', feedback: 'more senior', rounds });

    expect(deps.runStore.markReady).toHaveBeenCalledWith(
      'run-1', expect.any(String), { lookingFor: 'A design partner', youBring: 'Depth' },
    );
  });
});
