import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect, mock } from 'bun:test';
import {
  selectContactsForDiscovery,
  shouldRunIntroducerDiscovery,
  runIntroducerDiscovery,
  MAX_CONTACTS_PER_CYCLE,
  MAX_CANDIDATES_PER_CONTACT,
  INTRODUCER_DISCOVERY_SOURCE,
  type IntroducerDiscoveryDatabase,
  type IntroducerDiscoveryQueue,
  type ContactWithIntents,
} from '@indexnetwork/protocol';

describe('IntroducerDiscovery', () => {
  const userId = 'user-introducer';
  const personalNetworkId = 'personal-index-1';

  function createMockDatabase(overrides: {
    personalNetworkId?: string | null;
    contacts?: ContactWithIntents[];
  } = {}): IntroducerDiscoveryDatabase {
    return {
      getPersonalNetworkId: mock(() =>
        Promise.resolve(overrides.personalNetworkId ?? personalNetworkId),
      ),
      getContactsWithIntentFreshness: mock(() =>
        Promise.resolve(overrides.contacts ?? []),
      ),
    };
  }

  function createMockQueue(): IntroducerDiscoveryQueue {
    return {
      addJob: mock(() => Promise.resolve({ id: 'job-1' })),
    };
  }

  describe('constants', () => {
    it('exports expected constant values', () => {
      expect(MAX_CONTACTS_PER_CYCLE).toBe(5);
      expect(MAX_CANDIDATES_PER_CONTACT).toBe(3);
      expect(INTRODUCER_DISCOVERY_SOURCE).toBe('introducer_discovery');
    });
  });

  describe('shouldRunIntroducerDiscovery', () => {
    it('returns true when connector-flow count is below target', () => {
      expect(shouldRunIntroducerDiscovery(0, 2)).toBe(true);
      expect(shouldRunIntroducerDiscovery(1, 2)).toBe(true);
    });

    it('returns false when connector-flow count meets or exceeds target', () => {
      expect(shouldRunIntroducerDiscovery(2, 2)).toBe(false);
      expect(shouldRunIntroducerDiscovery(3, 2)).toBe(false);
    });

    it('uses default target of 2', () => {
      expect(shouldRunIntroducerDiscovery(0)).toBe(true);
      expect(shouldRunIntroducerDiscovery(2)).toBe(false);
    });
  });

  describe('selectContactsForDiscovery', () => {
    it('returns empty when user has no personal index', async () => {
      const db = createMockDatabase({ personalNetworkId: null });
      const result = await selectContactsForDiscovery(db, userId);
      expect(result).toEqual([]);
    });

    it('includes contacts regardless of intent count (profile matches are valuable)', async () => {
      const contacts: ContactWithIntents[] = [
        { userId: 'contact-1', latestIntentAt: '2026-03-27T00:00:00Z', intentCount: 3 },
        { userId: 'contact-2', latestIntentAt: null, intentCount: 0 },
        { userId: 'contact-3', latestIntentAt: '2026-03-26T00:00:00Z', intentCount: 1 },
      ];
      const db = createMockDatabase({ contacts });
      const result = await selectContactsForDiscovery(db, userId);

      expect(result).toHaveLength(3);
      expect(result.map((c) => c.userId)).toEqual(['contact-1', 'contact-2', 'contact-3']);
    });

    it('respects the limit parameter', async () => {
      const db = createMockDatabase();
      await selectContactsForDiscovery(db, userId, 3);

      expect(db.getContactsWithIntentFreshness).toHaveBeenCalledWith(
        personalNetworkId,
        userId,
        3,
      );
    });

    it('passes default limit of MAX_CONTACTS_PER_CYCLE', async () => {
      const db = createMockDatabase();
      await selectContactsForDiscovery(db, userId);

      expect(db.getContactsWithIntentFreshness).toHaveBeenCalledWith(
        personalNetworkId,
        userId,
        MAX_CONTACTS_PER_CYCLE,
      );
    });
  });

  describe('runIntroducerDiscovery', () => {
    it('returns early when user has no contacts', async () => {
      const db = createMockDatabase({ contacts: [] });
      const queue = createMockQueue();
      const result = await runIntroducerDiscovery(db, queue, userId);

      expect(result.contactsEvaluated).toBe(0);
      expect(result.jobsEnqueued).toBe(0);
      expect(result.skippedReason).toBe('no_contacts');
      expect(queue.addJob).not.toHaveBeenCalled();
    });

    it('returns early when user has no personal index', async () => {
      const db = createMockDatabase({ personalNetworkId: null });
      const queue = createMockQueue();
      const result = await runIntroducerDiscovery(db, queue, userId);

      expect(result.contactsEvaluated).toBe(0);
      expect(result.skippedReason).toBe('no_contacts');
    });

    it('enqueues discovery jobs for contacts with intents', async () => {
      const contacts: ContactWithIntents[] = [
        { userId: 'contact-1', latestIntentAt: '2026-03-27T00:00:00Z', intentCount: 2 },
        { userId: 'contact-2', latestIntentAt: '2026-03-26T00:00:00Z', intentCount: 1 },
      ];
      const db = createMockDatabase({ contacts });
      const queue = createMockQueue();
      const result = await runIntroducerDiscovery(db, queue, userId);

      expect(result.contactsEvaluated).toBe(2);
      expect(result.jobsEnqueued).toBe(2);
      expect(queue.addJob).toHaveBeenCalledTimes(2);

      // Verify job data includes introducer prefix and personal index
      const firstCall = (queue.addJob as ReturnType<typeof mock>).mock.calls[0];
      expect(firstCall[0].intentId).toStartWith('introducer:');
      expect(firstCall[0].userId).toBe(userId);
      expect(firstCall[0].networkIds).toEqual([personalNetworkId]);
      expect(firstCall[1].priority).toBe(15);
    });

    it('handles duplicate job IDs gracefully', async () => {
      const contacts: ContactWithIntents[] = [
        { userId: 'contact-1', latestIntentAt: '2026-03-27T00:00:00Z', intentCount: 1 },
      ];
      const db = createMockDatabase({ contacts });
      const queue: IntroducerDiscoveryQueue = {
        addJob: mock(() => Promise.reject(new Error('Duplicate job ID'))),
      };
      const result = await runIntroducerDiscovery(db, queue, userId);

      expect(result.contactsEvaluated).toBe(1);
      expect(result.jobsEnqueued).toBe(0);
    });
  });
});
