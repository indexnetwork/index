/**
 * The host behind `reject_opportunity` / `accept_opportunity` (#1471):
 * position → opportunity, then the SAME owner accept/reject the Radar card
 * performs.
 *
 * The tool is given numbers and never an id, so this module owns the mapping —
 * and a wrong mapping here is not a misroute, it is declining the wrong
 * person. Hence the ordering is pinned as hard as the writes are.
 */
import { describe, expect, it } from 'bun:test';

import { ACTIONABLE_VERDICT_STATUSES, acceptOpportunity, readActionableCounterparties, rejectOpportunity } from '../negotiator-verdict.host';

const USER_ID = 'user-1';
const INTENT_ID = 'intent-1';
const CAMILLE = 'eba8e028-1c4d-4f7a-9b3e-5d6a7c8e9f01';
const ILYA = '7f3d2c1b-8a90-4e5f-b6c7-d8e9f0a1b2c3';
const FRESH = 'aa11bb22-cc33-4d44-8e55-ff6677889900';

const row = (over: Record<string, unknown>) => ({
  id: CAMILLE,
  status: 'stalled',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  counterpartName: 'Camille Dubois',
  actors: [{ userId: USER_ID, role: 'peer' }, { userId: 'user-2', role: 'peer' }],
  ...over,
});

const CAMILLE_ROW = row({});
const ILYA_ROW = row({
  id: ILYA,
  status: 'pending',
  createdAt: new Date('2026-08-05T00:00:00Z'),
  counterpartName: 'Ilya Roth',
});

interface Written {
  opportunityId: string;
  status: string;
  userId: string;
  options: { scopeType: string; scopeId: string };
}

function harness(over: Record<string, unknown> = {}) {
  const listed: Array<{ userId: string; options: Record<string, unknown> }> = [];
  const written: Written[] = [];
  return {
    listed,
    written,
    deps: {
      listOpportunities: (async (userId: string, options: Record<string, unknown>) => {
        listed.push({ userId, options });
        return [CAMILLE_ROW, ILYA_ROW];
      }) as never,
      updateStatus: (async (
        opportunityId: string,
        status: string,
        userId: string,
        options: { scopeType: string; scopeId: string },
      ) => {
        written.push({ opportunityId, status, userId, options });
        return { opportunity: { id: opportunityId, status } };
      }) as never,
      ...over,
    },
  };
}

describe('readActionableCounterparties', () => {
  it('scopes the read to this client, this signal, and the statuses still open to a verdict', async () => {
    const { listed, deps } = harness();

    await readActionableCounterparties(USER_ID, INTENT_ID, deps);

    expect(listed).toEqual([{
      userId: USER_ID,
      options: { statuses: ACTIONABLE_VERDICT_STATUSES, scopeType: 'intent', scopeId: INTENT_ID },
    }]);
    expect(ACTIONABLE_VERDICT_STATUSES).toEqual(['pending', 'negotiating', 'stalled']);
  });

  it('numbers oldest first and labels each with name plus one-line state', async () => {
    const { deps } = harness();

    const actionable = await readActionableCounterparties(USER_ID, INTENT_ID, deps);

    expect(actionable).toEqual([
      {
        position: 1,
        opportunityId: CAMILLE,
        name: 'Camille Dubois',
        status: 'stalled',
        label: 'Camille Dubois — parked, waiting on you',
        // Neither is an introduction, so neither is gated.
        awaitingIntroducerApproval: false,
      },
      {
        position: 2,
        opportunityId: ILYA,
        name: 'Ilya Roth',
        status: 'pending',
        label: 'Ilya Roth — waiting on your decision',
        awaitingIntroducerApproval: false,
      },
    ]);
  });

  it('appends a match that arrives mid-turn instead of renumbering the ones already read', async () => {
    const fresh = row({
      id: FRESH,
      status: 'negotiating',
      createdAt: new Date('2026-08-19T00:00:00Z'),
      counterpartName: 'Nora Vance',
    });
    const { deps } = harness({
      listOpportunities: (async () => [fresh, ILYA_ROW, CAMILLE_ROW]) as never,
    });

    const actionable = await readActionableCounterparties(USER_ID, INTENT_ID, deps);

    expect(actionable.map((c) => c.name)).toEqual(['Camille Dubois', 'Ilya Roth', 'Nora Vance']);
    expect(actionable[2].label).toBe('Nora Vance — your agents are still negotiating');
  });

  it('excludes a pairing the client only introduced — a verdict is the parties\' to pass', async () => {
    const { deps } = harness({
      listOpportunities: (async () => [
        row({ actors: [{ userId: USER_ID, role: 'introducer' }, { userId: 'user-2', role: 'peer' }] }),
        ILYA_ROW,
      ]) as never,
    });

    const actionable = await readActionableCounterparties(USER_ID, INTENT_ID, deps);

    expect(actionable.map((c) => c.opportunityId)).toEqual([ILYA]);
  });

  it('offers no verdicts rather than losing the turn when the read fails', async () => {
    const { deps } = harness({
      listOpportunities: (async () => { throw new Error('database unavailable'); }) as never,
    });

    expect(await readActionableCounterparties(USER_ID, INTENT_ID, deps)).toEqual([]);
  });
});

describe('rejectOpportunity', () => {
  it('sends the number the model was shown down the Radar Skip path, intent-scoped', async () => {
    const { written, deps } = harness();

    const result = await rejectOpportunity(USER_ID, { intentId: INTENT_ID, counterparty: 1 }, deps);

    expect(result).toEqual({ status: 'executed', counterparty: 'Camille Dubois' });
    expect(written).toEqual([{
      opportunityId: CAMILLE,
      status: 'rejected',
      userId: USER_ID,
      options: { scopeType: 'intent', scopeId: INTENT_ID },
    }]);
  });

  it('resolves position 2 to the second counterparty, not the first', async () => {
    const { written, deps } = harness();

    const result = await rejectOpportunity(
      USER_ID,
      { intentId: INTENT_ID, counterparty: 2, reason: 'Wrong stage for me.' },
      deps,
    );

    expect(result).toEqual({ status: 'executed', counterparty: 'Ilya Roth' });
    expect(written[0].opportunityId).toBe(ILYA);
  });

  it('writes nothing and re-lists when the number names no counterparty', async () => {
    const { written, deps } = harness();

    const result = await rejectOpportunity(USER_ID, { intentId: INTENT_ID, counterparty: 5 }, deps);

    expect(result).toEqual({
      status: 'unknown_counterparty',
      count: 2,
      actionable: ['Camille Dubois — parked, waiting on you', 'Ilya Roth — waiting on your decision'],
    });
    expect(written).toHaveLength(0);
  });

  it('writes nothing when the signal has nothing actionable left', async () => {
    const { written, deps } = harness({ listOpportunities: (async () => []) as never });

    const result = await rejectOpportunity(USER_ID, { intentId: INTENT_ID, counterparty: 1 }, deps);

    expect(result).toEqual({ status: 'none_actionable' });
    expect(written).toHaveLength(0);
  });

  it('re-lists rather than erroring when the pairing left the set between render and call', async () => {
    const { deps } = harness({
      updateStatus: (async () => ({ error: 'Opportunity not found', status: 404 })) as never,
    });

    const result = await rejectOpportunity(USER_ID, { intentId: INTENT_ID, counterparty: 1 }, deps);

    expect(result).toMatchObject({ status: 'unknown_counterparty', count: 2 });
  });

  it('reports a service refusal honestly instead of claiming the decision landed', async () => {
    const { deps } = harness({
      updateStatus: (async () => ({ error: 'Not authorized to update this opportunity', status: 403 })) as never,
    });
    const { deps: broken } = harness({
      updateStatus: (async () => ({ error: 'Boom', status: 500 })) as never,
    });

    expect(await rejectOpportunity(USER_ID, { intentId: INTENT_ID, counterparty: 1 }, deps))
      .toMatchObject({ status: 'unknown_counterparty' });
    expect(await rejectOpportunity(USER_ID, { intentId: INTENT_ID, counterparty: 1 }, broken))
      .toEqual({ status: 'error' });
  });

  it('never throws — a failed write is reported, not raised', async () => {
    const { deps } = harness({
      updateStatus: (async () => { throw new Error('connection reset'); }) as never,
    });

    expect(await rejectOpportunity(USER_ID, { intentId: INTENT_ID, counterparty: 1 }, deps))
      .toEqual({ status: 'error' });
  });
});

describe('acceptOpportunity', () => {
  it('takes the same owner path with the accepted status', async () => {
    const { written, deps } = harness();

    const result = await acceptOpportunity(USER_ID, { intentId: INTENT_ID, counterparty: 1 }, deps);

    expect(result).toEqual({ status: 'executed', counterparty: 'Camille Dubois' });
    expect(written).toEqual([{
      opportunityId: CAMILLE,
      status: 'accepted',
      userId: USER_ID,
      options: { scopeType: 'intent', scopeId: INTENT_ID },
    }]);
  });

  it('names whose move it is when the client already committed', async () => {
    const { deps } = harness({
      updateStatus: (async () => ({
        error: 'You have already acted on this opportunity. The other party must accept.',
        status: 409,
      })) as never,
    });

    const result = await acceptOpportunity(USER_ID, { intentId: INTENT_ID, counterparty: 1 }, deps);

    expect(result).toEqual({ status: 'already_decided', counterparty: 'Camille Dubois' });
  });
});
