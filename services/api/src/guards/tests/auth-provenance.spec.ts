import { describe, expect, it } from 'bun:test';

import { recordRequestAuthContext } from '../../lib/request-auth-context';
import { isSessionAuthenticated } from '../auth.guard';

describe('isSessionAuthenticated — owner-action provenance', () => {
  it('recognizes an authenticated ordinary JWT context as a human session', () => {
    const request = new Request('http://localhost/opportunities/o/status', {
      headers: { Authorization: 'Bearer session.jwt.token' },
    });
    recordRequestAuthContext(request, { kind: 'session' });

    expect(isSessionAuthenticated(request)).toBe(true);
  });

  it('recognizes an authenticated query-token JWT context as a human session', () => {
    const request = new Request('http://localhost/opportunities/o/status?token=session.jwt.token');
    recordRequestAuthContext(request, { kind: 'session' });

    expect(isSessionAuthenticated(request)).toBe(true);
  });

  it('does not treat a bearer-carried v1 CLI API key as a human session', () => {
    const request = new Request('http://localhost/opportunities/o/status', {
      headers: { Authorization: 'Bearer legacy-cli-key' },
    });
    recordRequestAuthContext(request, { kind: 'api_key', agentId: null });

    expect(isSessionAuthenticated(request)).toBe(false);
  });

  it('does not treat an agent API-key context as a human session', () => {
    const request = new Request('http://localhost/opportunities/o/status', {
      headers: { 'x-api-key': 'agent-key' },
    });
    recordRequestAuthContext(request, { kind: 'api_key', agentId: 'agent-1' });

    expect(isSessionAuthenticated(request)).toBe(false);
  });

  it('does not invent provenance for an unauthenticated request', () => {
    expect(isSessionAuthenticated(new Request('http://localhost/opportunities/o/status'))).toBe(false);
  });
});
