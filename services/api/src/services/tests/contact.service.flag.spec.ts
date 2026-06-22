/**
 * Tests for the CONTACTS_ENABLED gate on ContactService write/create paths.
 *
 * The gate must short-circuit BEFORE any DB access so no ghost users are minted
 * when the feature is disabled. We inject a DB stub that throws if touched.
 *
 * Run: bun test src/services/tests/contact.service.flag.spec.ts
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { ContactService } from '../contact.service';
import { ContactsDisabledError } from '../../lib/contacts-feature';

// DB stub: any method access throws, proving the gate runs before DB work.
const explodingDb = new Proxy(
  {},
  {
    get() {
      return () => {
        throw new Error('DB must not be touched when contacts are disabled');
      };
    },
  },
) as never;

const OWNER = '00000000-0000-4000-8000-0000000000aa';
let prev: string | undefined;

describe('ContactService — CONTACTS_ENABLED gate (disabled)', () => {
  beforeEach(() => {
    prev = process.env.CONTACTS_ENABLED;
    process.env.CONTACTS_ENABLED = 'false';
  });
  afterEach(() => {
    process.env.CONTACTS_ENABLED = prev;
  });

  it('addContact throws ContactsDisabledError without touching the DB', async () => {
    const svc = new ContactService(explodingDb);
    await expect(svc.addContact(OWNER, 'someone@example.com')).rejects.toBeInstanceOf(ContactsDisabledError);
  });

  it('importContacts throws ContactsDisabledError without touching the DB', async () => {
    const svc = new ContactService(explodingDb);
    await expect(
      svc.importContacts(OWNER, [{ name: 'A', email: 'a@example.com' }]),
    ).rejects.toBeInstanceOf(ContactsDisabledError);
  });

  it('resolveUsers throws ContactsDisabledError without touching the DB', async () => {
    const svc = new ContactService(explodingDb);
    await expect(
      svc.resolveUsers(OWNER, [{ name: 'A', email: 'a@example.com' }]),
    ).rejects.toBeInstanceOf(ContactsDisabledError);
  });
});

describe('ContactService — CONTACTS_ENABLED gate (enabled passes the gate)', () => {
  beforeEach(() => {
    prev = process.env.CONTACTS_ENABLED;
    process.env.CONTACTS_ENABLED = 'true';
  });
  afterEach(() => {
    process.env.CONTACTS_ENABLED = prev;
  });

  it('addContact proceeds past the gate and reaches the DB when enabled', async () => {
    const svc = new ContactService(explodingDb);
    // Passes the flag check, then hits the exploding DB stub — proving the gate
    // did NOT block it. The DB error is the only thing that should surface.
    await expect(svc.addContact(OWNER, 'someone@example.com')).rejects.toThrow('DB must not be touched');
  });
});
