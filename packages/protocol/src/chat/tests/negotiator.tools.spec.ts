/**
 * P5.4 (IND-408) — negotiator memory tools (`remember`/`forget`).
 *
 * These tools exist ONLY in the negotiator persona's toolset: they are
 * appended after the allowlist filter when (and only when) the composition
 * root injects the host bridge. The host owns all policy (flag, caps,
 * matching); the tools translate between the model and the bridge — that
 * translation is what's pinned here.
 */
import { describe, expect, it } from "bun:test";

import { NEGOTIATOR_MEMORY_TOOL_NAMES, createNegotiatorMemoryTools } from "../negotiator.tools.js";
import { NEGOTIATOR_TOOL_NAMES, filterNegotiatorTools } from "../negotiator.persona.js";
import { buildNegotiatorSystemContent } from "../negotiator.prompt.js";
import type { NegotiatorMemoryForgetResult, NegotiatorMemoryRememberInput, NegotiatorMemoryToolsHost, NegotiatorMemoryToolView } from "../../shared/interfaces/negotiator-memory.interface.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.factory.js";

function makeHost(overrides: Partial<NegotiatorMemoryToolsHost> = {}): {
  host: NegotiatorMemoryToolsHost;
  rememberCalls: Array<{ userId: string; input: NegotiatorMemoryRememberInput }>;
  forgetCalls: Array<{ userId: string; input: { memoryId?: string; description?: string } }>;
} {
  const rememberCalls: Array<{ userId: string; input: NegotiatorMemoryRememberInput }> = [];
  const forgetCalls: Array<{ userId: string; input: { memoryId?: string; description?: string } }> = [];
  const host: NegotiatorMemoryToolsHost = {
    remember: async (userId, input) => {
      rememberCalls.push({ userId, input });
      return { id: "mem-1", kind: input.kind, content: input.content };
    },
    forget: async (userId, input) => {
      forgetCalls.push({ userId, input });
      return { status: "not_found" };
    },
    ...overrides,
  };
  return { host, rememberCalls, forgetCalls };
}

const invoke = async (tool: { invoke: (input: unknown) => Promise<unknown> }, input: unknown) =>
  JSON.parse(String(await tool.invoke(input))) as Record<string, unknown>;

describe("createNegotiatorMemoryTools", () => {
  it("creates exactly the remember and forget tools", () => {
    const { host } = makeHost();
    const tools = createNegotiatorMemoryTools({ host, userId: "user-1" });
    expect(tools.map((t) => t.name)).toEqual([...NEGOTIATOR_MEMORY_TOOL_NAMES]);
  });

  it("remember passes the acting user, kind, content, and session provenance to the host", async () => {
    const { host, rememberCalls } = makeHost();
    const [remember] = createNegotiatorMemoryTools({ host, userId: "user-1", sessionId: "sess-9" });
    const result = await invoke(remember, { kind: "disclosure_rule", content: "Never share my budget." });

    expect(rememberCalls).toHaveLength(1);
    expect(rememberCalls[0].userId).toBe("user-1");
    expect(rememberCalls[0].input).toEqual({
      kind: "disclosure_rule",
      content: "Never share my budget.",
      sessionId: "sess-9",
    });
    expect(result.status).toBe("remembered");
    expect((result.memory as NegotiatorMemoryToolView & { memoryId: string }).memoryId).toBe("mem-1");
  });

  it("remember reports disabled (not an error) when the host declines the write", async () => {
    const { host } = makeHost({ remember: async () => null });
    const [remember] = createNegotiatorMemoryTools({ host, userId: "user-1" });
    const result = await invoke(remember, { kind: "threshold", content: "Minimum rate is $150/h." });
    expect(result.status).toBe("disabled");
  });

  it("remember maps a throwing host to an honest error result", async () => {
    const { host } = makeHost({ remember: async () => { throw new Error("db down"); } });
    const [remember] = createNegotiatorMemoryTools({ host, userId: "user-1" });
    const result = await invoke(remember, { kind: "playbook", content: "Open with scope questions." });
    expect(result.status).toBe("error");
  });

  it("forget maps deleted / ambiguous / not_found host outcomes", async () => {
    const outcomes: NegotiatorMemoryForgetResult[] = [
      { status: "deleted", memory: { id: "m1", kind: "playbook", content: "Old tactic" } },
      { status: "ambiguous", candidates: [
        { id: "m1", kind: "playbook", content: "A" },
        { id: "m2", kind: "threshold", content: "B" },
      ] },
      { status: "not_found" },
    ];
    let call = 0;
    const { host } = makeHost({ forget: async () => outcomes[call++] });
    const [, forget] = createNegotiatorMemoryTools({ host, userId: "user-1" });

    const deleted = await invoke(forget, { description: "the old tactic" });
    expect(deleted.status).toBe("forgotten");
    expect((deleted.memory as { content: string }).content).toBe("Old tactic");

    const ambiguous = await invoke(forget, { description: "that rule" });
    expect(ambiguous.status).toBe("ambiguous");
    expect((ambiguous.candidates as unknown[]).length).toBe(2);

    const notFound = await invoke(forget, { description: "nothing like this" });
    expect(notFound.status).toBe("not_found");
  });

  it("forget rejects an empty reference without calling the host", async () => {
    const { host, forgetCalls } = makeHost();
    const [, forget] = createNegotiatorMemoryTools({ host, userId: "user-1" });
    const result = await invoke(forget, {});
    expect(result.status).toBe("error");
    expect(forgetCalls).toHaveLength(0);
  });

  it("forget prefers memoryId when provided (disambiguation round-trip)", async () => {
    const seen: Array<{ memoryId?: string; description?: string }> = [];
    const { host } = makeHost({
      forget: async (_userId, input) => {
        seen.push(input);
        return {
          status: "deleted",
          memory: { id: input.memoryId!, kind: "disclosure_rule", content: "X" },
        };
      },
    });
    const [, forget] = createNegotiatorMemoryTools({ host, userId: "user-1" });
    const result = await invoke(forget, { memoryId: "123e4567-e89b-42d3-a456-426614174000" });
    expect(result.status).toBe("forgotten");
    expect(seen[0].memoryId).toBe("123e4567-e89b-42d3-a456-426614174000");
  });
});

// ─── Registry isolation ──────────────────────────────────────────────────────

describe("memory tools registry isolation", () => {
  it("remember/forget are NOT part of the shared-registry allowlist", () => {
    for (const name of NEGOTIATOR_MEMORY_TOOL_NAMES) {
      expect(NEGOTIATOR_TOOL_NAMES).not.toContain(name);
    }
  });

  it("filterNegotiatorTools drops registry tools that happen to carry the memory-tool names", () => {
    // Proves the ONLY way remember/forget reach a toolset is the explicit
    // host-gated append in createNegotiatorTools — never through the registry.
    const fakeRegistry = [{ name: "remember" }, { name: "forget" }, { name: "list_negotiations" }];
    expect(filterNegotiatorTools(fakeRegistry).map((t) => t.name)).toEqual(["list_negotiations"]);
  });
});

// ─── Prompt gating ───────────────────────────────────────────────────────────

function makeCtx(): ResolvedToolContext {
  return {
    userId: "user-1",
    userName: "Alice Test",
    userEmail: "alice@example.com",
    user: { id: "user-1", name: "Alice Test", email: "alice@example.com" },
    userProfile: null,
    userNetworks: [],
    isOwner: false,
    isOnboarding: false,
    hasName: true,
    contactsEnabled: false,
  } as unknown as ResolvedToolContext;
}

describe("negotiator prompt — memory tools section", () => {
  const opts = { agentName: "Alice's Negotiator" };

  it("advertises remember/forget only when the tools are registered", () => {
    const withTools = buildNegotiatorSystemContent(makeCtx(), { ...opts, memoryToolsEnabled: true });
    expect(withTools).toContain("## Remembering and forgetting");
    expect(withTools).toContain("| **remember** |");
    expect(withTools).toContain("| **forget** |");
    expect(withTools).toContain("standing consent");
  });

  it("is byte-identical to the pre-P5.4 prompt when the tools are absent", () => {
    const without = buildNegotiatorSystemContent(makeCtx(), opts);
    const explicitFalse = buildNegotiatorSystemContent(makeCtx(), { ...opts, memoryToolsEnabled: false });
    expect(explicitFalse).toBe(without);
    expect(without).not.toContain("## Remembering and forgetting");
    expect(without).not.toContain("| **remember** |");
  });
});
