import { describe, it, expect } from "bun:test";
import { assessDeadlock, configuredDeadlockShiftEnabled, configuredDeadlockThreshold, renderBargainingShiftSection, DEFAULT_DEADLOCK_THRESHOLD, MIN_DEADLOCK_THRESHOLD } from "../negotiation.deadlock.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";

/**
 * IND-428 — deadlock detection + persuasion→bargaining mode shift (unit).
 *
 * Pins:
 * - detector semantics: maximal TRAILING run of counter/question turns;
 *   openings, terminal actions, ask_user, and unreadable actions RESET the
 *   run; boundary at exactly N (N-1 is not a deadlock),
 * - env config: strict-literal flag (default off), threshold integer >= 2
 *   with fallback-to-default on invalid values,
 * - prompt section: rendered only when active; ask_user escalation line only
 *   when the caller already legally holds the action; empty string otherwise,
 * - agent prompt assembly: byte-identical prompts when bargaining is absent
 *   (disabled-path equivalence at the drafting surface), v1 never gains the
 *   section even if the field is passed.
 */

function turn(action: string) {
  return {
    action,
    assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
    message: null,
  };
}

const turns = (...actions: string[]) => actions.map(turn) as Array<ReturnType<typeof turn>>;

// ─── Detector semantics ──────────────────────────────────────────────────────

describe("assessDeadlock — trailing-run semantics", () => {
  it("empty history is never deadlocked", () => {
    expect(assessDeadlock([], 2)).toEqual({ deadlocked: false, consecutiveNonConvergent: 0, threshold: 2 });
  });

  it("boundary: N-1 consecutive counters is not a deadlock; N is", () => {
    const nMinus1 = assessDeadlock(turns("outreach", "counter", "counter", "counter"), 4);
    expect(nMinus1.deadlocked).toBe(false);
    expect(nMinus1.consecutiveNonConvergent).toBe(3);

    const n = assessDeadlock(turns("outreach", "counter", "counter", "counter", "counter"), 4);
    expect(n.deadlocked).toBe(true);
    expect(n.consecutiveNonConvergent).toBe(4);
  });

  it("question counts toward the run, mixed with counter", () => {
    const a = assessDeadlock(turns("outreach", "counter", "question", "counter"), 3);
    expect(a.deadlocked).toBe(true);
    expect(a.consecutiveNonConvergent).toBe(3);
  });

  it("only the TRAILING run counts — an opening mid-history resets it", () => {
    // A continuation where a fresh outreach re-opened the case: the earlier
    // counters no longer signal a stalemate on the current proposal.
    const a = assessDeadlock(turns("counter", "counter", "counter", "outreach", "counter"), 3);
    expect(a.deadlocked).toBe(false);
    expect(a.consecutiveNonConvergent).toBe(1);
    expect(assessDeadlock(turns("counter", "counter", "propose", "counter"), 2).consecutiveNonConvergent).toBe(1);
  });

  it("ask_user resets the run (new principal input is about to arrive)", () => {
    const a = assessDeadlock(turns("outreach", "counter", "counter", "ask_user"), 2);
    expect(a.deadlocked).toBe(false);
    expect(a.consecutiveNonConvergent).toBe(0);
    // …but counters after the consult count fresh.
    const b = assessDeadlock(turns("outreach", "counter", "ask_user", "counter", "counter"), 2);
    expect(b.deadlocked).toBe(true);
    expect(b.consecutiveNonConvergent).toBe(2);
  });

  it("terminal actions reset the run (the game decided, not stalled)", () => {
    for (const terminal of ["accept", "reject", "withdraw", "decline"]) {
      const a = assessDeadlock(turns("counter", "counter", terminal), 2);
      expect(a.deadlocked).toBe(false);
      expect(a.consecutiveNonConvergent).toBe(0);
    }
  });

  it("unreadable/unknown actions reset conservatively (never manufacture a deadlock)", () => {
    expect(assessDeadlock(turns("counter", "counter", "garbage"), 2).deadlocked).toBe(false);
    const malformed = [...turns("counter", "counter"), { action: undefined } as never];
    expect(assessDeadlock(malformed, 2).deadlocked).toBe(false);
  });

  it("an invalid threshold argument falls back to the default", () => {
    const history = turns("counter", "counter", "counter");
    expect(assessDeadlock(history, 0).threshold).toBe(DEFAULT_DEADLOCK_THRESHOLD);
    expect(assessDeadlock(history, 1.5).threshold).toBe(DEFAULT_DEADLOCK_THRESHOLD);
    expect(assessDeadlock(history, Number.NaN).threshold).toBe(DEFAULT_DEADLOCK_THRESHOLD);
  });
});

// ─── Env config ──────────────────────────────────────────────────────────────

describe("deadlock env helpers", () => {
  it("flag is strict-literal 'true', default off; threshold validates integer >= 2", () => {
    const origFlag = process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED;
    const origThreshold = process.env.NEGOTIATION_DEADLOCK_THRESHOLD;
    try {
      delete process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED;
      delete process.env.NEGOTIATION_DEADLOCK_THRESHOLD;
      expect(configuredDeadlockShiftEnabled()).toBe(false);
      expect(configuredDeadlockThreshold()).toBe(DEFAULT_DEADLOCK_THRESHOLD);

      process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED = "true";
      expect(configuredDeadlockShiftEnabled()).toBe(true);
      for (const notTrue of ["TRUE", "1", "yes", "on", ""]) {
        process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED = notTrue;
        expect(configuredDeadlockShiftEnabled()).toBe(false);
      }

      process.env.NEGOTIATION_DEADLOCK_THRESHOLD = String(MIN_DEADLOCK_THRESHOLD);
      expect(configuredDeadlockThreshold()).toBe(MIN_DEADLOCK_THRESHOLD);
      process.env.NEGOTIATION_DEADLOCK_THRESHOLD = "7";
      expect(configuredDeadlockThreshold()).toBe(7);
      for (const invalid of ["1", "0", "-3", "3.5", "abc", ""]) {
        process.env.NEGOTIATION_DEADLOCK_THRESHOLD = invalid;
        expect(configuredDeadlockThreshold()).toBe(DEFAULT_DEADLOCK_THRESHOLD);
      }
    } finally {
      if (origFlag === undefined) delete process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED; else process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED = origFlag;
      if (origThreshold === undefined) delete process.env.NEGOTIATION_DEADLOCK_THRESHOLD; else process.env.NEGOTIATION_DEADLOCK_THRESHOLD = origThreshold;
    }
  });
});

// ─── Prompt section render ───────────────────────────────────────────────────

describe("renderBargainingShiftSection", () => {
  it("returns the empty string when inactive", () => {
    expect(renderBargainingShiftSection({ active: false, userName: "Alice", canAskUser: true, consecutiveNonConvergent: 4 })).toBe("");
  });

  it("renders the stance shift with the run length and user name substituted", () => {
    const s = renderBargainingShiftSection({ active: true, userName: "Alice", canAskUser: false, consecutiveNonConvergent: 4 });
    expect(s).toContain("SHIFT FROM PERSUASION TO BARGAINING");
    expect(s).toContain("The last 4 turns");
    expect(s).toContain("Alice's interests");
    expect(s).toContain("your available actions are unchanged");
    expect(s).not.toContain("{userName}");
    expect(s).not.toContain("{consecutive}");
    expect(s).not.toContain("{askUserEscalation}");
    expect(s).not.toContain("ask_user");
  });

  it("includes the ask_user escalation line only when the action is already legally held", () => {
    const withEscalation = renderBargainingShiftSection({ active: true, userName: "Alice", canAskUser: true, consecutiveNonConvergent: 4 });
    expect(withEscalation).toContain('"ask_user"');
    expect(withEscalation).toContain("Alice's own input");
  });
});

// ─── Agent prompt assembly (drafting-surface equivalence) ────────────────────

class CapturingNegotiator extends IndexNegotiator {
  captured: Array<Array<{ role: string; content: string }>> = [];
  constructor(private scripted: unknown) {
    super({ turnTimeoutMs: 1000 });
  }
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.captured.push(chatMessages);
    return this.scripted;
  }
}

const counterOutput = {
  action: "counter",
  assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  message: null,
};

function agentInput(extra?: Partial<NegotiationAgentInput>): NegotiationAgentInput {
  return {
    ownUser: { id: "u-init", intents: [], profile: { name: "Alice" } },
    otherUser: { id: "u-cp", intents: [], profile: { name: "Bob" } },
    indexContext: { networkId: "net-1", prompt: "" },
    seedAssessment: { reasoning: "seed", valencyRole: "peer" },
    history: [
      { action: "outreach", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null },
      { action: "counter", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null },
    ],
    seat: "initiator",
    protocolVersion: "v2",
    ...extra,
  };
}

describe("IndexNegotiator — bargaining stance prompt (IND-428)", () => {
  it("injects the bargaining section when the graph passes the stance", async () => {
    const agent = new CapturingNegotiator(counterOutput);
    await agent.invoke(agentInput({ bargaining: { consecutiveNonConvergent: 4 } }));
    const systemPrompt = agent.captured[0][0].content;
    expect(systemPrompt).toContain("SHIFT FROM PERSUASION TO BARGAINING");
    expect(systemPrompt).toContain("The last 4 turns");
    // Without canAskUser the escalation line must not render.
    expect(systemPrompt).not.toContain('escalate with "ask_user"');
  });

  it("adds the ask_user escalation only when canAskUser is also granted", async () => {
    const agent = new CapturingNegotiator(counterOutput);
    await agent.invoke(agentInput({ bargaining: { consecutiveNonConvergent: 4 }, canAskUser: true }));
    expect(agent.captured[0][0].content).toContain('escalate with "ask_user"');
  });

  it("keeps prompts byte-identical when bargaining is absent (disabled-path equivalence)", async () => {
    const withoutField = new CapturingNegotiator(counterOutput);
    await withoutField.invoke(agentInput());
    const withUndefined = new CapturingNegotiator(counterOutput);
    await withUndefined.invoke(agentInput({ bargaining: undefined }));

    expect(withUndefined.captured[0][0].content).toBe(withoutField.captured[0][0].content);
    expect(withUndefined.captured[0][1].content).toBe(withoutField.captured[0][1].content);
    expect(withoutField.captured[0][0].content).not.toContain("BARGAINING");
    expect(withoutField.captured[0][0].content).not.toContain("{bargainingShift}");
  });

  it("v1 never gains the section even if the field is passed (defense in depth)", async () => {
    const agent = new CapturingNegotiator({ ...counterOutput });
    await agent.invoke(agentInput({ protocolVersion: "v1", bargaining: { consecutiveNonConvergent: 4 } }));
    expect(agent.captured[0][0].content).not.toContain("BARGAINING");
  });
});
