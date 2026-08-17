import { describe, expect, it, mock } from 'bun:test';

import { SignalIntakeService } from '../signal-intake.service';

const question = {
  title: 'Question 1',
  prompt: 'Who do you want to meet?',
  options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
  multiSelect: false,
};

function makeDeps(recordAnsweredQuestion: unknown) {
  return {
    packStore: {
      getPack: mock(async () => ({
        userId: 'u1', brief: 'b', question, premiseHash: 'h', generatedAt: new Date(),
      })),
      upsertPack: mock(async () => undefined),
    },
    runStore: {
      claimRun: mock(async () => ({
        run: { id: 'run-1', userId: 'u1', answersHash: 'h', status: 'pending', proposalId: null, error: null, createdAt: new Date() },
        claimed: false,
      })),
      markReady: mock(async () => undefined),
      markFailed: mock(async () => undefined),
      sweepStaleRuns: mock(async () => undefined),
      getRunForOwner: mock(async () => null),
    },
    proposalStore: {
      createProposals: mock(async () => undefined),
      getProposalForOwner: mock(async () => null),
    },
    intents: {
      generateIntakePack: mock(async () => ({ brief: 'b', question })),
      generateIntakeFollowUps: mock(async () => ({ questions: [question], plannedFollowUpCount: 1 })),
      synthesizeIntake: mock(async () => ({ description: 'd', lookingFor: 'l', youBring: 'y' })),
    },
    getPremises: mock(async () => []),
    getNetworkTitles: mock(async () => []),
    getGlobalContext: mock(async () => null),
    invokeIntentGraph: mock(async () => ({ verifiedIntents: [] })),
    recordAnsweredQuestion,
  };
}

const whoAnswer = { selectedOptions: ['A design partner'] };
const bringAnswer = { selectedOptions: ['Engineering depth'] };

/** The two-answer default funnel as the client now carries it. */
const rounds = [
  { prompt: 'Who do you want to meet?', answer: whoAnswer },
  { prompt: 'What would you bring?', answer: bringAnswer },
];

describe('intake answer write-back', () => {
  it('records the round-1 answer with stage "who"', async () => {
    const recorder = mock(async () => undefined);
    const service = new SignalIntakeService(makeDeps(recorder) as never);

    await service.followUpQuestions('u1', { rounds: rounds.slice(0, 1) });

    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder.mock.calls[0][0]).toMatchObject({
      userId: 'u1', stage: 'who', prompt: 'Who do you want to meet?',
      question: { title: question.title, options: question.options, multiSelect: question.multiSelect },
    });
  });

  it('records each follow-up round with its client-sent prompt', async () => {
    const recorder = mock(async () => undefined);
    const service = new SignalIntakeService(makeDeps(recorder) as never);

    await service.prepare('u1', { rounds });

    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder.mock.calls[0][0]).toMatchObject({ stage: 'followup-2', prompt: 'What would you bring?' });
    // Follow-up rounds carry only their prompt, not the full question object,
    // so no `question` is forwarded and the recorder falls back to its
    // documented proxy.
    expect(recorder.mock.calls[0][0]).not.toHaveProperty('question');
  });

  it('does not await the recorder before responding', async () => {
    let settled = false;
    const recorder = mock(() => new Promise<void>((resolve) => setTimeout(() => {
      settled = true;
      resolve();
    }, 50)));
    const service = new SignalIntakeService(makeDeps(recorder) as never);

    await service.prepare('u1', { rounds });

    expect(settled).toBe(false);
  });

  it('never fails a request when the recorder rejects', async () => {
    const recorder = mock(async () => { throw new Error('questions table down'); });
    const service = new SignalIntakeService(makeDeps(recorder) as never);

    await expect(service.prepare('u1', { rounds })).resolves.toMatchObject({ runId: 'run-1' });
  });
});
