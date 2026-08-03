import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { AuthGuard } from '../../guards/auth.guard';
import { FastSignalIntakeEnabledGuard } from '../../guards/fast-intake.guard';
import { RouteRegistry } from '../../lib/router/router.decorators';
import { IntentIntakeController } from '../intent-intake.controller';

const user = { id: 'u1' } as never;
const question = {
  title: 'Question 1',
  prompt: 'Who do you want to meet?',
  options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
  multiSelect: false,
};
const proposal = {
  proposalId: 'prop-1',
  description: 'Looking for a design partner.',
  lookingFor: 'A design partner',
  youBring: 'Engineering depth',
};
const rounds = [
  { prompt: 'Who do you want to meet?', answer: { selectedOptions: ['A design partner'] } },
  { prompt: 'What do you bring?', answer: { selectedOptions: ['Engineering depth'] } },
];

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    getOrCreatePack: mock(async () => ({ brief: 'b', question, packHit: true })),
    followUpQuestions: mock(async () => ({ questions: [question], total: 2 })),
    prepare: mock(async () => ({ runId: 'run-1' })),
    resolveProposal: mock(async () => proposal),
    revise: mock(async () => proposal),
    ...overrides,
  };
}

const request = (body: unknown) => new Request('http://localhost/intents/intake', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const original = process.env.FAST_SIGNAL_INTAKE;
beforeEach(() => { process.env.FAST_SIGNAL_INTAKE = 'true'; });
afterEach(() => {
  if (original === undefined) delete process.env.FAST_SIGNAL_INTAKE;
  else process.env.FAST_SIGNAL_INTAKE = original;
});

describe('IntentIntakeController flag gating', () => {
  it('404s every route when the flag is off', async () => {
    process.env.FAST_SIGNAL_INTAKE = 'false';
    const controller = new IntentIntakeController({ service: makeService() as never });

    const responses = await Promise.all([
      controller.start(request({}), user),
      controller.question(request({ rounds: [rounds[0]] }), user),
      controller.prepare(request({ rounds }), user),
      controller.proposal(request({ runId: '11111111-1111-4111-8111-111111111111', rounds }), user),
      controller.revise(request({ runId: '11111111-1111-4111-8111-111111111111', feedback: 'x', rounds }), user),
    ]);

    for (const response of responses) expect(response.status).toBe(404);
  });

  it('rate-limits every synthesizing route far tighter than ordinary writes', () => {
    // Each of these can launch an LLM synthesis plus a full intent-graph run and
    // a durable proposal write: /prepare answers 202 and then does it in the
    // background, /revise does it synchronously, and /proposal does it whenever
    // `whereText` is supplied or the speculative run is unusable. `resolveProposal`
    // also accepts the same runId repeatedly, so the 600/min `write` budget is not
    // a meaningful cap on any of them.
    for (const method of ['prepare', 'revise', 'proposal'] as const) {
      const names = RouteRegistry.getGuards(IntentIntakeController, method).map((guard) => guard.name);
      expect(names[0]).toBe('RateLimit(intake_synthesis)');
    }
    // /start and /question never synthesize: one is a pack lookup, the other is a
    // single structured question call with no durable write.
    for (const method of ['start', 'question'] as const) {
      const names = RouteRegistry.getGuards(IntentIntakeController, method).map((guard) => guard.name);
      expect(names[0]).toBe('RateLimit(write)');
    }
  });

  it('registers FastSignalIntakeEnabledGuard before AuthGuard on every route, so an unauthenticated request to a flag-off deployment 404s before AuthGuard ever runs', () => {
    for (const method of ['start', 'question', 'prepare', 'proposal', 'revise'] as const) {
      const guards = RouteRegistry.getGuards(IntentIntakeController, method);
      const flagIndex = guards.indexOf(FastSignalIntakeEnabledGuard);
      const authIndex = guards.indexOf(AuthGuard);
      expect(flagIndex).toBeGreaterThanOrEqual(0);
      expect(authIndex).toBeGreaterThanOrEqual(0);
      expect(flagIndex).toBeLessThan(authIndex);
    }
  });
});

describe('IntentIntakeController routes', () => {
  it('returns the pack question from /start', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });

    const response = await controller.start(request({}), user);
    const data = await response.json() as { question: { prompt: string } };

    expect(response.status).toBe(200);
    expect(data.question.prompt).toBe('Who do you want to meet?');
  });

  it('returns the follow-up question batch from /question', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });

    const response = await controller.question(request({ rounds: [rounds[0]] }), user);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ questions: [question], total: 2 });
  });

  it('passes a client-carried plannedTotal through to the service', async () => {
    const followUpQuestions = mock(async () => ({ questions: [question], total: 3 }));
    const controller = new IntentIntakeController({ service: makeService({ followUpQuestions }) as never });

    const response = await controller.question(request({ rounds, plannedTotal: 3 }), user);

    expect(response.status).toBe(200);
    expect(followUpQuestions).toHaveBeenCalledWith('u1', { rounds, plannedTotal: 3 });
  });

  it('rejects an empty rounds list', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });
    const response = await controller.question(request({ rounds: [] }), user);
    expect(response.status).toBe(400);
  });

  it('returns 202 with a runId from /prepare', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });

    const response = await controller.prepare(request({ rounds }), user);
    const data = await response.json() as { runId: string };

    expect(response.status).toBe(202);
    expect(data.runId).toBe('run-1');
  });

  it('returns the proposal from /proposal', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });

    const response = await controller.proposal(
      request({ runId: '11111111-1111-4111-8111-111111111111', rounds }), user,
    );
    const data = await response.json() as { proposalId: string };

    expect(response.status).toBe(200);
    expect(data.proposalId).toBe('prop-1');
  });

  it('forwards the picked community to the service so it lands on the proposal', async () => {
    const service = makeService();
    const controller = new IntentIntakeController({ service: service as never });
    const networkId = '22222222-2222-4222-8222-222222222222';

    await controller.proposal(
      request({ runId: '11111111-1111-4111-8111-111111111111', networkId, rounds }), user,
    );

    // The regression: `networkId` was parsed and then dropped, so the proposal
    // row kept a NULL network and /intents/confirm 409'd on every community pick.
    expect(service.resolveProposal).toHaveBeenCalledWith('u1', expect.objectContaining({ networkId }));
  });

  it('forwards the picked community through /revise as well', async () => {
    const service = makeService();
    const controller = new IntentIntakeController({ service: service as never });
    const networkId = '22222222-2222-4222-8222-222222222222';

    await controller.revise(
      request({ runId: '11111111-1111-4111-8111-111111111111', feedback: 'sharper', networkId, rounds }), user,
    );

    expect(service.revise).toHaveBeenCalledWith('u1', expect.objectContaining({ networkId }));
  });

  it('maps a community the user does not belong to onto 403', async () => {
    const service = makeService({
      resolveProposal: mock(async () => {
        const { IntakeNetworkMembershipError } = await import('../../services/signal-intake.service');
        throw new IntakeNetworkMembershipError('22222222-2222-4222-8222-222222222222');
      }),
    });
    const controller = new IntentIntakeController({ service: service as never });

    const response = await controller.proposal(request({
      runId: '11111111-1111-4111-8111-111111111111',
      networkId: '22222222-2222-4222-8222-222222222222',
      rounds,
    }), user);

    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code).toBe('network_membership_required');
  });

  it('rejects an answer that carries nothing before any synthesis is started', async () => {
    const service = makeService();
    const controller = new IntentIntakeController({ service: service as never });

    const empty = await controller.prepare(request({
      rounds: [{ prompt: 'Who do you want to meet?', answer: { selectedOptions: [] } }],
    }), user);
    const blank = await controller.prepare(request({
      rounds: [{ prompt: 'Who do you want to meet?', answer: { selectedOptions: [], freeText: '   ' } }],
    }), user);

    expect(empty.status).toBe(400);
    expect(blank.status).toBe(400);
    expect(service.prepare).not.toHaveBeenCalled();
  });

  it('still accepts a free-text-only answer', async () => {
    const service = makeService();
    const controller = new IntentIntakeController({ service: service as never });

    const response = await controller.prepare(request({
      rounds: [
        rounds[0],
        { prompt: 'What do you bring?', answer: { selectedOptions: [], freeText: 'a robotics co-founder' } },
      ],
    }), user);

    expect(response.status).toBe(202);
    expect(service.prepare).toHaveBeenCalledTimes(1);
  });

  it('maps a foreign run to 404 run_not_found', async () => {
    const service = makeService({
      resolveProposal: mock(async () => {
        const { IntakeRunNotFoundError } = await import('../../services/signal-intake.service');
        throw new IntakeRunNotFoundError();
      }),
    });
    const controller = new IntentIntakeController({ service: service as never });

    const response = await controller.proposal(
      request({ runId: '11111111-1111-4111-8111-111111111111', rounds }), user,
    );
    const data = await response.json() as { code: string };

    expect(response.status).toBe(404);
    expect(data.code).toBe('run_not_found');
  });

  it('maps verification rejection to 422 with the clarification question', async () => {
    const service = makeService({
      resolveProposal: mock(async () => {
        const { IntakeVerificationRejectedError } = await import('../../services/signal-intake.service');
        throw new IntakeVerificationRejectedError(question);
      }),
    });
    const controller = new IntentIntakeController({ service: service as never });

    const response = await controller.proposal(
      request({ runId: '11111111-1111-4111-8111-111111111111', rounds }), user,
    );
    const data = await response.json() as { code: string; clarification: { prompt: string } };

    expect(response.status).toBe(422);
    expect(data.code).toBe('verification_rejected');
    expect(data.clarification.prompt).toBe('Who do you want to meet?');
  });

  it('returns the replacement proposal from /revise', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });

    const response = await controller.revise(
      request({ runId: '11111111-1111-4111-8111-111111111111', feedback: 'more specific', rounds }), user,
    );

    expect(response.status).toBe(200);
    expect((await response.json() as { proposalId: string }).proposalId).toBe('prop-1');
  });

  it('rejects malformed bodies with 400', async () => {
    const controller = new IntentIntakeController({ service: makeService() as never });

    const response = await controller.proposal(request({ runId: 'not-a-uuid' }), user);

    expect(response.status).toBe(400);
  });
});
