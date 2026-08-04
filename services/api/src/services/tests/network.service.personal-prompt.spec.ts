/** Config */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, mock, test } from 'bun:test';

import { NetworkService } from '../network.service';
import type { ChatDatabaseAdapter } from '../../adapters/database.adapter';

const PERSONAL_ID = 'personal-net-1';
const USER_ID = 'user-1';

/**
 * Build a NetworkService backed by a minimal mock adapter. `isPersonalNetwork`
 * reports PERSONAL_ID as personal; `updateIndexSettings` records its call and
 * echoes the patch. Ownership is enforced inside the real adapter, so the unit
 * test only exercises the service's field allowlist.
 */
function makeService() {
  const updateIndexSettings = mock(async (id: string, _userId: string, data: Record<string, unknown>) => ({ id, ...data }));
  const adapter = {
    isPersonalNetwork: mock(async (id: string) => id === PERSONAL_ID),
    updateIndexSettings,
  } as unknown as ChatDatabaseAdapter;
  return { service: new NetworkService(adapter), updateIndexSettings };
}

describe('networkService.updateNetwork on a personal network', () => {
  test('allows a prompt-only edit', async () => {
    const { service, updateIndexSettings } = makeService();
    await service.updateNetwork(PERSONAL_ID, USER_ID, { prompt: 'AI founders only' });
    expect(updateIndexSettings).toHaveBeenCalledWith(PERSONAL_ID, USER_ID, { prompt: 'AI founders only' });
  });

  test('allows clearing the prompt (null) — restores the prompt-less default', async () => {
    const { service, updateIndexSettings } = makeService();
    await service.updateNetwork(PERSONAL_ID, USER_ID, { prompt: null });
    expect(updateIndexSettings).toHaveBeenCalledWith(PERSONAL_ID, USER_ID, { prompt: null });
  });

  test('rejects a rename (title) on a personal network', async () => {
    const { service, updateIndexSettings } = makeService();
    await expect(
      service.updateNetwork(PERSONAL_ID, USER_ID, { title: 'Renamed' }),
    ).rejects.toThrow(/only allow editing the prompt/);
    expect(updateIndexSettings).not.toHaveBeenCalled();
  });

  test('rejects non-prompt fields even alongside a valid prompt', async () => {
    const { service, updateIndexSettings } = makeService();
    await expect(
      service.updateNetwork(PERSONAL_ID, USER_ID, { prompt: 'ok', imageUrl: 'x', joinPolicy: 'anyone' }),
    ).rejects.toThrow(/rejected: imageUrl, joinPolicy/);
    expect(updateIndexSettings).not.toHaveBeenCalled();
  });

  test('rejects hidden on a personal network (non-prompt field)', async () => {
    const { service, updateIndexSettings } = makeService();
    await expect(
      service.updateNetwork(PERSONAL_ID, USER_ID, { hidden: true }),
    ).rejects.toThrow(/rejected: hidden/);
    expect(updateIndexSettings).not.toHaveBeenCalled();
  });
});

describe('networkService.updateNetwork on a regular network', () => {
  test('passes hidden through to the adapter', async () => {
    const { service, updateIndexSettings } = makeService();
    await service.updateNetwork('regular-net-1', USER_ID, { hidden: true });
    expect(updateIndexSettings).toHaveBeenCalled();
    expect(updateIndexSettings.mock.calls[0][2]).toMatchObject({ hidden: true });
  });
});
