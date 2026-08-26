/**
 * Unit tests for PremiseCascade helpers and job dispatch. Injected deps
 * avoid Redis/DB/LLM; protocol/adapter modules are mocked.
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

import { PremiseCascade } from '../cascade';

describe('PremiseCascade — addDecomposeProfileJob', () => {
  it('runs profile decomposition for the user', async () => {
    const calls: string[] = [];
    const queue = new PremiseCascade({
      decomposeProfile: async (userId) => { calls.push(userId); },
    });
    await queue.addDecomposeProfileJob('user-1');
    expect(calls).toEqual(['user-1']);
  });
});

describe('PremiseCascade — job dispatch', () => {
  it('routes premise_decompose_profile to the injected decomposeProfile dep', async () => {
    const calls: string[] = [];
    const queue = new PremiseCascade({
      decomposeProfile: async (userId) => { calls.push(userId); },
    });

    await queue.processJob('premise_decompose_profile', { userId: 'user-2' });

    expect(calls).toEqual(['user-2']);
  });

  it('falls back to the default implementation when no dep is injected', async () => {
    mockGetUser.mockClear();
    mockCreateGraph.mockClear();
    mockGraphInvoke.mockClear();

    const queue = new PremiseCascade();
    await queue.processJob('premise_decompose_profile', { userId: 'user-1' });

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

    const queue = new PremiseCascade();
    await queue.processJob('premise_decompose_profile', { userId: 'user-3' });

    expect(mockGraphInvoke).not.toHaveBeenCalled();
  });
});
