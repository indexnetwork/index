import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { EnrichmentGraphFactory } from '../enrichment.graph.js';
import type { EnrichmentGraphDatabase } from '../../../platform/database.js';
import type { UserIdentity } from '../../../protocol/schemas/identity.schema.js';

describe('ProfileGraph (query mode)', () => {
  let factory: EnrichmentGraphFactory;
  let mockDatabase: EnrichmentGraphDatabase;

  const mockProfile: UserIdentity = {
    userId: 'test-user-id',
    identity: {
      name: 'Test User',
      bio: 'A test user bio',
      location: 'Test City, Test Country'
    },
    context: 'Test user is working on testing things',
  };

  beforeEach(() => {
    mockDatabase = {
      getProfile: mock(async (userId: string) => null),
      getProfileByUserId: mock(async (userId: string) => null),
      getPremisesForUser: mock(async () => []),
    } as any;

    factory = new EnrichmentGraphFactory(mockDatabase);
  });

  it('should return existing profile without generation in query mode', async () => {
    // Enrichment presence is signalled by ACTIVE premises (the user_profiles
    // replacement), not by getProfile being non-null.
    (mockDatabase.getProfile as any).mockResolvedValue(mockProfile);
    (mockDatabase.getPremisesForUser as any).mockResolvedValue([{ id: 'p1' }]);
    (mockDatabase.getProfileByUserId as any).mockResolvedValue({ id: 'profile-id' });

    const graph = factory.createGraph();
    const result = await graph.invoke({
      userId: 'test-user-id',
      operationMode: 'query'
    });

    expect(result.profile).toEqual(mockProfile);
    expect(mockDatabase.getProfile).toHaveBeenCalledWith('test-user-id');
    expect(result.readResult?.hasProfile).toBe(true);
    expect(result.readResult?.profile?.name).toBe('Test User');
  });

  it('should return undefined in query mode when profile does not exist', async () => {
    (mockDatabase.getProfile as any).mockResolvedValue(null);

    const graph = factory.createGraph();
    const result = await graph.invoke({
      userId: 'test-user-id',
      operationMode: 'query'
    });

    expect(result.profile).toBeUndefined();
    expect(result.readResult?.hasProfile).toBe(false);
  });

  it('should surface a database error without throwing', async () => {
    (mockDatabase.getProfile as any).mockRejectedValue(new Error('db down'));

    const graph = factory.createGraph();
    const result = await graph.invoke({
      userId: 'test-user-id',
      operationMode: 'query'
    });

    expect(result.error).toContain('db down');
  });
});
