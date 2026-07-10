/**
 * P4.0 personafication — orchestrator persona equivalence tests.
 *
 * The refactor's contract is "provably zero behavior change" for the
 * orchestrator: ORCHESTRATOR_PERSONA must be exactly the pre-refactor wiring.
 * These tests pin that down two ways:
 *
 * 1. Byte-identity: persona-built prompts === direct buildSystemContent
 *    calls across scope variants (the persona delegates lazily through the
 *    live import binding, so outputs are identical by construction — toolset
 *    equivalence is proven by chat.agent.spec.ts, whose default-persona agent
 *    picks up the tool.factory module mock exactly as before the refactor).
 * 2. Snapshot: the orchestrator system prompt for a canned context, so any
 *    accidental prompt drift fails loudly.
 *
 * No LLM calls, no DB.
 */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it } from "bun:test";

import { ORCHESTRATOR_PERSONA, ORCHESTRATOR_PERSONA_ID } from "../chat.persona.js";
import { buildSystemContent } from "../chat.prompt.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.factory.js";
import type { IterationContext } from "../chat.prompt.modules.js";

// ─── Fixtures (mirrors chat.prompt.spec.ts) ─────────────────────────────────

function makeCtx(overrides: Partial<ResolvedToolContext> = {}): ResolvedToolContext {
  const scopeOverrides = overrides.networkId && !overrides.scopeType
    ? { scopeType: "network" as const, scopeId: overrides.networkId }
    : {};

  return {
    userId: "user-1",
    userName: "Alice Test",
    userEmail: "alice@example.com",
    user: { id: "user-1", name: "Alice Test", email: "alice@example.com" },
    userProfile: { bio: "Builder", skills: ["typescript"], interests: ["AI"] },
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
    ],
    isOnboarding: false,
    hasName: true,
    ...scopeOverrides,
    ...overrides,
  } as unknown as ResolvedToolContext;
}

function makeIterCtx(ctx: ResolvedToolContext, currentMessage?: string): IterationContext {
  return { recentTools: [], currentMessage, ctx };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ORCHESTRATOR_PERSONA — zero-behavior-change contract", () => {
  it("has the canonical persona id", () => {
    expect(ORCHESTRATOR_PERSONA.id).toBe(ORCHESTRATOR_PERSONA_ID);
    expect(ORCHESTRATOR_PERSONA_ID).toBe("orchestrator");
  });

  it("keeps every orchestrator loop behavior enabled", () => {
    expect(ORCHESTRATOR_PERSONA.loopBehaviors).toEqual({
      createIntentCallback: true,
      hallucinationRecovery: true,
    });
  });

  it("produces byte-identical system content across scope variants", () => {
    const variants: Array<{ ctx: ResolvedToolContext; message?: string }> = [
      { ctx: makeCtx(), message: "hello" },
      { ctx: makeCtx({ networkId: "idx-community" }), message: "find people" },
      {
        ctx: makeCtx({
          scopeType: "intent",
          scopeId: "intent-42",
        } as Partial<ResolvedToolContext>),
        message: "status of my intent?",
      },
    ];

    for (const { ctx, message } of variants) {
      const iterCtx = makeIterCtx(ctx, message);
      expect(ORCHESTRATOR_PERSONA.buildSystemContent(ctx, iterCtx)).toBe(
        buildSystemContent(ctx, iterCtx),
      );
    }
  });

  it("orchestrator system prompt matches snapshot (general scope)", () => {
    const ctx = makeCtx();
    const prompt = ORCHESTRATOR_PERSONA.buildSystemContent(ctx, makeIterCtx(ctx, "hello"));
    expect(prompt).toMatchSnapshot();
  });
});
