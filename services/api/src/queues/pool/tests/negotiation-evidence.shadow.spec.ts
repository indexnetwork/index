import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { chatDatabaseAdapter } from '../../../adapters/database.adapter';
import { maybeRunNegotiationEvidenceShadow } from '../negotiation-evidence.shadow';
import type { PoolMiningTrigger } from '../mining.shared';

const TRIGGER: PoolMiningTrigger = {
  source: 'discovery_run',
  userId: 'owner-1',
  intentId: 'intent-1',
};

afterEach(() => {
  delete process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE;
});

describe('maybeRunNegotiationEvidenceShadow — gating', () => {
  it('is a no-op when the flag is off (never touches the database)', async () => {
    delete process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE;
    const getIntent = spyOn(chatDatabaseAdapter, 'getIntent');
    await maybeRunNegotiationEvidenceShadow(TRIGGER);
    expect(getIntent).not.toHaveBeenCalled();
    getIntent.mockRestore();
  });

  it('is a no-op for introducer-flow and intent-less triggers even when enabled', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const getIntent = spyOn(chatDatabaseAdapter, 'getIntent');
    await maybeRunNegotiationEvidenceShadow({ ...TRIGGER, isIntroducerFlow: true });
    await maybeRunNegotiationEvidenceShadow({ ...TRIGGER, intentId: undefined });
    expect(getIntent).not.toHaveBeenCalled();
    getIntent.mockRestore();
  });

  it('stops when the intent is not owned by the trigger user (no pool read)', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const getIntent = spyOn(chatDatabaseAdapter, 'getIntent').mockResolvedValue({
      userId: 'someone-else',
      payload: {},
      summary: '',
    } as never);
    const getPool = spyOn(chatDatabaseAdapter, 'getLivePoolOpportunitiesForIntent');
    await maybeRunNegotiationEvidenceShadow(TRIGGER);
    expect(getIntent).toHaveBeenCalledTimes(1);
    expect(getPool).not.toHaveBeenCalled();
    getIntent.mockRestore();
    getPool.mockRestore();
  });

  it('never throws even when the database read fails (failure isolation)', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const getIntent = spyOn(chatDatabaseAdapter, 'getIntent').mockRejectedValue(new Error('db down'));
    await expect(maybeRunNegotiationEvidenceShadow(TRIGGER)).resolves.toBeUndefined();
    getIntent.mockRestore();
  });
});
