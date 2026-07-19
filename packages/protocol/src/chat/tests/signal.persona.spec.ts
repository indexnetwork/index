import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it, mock } from "bun:test";

import { ORCHESTRATOR_PERSONA, ORCHESTRATOR_PERSONA_ID } from "../chat.persona.js";
import { SIGNAL_PERSONA, SIGNAL_PERSONA_ID, SIGNAL_TOOL_NAMES, filterSignalTools, narrowSignalTools } from "../signal.persona.js";
import { buildSignalSystemContent } from "../signal.prompt.js";
import type { ChatTools, ResolvedToolContext } from "../../shared/agent/tool.factory.js";
import type { SystemDatabase, UserDatabase } from "../../shared/interfaces/database.interface.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NETWORK_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_NETWORK_ID = "33333333-3333-4333-8333-333333333333";
const INTENT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_INTENT_ID = "55555555-5555-4555-8555-555555555555";

const EXPECTED_SIGNAL_TOOLS = [
  "read_intents",
  "create_intent",
  "update_intent",
  "delete_intent",
  "search_intents",
  "read_intent_indexes",
  "create_intent_index",
  "delete_intent_index",
  "read_user_contexts",
  "preview_user_context",
  "confirm_user_context",
  "create_user_context",
  "update_user_context",
  "read_premises",
  "create_premise",
  "update_premise",
  "retract_premise",
  "read_networks",
  "read_network_memberships",
  "scrape_url",
  "ask_user_question",
] as const;

const FORBIDDEN_TOOLS = [
  "discover_opportunities",
  "get_discovery_run",
  "cancel_discovery_run",
  "list_opportunities",
  "update_opportunity",
  "confirm_opportunity_delivery",
  "list_negotiations",
  "get_negotiation",
  "respond_to_negotiation",
  "list_contacts",
  "search_contacts",
  "add_contact",
  "remove_contact",
  "import_contacts",
  "import_gmail_contacts",
  "register_agent",
  "list_agents",
  "update_agent",
  "delete_agent",
  "grant_agent_permission",
  "revoke_agent_permission",
  "create_network",
  "update_network",
  "delete_network",
  "create_network_membership",
  "delete_network_membership",
] as const;

function makeContext(scope?: { scopeType: "network" | "intent"; scopeId: string }): ResolvedToolContext {
  return {
    userId: USER_ID,
    userName: "Alice",
    userEmail: "alice@example.com",
    user: { id: USER_ID, name: "Alice", email: "alice@example.com" },
    userProfile: { context: "Product builder in Berlin" },
    userNetworks: [],
    indexScope: [],
    isOwner: false,
    isOnboarding: false,
    hasName: true,
    contactsEnabled: false,
    ...scope,
  } as unknown as ResolvedToolContext;
}

function membership(networkId = NETWORK_ID) {
  return {
    networkId,
    networkTitle: networkId === NETWORK_ID ? "Builders" : "Other",
    indexPrompt: null,
    permissions: ["member"],
    memberPrompt: null,
    autoAssign: false,
    isPersonal: false,
    joinedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function liveIntent(id = INTENT_ID, userId = USER_ID) {
  return {
    id,
    userId,
    payload: "Find climate founders",
    summary: "Climate founders",
    isIncognito: false,
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    archivedAt: null,
    status: "ACTIVE" as const,
  };
}

function makeHarness(options: {
  context?: ResolvedToolContext;
  memberships?: ReturnType<typeof membership>[];
  member?: boolean;
  intents?: ReturnType<typeof liveIntent>[];
  getIntent?: ReturnType<typeof liveIntent> | null;
  getIntentError?: Error;
  assignedIds?: string[];
  intentNetworkIds?: string[];
} = {}) {
  const calls: Array<{ name: string; query: Record<string, unknown> }> = [];
  const names = [
    "create_intent",
    "read_premises",
    "read_user_contexts",
    "read_intents",
    "search_intents",
    "read_intent_indexes",
    "read_networks",
    "read_network_memberships",
  ];
  const shared = names.map((name) => ({
    name,
    invoke: mock(async (query: Record<string, unknown>) => {
      calls.push({ name, query });
      return JSON.stringify({ success: true, shared: true });
    }),
  })) as unknown as ChatTools;

  const getNetworkMemberships = mock(async () => options.memberships ?? []);
  const getActiveIntents = mock(async () =>
    (options.intents ?? []).map(({ id, payload, summary, createdAt }) => ({ id, payload, summary, createdAt }))
  );
  const searchOwnIntents = mock(async (_query: string, _limit: number) =>
    (options.intents ?? []).map(({ id, payload, summary, createdAt }) => ({ id, payload, summary, createdAt }))
  );
  const getIntent = mock(async (_intentId: string) => {
    if (options.getIntentError) throw options.getIntentError;
    return options.getIntent ?? null;
  });
  const isIntentAssignedToIndex = mock(async (intentId: string, _networkId: string) =>
    (options.assignedIds ?? []).includes(intentId)
  );
  const getNetworkIdsForIntent = mock(async (intentId: string) =>
    intentId === INTENT_ID ? (options.intentNetworkIds ?? []) : []
  );
  const isNetworkMember = mock(async (_networkId: string, _userId: string) => options.member ?? false);

  const userDb = {
    getNetworkMemberships,
    getActiveIntents,
    searchOwnIntents,
    getIntent,
    getNetworkIdsForIntent,
    isIntentAssignedToIndex,
  } as unknown as UserDatabase;
  const systemDb = { isNetworkMember } as unknown as SystemDatabase;
  const tools = narrowSignalTools(shared, {
    context: options.context ?? makeContext(),
    userDb,
    systemDb,
  });

  return {
    calls,
    tools,
    adapters: {
      getNetworkMemberships,
      getActiveIntents,
      searchOwnIntents,
      getIntent,
      getNetworkIdsForIntent,
      isIntentAssignedToIndex,
      isNetworkMember,
    },
  };
}

function signalTool(harness: ReturnType<typeof makeHarness>, name: string) {
  return harness.tools.find((candidate) => candidate.name === name)!;
}

function parsed(result: unknown) {
  return JSON.parse(String(result)) as {
    success: boolean;
    error?: string;
    data?: Record<string, unknown>;
  };
}

describe("SIGNAL_PERSONA", () => {
  it("uses the canonical persisted persona id", () => {
    expect(SIGNAL_PERSONA_ID).toBe("signal");
    expect(SIGNAL_PERSONA.id).toBe(SIGNAL_PERSONA_ID);
    expect(SIGNAL_PERSONA_ID).not.toBe(ORCHESTRATOR_PERSONA_ID);
  });

  it("disables only the discovery-coupled callback and retains proposal recovery", () => {
    expect(SIGNAL_PERSONA.loopBehaviors).toEqual({
      createIntentCallback: false,
      hallucinationRecovery: true,
    });
    expect(ORCHESTRATOR_PERSONA.loopBehaviors.createIntentCallback).toBe(true);
  });

  it("uses the Signal-specific prompt builder", () => {
    const ctx = makeContext();
    expect(SIGNAL_PERSONA.buildSystemContent(ctx, { iteration: 1 } as never)).toBe(
      buildSignalSystemContent(ctx),
    );
  });
});

describe("Signal Agent tool boundary", () => {
  it("pins the exact positive allowlist", () => {
    expect(SIGNAL_TOOL_NAMES).toEqual(EXPECTED_SIGNAL_TOOLS);
  });

  it("keeps exactly allowlisted tools from a shared registry", () => {
    const registry = [...EXPECTED_SIGNAL_TOOLS, ...FORBIDDEN_TOOLS, "read_docs"]
      .map((name) => ({ name }));
    expect(filterSignalTools(registry).map((candidate) => candidate.name)).toEqual(
      EXPECTED_SIGNAL_TOOLS,
    );
  });

  it("cannot admit forbidden capability families", () => {
    const allowed = new Set<string>(SIGNAL_TOOL_NAMES);
    for (const forbidden of FORBIDDEN_TOOLS) {
      expect(allowed.has(forbidden)).toBe(false);
    }
  });

  it("keeps proposal creation strict and passes no-network proposals without membership authorization", async () => {
    const harness = makeHarness();
    const create = signalTool(harness, "create_intent");

    await expect(create.invoke({ description: "Find climate founders", autoApprove: true }))
      .rejects.toThrow();
    expect(harness.calls).toEqual([]);

    await create.invoke({ description: "Find climate founders" });
    expect(harness.adapters.isNetworkMember).not.toHaveBeenCalled();
    expect(harness.calls).toEqual([{
      name: "create_intent",
      query: { description: "Find climate founders", autoApprove: false },
    }]);
  });

  it("clamps focused creation, rejects conflicts, and checks live membership before the shared tool", async () => {
    const member = makeHarness({
      context: makeContext({ scopeType: "network", scopeId: NETWORK_ID }),
      member: true,
    });
    await signalTool(member, "create_intent").invoke({ description: "Find climate founders" });
    expect(member.adapters.isNetworkMember).toHaveBeenCalledWith(NETWORK_ID, USER_ID);
    expect(member.calls[0]).toEqual({
      name: "create_intent",
      query: { description: "Find climate founders", networkId: NETWORK_ID, autoApprove: false },
    });

    const conflict = parsed(await signalTool(member, "create_intent").invoke({
      description: "Find climate founders",
      networkId: OTHER_NETWORK_ID,
    }));
    expect(conflict.success).toBe(false);
    expect(member.calls).toHaveLength(1);

    const stale = makeHarness({
      context: makeContext({ scopeType: "network", scopeId: NETWORK_ID }),
      member: false,
    });
    const denied = parsed(await signalTool(stale, "create_intent").invoke({ description: "Find climate founders" }));
    expect(denied.success).toBe(false);
    expect(stale.adapters.isNetworkMember).toHaveBeenCalledWith(NETWORK_ID, USER_ID);
    expect(stale.calls).toEqual([]);

    const explicitNonMember = makeHarness({ member: false });
    const explicitDenied = parsed(await signalTool(explicitNonMember, "create_intent").invoke({
      description: "Find climate founders",
      networkId: NETWORK_ID,
    }));
    expect(explicitDenied.success).toBe(false);
    expect(explicitNonMember.adapters.isNetworkMember).toHaveBeenCalledWith(NETWORK_ID, USER_ID);
    expect(explicitNonMember.calls).toEqual([]);
  });

  it("pins intent-focused search to the selected owned live intent", async () => {
    const selected = liveIntent();
    const harness = makeHarness({
      context: makeContext({ scopeType: "intent", scopeId: INTENT_ID }),
      getIntent: selected,
    });
    const result = parsed(await signalTool(harness, "search_intents").invoke({ query: "climate" }));
    expect((result.data?.intents as unknown[])).toHaveLength(1);
    expect(harness.adapters.getIntent).toHaveBeenCalledWith(INTENT_ID);
    expect(harness.adapters.searchOwnIntents).not.toHaveBeenCalled();

    const foreign = makeHarness({
      context: makeContext({ scopeType: "intent", scopeId: INTENT_ID }),
      getIntentError: new Error("Access denied: intent not owned by user"),
    });
    const foreignResult = parsed(await signalTool(foreign, "search_intents").invoke({ query: "climate" }));
    expect(foreignResult.data?.intents).toEqual([]);
  });

  it("network-focused search requires live membership and returns only assigned own active intents", async () => {
    const first = liveIntent(INTENT_ID);
    const second = liveIntent(OTHER_INTENT_ID);
    const harness = makeHarness({
      context: makeContext({ scopeType: "network", scopeId: NETWORK_ID }),
      member: true,
      intents: [first, second],
      assignedIds: [OTHER_INTENT_ID],
    });
    const result = parsed(await signalTool(harness, "search_intents").invoke({ query: "climate", limit: 10 }));
    expect((result.data?.intents as Array<{ id: string }>).map((intent) => intent.id)).toEqual([OTHER_INTENT_ID]);
    expect(harness.adapters.isNetworkMember).toHaveBeenCalledWith(NETWORK_ID, USER_ID);
    expect(harness.adapters.getActiveIntents).toHaveBeenCalledTimes(1);
    expect(harness.adapters.searchOwnIntents).not.toHaveBeenCalled();
    expect(harness.adapters.isIntentAssignedToIndex).toHaveBeenCalledTimes(2);

    const stale = makeHarness({
      context: makeContext({ scopeType: "network", scopeId: NETWORK_ID }),
      member: false,
      intents: [first],
    });
    const denied = parsed(await signalTool(stale, "search_intents").invoke({ query: "climate" }));
    expect(denied.success).toBe(false);
    expect(stale.adapters.getActiveIntents).not.toHaveBeenCalled();
    expect(stale.adapters.searchOwnIntents).not.toHaveBeenCalled();

    const limited = makeHarness({
      context: makeContext({ scopeType: "network", scopeId: NETWORK_ID }),
      member: true,
      intents: [first, second],
      assignedIds: [OTHER_INTENT_ID],
    });
    const limitedResult = parsed(await signalTool(limited, "search_intents").invoke({
      query: "climate",
      limit: 1,
    }));
    expect((limitedResult.data?.intents as Array<{ id: string }>).map((intent) => intent.id))
      .toEqual([OTHER_INTENT_ID]);
    expect(limited.adapters.isIntentAssignedToIndex).toHaveBeenCalledTimes(2);
  });

  it("unscoped search uses only the own-active adapter", async () => {
    const harness = makeHarness({ intents: [liveIntent()] });
    const result = parsed(await signalTool(harness, "search_intents").invoke({ query: "climate", limit: 7 }));
    expect((result.data?.intents as unknown[])).toHaveLength(1);
    expect(harness.adapters.searchOwnIntents).toHaveBeenCalledWith("climate", 7);
    expect(harness.adapters.isNetworkMember).not.toHaveBeenCalled();
  });

  it("read_networks returns only fresh memberships, intersects focus, and never forwards to public reads", async () => {
    const harness = makeHarness({
      context: makeContext({ scopeType: "network", scopeId: NETWORK_ID }),
      memberships: [membership(NETWORK_ID), membership(OTHER_NETWORK_ID)],
    });
    const result = parsed(await signalTool(harness, "read_networks").invoke({}));
    expect((result.data?.memberOf as Array<{ networkId: string }>).map((row) => row.networkId)).toEqual([NETWORK_ID]);
    expect(result.data?.publicNetworks).toEqual([]);
    expect(harness.adapters.getNetworkMemberships).toHaveBeenCalledTimes(1);
    expect(harness.calls).toEqual([]);

    const intentFocused = makeHarness({
      context: makeContext({ scopeType: "intent", scopeId: INTENT_ID }),
      memberships: [membership(NETWORK_ID), membership(OTHER_NETWORK_ID)],
      getIntent: liveIntent(),
      intentNetworkIds: [OTHER_NETWORK_ID],
    });
    const intentResult = parsed(await signalTool(intentFocused, "read_networks").invoke({}));
    expect((intentResult.data?.memberOf as Array<{ networkId: string }>).map((row) => row.networkId))
      .toEqual([OTHER_NETWORK_ID]);
    expect(intentFocused.adapters.getIntent).toHaveBeenCalledWith(INTENT_ID);
    expect(intentFocused.adapters.getNetworkIdsForIntent).toHaveBeenCalledWith(INTENT_ID);

    const staleFocus = makeHarness({
      context: makeContext({ scopeType: "network", scopeId: NETWORK_ID }),
      memberships: [],
    });
    const staleResult = parsed(await signalTool(staleFocus, "read_networks").invoke({}));
    expect(staleResult.success).toBe(false);

    const none = makeHarness({ memberships: [] });
    const noneResult = parsed(await signalTool(none, "read_networks").invoke({}));
    expect(noneResult.data?.memberOf).toEqual([]);
  });

  it("read_network_memberships is current-user-only and never enumerates network members", async () => {
    const harness = makeHarness({ memberships: [membership(NETWORK_ID), membership(OTHER_NETWORK_ID)] });
    const read = signalTool(harness, "read_network_memberships");
    await expect(read.invoke({ userId: "another-user" })).rejects.toThrow();
    const result = parsed(await read.invoke({ networkId: NETWORK_ID }));
    expect(result.data?.userId).toBe(USER_ID);
    expect((result.data?.memberships as Array<{ networkId: string }>).map((row) => row.networkId)).toEqual([NETWORK_ID]);
    expect(harness.adapters.getNetworkMemberships).toHaveBeenCalledTimes(1);
    expect(harness.calls).toEqual([]);

    const stale = makeHarness({
      context: makeContext({ scopeType: "network", scopeId: NETWORK_ID }),
      memberships: [],
    });
    const staleResult = parsed(await signalTool(stale, "read_network_memberships").invoke({}));
    expect(staleResult.success).toBe(false);
  });

  it("read_intent_indexes performs the exact owned-live, scope, membership, and assignment checks", async () => {
    const harness = makeHarness({
      context: makeContext({ scopeType: "network", scopeId: NETWORK_ID }),
      member: true,
      getIntent: liveIntent(),
      assignedIds: [INTENT_ID],
    });
    const result = parsed(await signalTool(harness, "read_intent_indexes").invoke({
      intentId: INTENT_ID,
      networkId: NETWORK_ID,
    }));
    expect(result.data).toEqual({
      isAssigned: true,
      links: [{ intentId: INTENT_ID, networkId: NETWORK_ID }],
    });
    expect(harness.adapters.getIntent).toHaveBeenCalledWith(INTENT_ID);
    expect(harness.adapters.isNetworkMember).toHaveBeenCalledWith(NETWORK_ID, USER_ID);
    expect(harness.adapters.isIntentAssignedToIndex).toHaveBeenCalledWith(INTENT_ID, NETWORK_ID);

    const unassigned = makeHarness({ member: true, getIntent: liveIntent() });
    const unassignedResult = parsed(await signalTool(unassigned, "read_intent_indexes").invoke({
      intentId: INTENT_ID,
      networkId: NETWORK_ID,
    }));
    expect(unassignedResult.data).toEqual({ isAssigned: false, links: [] });

    const mismatch = parsed(await signalTool(harness, "read_intent_indexes").invoke({
      intentId: INTENT_ID,
      networkId: OTHER_NETWORK_ID,
    }));
    expect(mismatch.success).toBe(false);
    expect(harness.adapters.getIntent).toHaveBeenCalledTimes(1);

    const foreign = makeHarness({
      member: true,
      getIntentError: new Error("Access denied: intent not owned by user"),
    });
    const foreignResult = parsed(await signalTool(foreign, "read_intent_indexes").invoke({
      intentId: OTHER_INTENT_ID,
      networkId: NETWORK_ID,
    }));
    expect(foreignResult.success).toBe(false);
    expect(foreign.adapters.isNetworkMember).not.toHaveBeenCalled();
    expect(foreign.adapters.isIntentAssignedToIndex).not.toHaveBeenCalled();

    const stale = makeHarness({ member: false, getIntent: liveIntent() });
    const staleResult = parsed(await signalTool(stale, "read_intent_indexes").invoke({
      intentId: INTENT_ID,
      networkId: NETWORK_ID,
    }));
    expect(staleResult.success).toBe(false);
    expect(stale.adapters.isIntentAssignedToIndex).not.toHaveBeenCalled();
  });
});

describe("buildSignalSystemContent", () => {
  const prompt = buildSignalSystemContent(makeContext());

  it("identifies the restricted role and grounds writes", () => {
    expect(prompt).toContain("You are Signal Agent");
    expect(prompt).toContain("Read before writing");
    expect(prompt).toContain("latest explicit request");
    expect(prompt).toContain("Matching happens separately in the background");
  });

  it("advertises every allowed capability and no forbidden tool", () => {
    for (const allowed of SIGNAL_TOOL_NAMES) {
      expect(prompt).toContain(allowed);
    }
    for (const forbidden of FORBIDDEN_TOOLS) {
      expect(prompt).not.toContain(forbidden);
    }
  });

  it("includes preloaded identity and profile context", () => {
    expect(prompt).toContain('"name": "Alice"');
    expect(prompt).toContain("Product builder in Berlin");
  });
});
