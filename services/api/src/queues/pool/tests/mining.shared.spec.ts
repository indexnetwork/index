import { describe, expect, it, mock } from 'bun:test';

import { selectPoolForMining } from '../mining.shared';

describe('pool discriminator mining scope', () => {
  it('uses the exact-trigger pool selector for intent-scoped mining', async () => {
    const exactPool = mock(async () => []);
    const broadRadar = mock(async () => []);

    await selectPoolForMining('owner-1', 'intent-1', undefined, {
      getLivePoolOpportunitiesForIntent: exactPool,
      getOpportunitiesForUser: broadRadar,
    });

    expect(exactPool).toHaveBeenCalledWith('owner-1', 'intent-1');
    expect(broadRadar).not.toHaveBeenCalled();
  });
});
