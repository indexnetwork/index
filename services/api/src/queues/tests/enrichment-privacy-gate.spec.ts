import { describe, expect, it } from 'bun:test';

// Keep this queue-decision spec hermetic even though the queue module imports
// the default database adapter for production use.
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

const { EnrichmentQueue } = await import('../enrichment.queue.js');

for (const [key, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

// The adapter's data-source behavior is covered separately. These tests inject
// its narrow read contract and exercise the queue's real admission logic.
let admissionContext: {
  userExists: boolean;
  networkExists: boolean;
  membershipExists: boolean;
  hasActivePremise: boolean;
} = {
  userExists: true,
  networkExists: true,
  membershipExists: true,
  hasActivePremise: false,
};
const admissionContextCalls: Array<[string, string | undefined]> = [];

function callGate(data: { userId: string; networkId?: string }) {
  const queue = new EnrichmentQueue({
    admissionDatabase: {
      async getEnrichmentAdmissionContext(userId: string, networkId?: string) {
        admissionContextCalls.push([userId, networkId]);
        return admissionContext;
      },
    } as never,
  });
  return (queue as unknown as {
    resolveAdmissionDecision(
      name: 'ensure_profile_hyde',
      data: { userId: string; networkId?: string },
    ): Promise<{ allowed: boolean; reason: string; hasExistingProfile: boolean }>;
  }).resolveAdmissionDecision('ensure_profile_hyde', data);
}

describe('EnrichmentQueue.resolveAdmissionDecision — enrichment signal (WS10)', () => {
  it('keys hasExistingProfile on the adapter-reported ACTIVE premise', async () => {
    admissionContextCalls.length = 0;
    admissionContext = {
      userExists: true,
      networkExists: true,
      membershipExists: true,
      hasActivePremise: true,
    };

    const decision = await callGate({ userId: 'u1', networkId: 'n1' });

    expect(decision.hasExistingProfile).toBe(true);
    expect(decision.reason).toBe('existing_profile_no_public_enrichment_needed');
    expect(decision.allowed).toBe(true);
    expect(admissionContextCalls).toContainEqual(['u1', 'n1']);
  });

  it('treats a user with no ACTIVE premises as not-yet-enriched', async () => {
    admissionContextCalls.length = 0;
    admissionContext = {
      userExists: true,
      networkExists: true,
      membershipExists: true,
      hasActivePremise: false,
    };

    const decision = await callGate({ userId: 'u2', networkId: 'n1' });

    expect(decision.hasExistingProfile).toBe(false);
    expect(decision.reason).toBe('enrichment_allowed');
    expect(admissionContextCalls).toContainEqual(['u2', 'n1']);
  });

  it('denies a scoped job when membership was removed', async () => {
    admissionContextCalls.length = 0;
    admissionContext = {
      userExists: true,
      networkExists: true,
      membershipExists: false,
      hasActivePremise: false,
    };

    expect(await callGate({ userId: 'u1', networkId: 'n1' })).toEqual({
      allowed: false,
      reason: 'network_membership_not_found',
      hasExistingProfile: false,
    });
  });

  it('denies a removed membership before applying the existing-profile shortcut', async () => {
    admissionContextCalls.length = 0;
    admissionContext = {
      userExists: true,
      networkExists: true,
      membershipExists: false,
      hasActivePremise: true,
    };

    expect(await callGate({ userId: 'u1', networkId: 'n1' })).toEqual({
      allowed: false,
      reason: 'network_membership_not_found',
      hasExistingProfile: true,
    });
  });

  it('reports a missing user before a missing network', async () => {
    admissionContextCalls.length = 0;
    admissionContext = {
      userExists: false,
      networkExists: false,
      membershipExists: false,
      hasActivePremise: false,
    };

    expect(await callGate({ userId: 'u1', networkId: 'n1' })).toEqual({
      allowed: false,
      reason: 'user_not_found',
      hasExistingProfile: false,
    });
  });

  it('checks that an unscoped job still has a live user', async () => {
    admissionContextCalls.length = 0;
    admissionContext = {
      userExists: false,
      networkExists: true,
      membershipExists: true,
      hasActivePremise: false,
    };

    const decision = await callGate({ userId: 'u3' });

    expect(decision.reason).toBe('user_not_found');
    expect(admissionContextCalls).toContainEqual(['u3', undefined]);
  });
});
