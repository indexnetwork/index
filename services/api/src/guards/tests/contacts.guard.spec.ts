/**
 * Tests for ContactsEnabledGuard — gates the contact import / manual-add
 * endpoints. Throws Error('Not found') (mapped to 404 in main.ts) when the
 * CONTACTS_ENABLED flag is not exactly 'true'.
 *
 * Run: bun test src/guards/tests/contacts.guard.spec.ts
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ContactsEnabledGuard } from '../contacts.guard';

const req = () => new Request('http://localhost/users/contacts', { method: 'POST' });
let prev: string | undefined;

describe('ContactsEnabledGuard', () => {
  beforeEach(() => {
    prev = process.env.CONTACTS_ENABLED;
  });
  afterEach(() => {
    process.env.CONTACTS_ENABLED = prev;
  });

  test('passes (returns void) when CONTACTS_ENABLED === "true"', async () => {
    process.env.CONTACTS_ENABLED = 'true';
    await expect(ContactsEnabledGuard(req())).resolves.toBeUndefined();
  });

  test('throws "Not found" (→404) when CONTACTS_ENABLED === "false"', async () => {
    process.env.CONTACTS_ENABLED = 'false';
    await expect(ContactsEnabledGuard(req())).rejects.toThrow('Not found');
  });

  test('throws "Not found" (→404) when CONTACTS_ENABLED is unset (disabled-when-unset)', async () => {
    delete process.env.CONTACTS_ENABLED;
    await expect(ContactsEnabledGuard(req())).rejects.toThrow('Not found');
  });

  test('throws when CONTACTS_ENABLED is any non-"true" value', async () => {
    process.env.CONTACTS_ENABLED = '1';
    await expect(ContactsEnabledGuard(req())).rejects.toThrow('Not found');
  });
});
