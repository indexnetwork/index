/**
 * Proves the PRODUCTION `signalIntakeService` singleton — not an
 * injected-fakes instance — carries a real `recordAnsweredQuestion` that
 * writes through the same `QuestionerAdapter` singleton `chatQuestions.persist`
 * uses. Every heavy collaborator the module wires at import time is stubbed
 * via `mock.module` so this stays DB-free; only the questioner adapter
 * module is asserted against, since that is the seam under test.
 */
import { describe, expect, it, mock } from 'bun:test';

const question = {
  title: 'Question 1',
  prompt: 'Who do you want to meet?',
  options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
  multiSelect: false,
};

mock.module('../../adapters/database.adapter', () => ({
  chatDatabaseAdapter: {
    getPremisesForUser: async () => [],
    getNonPersonalNetworkIds: async () => [],
    getNetwork: async () => null,
    getUserContext: async () => null,
  },
  intentDatabaseAdapter: {},
}));
mock.module('../../adapters/signal-intake-pack.database.adapter', () => ({
  signalIntakePackAdapter: {
    getPack: async () => ({
      userId: 'u1', brief: 'b', question, premiseHash: 'h', generatedAt: new Date(),
    }),
    upsertPack: async () => undefined,
  },
}));
mock.module('../../adapters/signal-intake-run.database.adapter', () => ({
  computeAnswersHash: () => 'hash',
  SIGNAL_INTAKE_RUN_TTL_MS: 1000,
  signalIntakeRunAdapter: {
    claimRun: async () => ({
      run: { id: 'run-1', userId: 'u1', answersHash: 'h', status: 'pending', proposalId: null, error: null, createdAt: new Date() },
      claimed: false,
    }),
    markReady: async () => undefined,
    markFailed: async () => undefined,
    sweepStaleRuns: async () => undefined,
    getRunForOwner: async () => null,
  },
}));
mock.module('../../adapters/intent-proposal.database.adapter', () => ({
  intentProposalDatabaseAdapter: { createProposals: async () => undefined, getProposalForOwner: async () => null },
}));
mock.module('../../adapters/embedder.adapter', () => ({ EmbedderAdapter: class EmbedderAdapter {} }));
mock.module('../../queues/intent.queue', () => ({ intentQueue: {} }));
mock.module('../../queues/questioner.queue', () => ({ questionerEnqueueIfEnabled: () => undefined }));

const persist = mock(async (batch: Array<Record<string, unknown>>) => batch.map(() => 'question-id-1'));
const answer = mock(async () => true);
mock.module('../../adapters/questioner.adapter.instance', () => ({
  questionerAdapter: { persist, answer },
}));

const { signalIntakeService } = await import('../signal-intake.service');

describe('production intake recorder wiring', () => {
  it('persists and answers a chat-mode question row through the shared questioner adapter', async () => {
    // `prepare` is used (not `nextQuestion`) so this stays clear of the real
    // `SignalIntakeOrchestrator`/intent-graph LLM calls: the run store mock
    // reports `claimed: false`, so speculative synthesis never fires and the
    // only production collaborator exercised is the questioner adapter.
    await signalIntakeService.prepare('u1', {
      whoAnswer: { selectedOptions: ['A design partner'] },
      bringAnswer: { selectedOptions: ['Engineering depth'] },
      round2Prompt: 'What would you bring?',
    });

    // The recorder is fire-and-forget; give its microtask chain a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(persist).toHaveBeenCalledTimes(1);
    const [batch] = persist.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(batch[0]).toMatchObject({
      detection: { mode: 'chat', sourceType: 'conversation', sourceId: 'intake:bring' },
      actors: [{ userId: 'u1', role: 'subject' }],
    });

    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer.mock.calls[0][0]).toBe('question-id-1');
    expect(answer.mock.calls[0][1]).toBe('u1');
    expect(answer.mock.calls[0][2]).toMatchObject({
      selectedOptions: ['Engineering depth'],
      answeredBy: 'u1',
    });
  });
});
