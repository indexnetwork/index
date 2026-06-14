import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it, mock } from "bun:test";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
  OpportunityPresenter,
  type HomeCardPresenterInput,
} from "../opportunity.presenter.js";
import type { NegotiationContext } from "../negotiation-context.loader.js";

type PresenterWithInvokeOverride = {
  invokeWithTimeout: (...args: unknown[]) => unknown;
};

const BASE_INPUT: HomeCardPresenterInput = {
  viewerContext: "Name: Alice\nBio: Engineer",
  otherPartyContext: "Name: Bob\nBio: Designer",
  matchReasoning: "Both interested in AI tooling and design systems.",
  category: "collaboration",
  confidence: 0.8,
  signalsSummary: "Complementary skills",
  indexName: "Test Index",
  viewerRole: "peer",
  opportunityStatus: "pending",
};

function makeNegotiatingContext(turnCount: number, turnCap: number): NegotiationContext {
  return { status: "negotiating", turnCount, turnCap };
}

function makeCompletedContext(
  status: NegotiationContext["status"],
  opts: { hasOpportunity: boolean; reason?: "turn_cap" | "timeout"; turnCount?: number } = { hasOpportunity: true },
): NegotiationContext {
  return {
    status,
    turnCount: opts.turnCount ?? 2,
    turnCap: 6,
    outcome: {
      hasOpportunity: opts.hasOpportunity,
      agreedRoles: [{ userId: "u1", role: "peer" }],
      reasoning: "Agents converged on a shared goal.",
      turnCount: opts.turnCount ?? 2,
      ...(opts.reason ? { reason: opts.reason } : {}),
    },
    turns: [
      {
        action: "propose",
        assessment: {
          reasoning: "Start the conversation with the React opening.",
          suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        },
        message: "Opening pitch",
      },
      {
        action: opts.hasOpportunity ? "accept" : "counter",
        assessment: {
          reasoning: "Accept because roles align on design systems.",
          suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        },
        message: "Closing note",
      },
    ],
  };
}

/** Captures the (system, human) messages the presenter would pass to the LLM. */
function capturingPresenter(fakeLLMResult?: unknown): {
  presenter: OpportunityPresenter;
  getLastHumanContent: () => string | undefined;
  getCallCount: () => number;
} {
  let lastHuman: string | undefined;
  let calls = 0;
  const presenter = new OpportunityPresenter();
  const overridable = presenter as unknown as PresenterWithInvokeOverride;
  overridable.invokeWithTimeout = mock(async (..._args: unknown[]) => {
    calls += 1;
    const messages = _args[1] as (SystemMessage | HumanMessage)[];
    const human = messages.find((m): m is HumanMessage => m instanceof HumanMessage);
    lastHuman = human?.content as string | undefined;
    // Return a valid parsed shape so downstream code doesn't throw.
    return (
      fakeLLMResult ?? {
        presentation: {
          headline: "Match",
          personalizedSummary: "You would both get value.",
          digestSummary: "You might like meeting Bob because you would both get value.",
          suggestedAction: "Reach out.",
          narratorRemark: "Worth a look.",
          greeting: "Saw we may both get value from connecting and would love to compare notes.",
          mutualIntentsLabel: "Shared interests",
        },
      }
    );
  });
  return {
    presenter,
    getLastHumanContent: () => lastHuman,
    getCallCount: () => calls,
  };
}

describe("OpportunityPresenter – negotiation branch", () => {
  it("returns templated chip without invoking the LLM for status `negotiating`", async () => {
    const { presenter, getCallCount } = capturingPresenter();

    const result = await presenter.presentHomeCard({
      ...BASE_INPUT,
      opportunityStatus: "negotiating",
      negotiationContext: makeNegotiatingContext(3, 8),
    });

    expect(getCallCount()).toBe(0);
    expect(result.narratorRemark).toBe("Currently negotiating · turn 3 of 8");
    expect(result.headline).toBe("Negotiation in progress");
  });

  it("drops the `of N` when turnCap is 0 (unlimited)", async () => {
    const { presenter } = capturingPresenter();
    const result = await presenter.presentHomeCard({
      ...BASE_INPUT,
      opportunityStatus: "negotiating",
      negotiationContext: makeNegotiatingContext(1, 0),
    });
    expect(result.narratorRemark).toBe("Currently negotiating · turn 1");
  });

  it("injects NEGOTIATION CONTEXT block into the prompt for `pending`", async () => {
    const { presenter, getLastHumanContent } = capturingPresenter();

    await presenter.presentHomeCard({
      ...BASE_INPUT,
      opportunityStatus: "pending",
      negotiationContext: makeCompletedContext("pending", { hasOpportunity: true }),
    });

    const human = getLastHumanContent();
    expect(human).toBeDefined();
    expect(human!).toContain("NEGOTIATION CONTEXT:");
    expect(human!).toContain("Negotiation status: pending");
    expect(human!).toContain("Turns exchanged: 2 of 6");
    expect(human!).toContain("Turn 1 (propose):");
    expect(human!).toContain("Final outcome: agreed");
  });

  it("includes `agents hit the turn cap` phrasing for stalled/turn_cap", async () => {
    const { presenter, getLastHumanContent } = capturingPresenter();

    await presenter.presentHomeCard({
      ...BASE_INPUT,
      opportunityStatus: "stalled",
      negotiationContext: makeCompletedContext("stalled", {
        hasOpportunity: false,
        reason: "turn_cap",
        turnCount: 6,
      }),
    });

    const human = getLastHumanContent();
    expect(human!).toContain("agents hit the turn cap without converging");
  });

  it("includes `counterpart went silent` phrasing for stalled/timeout", async () => {
    const { presenter, getLastHumanContent } = capturingPresenter();

    await presenter.presentHomeCard({
      ...BASE_INPUT,
      opportunityStatus: "stalled",
      negotiationContext: makeCompletedContext("stalled", {
        hasOpportunity: false,
        reason: "timeout",
      }),
    });

    const human = getLastHumanContent();
    expect(human!).toContain("counterpart went silent before responding");
  });

  it("does NOT include NEGOTIATION CONTEXT block when negotiationContext is absent", async () => {
    const { presenter, getLastHumanContent } = capturingPresenter();

    await presenter.presentHomeCard({
      ...BASE_INPUT,
      opportunityStatus: "pending",
    });

    const human = getLastHumanContent();
    expect(human!).not.toContain("NEGOTIATION CONTEXT:");
  });

  it("flags outcome `declined` for `rejected`", async () => {
    const { presenter, getLastHumanContent } = capturingPresenter();

    await presenter.presentHomeCard({
      ...BASE_INPUT,
      opportunityStatus: "rejected",
      negotiationContext: makeCompletedContext("rejected", { hasOpportunity: false }),
    });

    const human = getLastHumanContent();
    expect(human!).toContain("Final outcome: declined");
  });

  it("includes `agreed` outcome for `accepted`", async () => {
    const { presenter, getLastHumanContent } = capturingPresenter();

    await presenter.presentHomeCard({
      ...BASE_INPUT,
      opportunityStatus: "accepted",
      negotiationContext: makeCompletedContext("accepted", { hasOpportunity: true }),
    });

    const human = getLastHumanContent();
    expect(human!).toContain("Final outcome: agreed");
  });
});
