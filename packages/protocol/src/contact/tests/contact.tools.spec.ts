/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { createContactTools } from "../contact.tools.js";
import type { ResolvedToolContext } from "../tool.helpers.js";

// ─── Minimal context stub ─────────────────────────────────────────────────────

const userId = '00000000-0000-4000-8000-000000000001';

const context: ResolvedToolContext = {
  userId,
  userName: 'Test User',
  userEmail: 'test@example.com',
  user: { id: userId, name: 'Test User', email: 'test@example.com' } as never,
  userProfile: null,
  userNetworks: [],
  isOnboarding: false,
  hasName: true,
};

// ─── Mock contactService ───────────────────────────────────────────────────────

function makeDeps(overrides?: {
  importContacts?: () => unknown;
  listContacts?: () => unknown;
  addContact?: () => unknown;
  removeContact?: () => unknown;
  contactsEnabled?: boolean;
}) {
  return {
    contactsEnabled: overrides?.contactsEnabled ?? true,
    contactService: {
      importContacts: overrides?.importContacts ?? (async () => ({ imported: 2, skipped: 0, newContacts: 1, existingContacts: 1 })),
      listContacts: overrides?.listContacts ?? (async () => ([
        { userId: 'c1', user: { name: 'Alice', email: 'alice@example.com', avatar: null, isGhost: false } },
      ])),
      addContact: overrides?.addContact ?? (async () => ({ userId: 'c2', isNew: true })),
      removeContact: overrides?.removeContact ?? (async () => {}),
    },
  } as never;
}

// ─── Helper to build a defineTool shim ────────────────────────────────────────

function makeDefineTool() {
  type ToolSpec = {
    name: string;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  };

  const tools = new Map<string, ToolSpec>();

  const defineTool = (spec: ToolSpec) => {
    tools.set(spec.name, spec);
    return spec; // return value unused by callers
  };

  async function call(name: string, query: unknown): Promise<unknown> {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    const raw = await tool.handler({ context, query });
    return JSON.parse(raw);
  }

  return { defineTool, call };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createContactTools - import_contacts', () => {
  it('returns success with import statistics', async () => {
    const { defineTool, call } = makeDefineTool();
    createContactTools(defineTool, makeDeps());

    const result = await call('import_contacts', {
      contacts: [
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' },
      ],
    }) as { success: boolean; data: { imported: number } };

    expect(result.success).toBe(true);
    expect(result.data.imported).toBe(2);
  });

  it('returns error when contactService throws', async () => {
    const { defineTool, call } = makeDefineTool();
    createContactTools(
      defineTool,
      makeDeps({ importContacts: async () => { throw new Error('DB failure'); } }),
    );

    const result = await call('import_contacts', { contacts: [] }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('DB failure');
  });
});

describe('createContactTools - CONTACTS_ENABLED gating', () => {
  const names = (deps: ReturnType<typeof makeDeps>): string[] => {
    const { defineTool } = makeDefineTool();
    return createContactTools(defineTool, deps).map((t: { name: string }) => t.name);
  };

  it('registers import/add only when contactsEnabled is true', () => {
    const registered = names(makeDeps({ contactsEnabled: true }));
    expect(registered).toContain('import_contacts');
    expect(registered).toContain('add_contact');
  });

  it('omits import_contacts and add_contact when disabled, keeps read/remove/search', () => {
    const registered = names(makeDeps({ contactsEnabled: false }));
    expect(registered).not.toContain('import_contacts');
    expect(registered).not.toContain('add_contact');
    expect(registered).toContain('list_contacts');
    expect(registered).toContain('remove_contact');
    expect(registered).toContain('search_contacts');
  });
});

describe('createContactTools - list_contacts', () => {
  it('returns contacts list', async () => {
    const { defineTool, call } = makeDefineTool();
    createContactTools(defineTool, makeDeps());

    const result = await call('list_contacts', {}) as {
      success: boolean;
      data: { count: number; contacts: Array<{ name: string; isGhost: boolean }> };
    };

    expect(result.success).toBe(true);
    expect(result.data.count).toBe(1);
    expect(result.data.contacts[0].name).toBe('Alice');
  });

  it('respects the limit parameter', async () => {
    const { defineTool, call } = makeDefineTool();
    createContactTools(
      defineTool,
      makeDeps({
        listContacts: async () => ([
          { userId: 'c1', user: { name: 'Alice', email: 'a@x.com', avatar: null, isGhost: false } },
          { userId: 'c2', user: { name: 'Bob', email: 'b@x.com', avatar: null, isGhost: false } },
          { userId: 'c3', user: { name: 'Carol', email: 'c@x.com', avatar: null, isGhost: false } },
        ]),
      }),
    );

    const result = await call('list_contacts', { limit: 2 }) as {
      success: boolean;
      data: { count: number };
    };

    expect(result.data.count).toBe(2);
  });
});

describe('createContactTools - add_contact', () => {
  it('returns added=true for a new ghost contact', async () => {
    const { defineTool, call } = makeDefineTool();
    createContactTools(defineTool, makeDeps());

    const result = await call('add_contact', { email: 'newperson@example.com' }) as {
      success: boolean;
      data: { added: boolean; isNewGhost: boolean };
    };

    expect(result.success).toBe(true);
    expect(result.data.added).toBe(true);
    expect(result.data.isNewGhost).toBe(true);
  });

  it('returns error when addContact throws', async () => {
    const { defineTool, call } = makeDefineTool();
    createContactTools(
      defineTool,
      makeDeps({ addContact: async () => { throw new Error('Already exists'); } }),
    );

    const result = await call('add_contact', { email: 'x@x.com' }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Already exists');
  });
});

describe('createContactTools - remove_contact', () => {
  it('returns removed=true on success', async () => {
    const { defineTool, call } = makeDefineTool();
    createContactTools(defineTool, makeDeps());

    const result = await call('remove_contact', { contactUserId: 'c1' }) as {
      success: boolean;
      data: { removed: boolean };
    };

    expect(result.success).toBe(true);
    expect(result.data.removed).toBe(true);
  });

  it('returns error when removeContact throws', async () => {
    const { defineTool, call } = makeDefineTool();
    createContactTools(
      defineTool,
      makeDeps({ removeContact: async () => { throw new Error('Not found'); } }),
    );

    const result = await call('remove_contact', { contactUserId: 'ghost' }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Not found');
  });
});
