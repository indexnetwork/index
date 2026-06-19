/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, test, expect } from "bun:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

import type { ResolvedToolContext } from "../../shared/agent/tool.factory.js";

import { buildSystemContent } from "../chat.prompt.js";
import { extractRecentToolCalls, resolveModules, PROMPT_MODULES, type IterationContext } from "../chat.prompt.modules.js";

describe("extractRecentToolCalls", () => {
  test("returns empty array when no tool calls in messages", () => {
    const messages = [new HumanMessage("hello")];
    const result = extractRecentToolCalls(messages);
    expect(result).toEqual([]);
  });

  test("returns tool calls from most recent AI message", () => {
    const messages = [
      new HumanMessage("find me a mentor"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "discover_opportunities", args: { searchQuery: "mentor" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "results...", name: "discover_opportunities" }),
    ];
    const result = extractRecentToolCalls(messages);
    expect(result).toEqual([{ name: "discover_opportunities", args: { searchQuery: "mentor" } }]);
  });

  test("collects tool calls from ALL AI messages since last HumanMessage", () => {
    const messages = [
      new HumanMessage("find me a mentor"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "read_user_contexts", args: {}, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "profile data", name: "read_user_contexts" }),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc2", name: "discover_opportunities", args: { searchQuery: "mentor" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc2", content: "results...", name: "discover_opportunities" }),
    ];
    const result = extractRecentToolCalls(messages);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(["read_user_contexts", "discover_opportunities"]);
  });

  test("resets scope on new HumanMessage", () => {
    const messages = [
      new HumanMessage("first question"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "read_intents", args: {}, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "old intents", name: "read_intents" }),
      new HumanMessage("second question"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc2", name: "create_intent", args: { description: "test" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc2", content: "created", name: "create_intent" }),
    ];
    const result = extractRecentToolCalls(messages);
    expect(result).toEqual([{ name: "create_intent", args: { description: "test" } }]);
  });

  test("handles AI message with multiple parallel tool calls", () => {
    const messages = [
      new HumanMessage("introduce Alice and Bob"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "tc1", name: "read_user_contexts", args: { userId: "alice" }, type: "tool_call" },
          { id: "tc2", name: "read_user_contexts", args: { userId: "bob" }, type: "tool_call" },
          { id: "tc3", name: "read_network_memberships", args: { userId: "alice" }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ tool_call_id: "tc1", content: "alice profile", name: "read_user_contexts" }),
      new ToolMessage({ tool_call_id: "tc2", content: "bob profile", name: "read_user_contexts" }),
      new ToolMessage({ tool_call_id: "tc3", content: "alice memberships", name: "read_network_memberships" }),
    ];
    const result = extractRecentToolCalls(messages);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ name: "read_user_contexts", args: { userId: "alice" } });
    expect(result[2]).toEqual({ name: "read_network_memberships", args: { userId: "alice" } });
  });
});

// Minimal mock for ResolvedToolContext — only fields needed by resolution logic
function mockCtx(overrides: Partial<{ networkId: string; isOwner: boolean; isOnboarding: boolean; contactsEnabled: boolean }> = {}): IterationContext["ctx"] {
  return {
    userId: "test-user",
    userEmail: "test@example.com",
    userName: "Test User",
    user: {},
    userProfile: {},
    userNetworks: [],
    scopedIndex: null,
    scopedMembershipRole: null,
    networkId: overrides.networkId ?? null,
    indexName: null,
    isOwner: overrides.isOwner ?? false,
    isOnboarding: overrides.isOnboarding ?? false,
    hasName: true,
    contactsEnabled: "contactsEnabled" in overrides ? overrides.contactsEnabled : true,
  } as unknown as IterationContext["ctx"];
}

describe("resolveModules", () => {
  test("returns empty string when no tools, no regex match, no context match", () => {
    const iterCtx: IterationContext = {
      recentTools: [],
      currentMessage: "hello",
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toBe("");
  });

  test("returns empty string when isOnboarding is true (modules skipped)", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "discover_opportunities", args: {} }],
      currentMessage: undefined,
      ctx: mockCtx({ isOnboarding: true }),
    };
    const result = resolveModules(iterCtx);
    expect(result).toBe("");
  });

  test("activates discovery module on discover_opportunities trigger", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "discover_opportunities", args: { searchQuery: "mentor" } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 1. User wants to find connections or discover");
    expect(result).toContain("### 1a. User wants to connect with a specific mentioned person");
    expect(result).toContain("### 7. Opportunities in chat");
    expect(result).toContain("### Discovery-first; intent as follow-up");
  });

  test("activates introduction module (excludes discovery) when partyUserIds present", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "discover_opportunities", args: { partyUserIds: ["a", "b"] } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 6. Introduce two people");
    expect(result).toContain("### 6a. Discover who to introduce to someone");
    // discovery should be excluded
    expect(result).not.toContain("### 1. User wants to find connections or discover");
  });

  test("activates introduction module when introTargetUserId present", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "discover_opportunities", args: { introTargetUserId: "user-x" } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 6. Introduce two people");
    expect(result).not.toContain("### 1. User wants to find connections or discover");
  });

  test("activates intent-creation module on create_intent trigger", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "create_intent", args: { description: "test" } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 2. User explicitly wants to create or save an intent");
  });

  test("activates intent-management module on update_intent trigger", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "update_intent", args: {} }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 4. Update or delete an intent");
  });

  test("activates person-lookup module on read_user_contexts trigger", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "read_user_contexts", args: { query: "Alice" } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 0. User asks about a specific person by name");
  });

  test("activates url-scraping module on scrape_url trigger", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "scrape_url", args: { url: "https://example.com" } }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 3. User includes a URL");
  });

  test("activates url-scraping module via regex when message contains URL", () => {
    const iterCtx: IterationContext = {
      recentTools: [],
      currentMessage: "check out https://example.com",
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 3. User includes a URL");
  });

  test("activates community module on read_networks trigger", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "read_networks", args: {} }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 8. Explore what a community is about");
    expect(result).toContain("### When to mention community/index");
  });

  test("activates contacts module on import_gmail_contacts trigger", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "import_gmail_contacts", args: {} }],
      ctx: mockCtx({ contactsEnabled: true }),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 9. Import contacts from Gmail");
    expect(result).toContain("### 10. Add or manage contacts manually");
  });

  test("does NOT activate contacts module when contactsEnabled is false (even on list_contacts)", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "list_contacts", args: {} }],
      ctx: mockCtx({ contactsEnabled: false }),
    };
    const result = resolveModules(iterCtx);
    expect(result).not.toContain("### 9. Import contacts from Gmail");
    expect(result).not.toContain("### 10. Add or manage contacts manually");
    expect(result).not.toContain("import_gmail_contacts");
  });

  test("does NOT activate contacts module when contactsEnabled is unset (fail-closed)", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "import_gmail_contacts", args: {} }, { name: "add_contact", args: {} }],
      // contactsEnabled omitted → undefined, must be treated as disabled
      ctx: mockCtx({ contactsEnabled: undefined as unknown as boolean }),
    };
    const result = resolveModules(iterCtx);
    expect(result).not.toContain("### 9. Import contacts from Gmail");
  });

  test("activates shared-context module on read_network_memberships trigger", () => {
    const iterCtx: IterationContext = {
      recentTools: [{ name: "read_network_memberships", args: {} }],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 5. Find shared context between two users");
  });

  test("activates mentions module via regex on @mention in message", () => {
    const iterCtx: IterationContext = {
      recentTools: [],
      currentMessage: "what about @[Alice](user-123)?",
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("@[Display Name](userId)");
  });

  test("does not activate mentions module without @mention", () => {
    const iterCtx: IterationContext = {
      recentTools: [],
      currentMessage: "hello world",
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).not.toContain("@[Display Name](userId)");
  });

  test("multiple modules can activate simultaneously", () => {
    const iterCtx: IterationContext = {
      recentTools: [
        { name: "discover_opportunities", args: { searchQuery: "AI" } },
        { name: "read_user_contexts", args: { query: "Bob" } },
      ],
      ctx: mockCtx(),
    };
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 1. User wants to find connections or discover");
    expect(result).toContain("### 0. User asks about a specific person by name");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPT_MODULES registry sanity checks
// ═══════════════════════════════════════════════════════════════════════════════

describe("PROMPT_MODULES registry", () => {
  test("has exactly 10 modules", () => {
    expect(PROMPT_MODULES).toHaveLength(10);
  });

  test("all module IDs are unique", () => {
    const ids = PROMPT_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("expected module IDs are present", () => {
    const ids = new Set(PROMPT_MODULES.map((m) => m.id));
    for (const expected of [
      "discovery",
      "introduction",
      "intent-creation",
      "intent-management",
      "person-lookup",
      "url-scraping",
      "community",
      "contacts",
      "shared-context",
      "mentions",
    ]) {
      expect(ids.has(expected)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildSystemContent snapshot identity tests
// ═══════════════════════════════════════════════════════════════════════════════

function makeCtx(overrides: Partial<ResolvedToolContext> = {}): ResolvedToolContext {
  return {
    userId: "user-1",
    userName: "Alice Test",
    userEmail: "alice@example.com",
    user: { id: "user-1", name: "Alice Test", email: "alice@example.com" } as unknown as ResolvedToolContext["user"],
    userProfile: {
      bio: "Builder of things",
      skills: ["typescript"],
      interests: ["AI"],
    } as unknown as ResolvedToolContext["userProfile"],
    userNetworks: [
      {
        networkId: "idx-personal",
        networkTitle: "My Network",
        indexPrompt: null,
        permissions: ["owner"],
        memberPrompt: null,
        autoAssign: false,
        isPersonal: true,
        joinedAt: "2024-01-01T00:00:00Z",
      },
      {
        networkId: "idx-community",
        networkTitle: "AI Builders",
        indexPrompt: "AI enthusiasts",
        permissions: ["member"],
        memberPrompt: null,
        autoAssign: true,
        isPersonal: false,
        joinedAt: "2024-02-01T00:00:00Z",
      },
    ] as unknown as ResolvedToolContext["userNetworks"],
    indexScope: ["idx-personal", "idx-community"],
    isOnboarding: false,
    hasName: true,
    contactsEnabled: true,
    ...overrides,
  };
}

describe("buildSystemContent snapshot identity", () => {
  test("general chat (no index scope, no onboarding) — patterns are NOT in base prompt", () => {
    const ctx = makeCtx();
    const output = buildSystemContent(ctx);

    // Verify key core sections are present in the correct order
    const missionIdx = output.indexOf("You are Index.");
    const voiceIdx = output.indexOf("## Voice and constraints");
    const sessionIdx = output.indexOf("## Session");
    const preloadedIdx = output.indexOf("### Current User (preloaded context)");
    const architectureIdx = output.indexOf("## Architecture Philosophy");
    const toolsIdx = output.indexOf("## Tools Reference");
    const scopingIdx = output.indexOf("### Index Scope");
    const urlsIdx = output.indexOf("### URLs");
    const narrationIdx = output.indexOf("### Narration Style");
    const outputFmtIdx = output.indexOf("### Output Format");
    const generalIdx = output.indexOf("### General");

    expect(missionIdx).toBeGreaterThanOrEqual(0);
    expect(voiceIdx).toBeGreaterThan(missionIdx);
    expect(sessionIdx).toBeGreaterThan(voiceIdx);
    expect(preloadedIdx).toBeGreaterThan(sessionIdx);
    expect(architectureIdx).toBeGreaterThan(preloadedIdx);
    expect(toolsIdx).toBeGreaterThan(architectureIdx);
    expect(scopingIdx).toBeGreaterThan(toolsIdx);
    expect(urlsIdx).toBeGreaterThan(scopingIdx);
    expect(narrationIdx).toBeGreaterThan(urlsIdx);
    expect(outputFmtIdx).toBeGreaterThan(narrationIdx);
    expect(generalIdx).toBeGreaterThan(outputFmtIdx);

    // Patterns and behavioral rules should NOT be in base prompt (no iterCtx)
    expect(output).not.toContain("## Orchestration Patterns");
    expect(output).not.toContain("## Behavioral Rules");
    expect(output).not.toContain("### 1. User wants to find connections");

    // Onboarding section must NOT be present
    expect(output).not.toContain("## ONBOARDING MODE");

    // Snapshot full content to catch any unintended changes
    expect(output).toMatchSnapshot();
  });

  test("scoped chat (index scope, owner) produces stable output", () => {
    const ctx = makeCtx({
      networkId: "idx-community",
      indexName: "AI Builders",
      isOwner: true,
      scopedIndex: { id: "idx-community", title: "AI Builders", prompt: "AI enthusiasts" },
      scopedMembershipRole: "owner",
    });
    const output = buildSystemContent(ctx);

    expect(output).toContain('This chat is scoped to index "AI Builders"');
    expect(output).toContain("You are the **owner** of this index");
    expect(output).toContain("scoped to current index");

    expect(output).toMatchSnapshot();
  });

  test("onboarding mode produces stable output", () => {
    const ctx = makeCtx({ isOnboarding: true, hasName: true });
    const output = buildSystemContent(ctx);

    expect(output).toContain("## ONBOARDING MODE (ACTIVE)");
    expect(output).toContain("### Onboarding Flow");
    expect(output).toContain("complete_onboarding()");
    expect(output).not.toContain("Call `discover_opportunities(searchQuery=");

    expect(output).toMatchSnapshot();
  });

  test("onboarding without name produces stable output", () => {
    const ctx = makeCtx({ isOnboarding: true, hasName: false });
    const output = buildSystemContent(ctx);

    expect(output).toContain("**User has no name on file.**");
    expect(output).not.toContain("You're Alice Test, right?");

    expect(output).toMatchSnapshot();
  });

  test("onboarding with networkId set rewrites step 6 to skip community discovery", () => {
    // Network-scoped users (e.g. experiment-network CSV invitees) cannot join
    // other communities — their key is bound to a single network. Step 6 must
    // not propose anything to join, and must not run read_networks at all,
    // otherwise the agent picks the bound network out of `memberOf` and
    // re-presents it as a community to join.
    const ctx = makeCtx({
      isOnboarding: true,
      hasName: true,
      networkId: "idx-community",
      indexName: "AI Builders",
      scopedIndex: { id: "idx-community", title: "AI Builders", prompt: "AI enthusiasts" },
      scopedMembershipRole: "member",
    });
    const output = buildSystemContent(ctx);

    expect(output).toContain("Community discovery (skipped");
    expect(output).toContain("AI Builders");
    expect(output).toContain("Proceed DIRECTLY to step 7");
    expect(output).not.toContain("communities you might find relevant");
    // The skipped branch mentions `networks_panel` only as something to NOT show.
    // The unscoped branch instructs to "Then immediately output this block" —
    // that imperative is what should be absent.
    expect(output).not.toContain("Then immediately output this block");
  });

  test("onboarding without networkId still renders the standard discover-communities step", () => {
    // Sanity check: the conditional only kicks in when scoped — unscoped
    // onboarding still presents the panel.
    const ctx = makeCtx({ isOnboarding: true, hasName: true });
    const output = buildSystemContent(ctx);

    expect(output).toContain("**Discover communities**");
    expect(output).toContain("communities you might find relevant");
    expect(output).toContain("```networks_panel");
    expect(output).not.toContain("Community discovery (skipped");
  });

  test("without iterCtx, modules section is empty; with empty iterCtx, result matches", () => {
    const ctx = makeCtx();
    const withoutIter = buildSystemContent(ctx);
    const withEmptyIter = buildSystemContent(ctx, {
      recentTools: [],
      ctx,
    });
    // With no tools called and no regex match, result should be identical
    expect(withEmptyIter).toBe(withoutIter);
  });

  test("with all modules active, full prompt is snapshot-stable", () => {
    const ctx = makeCtx({ contactsEnabled: true });
    // Craft iterCtx that triggers all 10 modules (introduction excludes discovery,
    // so use discovery-style args to get discovery + skip introduction)
    const iterCtx: IterationContext = {
      recentTools: [
        { name: "discover_opportunities", args: { searchQuery: "AI" } }, // discovery
        { name: "update_opportunity", args: {} },
        { name: "create_intent", args: {} },                          // intent-creation
        { name: "update_intent", args: {} },                          // intent-management
        { name: "read_user_contexts", args: {} },                     // person-lookup
        { name: "scrape_url", args: {} },                             // url-scraping
        { name: "read_networks", args: {} },                           // community
        { name: "add_contact", args: {} },                            // contacts
        { name: "read_network_memberships", args: {} },                 // shared-context
      ],
      currentMessage: "check @[Alice](user-1) and https://example.com", // mentions + url regex
      ctx,
    };
    const output = buildSystemContent(ctx, iterCtx);
    expect(output).toMatchSnapshot();
  });

  test("with iterCtx containing discovery tools, output includes discovery patterns", () => {
    const ctx = makeCtx();
    const iterCtx: IterationContext = {
      recentTools: [{ name: "discover_opportunities", args: { searchQuery: "AI" } }],
      ctx,
    };
    const output = buildSystemContent(ctx, iterCtx);
    expect(output).toContain("### 1. User wants to find connections or discover");
    expect(output).toContain("### 7. Opportunities in chat");

    // The base prompt sections should still be present
    expect(output).toContain("You are Index.");
    expect(output).toContain("### Index Scope");
    expect(output).toContain("### Output Format");
  });
});

describe("CONTACTS_ENABLED gating in buildSystemContent", () => {
  describe("tool reference table", () => {
    test("includes contact-import tools when contactsEnabled is true", () => {
      const output = buildSystemContent(makeCtx({ contactsEnabled: true }));
      expect(output).toContain("**import_gmail_contacts**");
      expect(output).toContain("**import_contacts**");
      expect(output).toContain("**add_contact**");
      // read-path tools always present
      expect(output).toContain("**list_contacts**");
      expect(output).toContain("**remove_contact**");
    });

    test("omits contact-import tools but keeps list/remove when contactsEnabled is false", () => {
      const output = buildSystemContent(makeCtx({ contactsEnabled: false }));
      expect(output).not.toContain("**import_gmail_contacts**");
      expect(output).not.toContain("**import_contacts**");
      expect(output).not.toContain("**add_contact**");
      // read-path tools remain available
      expect(output).toContain("**list_contacts**");
      expect(output).toContain("**remove_contact**");
    });

    test("fail-closed: omits import tools when contactsEnabled is unset", () => {
      const output = buildSystemContent(makeCtx({ contactsEnabled: undefined }));
      expect(output).not.toContain("**import_gmail_contacts**");
      expect(output).not.toContain("**add_contact**");
    });
  });

  describe("onboarding Gmail step", () => {
    test("renders the Connect Gmail step when onboarding and contactsEnabled is true", () => {
      const output = buildSystemContent(makeCtx({ isOnboarding: true, contactsEnabled: true }));
      expect(output).toContain("ONBOARDING MODE (ACTIVE)");
      expect(output).toContain("5. **Connect Gmail**");
      expect(output).toContain("[Connect Gmail](authUrl)");
    });

    test("skips the Connect Gmail step when onboarding but contactsEnabled is false", () => {
      const output = buildSystemContent(makeCtx({ isOnboarding: true, contactsEnabled: false }));
      expect(output).toContain("ONBOARDING MODE (ACTIVE)");
      expect(output).toContain("skipped — contact import is disabled");
      expect(output).not.toContain("[Connect Gmail](authUrl)");
      expect(output).not.toContain("Connect your Google account so I can learn from your Gmail");
      // onboarding still flows to the next steps
      expect(output).toContain("5.5. **Collect location**");
    });
  });
});
