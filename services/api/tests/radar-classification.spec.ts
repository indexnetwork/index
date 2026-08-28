import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect } from 'bun:test';
import { classifyOpportunity, RADAR_SOFT_TARGETS } from '@indexnetwork/protocol';

describe('classifyOpportunity', () => {
  const viewerId = 'user-1';

  it('classifies expired opportunity as expired', () => {
    const opp = {
      actors: [{ userId: viewerId, role: 'party' }, { userId: 'user-2', role: 'party' }],
      status: 'expired',
    };
    expect(classifyOpportunity(opp, viewerId)).toBe('expired');
  });

  it('classifies as connection when someone else is the introducer', () => {
    const opp = {
      actors: [
        { userId: viewerId, role: 'party' },
        { userId: 'user-2', role: 'party' },
        { userId: 'user-3', role: 'introducer' },
      ],
      status: 'pending',
    };
    expect(classifyOpportunity(opp, viewerId)).toBe('connection');
  });

  it('classifies opportunity without introducer as connection', () => {
    const opp = {
      actors: [{ userId: viewerId, role: 'party' }, { userId: 'user-2', role: 'party' }],
      status: 'pending',
    };
    expect(classifyOpportunity(opp, viewerId)).toBe('connection');
  });

});

describe('RADAR_SOFT_TARGETS', () => {
  it('has expected default values', () => {
    expect(RADAR_SOFT_TARGETS.connection).toBe(5);
    expect(RADAR_SOFT_TARGETS.expired).toBe(2);
  });
});
