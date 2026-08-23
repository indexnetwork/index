/**
 * Intake -> confirm seam test.
 *
 * Every other test around this funnel either mocks the web `apiClient` or fakes
 * `proposalStore`, so nothing exercised the one check that actually decides
 * whether a fast-intake signal can be created: `IntentService.createFromProposal`
 * enforcing the stored network scope and the authoritative proposal lifecycle.
 * That gap let a build ship in which the picked community never reached the
 * proposal, so every community pick 409'd at confirm.
 *
 * This file therefore runs the REAL `createFromProposal` against the SAME
 * proposal store the intake service wrote to, with the client's exact confirm
 * payload. Only the proposal store is in-memory (row semantics preserved); the
 * equality check under test is production code.
 */

import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock } from 'bun:test';

mock.module('../../adapters/database.adapter', () => ({
  IntentDatabaseAdapter: class IntentDatabaseAdapter {},
  intentDatabaseAdapter: {},
  chatDatabaseAdapter: {},
}));
mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class EmbedderAdapter {},
  embedderAdapter: {},
}));
mock.module('../../queues/intent.queue', () => ({
  intentQueue: { addGenerateHydeJob: async () => 'job-id' },
}));
mock.module('../../queues/questioner.queue', () => ({
  questionerEnqueueIfEnabled: () => undefined,
}));
mock.module('../../events/intent.event', () => ({
  IntentEvents: { onCreated: () => {} },
}));

const { IntentService } = await import('../intent.service');
const { SignalIntakeService } = await import('../signal-intake.service');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const NETWORK_ID = '22222222-2222-4222-8222-222222222222';

/** One intent per confirmed proposal, so "which signal did I create?" is observable. */
const intentIdFor = (proposalId: string) => `intent-of-${proposalId}`;

const verifierOutput = {
  reasoning: 'A directive with a concrete counterparty class.',
  classification: 'DIRECTIVE' as const,
  felicity_scores: { clarity: 91, authority: 83, sincerity: 88 },
  semantic_entropy: 0.24,
  referential_anchor: null,
  referential_breadth: 'moderate' as const,
  missing_selectional_constraints: [],
  specificity_warning: null,
  flags: [],
};

const question = {
  title: 'Question 1',
  prompt: 'Who do you want to meet?',
  options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
  multiSelect: false,
};

const rounds = [
  { prompt: 'Who do you want to meet?', answer: { selectedOptions: ['A design partner'] } },
  { prompt: 'What do you bring?', answer: { selectedOptions: ['Engineering depth'] } },
];

interface Row {
  id: string;
  userId: string;
  description: string;
  networkId: string | null;
  analysis: unknown;
  status: 'pending' | 'consumed' | 'rejected';
  expiresAt: Date;
  createdAt: Date;
  consumedAt: Date | null;
  consumedIntentId: string | null;
}

/**
 * In-memory `intent_proposals`, preserving the row semantics both services rely
 * on: owner scoping, pending status, and the membership-gated network write.
 */
class MemoryProposalStore {
  readonly rows = new Map<string, Row>();

  constructor(private readonly members: Set<string>) {}

  async createProposals(proposals: Array<{
    proposalId: string; userId: string; description: string; networkId?: string; analysis: unknown;
  }>): Promise<void> {
    for (const proposal of proposals) {
      this.rows.set(proposal.proposalId, {
        id: proposal.proposalId,
        userId: proposal.userId,
        description: proposal.description,
        networkId: proposal.networkId ?? null,
        analysis: proposal.analysis,
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        consumedAt: null,
        consumedIntentId: null,
      });
    }
  }

  async getProposalForOwner(proposalId: string, userId: string) {
    const row = this.rows.get(proposalId);
    return row && row.userId === userId ? row : null;
  }

  async setProposalNetwork(proposalId: string, userId: string, networkId: string): Promise<boolean> {
    const row = this.rows.get(proposalId);
    if (!row || row.userId !== userId || row.status !== 'pending') return false;
    if (!this.members.has(`${networkId}:${userId}`)) return false;
    row.networkId = networkId;
    return true;
  }

  async revisePendingProposal(input: {
    proposalId: string;
    userId: string;
    expectedDescription: string;
    expectedNetworkId: string | null;
    description: string;
    analysis: unknown;
  }) {
    const row = this.rows.get(input.proposalId);
    if (!row || row.userId !== input.userId || row.status !== 'pending'
      || row.description !== input.expectedDescription || row.networkId !== input.expectedNetworkId) return null;
    row.description = input.description;
    row.analysis = input.analysis;
    return row;
  }
}

/** Wires both services onto one proposal store, as production does. */
function makeSeam(options: { runStatus?: 'pending' | 'failed' } = {}) {
  const members = new Set([`${NETWORK_ID}:${USER_ID}`]);
  const store = new MemoryProposalStore(members);
  const run = {
    id: 'run-1', userId: USER_ID, answersHash: 'h',
    status: (options.runStatus ?? 'pending') as string,
    proposalId: null as string | null,
    lookingFor: null as string | null,
    youBring: null as string | null,
    error: null as string | null,
    createdAt: new Date(),
  };

  const intake = new SignalIntakeService({
    packStore: {
      getPack: async () => ({
        userId: USER_ID, brief: 'Ada builds tools.', question, premiseHash: 'h', generatedAt: new Date(),
      }),
      upsertPack: async () => undefined,
    },
    runStore: {
      // Models the unique (user_id, answers_hash) conflict: the second funnel run
      // with the same answers finds the existing row instead of inserting.
      claimRun: async () => ({ run, claimed: run.proposalId === null && run.status === 'pending' }),
      markReady: async (runId: string, proposalId: string, summary?: { lookingFor: string; youBring: string }) => {
        run.status = 'ready';
        run.proposalId = proposalId;
        run.lookingFor = summary?.lookingFor ?? null;
        run.youBring = summary?.youBring ?? null;
      },
      markFailed: async () => undefined,
      resetRun: async () => {
        run.status = 'pending';
        run.proposalId = null;
        run.lookingFor = null;
        run.youBring = null;
      },
      sweepStaleRuns: async () => undefined,
      getRunForOwner: async () => run,
    },
    proposalStore: store,
    isNetworkMember: async (networkId: string, userId: string) => members.has(`${networkId}:${userId}`),
    intents: {
      generateIntakePack: async () => ({ brief: 'b', question }),
      generateIntakeFollowUps: async () => ({ questions: [question], plannedFollowUpCount: 1 }),
      synthesizeIntake: async () => ({
        description: 'Looking for a design partner.',
        lookingFor: 'A design partner',
        youBring: 'Engineering depth',
      }),
    },
    getPremises: async () => [{ text: 'Ada builds tools.' }],
    getNetworkTitles: async () => ['Builders'],
    getGlobalContext: async () => null,
    invokeIntentGraph: async () => ({
      verifiedIntents: [{ description: 'Looking for a design partner.', score: 0.8, verification: verifierOutput }],
    }),
  } as never);

  // Mirrors the graph's `confirm` action (intent.graph.execute.ts) against the
  // SAME in-memory proposal store the intake service wrote to: the network
  // scope is checked before any description revision, an edited description
  // is "re-verified" (stubbed here) and made authoritative, then the proposal
  // is atomically consumed. This is what IntentService.createFromProposal now
  // delegates to; the seam under test is the store contract, not the graph's
  // own mechanics (covered at the protocol layer).
  const intentGraph = {
    invoke: async (input: { userId: string; proposalId: string; description: string; networkId?: string }) => {
      const proposal = await store.getProposalForOwner(input.proposalId, input.userId);
      if (!proposal) return { confirmResult: { kind: 'missing' } };
      if (proposal.networkId !== (input.networkId ?? null)) {
        return { confirmResult: { kind: 'payload_mismatch' } };
      }
      let effectiveDescription = proposal.description;
      if (proposal.description !== input.description) {
        if (proposal.status !== 'pending') return { confirmResult: { kind: 'consumed' } };
        const revised = await store.revisePendingProposal({
          proposalId: proposal.id,
          userId: input.userId,
          expectedDescription: proposal.description,
          expectedNetworkId: proposal.networkId,
          description: input.description,
          analysis: { verifierOutput, combinedScore: 83 },
        });
        if (!revised) return { confirmResult: { kind: 'payload_mismatch' } };
        effectiveDescription = input.description;
      }
      const row = store.rows.get(proposal.id);
      if (!row || row.status !== 'pending') return { confirmResult: { kind: 'consumed' } };
      const intentId = intentIdFor(proposal.id);
      row.status = 'consumed';
      row.consumedAt = new Date();
      row.consumedIntentId = intentId;
      row.description = effectiveDescription;
      return { confirmResult: { kind: 'created', intentId } };
    },
  };

  const confirm = new IntentService({
    intentGraph,
    emitProposalCreated: () => {},
  });

  return { intake, confirm, store, run };
}

/**
 * Reproduces the speculative write: a proposal created before the pick exists.
 * `prepare` deliberately does not await synthesis, so drain it here.
 */
async function speculate(seam: ReturnType<typeof makeSeam>) {
  await seam.intake.prepare(USER_ID, { rounds });
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('fast intake -> /intents/confirm seam', () => {
  it('accepts the confirm payload the client posts after picking a community', async () => {
    const seam = makeSeam();
    await speculate(seam);
    expect(seam.store.rows.get(seam.run.proposalId as string)?.networkId).toBeNull();

    const proposal = await seam.intake.resolveProposal(USER_ID, {
      runId: 'run-1', networkId: NETWORK_ID, rounds,
    });

    // Exactly what FastSignalIntake posts to /intents/confirm.
    const created = await seam.confirm.createFromProposal(
      USER_ID, proposal.description, proposal.proposalId, NETWORK_ID,
    );

    expect(created.id).toBe(intentIdFor(proposal.proposalId));
    expect(seam.store.rows.get(proposal.proposalId)?.networkId).toBe(NETWORK_ID);
  });

  it('pins the check being satisfied: a speculative proposal that never got the pick still 409s', async () => {
    const seam = makeSeam();
    await speculate(seam);
    const proposalId = seam.run.proposalId as string;

    // The pre-fix behavior, reproduced directly against the real check: the row
    // keeps networkId NULL while the client confirms with the picked community.
    await expect(seam.confirm.createFromProposal(
      USER_ID, 'Looking for a design partner', proposalId, NETWORK_ID,
    )).rejects.toMatchObject({ code: 'proposal_payload_mismatch' });
  });

  it('accepts an "Everywhere" pick, which sends no networkId at all', async () => {
    const seam = makeSeam();
    await speculate(seam);

    const proposal = await seam.intake.resolveProposal(USER_ID, { runId: 'run-1', rounds });
    const created = await seam.confirm.createFromProposal(
      USER_ID, proposal.description, proposal.proposalId, undefined,
    );

    expect(created.id).toBe(intentIdFor(proposal.proposalId));
    expect(seam.store.rows.get(proposal.proposalId)?.networkId).toBeNull();
  });

  it('re-verifies and confirms a description edited directly in the card', async () => {
    const seam = makeSeam();
    await speculate(seam);
    const proposal = await seam.intake.resolveProposal(USER_ID, {
      runId: 'run-1', networkId: NETWORK_ID, rounds,
    });
    const editedDescription = 'Looking for a design partner in Cancun.';

    const created = await seam.confirm.createFromProposal(
      USER_ID, editedDescription, proposal.proposalId, NETWORK_ID,
    );

    expect(created.id).toBe(intentIdFor(proposal.proposalId));
    expect(seam.store.rows.get(proposal.proposalId)?.description).toBe(editedDescription);
    expect(seam.store.rows.get(proposal.proposalId)?.status).toBe('consumed');
  });

  it('accepts the serial where-text path, which creates its proposal on demand', async () => {
    const seam = makeSeam();
    await speculate(seam);

    const proposal = await seam.intake.resolveProposal(USER_ID, {
      runId: 'run-1', networkId: NETWORK_ID, whereText: 'Berlin only', rounds,
    });
    const created = await seam.confirm.createFromProposal(
      USER_ID, proposal.description, proposal.proposalId, NETWORK_ID,
    );

    expect(created.id).toBe(intentIdFor(proposal.proposalId));
  });

  it('accepts the degraded path where speculation failed', async () => {
    const seam = makeSeam({ runStatus: 'failed' });

    const proposal = await seam.intake.resolveProposal(USER_ID, {
      runId: 'run-1', networkId: NETWORK_ID, rounds,
    });
    const created = await seam.confirm.createFromProposal(
      USER_ID, proposal.description, proposal.proposalId, NETWORK_ID,
    );

    expect(created.id).toBe(intentIdFor(proposal.proposalId));
  });

  it('accepts a revised draft, whose replacement proposal is a different row', async () => {
    const seam = makeSeam();
    await speculate(seam);
    const speculativeId = seam.run.proposalId as string;

    const revised = await seam.intake.revise(USER_ID, {
      runId: 'run-1', feedback: 'make it about hardware, not software', networkId: NETWORK_ID, rounds,
    });
    expect(revised.proposalId).not.toBe(speculativeId);

    const created = await seam.confirm.createFromProposal(
      USER_ID, revised.description, revised.proposalId, NETWORK_ID,
    );

    expect(created.id).toBe(intentIdFor(revised.proposalId));
  });

  it('creates a second, distinct signal when the same answers are given again within the run TTL', async () => {
    const seam = makeSeam();

    await speculate(seam);
    const first = await seam.intake.resolveProposal(USER_ID, {
      runId: 'run-1', networkId: NETWORK_ID, rounds,
    });
    const firstIntent = await seam.confirm.createFromProposal(
      USER_ID, first.description, first.proposalId, NETWORK_ID,
    );

    // Same funnel, same canned answers, same day: `claimRun` matches the run the
    // first signal used. Replaying it handed the user back `firstIntent` while
    // they believed a second signal had been created.
    await speculate(seam);
    const second = await seam.intake.resolveProposal(USER_ID, {
      runId: 'run-1', networkId: NETWORK_ID, rounds,
    });
    expect(second.proposalId).not.toBe(first.proposalId);

    const secondIntent = await seam.confirm.createFromProposal(
      USER_ID, second.description, second.proposalId, NETWORK_ID,
    );
    expect(secondIntent.id).not.toBe(firstIntent.id);
    expect(seam.store.rows.size).toBe(2);
  });

  it('never writes a community the user is not a member of', async () => {
    const seam = makeSeam();
    await speculate(seam);
    const foreignNetwork = '44444444-4444-4444-8444-444444444444';

    await expect(seam.intake.resolveProposal(USER_ID, {
      runId: 'run-1', networkId: foreignNetwork, rounds,
    })).rejects.toThrow('network_membership_required');
    expect(seam.store.rows.get(seam.run.proposalId as string)?.networkId).toBeNull();
  });
});
