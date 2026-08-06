import { describe, expect, it } from 'bun:test';

// Import the adapter response mapper without allowing this hermetic spec to
// probe a database. Restore the environment immediately after import.
const savedEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  API_TEST_ISOLATED_CHILD: process.env.API_TEST_ISOLATED_CHILD,
  API_TEST_DATABASE_READY: process.env.API_TEST_DATABASE_READY,
  API_TEST_PARENT_PID: process.env.API_TEST_PARENT_PID,
};
process.env.DATABASE_URL ||= 'postgres://stub:stub@localhost:5432/stub';
process.env.API_TEST_ISOLATED_CHILD = '1';
process.env.API_TEST_DATABASE_READY = '1';
process.env.API_TEST_PARENT_PID = String(process.ppid);

const { buildNetworkShareResponse } = await import('../chat.database.adapter.js');

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('buildNetworkShareResponse', () => {
  it('fails closed when stored permissions contain a malformed join policy', () => {
    const response = buildNetworkShareResponse({
      id: 'network-1',
      title: 'Network',
      prompt: null,
      imageUrl: null,
      permissions: {
        joinPolicy: 'future',
        invitationLink: { code: 'invite-code' },
        profileEnrichment: 'consent_required',
      },
      createdAt: new Date('2026-08-06T00:00:00.000Z'),
      updatedAt: new Date('2026-08-06T00:00:00.000Z'),
      ownerId: 'owner-1',
      userName: 'Owner',
      userAvatar: null,
    }, 3);

    expect(response.joinPolicy).toBe('invite_only');
    expect(response).not.toHaveProperty('permissions');
    expect(response._count.members).toBe(3);
  });
});
