import { describe, expect, it, spyOn } from 'bun:test';

import { log } from '../../log';
import { sanitizeHermesAssuranceOutput } from '../hermes-assurance-output';

describe('Hermes assurance child output', () => {
  it('preserves failure diagnostics while redacting credentials, hashes, and fixture identities', () => {
    const output = sanitizeHermesAssuranceOutput([
      'error: expected idxh_superSecretCredential to be active',
      'ownerId=2a5a250c-42c6-4f98-b9e4-9afba938f443 agentId=7aca65ed-b165-49d3-b4af-4f6522911357',
      'keyHashPrefix=deadbeef digest=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'secretHash=uJ8bX7aQ9mN2pR4sT6vW0yZ1cD3eF5gH7iK9lM2nP4q',
      'opaque 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      'opaque uJ8bX7aQ9mN2pR4sT6vW0yZ1cD3eF5gH7iK9lM2nP4q',
      'at tests/hermes-runtime-lifecycle.database.isolated.ts:80:13',
      '1 tests failed',
    ].join('\n'));

    expect(output).toContain('error:');
    expect(output).toContain('tests/hermes-runtime-lifecycle.database.isolated.ts:80:13');
    expect(output).toContain('1 tests failed');
    expect(output).not.toContain('idxh_');
    expect(output).not.toContain('deadbeef');
    expect(output).not.toContain('2a5a250c');
    expect(output).not.toContain('7aca65ed');
    expect(output).not.toContain('uJ8bX7a');
    expect(output).toContain('[REDACTED_CREDENTIAL]');
    expect(output).toContain('[REDACTED_ID]');
    expect(output).toContain('[REDACTED_HASH]');
  });

  it('suppresses application logs only in the explicit test assurance mode', () => {
    const previous = process.env.API_TEST_HERMES_ASSURANCE_QUIET;
    const info = spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      delete process.env.API_TEST_HERMES_ASSURANCE_QUIET;
      log.service.from('assurance-contract').info('ordinary test log');
      expect(info).toHaveBeenCalledTimes(1);

      process.env.API_TEST_HERMES_ASSURANCE_QUIET = '1';
      log.service.from('assurance-contract').info('identity-bearing fixture log', {
        ownerId: '2a5a250c-42c6-4f98-b9e4-9afba938f443',
      });
      expect(info).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.API_TEST_HERMES_ASSURANCE_QUIET;
      else process.env.API_TEST_HERMES_ASSURANCE_QUIET = previous;
      info.mockRestore();
    }
  });
});
