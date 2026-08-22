/**
 * #1471 — the negotiator's `reject_opportunity` / `accept_opportunity` tools
 * and the numbered counterparty list they act on.
 *
 * The owner's three decisions in their signal's DM are ANSWER, EDIT and
 * VERDICT. The first two had lanes; the third had none, so on 2026-08-20 a
 * client who told their agent to reject a counterparty got words back and
 * nothing else. What is pinned here is that the verdict is now an explicit
 * act, that the model reaches it by POSITION and never by id, and that every
 * result — including the ones where nothing happened — is copy the persona
 * can only repeat honestly.
 */
import { describe, expect, it } from "bun:test";

import { createNegotiatorVerdictTools } from "../negotiator.tools.js";
import { buildNegotiatorSystemContent } from "../negotiator.prompt.js";
import type { NegotiatorVerdictInput, NegotiatorVerdictResult, NegotiatorVerdictToolsHost } from "../../../platform/negotiator-verdict.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.factory.js";

const AGENT_OPTS = { agentName: "Alice's Negotiator" };
const OPPORTUNITY_ID = "eba8e028-1c4d-4f7a-9b3e-5d6a7c8e9f01";

function makeCtx(overrides: Partial<ResolvedToolContext> = {}): ResolvedToolContext {
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
    ...overrides,
  } as unknown as ResolvedToolContext;
}

const pinnedCtx = makeCtx({ scopeType: "intent", scopeId: "intent-42" } as Partial<ResolvedToolContext>);

type Call = { tool: "reject" | "accept"; userId: string; input: NegotiatorVerdictInput };

function makeHost(result: NegotiatorVerdictResult): { host: NegotiatorVerdictToolsHost; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    host: {
      rejectOpportunity: async (userId, input) => { calls.push({ tool: "reject", userId, input }); return result; },
      acceptOpportunity: async (userId, input) => { calls.push({ tool: "accept", userId, input }); return result; },
    },
  };
}

const tools = (host: NegotiatorVerdictToolsHost) =>
  createNegotiatorVerdictTools({ host, userId: "user-1", intentId: "intent-42" });

const invoke = async (tool: { invoke: (input: unknown) => Promise<unknown> }, input: unknown) =>
  JSON.parse(String(await tool.invoke(input))) as Record<string, unknown>;

describe("createNegotiatorVerdictTools", () => {
  it("registers exactly the two verdict tools", () => {
    const { host } = makeHost({ status: "executed", counterparty: "Camille Dubois" });
    expect(tools(host).map((t) => t.name)).toEqual(["reject_opportunity", "accept_opportunity"]);
  });

  it("routes a position and the client's own reason to the host, bound to the pinned signal", async () => {
    const { host, calls } = makeHost({ status: "executed", counterparty: "Camille Dubois" });
    const [reject] = tools(host);

    const result = await invoke(reject as never, { counterparty: 1, reason: "Wrong stage for me." });

    expect(calls).toEqual([{
      tool: "reject",
      userId: "user-1",
      input: { intentId: "intent-42", counterparty: 1, reason: "Wrong stage for me." },
    }]);
    expect(result.status).toBe("executed");
    // The confirmation names who the WRITE landed on, not who the model believed it picked.
    expect(result.counterparty).toBe("Camille Dubois");
    expect(String(result.message)).toContain("Camille Dubois");
    expect(String(result.message)).toContain("will not be contacted further");
    // A verdict on one match is not an edit of the signal.
    expect(String(result.message)).toContain("Do NOT also edit their signal");
  });

  it("omits the reason entirely when the client gave none — never an invented one", async () => {
    const { host, calls } = makeHost({ status: "executed", counterparty: "Camille Dubois" });
    const [reject] = tools(host);

    await invoke(reject as never, { counterparty: 2 });

    expect(calls[0].input).toEqual({ intentId: "intent-42", counterparty: 2 });
    expect("reason" in calls[0].input).toBe(false);
  });

  it("tells the client an accept is one side of two, never a connection", async () => {
    const { host, calls } = makeHost({ status: "executed", counterparty: "Camille Dubois" });
    const [, accept] = tools(host);

    const result = await invoke(accept as never, { counterparty: 1 });

    expect(calls[0].tool).toBe("accept");
    expect(String(result.message)).toContain("waiting on them");
    expect(String(result.message)).not.toContain("connected");
  });

  it("hands back the current list when the number names no counterparty, and says nothing was decided", async () => {
    const { host } = makeHost({
      status: "unknown_counterparty",
      count: 2,
      actionable: ["Camille Dubois — parked, waiting on you", "Ilya Roth — waiting on your decision"],
    });
    const [reject] = tools(host);

    const result = await invoke(reject as never, { counterparty: 7 });

    expect(result).toMatchObject({ status: "unknown_counterparty", count: 2 });
    expect(result.actionable).toEqual([
      "Camille Dubois — parked, waiting on you",
      "Ilya Roth — waiting on your decision",
    ]);
    expect(String(result.message)).toContain("Nothing was decided");
  });

  it("does not let an empty scope read as a recorded decision", async () => {
    const { host } = makeHost({ status: "none_actionable" });
    const [reject] = tools(host);

    const result = await invoke(reject as never, { counterparty: 1 });

    expect(result.status).toBe("none_actionable");
    expect(String(result.message)).toContain("rather than implying a decision was recorded");
  });

  it("says whose move it is when the client already acted", async () => {
    const { host } = makeHost({ status: "already_decided", counterparty: "Camille Dubois" });
    const [, accept] = tools(host);

    const result = await invoke(accept as never, { counterparty: 1 });

    expect(result).toMatchObject({ status: "already_decided", counterparty: "Camille Dubois" });
    expect(String(result.message)).toContain("nothing changed just now");
  });

  it("forbids describing the pairing as decided when the write failed", async () => {
    const { host } = makeHost({ status: "error" });
    const [reject, accept] = tools(host);

    const rejected = await invoke(reject as never, { counterparty: 1 });
    const accepted = await invoke(accept as never, { counterparty: 1 });

    expect(rejected.status).toBe("error");
    expect(String(rejected.message)).toContain("do not describe the pairing as rejected");
    expect(String(accepted.message)).toContain("do not describe the pairing as accepted");
  });

  it("never throws when the host does — the client keeps their turn", async () => {
    const host: NegotiatorVerdictToolsHost = {
      rejectOpportunity: async () => { throw new Error("database unavailable"); },
      acceptOpportunity: async () => { throw new Error("database unavailable"); },
    };
    const [reject] = tools(host);

    expect((await invoke(reject as never, { counterparty: 1 })).status).toBe("error");
  });

  it("exposes no id to the model — not in the schema, not in any result string", async () => {
    const statuses: NegotiatorVerdictResult[] = [
      { status: "executed", counterparty: "Camille Dubois" },
      { status: "none_actionable" },
      { status: "unknown_counterparty", count: 1, actionable: ["Camille Dubois — parked, waiting on you"] },
      { status: "already_decided", counterparty: "Camille Dubois" },
      { status: "error" },
    ];
    for (const status of statuses) {
      const { host } = makeHost(status);
      for (const tool of tools(host)) {
        const raw = String(await (tool as never as { invoke: (i: unknown) => Promise<unknown> })
          .invoke({ counterparty: 1 }));
        expect(raw).not.toContain(OPPORTUNITY_ID);
        expect(raw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        expect(raw.toLowerCase()).not.toContain("opportunityid");
      }
    }
    // The schema itself offers no place to put one.
    const { host } = makeHost({ status: "executed", counterparty: "Camille Dubois" });
    for (const tool of tools(host)) {
      expect(Object.keys((tool.schema as unknown as { shape: Record<string, unknown> }).shape).sort())
        .toEqual(["counterparty", "reason"]);
    }
  });
});

describe("buildNegotiatorSystemContent — verdicts in a pinned signal", () => {
  const COUNTERPARTIES = [
    "Camille Dubois — parked, waiting on you",
    "Ilya Roth — waiting on your decision",
  ];

  it("numbers each counterparty with the number the tools take", () => {
    const prompt = buildNegotiatorSystemContent(pinnedCtx, {
      ...AGENT_OPTS,
      actionableCounterparties: COUNTERPARTIES,
    });

    expect(prompt).toContain("## Verdicts Alice Test can pass here");
    expect(prompt).toContain("1. Camille Dubois — parked, waiting on you");
    expect(prompt).toContain("2. Ilya Roth — waiting on your decision");
    expect(prompt).toContain("reject_opportunity");
    expect(prompt).toContain("accept_opportunity");
  });

  it("makes the tool call the decision, not the sentence about it", () => {
    const prompt = buildNegotiatorSystemContent(pinnedCtx, {
      ...AGENT_OPTS,
      actionableCounterparties: COUNTERPARTIES,
    });

    expect(prompt).toContain("That call is the decision.");
    expect(prompt).toContain("Never pass a verdict they did not pass");
    expect(prompt).toContain("Pass their reason only if they gave one");
    expect(prompt).toContain("Accepting is one side of two");
    expect(prompt).toContain("update_opportunity is not this lever");
  });

  it("says nothing about the tools when no counterparty is actionable — the prompt is unchanged", () => {
    const withNone = buildNegotiatorSystemContent(pinnedCtx, AGENT_OPTS);
    const withEmpty = buildNegotiatorSystemContent(pinnedCtx, { ...AGENT_OPTS, actionableCounterparties: [] });

    expect(withNone).not.toContain("reject_opportunity");
    expect(withNone).not.toContain("Verdicts Alice Test can pass here");
    expect(withEmpty).toBe(withNone);
  });

  it("says nothing about the tools outside a pinned signal — they are not registered there", () => {
    const unscoped = buildNegotiatorSystemContent(makeCtx(), {
      ...AGENT_OPTS,
      actionableCounterparties: COUNTERPARTIES,
    });

    expect(unscoped).not.toContain("reject_opportunity");
    expect(unscoped).not.toContain("Verdicts Alice Test can pass here");
  });

  it("carries no opportunity id into the prompt", () => {
    const prompt = buildNegotiatorSystemContent(pinnedCtx, {
      ...AGENT_OPTS,
      actionableCounterparties: COUNTERPARTIES,
    });
    const verdictSection = prompt.slice(prompt.indexOf("## Verdicts"));

    expect(verdictSection).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
