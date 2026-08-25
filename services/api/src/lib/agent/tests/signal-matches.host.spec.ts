import { describe, expect, it } from 'bun:test';

import { ACTIONABLE_VERDICT_STATUSES, PERSONAL_AGENT_MATCH_STATUSES, passVerdictOnOpportunity, readActionableCounterparties, readSignalMatches, rejectOpportunity } from '../negotiator-verdict.host';

/**
 * The PersonalAgent's every turn reasons over this list, so a read that failed
 * must FAIL the turn. Making the protocol seam throw achieved nothing while
 * the only host binding behind it caught everything and returned `[]`: a
 * transient database error still produced a reflect that saw no negotiations,
 * decided nothing, succeeded — and permanently consumed that drain
 * generation's retained job.
 *
 * These run at the HOST binding, which is where the swallow actually lived.
 */
const listThrows = { listOpportunities: async () => { throw new Error('connection reset'); } };

const introduction = (approved: boolean | undefined) => ({
  listOpportunities: async () => [{
    id: 'opportunity-1',
    status: 'latent',
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
    counterpartName: 'Dana',
    actors: [
      { userId: 'alice', role: 'peer' },
      { userId: 'bob', role: 'peer' },
      { userId: 'carol', role: 'introducer', ...(approved === undefined ? {} : { approved }) },
    ],
  }],
});

describe('readSignalMatches', () => {
  it('propagates a read failure instead of reporting an empty signal', async () => {
    await expect(readSignalMatches('alice', 'intent-1', listThrows, PERSONAL_AGENT_MATCH_STATUSES))
      .rejects.toThrow('connection reset');
  });

  it('flags an introduction whose introducer has not approved it', async () => {
    const [match] = await readSignalMatches('alice', 'intent-1', introduction(undefined), PERSONAL_AGENT_MATCH_STATUSES);
    expect(match!.awaitingIntroducerApproval).toBe(true);
  });

  it('clears the flag once every introducer has approved', async () => {
    const [match] = await readSignalMatches('alice', 'intent-1', introduction(true), PERSONAL_AGENT_MATCH_STATUSES);
    expect(match!.awaitingIntroducerApproval).toBe(false);
  });

  it('lists latent and draft matches, which a kickoff reaches out to', async () => {
    const matches = await readSignalMatches('alice', 'intent-1', introduction(true), PERSONAL_AGENT_MATCH_STATUSES);
    expect(matches.map((match) => match.status)).toEqual(['latent']);
  });
});

describe('readActionableCounterparties', () => {
  it('still degrades to an empty list — the tool surfaces would rather offer nothing', async () => {
    expect(await readActionableCounterparties('alice', 'intent-1', listThrows)).toEqual([]);
  });
});

/**
 * The two verdict lanes list DIFFERENT status sets, and must keep doing so.
 *
 * The position lane resolves a 1-based number the caller was shown, so
 * widening its list renumbers every entry and the verdict lands on a
 * different person. The id lane resolves an opportunity id, so it can — and
 * must — list everything the PersonalAgent's context numbered, or "accept the
 * first one" before kickoff answers `unknown_counterparty` for a match the
 * service accepts. One test per lane, so the pair cannot drift again.
 */
function twoMatches() {
  const rows = [
    { id: 'latent-1', status: 'latent', createdAt: new Date('2026-08-01'), counterpartName: 'Nia', actors: [{ userId: 'alice', role: 'peer' }] },
    { id: 'pending-1', status: 'pending', createdAt: new Date('2026-08-02'), counterpartName: 'Omar', actors: [{ userId: 'alice', role: 'peer' }] },
  ];
  const listed: Array<{ statuses: string[] }> = [];
  return {
    listed,
    deps: {
      listOpportunities: async (_userId: string, options: { statuses: string[] }) => {
        listed.push({ statuses: [...options.statuses] });
        return rows.filter((row) => options.statuses.includes(row.status));
      },
      updateStatus: async () => ({}),
    },
  };
}

describe('the two verdict lanes list what their own refs mean', () => {
  it('the POSITION lane stays narrow — widening it would renumber what the caller read', async () => {
    const { listed, deps } = twoMatches();

    // Position 1 of the ACTIONABLE list is the pending row. Widen the set and
    // the latent one sorts in ahead of it, so this call would decline a
    // different person than the number the caller was shown.
    const outcome = await rejectOpportunity('alice', { intentId: 'intent-1', counterparty: 1 }, deps);

    expect(listed[0]!.statuses).toEqual([...ACTIONABLE_VERDICT_STATUSES]);
    expect(outcome).toMatchObject({ status: 'executed', counterparty: 'Omar' });
  });

  it('the ID lane lists the wide set, so a latent match the agent numbered resolves', async () => {
    const { listed, deps } = twoMatches();

    const outcome = await passVerdictOnOpportunity(
      'alice',
      { intentId: 'intent-1', opportunityId: 'latent-1' },
      'accepted',
      deps,
    );

    expect(listed[0]!.statuses).toEqual([...PERSONAL_AGENT_MATCH_STATUSES]);
    // It resolved rather than answering `unknown_counterparty`.
    expect(outcome.status).not.toBe('unknown_counterparty');
  });

  it('the wide set is a strict superset of the narrow one, so the id lane can never see less', () => {
    for (const status of ACTIONABLE_VERDICT_STATUSES) {
      expect(PERSONAL_AGENT_MATCH_STATUSES).toContain(status);
    }
  });
});
