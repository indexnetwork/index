import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { logNegotiationPickupConflict } from '../../lib/agent/negotiation-polling.log';

const forbidden = [
  'agentId', 'userId', 'ownerId', 'credentialId', 'installationId',
  'agent-private-value', 'owner-private-value',
  'idxh_credential_variant', 'idxo_owner_credential_variant',
];

afterEach(() => {
  delete process.env.FORCE_COLOR;
});

describe('negotiation polling conflict application log', () => {
  it('emits only the fixed stable reason without owner, agent, or credential material', () => {
    const info = spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      logNegotiationPickupConflict();
      expect(info).toHaveBeenCalledTimes(1);
      const rendered = String(info.mock.calls[0]?.[0]);
      expect(rendered).toContain('Lost race to claim negotiation task');
      expect(rendered).toContain('"reason":"runtime_conflict"');
      for (const value of forbidden) expect(rendered).not.toContain(value);
    } finally {
      info.mockRestore();
    }
  });
});
