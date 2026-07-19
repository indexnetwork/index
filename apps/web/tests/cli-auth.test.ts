import { describe, expect, test } from 'vitest';

import { validateCliCallbackUrl } from '@/lib/cli-auth';

describe('validateCliCallbackUrl', () => {
  test('accepts only a port-bound loopback callback path', () => {
    expect(validateCliCallbackUrl('http://127.0.0.1:43123/callback'))
      .toBe('http://127.0.0.1:43123/callback');
    expect(validateCliCallbackUrl('http://[::1]:43123/callback'))
      .toBe('http://[::1]:43123/callback');
  });

  test.each([
    null,
    'https://127.0.0.1:43123/callback',
    'http://localhost:43123/callback',
    'http://127.0.0.1/callback',
    'http://127.0.0.1:43123/other',
    'http://127.0.0.1:43123/callback?next=evil',
    'http://127.0.0.1:43123/callback#fragment',
    'http://attacker.example:43123/callback',
    'not-a-url',
  ])('rejects unsafe callback %s before credential minting', (value) => {
    expect(validateCliCallbackUrl(value)).toBeNull();
  });
});
