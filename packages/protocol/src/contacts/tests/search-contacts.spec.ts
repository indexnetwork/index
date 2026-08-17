import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createContactTools } from "../../contacts/application/index.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "user-123"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

interface CapturedTool {
  name: string;
  querySchema: z.ZodType;
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
}

function captureTools(deps: ToolDeps): CapturedTool[] {
  const toolDefs: CapturedTool[] = [];
  const defineTool = (def: {
    name: string;
    description: string;
    querySchema: z.ZodType;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  }) => {
    toolDefs.push({ name: def.name, querySchema: def.querySchema, handler: def.handler });
    return def;
  };
  createContactTools(defineTool as any, deps);
  return toolDefs;
}

describe("search_contacts", () => {
  test("accepts query and rejects legacy q", () => {
    const tools = captureTools({
      contactService: { searchContacts: async () => [] },
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "search_contacts")!;

    expect(tool.querySchema.safeParse({ query: "jane" }).success).toBe(true);
    expect(tool.querySchema.safeParse({ q: "jane" }).success).toBe(false);
  });

  test("forwards ownerId + query + limit and returns rows", async () => {
    let captured: { ownerId: string; query: string; limit: number } | null = null;
    const contactService = {
      searchContacts: async (ownerId: string, query: string, limit: number) => {
        captured = { ownerId, query, limit };
        return [
          {
            contactId: "cid-1",
            name: "Jane Smith",
            email: "jane@example.com",
            avatar: null,
          },
        ];
      },
    };
    const tools = captureTools({ contactService } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "search_contacts")!;
    const result = await tool.handler({
      context: makeContext("alice"),
      query: { query: "jane", limit: 10 },
    });
    const parsed = JSON.parse(result);
    expect(captured!).toEqual({ ownerId: "alice", query: "jane", limit: 10 });
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
    expect(parsed.data.contacts[0].email).toBe("jane@example.com");
  });

  test("defaults limit to 25", async () => {
    let capturedLimit: number | null = null;
    const contactService = {
      searchContacts: async (_ownerId: string, _query: string, limit: number) => {
        capturedLimit = limit;
        return [];
      },
    };
    const tools = captureTools({ contactService } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "search_contacts")!;
    await tool.handler({ context: makeContext(), query: { query: "anything" } });
    expect(capturedLimit!).toBe(25);
  });

  test("response uses userId not contactId", async () => {
    const contactService = {
      searchContacts: async () => [
        {
          contactId: "cid-42",
          name: "Bob Jones",
          email: "bob@example.com",
          avatar: null,
        },
      ],
    };
    const tools = captureTools({ contactService } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "search_contacts")!;

    const result = JSON.parse(
      await tool.handler({ context: makeContext("alice"), query: { query: "bob" } })
    );

    expect(result.success).toBe(true);
    const contact = result.data.contacts[0];
    expect(contact.userId).toBe("cid-42");
    expect(contact.contactId).toBeUndefined();
  });
});
