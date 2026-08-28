/**
 * Unit tests for PremiseQueue triggers and handlers. Injected deps avoid
 * Redis/DB/LLM; adapter and protocol modules are mocked.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, afterAll } from 'bun:test';

const mockGetUser = mock(async (_userId: string) => ({
  id: 'user-1', name: 'Jane Doe', email: 'jane@example.com', intro: 'Engineer.', location: 'Berlin', socials: [],
}));

mock.module('../../adapters/database.adapter', () => ({
  ChatDatabaseAdapter: class {
    getUser = mockGetUser;
  },
  OpportunityDatabaseAdapter: class {},
}));

mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class {},
}));

const mockGraphInvoke = mock(async () => ({}));
const mockCreateGraph = mock(() => ({ invoke: mockGraphInvoke }));

mock.module('@indexnetwork/protocol', () => ({
  PremiseGraphFactory: class {
    createGraph = mockCreateGraph;
  },
}));

afterAll(() => {
  mock.restore();
});

import { PremiseQueue } from '../premise.queue';

describe('PremiseQueue — addDecomposeProfileJob', () => {
  it('triggers decomposeProfile in the background for the user', async () => {
    const calls: string[] = [];
    const queue = new PremiseQueue({
      decomposeProfile: async (userId) => { calls.push(userId); },
    });

    const result = await queue.addDecomposeProfileJob('user-1');
    expect(result).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toEqual(['user-1']);
  });
});

describe('PremiseQueue — decomposeProfile', () => {
  it('routes to the injected decomposeProfile dep', async () => {
    const calls: string[] = [];
    const queue = new PremiseQueue({
      decomposeProfile: async (userId) => { calls.push(userId); },
    });

    await queue.decomposeProfile({ userId: 'user-2' });

    expect(calls).toEqual(['user-2']);
  });

  it('falls back to the default implementation when no dep is injected', async () => {
    mockGetUser.mockClear();
    mockCreateGraph.mockClear();
    mockGraphInvoke.mockClear();

    const queue = new PremiseQueue();
    await queue.decomposeProfile({ userId: 'user-1' });

    expect(mockGetUser).toHaveBeenCalledWith('user-1');
    expect(mockGraphInvoke).toHaveBeenCalledWith({
      userId: 'user-1',
      input: 'Name: Jane Doe\n\nLocation: Berlin\n\nEngineer.',
      operationMode: 'decompose',
    });
  });

  it('skips decomposition when the user has no name, location, or intro', async () => {
    mockGetUser.mockClear();
    mockGraphInvoke.mockClear();
    mockGetUser.mockResolvedValueOnce({ id: 'user-3', name: '', email: 'x@example.com', intro: null, location: null, socials: [] });

    const queue = new PremiseQueue();
    await queue.decomposeProfile({ userId: 'user-3' });

    expect(mockGraphInvoke).not.toHaveBeenCalled();
  });
});
