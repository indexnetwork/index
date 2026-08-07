/**
 * Proves the PRODUCTION `signalIntakeService` singleton — not an
 * injected-fakes instance — carries a real `recordAnsweredQuestion` that
 * writes through the same `QuestionerAdapter` singleton `chatQuestions.persist`
 * uses. Every heavy collaborator the module wires at import time is stubbed
 * via `mock.module` so this stays DB-free and network-free; only the
 * questioner adapter module is asserted against, since that is the seam
 * under test.
 *
 * The round-1 and follow-up fixtures are deliberately made to diverge:
 * round-1's real question offers two options but the user only picks one,
 * while follow-up rounds carry only their client-sent prompt, never the full
 * question object. This lets the two tests below tell a genuine "offered
 * menu" apart from a fabricated one — the current suite (pre-fix) could not,
 * since both stages persisted only the user's own selection reformatted as a
 * fake menu.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

/** Round-1's real question: two options offered, only one ever selected. */
const round1Question = {
  title: 'Who are you trying to meet?',
  prompt: 'Who do you want to meet?',
  options: [
    { label: 'A design partner', description: 'Builds alongside you' },
    { label: 'An investor', description: 'Funds the work' },
  ],
  multiSelect: false,
};

/** Round-2's question as produced by the (mocked) orchestrator; irrelevant to
 * the follow-up write-back, which receives only the client-sent prompt. */
const round2Question = {
  title: 'What would you bring?',
  prompt: 'What would you bring?',
  options: [{ label: 'Engineering depth', description: 'e' }],
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
      userId: 'u1', brief: 'b', question: round1Question, premiseHash: 'h', generatedAt: new Date(),
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

// Stubs the LLM-backed orchestrator/pack-generator/intent-graph collaborators
// so `followUpQuestions()` can run end to end (through the real `record()` call
// site) without ever reaching the network.
mock.module('@indexnetwork/protocol', () => ({
  FALLBACK_WHO_QUESTION: { title: 'Fallback', prompt: 'fallback', options: [], multiSelect: false },
  normalizeIntentDescription: (value: string) => value,
  IntentGraphFactory: class IntentGraphFactory {
    createGraph() {
      return { invoke: async () => ({ verifiedIntents: [] }) };
    }
  },
  SignalIntakeOrchestrator: class SignalIntakeOrchestrator {
    async generateFollowUps() {
      return { questions: [round2Question], plannedFollowUpCount: 1 };
    }
    async synthesize() {
      return { description: 'd', lookingFor: 'l', youBring: 'y' };
    }
  },
  SignalIntakePackGenerator: class SignalIntakePackGenerator {
    async generate() {
      return { brief: 'b', question: round1Question };
    }
  },
}));

const persist = mock(async (batch: Array<Record<string, unknown>>) => batch.map(() => 'question-id-1'));
const answer = mock(async () => true);
mock.module('../../adapters/questioner.adapter.instance', () => ({
  questionerAdapter: { persist, answer },
}));

const { signalIntakeService } = await import('../signal-intake.service');

describe('production intake recorder wiring', () => {
  beforeEach(() => {
    persist.mockClear();
    answer.mockClear();
  });

  it('mirrors the real round-1 menu for the "who" stage, including the option the user did not select', async () => {
    await signalIntakeService.followUpQuestions('u1', {
      rounds: [{ prompt: round1Question.prompt, answer: { selectedOptions: ['A design partner'] } }],
    });

    // The recorder is fire-and-forget; give its microtask chain a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(persist).toHaveBeenCalledTimes(1);
    const [batch] = persist.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(batch[0]).toMatchObject({
      detection: { mode: 'chat', sourceType: 'conversation', sourceId: 'intake:who' },
      actors: [{ userId: 'u1', role: 'subject' }],
    });

    const payload = batch[0].payload as { title: string; options: Array<{ label: string }>; multiSelect: boolean };
    expect(payload.title).toBe(round1Question.title);
    expect(payload.multiSelect).toBe(round1Question.multiSelect);
    // This is the OFFERED menu, not a fabrication from the user's picks: the
    // option the user did NOT select is still present in what gets persisted.
    expect(payload.options).toEqual(round1Question.options);
    expect(payload.options.map((o) => o.label)).toContain('An investor');

    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer.mock.calls[0][2]).toMatchObject({ selectedOptions: ['A design partner'] });
  });

  it('persists and answers a chat-mode question row through the shared questioner adapter, falling back to the documented proxy for follow-up rounds', async () => {
    // `prepare` is used (not `followUpQuestions`) so this stays clear of the real
    // `SignalIntakeOrchestrator`/intent-graph LLM calls: the run store mock
    // reports `claimed: false`, so speculative synthesis never fires and the
    // only production collaborator exercised is the questioner adapter.
    await signalIntakeService.prepare('u1', {
      rounds: [
        { prompt: round1Question.prompt, answer: { selectedOptions: ['A design partner'] } },
        { prompt: round2Question.prompt, answer: { selectedOptions: ['Engineering depth'] } },
      ],
    });

    // The recorder is fire-and-forget; give its microtask chain a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(persist).toHaveBeenCalledTimes(1);
    const [batch] = persist.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(batch[0]).toMatchObject({
      detection: { mode: 'chat', sourceType: 'conversation', sourceId: 'intake:followup-2' },
      actors: [{ userId: 'u1', role: 'subject' }],
    });

    // No real question object travels with a follow-up round (only its
    // prompt), so the proxy fallback fires: `payload.options` mirrors only
    // what the user selected, unlike the "who" case above which mirrors the
    // full offered menu.
    const payload = batch[0].payload as { title: string; options: Array<{ label: string; description: string }>; multiSelect: boolean };
    expect(payload.title).toBe('Follow-up');
    expect(payload.options).toEqual([{ label: 'Engineering depth', description: 'Engineering depth' }]);

    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer.mock.calls[0][0]).toBe('question-id-1');
    expect(answer.mock.calls[0][1]).toBe('u1');
    expect(answer.mock.calls[0][2]).toMatchObject({
      selectedOptions: ['Engineering depth'],
      answeredBy: 'u1',
    });
  });
});
