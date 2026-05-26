/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { createIntegrationTools } from "../integration.tools.js";
import type { ResolvedToolContext } from "../tool.helpers.js";

// ─── Context stub ─────────────────────────────────────────────────────────────

const userId = '00000000-0000-4000-8000-000000000002';

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

// ─── defineTool shim ──────────────────────────────────────────────────────────

function makeDefineTool() {
  type ToolSpec = {
    name: string;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  };

  const tools = new Map<string, ToolSpec>();

  const defineTool = (spec: ToolSpec) => {
    tools.set(spec.name, spec);
    return spec;
  };

  async function call(name: string, query: unknown = {}): Promise<unknown> {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    const raw = await tool.handler({ context, query });
    return JSON.parse(raw);
  }

  return { defineTool, call };
}

// ─── Mock deps factory ────────────────────────────────────────────────────────

function makeDeps(overrides?: {
  isConnected?: boolean;
  authUrl?: string;
  importResult?: { imported: number; skipped: number; newContacts: number; existingContacts: number };
  importThrows?: string;
}) {
  const isConnected = overrides?.isConnected ?? true;
  const authUrl = overrides?.authUrl ?? 'https://oauth.example.com/auth';

  return {
    integration: {
      createSession: async () => ({
        toolkits: async () => ({
          items: isConnected ? [
            { slug: 'gmail', connection: { connectedAccount: { id: 'account-123' } } },
          ] : [],
        }),
        authorize: async (_: string, __?: unknown) => ({ redirectUrl: authUrl }),
      }),
    },
    integrationImporter: {
      importContacts: async () => {
        if (overrides?.importThrows) throw new Error(overrides.importThrows);
        return overrides?.importResult ?? { imported: 5, skipped: 1, newContacts: 3, existingContacts: 2 };
      },
    },
  } as never;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createIntegrationTools - import_gmail_contacts', () => {
  it('returns success with import statistics when Gmail is connected', async () => {
    const { defineTool, call } = makeDefineTool();
    createIntegrationTools(defineTool, makeDeps({ isConnected: true }));

    const result = await call('import_gmail_contacts') as {
      success: boolean;
      data: { imported: number; newContacts: number; existingContacts: number };
    };

    expect(result.success).toBe(true);
    expect(result.data.imported).toBe(5);
    expect(result.data.newContacts).toBe(3);
    expect(result.data.existingContacts).toBe(2);
  });

  it('returns requiresAuth=true with auth URL when Gmail is not connected', async () => {
    const { defineTool, call } = makeDefineTool();
    createIntegrationTools(defineTool, makeDeps({ isConnected: false, authUrl: 'https://oauth.example.com/auth' }));

    const result = await call('import_gmail_contacts') as {
      success: boolean;
      data: { requiresAuth: boolean; authUrl: string };
    };

    expect(result.success).toBe(true);
    expect(result.data.requiresAuth).toBe(true);
    expect(result.data.authUrl).toBe('https://oauth.example.com/auth');
  });

  it('returns error when import throws', async () => {
    const { defineTool, call } = makeDefineTool();
    createIntegrationTools(defineTool, makeDeps({ isConnected: true, importThrows: 'Quota exceeded' }));

    const result = await call('import_gmail_contacts') as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('Quota exceeded');
  });

  it('returns appropriate message when no new contacts imported', async () => {
    const { defineTool, call } = makeDefineTool();
    createIntegrationTools(
      defineTool,
      makeDeps({ isConnected: true, importResult: { imported: 3, skipped: 0, newContacts: 0, existingContacts: 3 } }),
    );

    const result = await call('import_gmail_contacts') as {
      success: boolean;
      data: { message: string; newContacts: number };
    };

    expect(result.success).toBe(true);
    expect(result.data.newContacts).toBe(0);
    expect(result.data.message).toBeTruthy();
  });
});
