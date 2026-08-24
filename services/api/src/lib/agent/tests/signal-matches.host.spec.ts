import { describe, expect, it } from 'bun:test';

import { PERSONAL_AGENT_MATCH_STATUSES, readActionableCounterparties, readSignalMatches } from '../negotiator-verdict.host';

/**
 * The PersonalAgent's every turn reasons over this list, so a read that failed
 * must FAIL the turn. Making the protocol seam throw achieved nothing while
 * the only host binding behind it caught everything and returned `[]`: a
 * transient database error still produced a reflect that saw no negotiations,
 * decided nothing, succeeded — and permanently consumed the round's one
 * retained reflect job.
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
