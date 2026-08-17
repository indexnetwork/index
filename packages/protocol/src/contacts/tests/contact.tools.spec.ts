/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { createContactTools } from "../../contacts/application/index.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.factory.js";

// ─── Minimal context stub ─────────────────────────────────────────────────────

const userId = '00000000-0000-4000-8000-000000000001';

const context: ResolvedToolContext = {
  userId,
  userName: 'Test User',
  userEmail: 'test@example.com',
  user: { id: userId, name: 'Test User', email: 'test@example.com' } as never,
  userProfile: null,
  userNetworks: [],
  indexScope: [],
  isOnboarding: false,
  hasName: true,
};

// ─── Mock contactService ───────────────────────────────────────────────────────

function makeDeps(overrides?: {
  listContacts?: () => unknown;
  removeContact?: () => unknown;
}) {
  return {
    contactService: {
      listContacts: overrides?.listContacts ?? (async () => ([
        { userId: 'c1', user: { name: 'Alice', email: 'alice@example.com', avatar: null } },
      ])),
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

describe('createContactTools - registered surface', () => {
  it('registers exactly list/remove/search — no import or manual-add path', () => {
    const { defineTool } = makeDefineTool();
    const registered = createContactTools(defineTool, makeDeps()).map((t: { name: string }) => t.name);
    expect(registered).toEqual(['list_contacts', 'remove_contact', 'search_contacts']);
  });
});

describe('createContactTools - list_contacts', () => {
  it('returns contacts list', async () => {
    const { defineTool, call } = makeDefineTool();
    createContactTools(defineTool, makeDeps());

    const result = await call('list_contacts', {}) as {
      success: boolean;
      data: { count: number; contacts: Array<{ name: string }> };
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
          { userId: 'c1', user: { name: 'Alice', email: 'a@x.com', avatar: null } },
          { userId: 'c2', user: { name: 'Bob', email: 'b@x.com', avatar: null } },
          { userId: 'c3', user: { name: 'Carol', email: 'c@x.com', avatar: null } },
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
    expect(result.error).toBe('Failed to remove contact. Please try again.');
    expect(result.error).not.toContain('Not found');
  });
});
