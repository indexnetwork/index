import { describe, expect, test } from 'bun:test';

import { isInviteLanding } from './invite-landing';

const BASE = 'https://index.network';

describe('isInviteLanding', () => {
  test('absolute invite landing URL', () => {
    expect(isInviteLanding('https://index.network/l/abc123', BASE)).toBe(true);
  });

  test('invite landing URL with query from the visit', () => {
    expect(isInviteLanding('https://index.network/l/abc123?utm_source=x', BASE)).toBe(true);
  });

  test('percent-encoded callback URL, as magic-link verify can pass it', () => {
    expect(isInviteLanding(encodeURIComponent('https://index.network/l/abc123'), BASE)).toBe(true);
  });

  test('relative invite landing path', () => {
    expect(isInviteLanding('/l/abc123', BASE)).toBe(true);
  });

  test('ordinary sign-in destinations', () => {
    expect(isInviteLanding('https://index.network/', BASE)).toBe(false);
    expect(isInviteLanding('/', BASE)).toBe(false);
    expect(isInviteLanding('/networks/some-id', BASE)).toBe(false);
  });

  test('lookalike paths are not invite landings', () => {
    expect(isInviteLanding('https://index.network/login', BASE)).toBe(false);
    expect(isInviteLanding('https://index.network/landing', BASE)).toBe(false);
  });

  test('missing callback URL', () => {
    expect(isInviteLanding(undefined, BASE)).toBe(false);
    expect(isInviteLanding('', BASE)).toBe(false);
  });
});
