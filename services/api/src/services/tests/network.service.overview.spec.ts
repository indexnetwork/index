/** Config */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, mock, test } from 'bun:test';

import { NetworkService } from '../network.service';
import type { ChatDatabaseAdapter } from '../../adapters/database.adapter';

const NETWORK_ID = 'net-1';
const USER_ID = 'user-1';

/**
 * Build a NetworkService over a minimal mock adapter for getNetworkOverview.
 * `isMember` controls the membership gate; the three data reads return one row
 * each so the composed payload is observable. See EDG-53.
 */
function makeService(isMember: boolean, userContext: { text: string; generatedAt: Date } | null = { text: 'ctx', generatedAt: new Date() }) {
  const isNetworkMember = mock(async () => isMember);
  const getNetworkIntentsForMemberOwn = mock(async () => [
    { id: 'i1', payload: 'P', summary: null, userId: USER_ID, userName: 'A', createdAt: new Date() },
  ]);
  const getNetworkPremisesForMember = mock(async () => [
    { id: 'p1', text: 'premise', summary: null, createdAt: new Date() },
  ]);
  const getUserContext = mock(async () => (userContext
    ? { id: 'c1', text: userContext.text, embedding: [] as number[], premiseHash: '', generatedAt: userContext.generatedAt }
    : null));
  const adapter = {
    isNetworkMember,
    getNetworkIntentsForMemberOwn,
    getNetworkPremisesForMember,
    getUserContext,
  } as unknown as ChatDatabaseAdapter;
  return { service: new NetworkService(adapter), isNetworkMember, getNetworkIntentsForMemberOwn, getNetworkPremisesForMember, getUserContext };
}

describe('networkService.getNetworkOverview (EDG-53)', () => {
  test('throws and runs no data reads for a non-member', async () => {
    const { service, isNetworkMember, getNetworkIntentsForMemberOwn, getNetworkPremisesForMember, getUserContext } = makeService(false);
    await expect(service.getNetworkOverview(NETWORK_ID, USER_ID)).rejects.toThrow(/Access denied/);
    expect(isNetworkMember).toHaveBeenCalledWith(NETWORK_ID, USER_ID);
    expect(getNetworkIntentsForMemberOwn).not.toHaveBeenCalled();
    expect(getNetworkPremisesForMember).not.toHaveBeenCalled();
    expect(getUserContext).not.toHaveBeenCalled();
  });

  test('composes intents, premises and trimmed user_context for a member', async () => {
    const { service, getNetworkIntentsForMemberOwn, getUserContext } = makeService(true);
    const overview = await service.getNetworkOverview(NETWORK_ID, USER_ID);
    // The honest, uncapped user-scoped query is used (not getMyIntentsInNetwork).
    expect(getNetworkIntentsForMemberOwn).toHaveBeenCalledWith(NETWORK_ID, USER_ID);
    expect(getUserContext).toHaveBeenCalledWith(USER_ID, NETWORK_ID);
    expect(overview.intents).toHaveLength(1);
    expect(overview.premises).toHaveLength(1);
    // Only text + generatedAt are surfaced; the embedding never leaves the adapter.
    expect(overview.userContext).toEqual({ text: 'ctx', generatedAt: expect.any(Date) });
  });

  test('returns null user_context when the member has none for the network', async () => {
    const { service } = makeService(true, null);
    const overview = await service.getNetworkOverview(NETWORK_ID, USER_ID);
    expect(overview.userContext).toBeNull();
  });
});
