import { describe, expect, it } from 'bun:test';

import { isSessionAuthenticated } from '../auth.guard';

describe('isSessionAuthenticated — owner-action provenance', () => {
  it('recognizes a Bearer JWT path as a human session', () => {
    const request = new Request('http://localhost/opportunities/o/status', {
      headers: { Authorization: 'Bearer session.jwt.token' },
    });
    expect(isSessionAuthenticated(request)).toBe(true);
  });

  it('recognizes a token query path as a human session', () => {
    const request = new Request('http://localhost/opportunities/o/status?token=session.jwt.token');
    expect(isSessionAuthenticated(request)).toBe(true);
  });

  it('does not treat an API key / agent principal as a human session', () => {
    const request = new Request('http://localhost/opportunities/o/status', {
      headers: { 'x-api-key': 'agent-key' },
    });
    expect(isSessionAuthenticated(request)).toBe(false);
  });

  it('does not invent provenance for an unauthenticated request', () => {
    expect(isSessionAuthenticated(new Request('http://localhost/opportunities/o/status'))).toBe(false);
  });
});
