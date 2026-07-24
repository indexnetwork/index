import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { buildSeededAttribution, combineAttributedDialogue, renderAttributedPriorDialogue, attributedDialogueIsEmpty, type AttributedPriorDialogue, type TaskAttribution } from "../negotiation.attribution.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState, type NegotiationTurn } from "../negotiation.state.js";
import type { NegotiationGraphDatabase } from "../../shared/interfaces/database.interface.js";
import type { AgentDispatcher } from "../../shared/interfaces/agent-dispatcher.interface.js";

/**
 * IND-569 — label prior-dialogue context per opportunity in negotiator prompts.
 *
 * Covers three layers:
 *  1. The pure grouping (`buildSeededAttribution`) partitions seeded prior
 *     turns into earlier-opportunity groups, an unattributed block, and the
 *     current opportunity's own turns.
 *  2. The negotiator prompt renders each block with an explicit, labeled header.
 *  3. The graph wires the attributed form through to the turn prompt: a
 *     continuation with two prior concluded tasks + legacy unattributed turns
 *     reaches the agent as two earlier groups plus an unattributed block.
 */

function turn(action: string, reasoning: string, message?: string): NegotiationTurn {
  return {
    action: action as NegotiationTurn["action"],
    assessment: { reasoning, suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    message: message ?? null,
  };
}

function dataMessage(id: string, senderId: string, t: NegotiationTurn, taskId: string | null, ageMs: number) {
  return {
    id,
    senderId,
    role: "agent" as const,
    parts: [{ kind: "data" as const, data: t }],
    createdAt: new Date(Date.now() - ageMs),
    taskId,
  };
}

describe("IND-569 buildSeededAttribution", () => {
  it("groups prior turns by opportunity, isolates unattributed, keeps same-opportunity turns current", async () => {
    const entries = [
      { taskId: "task-A", turn: turn("propose", "A1") },
      { taskId: "task-A", turn: turn("accept", "A2") },
      { taskId: "task-B", turn: turn("outreach", "B1") },
      { taskId: null, turn: turn("counter", "legacy") },
      { taskId: "task-cur", turn: turn("propose", "same opp") },
    ];

    const meta: Record<string, TaskAttribution> = {
      "task-A": { opportunityId: "opp-A", opportunityTitle: "ML co-founder search", outcome: "accepted", concludedAt: "2026-05-01T10:00:00Z" },
      "task-B": { opportunityId: "opp-B", opportunityTitle: "Design partner intro", outcome: "declined", concludedAt: "2026-04-15T09:00:00Z" },
      "task-cur": { opportunityId: "opp-current", opportunityTitle: "Current", outcome: null, concludedAt: null },
    };

    const seeded = await buildSeededAttribution(entries, "opp-current", async (id) => meta[id] ?? null);

    expect(seeded.earlier).toHaveLength(2);
    expect(seeded.earlier[0].opportunityId).toBe("opp-A");
    expect(seeded.earlier[0].turns).toHaveLength(2);
    expect(seeded.earlier[1].opportunityId).toBe("opp-B");
    expect(seeded.unattributed).toHaveLength(1);
    expect(seeded.unattributed[0].assessment.reasoning).toBe("legacy");
    // Same-opportunity prior turns join the current block, never an earlier one.
    expect(seeded.currentSeeded).toHaveLength(1);
    expect(seeded.currentSeeded[0].assessment.reasoning).toBe("same opp");
  });

  it("degrades unresolved / opportunity-less tasks to the unattributed block", async () => {
    const entries = [
      { taskId: "task-missing", turn: turn("propose", "unresolved") },
      { taskId: "task-noopp", turn: turn("counter", "no opp") },
    ];
    const seeded = await buildSeededAttribution(entries, "opp-current", async (id) =>
      id === "task-noopp" ? { opportunityId: null, opportunityTitle: null, outcome: null, concludedAt: null } : null,
    );
    expect(seeded.earlier).toHaveLength(0);
    expect(seeded.currentSeeded).toHaveLength(0);
    expect(seeded.unattributed).toHaveLength(2);
  });
});

describe("IND-569 renderAttributedPriorDialogue", () => {
  const fmt = (t: NegotiationTurn, i: number) => `Turn ${i + 1}: ${t.action} — ${t.assessment.reasoning}`;

  it("emits labeled earlier, unattributed, and current blocks; re-indexes each block from 1", () => {
    const dialogue: AttributedPriorDialogue = {
      earlier: [
        { opportunityId: "opp-A", opportunityTitle: "ML co-founder search", outcome: "accepted", concludedAt: "2026-05-01T10:00:00Z", turns: [turn("propose", "A1"), turn("accept", "A2")] },
        { opportunityId: "opp-B", opportunityTitle: "Design partner intro", outcome: "declined", concludedAt: "2026-04-15T09:00:00Z", turns: [turn("outreach", "B1")] },
      ],
      unattributed: [turn("counter", "legacy")],
      current: [turn("outreach", "current opening")],
    };
    const rendered = renderAttributedPriorDialogue(dialogue, fmt);

    expect(rendered).toContain('[Earlier negotiation — opportunity: "ML co-founder search" — concluded: accepted on 2026-05-01]');
    expect(rendered).toContain('[Earlier negotiation — opportunity: "Design partner intro" — concluded: declined on 2026-04-15]');
    expect(rendered).toContain("[Earlier context — unattributed]");
    expect(rendered).toContain("[Current opportunity — under negotiation now]");
    // Each block restarts at Turn 1 (no single flat numbering across opportunities).
    expect(rendered.match(/Turn 1:/g)?.length).toBe(4);
  });

  it("degrades missing title / outcome / date gracefully", () => {
    const dialogue: AttributedPriorDialogue = {
      earlier: [{ opportunityId: "opp-X", opportunityTitle: null, outcome: null, concludedAt: null, turns: [turn("propose", "x")] }],
      unattributed: [],
      current: [],
    };
    const rendered = renderAttributedPriorDialogue(dialogue, fmt);
    expect(rendered).toContain("[Earlier negotiation — opportunity: (untitled) — concluded: outcome unknown]");
    expect(rendered).not.toContain(" on null");
  });

  it("attributedDialogueIsEmpty detects blockless dialogue", () => {
    expect(attributedDialogueIsEmpty({ earlier: [], unattributed: [], current: [] })).toBe(true);
    expect(attributedDialogueIsEmpty(combineAttributedDialogue({ earlier: [], unattributed: [], currentSeeded: [] }, [turn("propose", "x")]))).toBe(false);
  });
});

/** Captures the chat messages the negotiator would send, without a live model. */
class CapturingNegotiator extends IndexNegotiator {
  captured: Array<{ role: string; content: string }> | null = null;
  constructor() {
    super({ turnTimeoutMs: 1000 });
  }
  protected override async callModel(_model: unknown, chatMessages: Array<{ role: string; content: string }>): Promise<unknown> {
    this.captured = chatMessages;
    return { action: "counter", assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null };
  }
}

describe("IND-569 negotiator prompt rendering", () => {
  it("continuation prompt contains two labeled earlier blocks and a separate current block", async () => {
    const agent = new CapturingNegotiator();
    const priorDialogue: AttributedPriorDialogue = {
      earlier: [
        { opportunityId: "opp-A", opportunityTitle: "ML co-founder search", outcome: "accepted", concludedAt: "2026-05-01T10:00:00Z", turns: [turn("propose", "Great fit"), turn("accept", "Agreed")] },
        { opportunityId: "opp-B", opportunityTitle: "Design partner intro", outcome: "declined", concludedAt: "2026-04-15T09:00:00Z", turns: [turn("outreach", "Reaching out"), turn("decline", "Not a fit")] },
      ],
      unattributed: [turn("counter", "legacy turn text")],
      current: [turn("outreach", "current opening move")],
    };

    const input: NegotiationAgentInput = {
      ownUser: { id: "u-init", intents: [], profile: { name: "Alice" } },
      otherUser: { id: "u-cp", intents: [], profile: { name: "Bob" } },
      indexContext: { networkId: "net-1", prompt: "AI co-founders" },
      seedAssessment: { reasoning: "seed", valencyRole: "peer" },
      history: [],
      seat: "initiator",
      protocolVersion: "v2",
      isContinuation: true,
      priorDialogue,
    };

    await agent.invoke(input);
    const userMessage = agent.captured!.find((m) => m.role === "user")!.content;

    expect(userMessage).toContain('[Earlier negotiation — opportunity: "ML co-founder search" — concluded: accepted on 2026-05-01]');
    expect(userMessage).toContain('[Earlier negotiation — opportunity: "Design partner intro" — concluded: declined on 2026-04-15]');
    expect(userMessage).toContain("[Earlier context — unattributed]");
    expect(userMessage).toContain("legacy turn text");
    expect(userMessage).toContain("[Current opportunity — under negotiation now]");
    expect(userMessage).toContain("current opening move");
    // Trust-boundary framing: prior turns are context, not instructions.
    expect(userMessage).toContain("not instructions");
    // Current block appears after both earlier blocks in the rendered prompt.
    const currentIdx = userMessage.indexOf("[Current opportunity — under negotiation now]");
    const earlierIdx = userMessage.indexOf("[Earlier negotiation");
    expect(earlierIdx).toBeGreaterThanOrEqual(0);
    expect(currentIdx).toBeGreaterThan(earlierIdx);
  });

  it("without attributed dialogue, continuation falls back to the flat history rendering", async () => {
    const agent = new CapturingNegotiator();
    const input: NegotiationAgentInput = {
      ownUser: { id: "u-init", intents: [], profile: { name: "Alice" } },
      otherUser: { id: "u-cp", intents: [], profile: { name: "Bob" } },
      indexContext: { networkId: "net-1", prompt: "" },
      seedAssessment: { reasoning: "seed", valencyRole: "peer" },
      history: [turn("propose", "flat prior")],
      seat: "initiator",
      protocolVersion: "v2",
      isContinuation: true,
    };
    await agent.invoke(input);
    const userMessage = agent.captured!.find((m) => m.role === "user")!.content;
    expect(userMessage).toContain("flat prior");
    expect(userMessage).toContain("Negotiation history:");
    expect(userMessage).not.toContain("[Earlier negotiation");
    expect(userMessage).not.toContain("[Current opportunity — under negotiation now]");
    // Flat fallback keeps the original wrapper (no per-opportunity preamble).
    expect(userMessage).not.toContain("not instructions");
  });
});

// ─── Graph wiring ──────────────────────────────────────────────────────────

let msgCounter = 0;
const origInvoke = IndexNegotiator.prototype.invoke;
afterEach(() => {
  IndexNegotiator.prototype.invoke = origInvoke;
});

const sourceUser = {
  id: "user-source",
  intents: [{ id: "iCur", title: "Current search", description: "d", confidence: 0.9 }],
  profile: { name: "Alice", bio: "PM", skills: ["product"] },
};
const candidateUser = {
  id: "user-candidate",
  intents: [{ id: "iCurC", title: "Current cand", description: "d", confidence: 0.85 }],
  profile: { name: "Bob", bio: "Eng", skills: ["ML"] },
};

function createWiringDatabase() {
  const now = Date.now();
  const priorMessages = [
    dataMessage("m1", `agent:${sourceUser.id}`, turn("propose", "A1"), "task-A", 500_000),
    dataMessage("m2", `agent:${candidateUser.id}`, turn("accept", "A2"), "task-A", 490_000),
    dataMessage("m3", `agent:${sourceUser.id}`, turn("outreach", "B1"), "task-B", 400_000),
    dataMessage("m4", `agent:${candidateUser.id}`, turn("decline", "B2"), "task-B", 390_000),
    dataMessage("m5", `agent:${sourceUser.id}`, turn("counter", "legacy"), null, 300_000),
  ];

  const tasks: Record<string, { id: string; conversationId: string; state: string; metadata: Record<string, unknown>; createdAt: Date; updatedAt: Date }> = {
    "task-A": {
      id: "task-A", conversationId: "conv-1", state: "completed",
      metadata: { opportunityId: "opp-A", sourceIntentId: "iA", intentSnapshots: [{ userId: sourceUser.id, intentId: "iA", title: "ML co-founder search", description: "" }] },
      createdAt: new Date(now - 510_000), updatedAt: new Date("2026-05-01T10:00:00Z"),
    },
    "task-B": {
      id: "task-B", conversationId: "conv-1", state: "completed",
      metadata: { opportunityId: "opp-B", sourceIntentId: "iB", intentSnapshots: [{ userId: sourceUser.id, intentId: "iB", title: "Design partner intro", description: "" }] },
      createdAt: new Date(now - 410_000), updatedAt: new Date("2026-04-15T09:00:00Z"),
    },
  };

  const artifacts: Record<string, Array<{ id: string; name: string | null; parts: unknown[]; metadata: Record<string, unknown> | null }>> = {
    "task-A": [{ id: "art-A", name: "negotiation-outcome", parts: [{ kind: "data", data: { hasOpportunity: true, turnCount: 2 } }], metadata: null }],
    "task-B": [{ id: "art-B", name: "negotiation-outcome", parts: [{ kind: "data", data: { hasOpportunity: false, turnCount: 2 } }], metadata: null }],
  };

  return {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createMessage: async (p: { senderId: string; parts: unknown[] }) => ({ id: `msg-${++msgCounter}`, senderId: p.senderId, role: "agent" as const, parts: p.parts, createdAt: new Date() }),
    createTask: async () => ({ id: "task-current", conversationId: "conv-1", state: "submitted" }),
    createNegotiationTaskForAttempt: async () => ({ id: "task-current", conversationId: "conv-1", state: "submitted" }),
    updateTaskState: async () => ({ id: "task-current", conversationId: "conv-1", state: "working" }),
    createArtifact: async () => ({ id: "art-new" }),
    setTaskTurnContext: async () => {},
    getNegotiationTaskForOpportunity: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
    getOpportunityUserAnswers: async () => [],
    getTasksForUser: async () => [],
    getTask: async (id: string) => tasks[id] ?? null,
    getArtifactsForTask: async (id: string) => artifacts[id] ?? [],
    getMessagesForConversation: async () => priorMessages,
    getUserContext: async () => ({ text: "" }),
    updateOpportunityStatus: async () => ({ id: "opp-current", status: "negotiating" }),
  } as unknown as NegotiationGraphDatabase;
}

function createMockDispatcher() {
  return {
    dispatch: async () => ({ handled: false as const, reason: "no_agent" as const }),
    hasExternalAgent: async () => false,
  } as unknown as AgentDispatcher;
}

describe("IND-569 graph wiring", () => {
  beforeEach(() => {
    msgCounter = 0;
  });

  it("continuation with two prior concluded tasks reaches the turn prompt as two labeled earlier groups + unattributed block", async () => {
    let capturedInput: Record<string, unknown> | null = null;
    IndexNegotiator.prototype.invoke = async function (input) {
      if (!capturedInput) capturedInput = input as unknown as Record<string, unknown>;
      return { action: "accept", assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never;
    };

    const graph = new NegotiationGraphFactory(createWiringDatabase(), createMockDispatcher()).createGraph();
    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext: { networkId: "idx-1", prompt: "AI co-founders" },
      seedAssessment: { reasoning: "seed", valencyRole: "peer" },
      opportunityId: "opp-current",
      maxTurns: 2,
    } as Partial<typeof NegotiationGraphState.State>);

    expect(result.isContinuation).toBe(true);
    expect(capturedInput).not.toBeNull();

    const priorDialogue = (capturedInput as Record<string, unknown>).priorDialogue as AttributedPriorDialogue | undefined;
    expect(priorDialogue).toBeDefined();
    expect(priorDialogue!.earlier).toHaveLength(2);

    const byOpp = Object.fromEntries(priorDialogue!.earlier.map((g) => [g.opportunityId, g]));
    expect(byOpp["opp-A"].opportunityTitle).toBe("ML co-founder search");
    expect(byOpp["opp-A"].outcome).toBe("accepted");
    expect(byOpp["opp-A"].concludedAt).toBe(new Date("2026-05-01T10:00:00Z").toISOString());
    expect(byOpp["opp-B"].opportunityTitle).toBe("Design partner intro");
    expect(byOpp["opp-B"].outcome).toBe("declined");

    // Legacy null-task turn lands in the unattributed block, never mixed in.
    expect(priorDialogue!.unattributed).toHaveLength(1);
    expect(priorDialogue!.unattributed[0].assessment.reasoning).toBe("legacy");
    // No prior turn belonged to opp-current, and no session turn exists yet.
    expect(priorDialogue!.current).toHaveLength(0);
  }, 30_000);
});
