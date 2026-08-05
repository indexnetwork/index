import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { isStaff, staffNotificationEmails } from '../staff';

describe('isStaff (network-request authorization boundary)', () => {
  const saved = process.env.STAFF_EMAILS;

  beforeEach(() => {
    delete process.env.STAFF_EMAILS;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.STAFF_EMAILS;
    else process.env.STAFF_EMAILS = saved;
  });

  test('an @index.network address is staff', () => {
    expect(isStaff({ email: 'alice@index.network' })).toBe(true);
  });

  test('is case-insensitive on the staff domain', () => {
    expect(isStaff({ email: 'Alice@Index.Network' })).toBe(true);
    expect(isStaff({ email: 'BOB@INDEX.NETWORK' })).toBe(true);
  });

  test('a non-staff outside address is rejected', () => {
    expect(isStaff({ email: 'someone@example.com' })).toBe(false);
  });

  test('missing/empty email is never staff', () => {
    expect(isStaff({ email: null })).toBe(false);
    expect(isStaff({ email: '' })).toBe(false);
  });

  test('STAFF_EMAILS grants staff regardless of domain, case-insensitively', () => {
    process.env.STAFF_EMAILS = 'Founder@Partner.io, ops@vendor.co';
    expect(isStaff({ email: 'founder@partner.io' })).toBe(true);
    expect(isStaff({ email: 'FOUNDER@PARTNER.IO' })).toBe(true);
    expect(isStaff({ email: 'ops@vendor.co' })).toBe(true);
    expect(isStaff({ email: 'stranger@partner.io' })).toBe(false);
  });
});

describe('staffNotificationEmails', () => {
  const saved = process.env.STAFF_EMAILS;

  afterEach(() => {
    if (saved === undefined) delete process.env.STAFF_EMAILS;
    else process.env.STAFF_EMAILS = saved;
  });

  test('falls back to hello@index.network when STAFF_EMAILS is unset', () => {
    delete process.env.STAFF_EMAILS;
    expect(staffNotificationEmails()).toEqual(['hello@index.network']);
  });

  test('uses the configured, normalized STAFF_EMAILS list when present', () => {
    process.env.STAFF_EMAILS = ' A@Index.Network , b@index.network ';
    expect(staffNotificationEmails()).toEqual(['a@index.network', 'b@index.network']);
  });
});
