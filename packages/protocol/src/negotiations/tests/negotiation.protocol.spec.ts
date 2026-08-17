import { describe, it, expect, afterEach } from "bun:test";
import { InitiatorTurnSchema, CounterpartyTurnSchema, FinalInitiatorTurnSchema, FinalCounterpartyTurnSchema, allowedActionsFor, turnSchemaFor, isTerminalAction, isRejectLikeAction, fallbackActionFor, rejectActionFor, readProtocolVersion, configuredProtocolVersion, resolveSeat, seatViolationMessage } from "../negotiation.protocol.js";
import { SystemNegotiationTurnSchema, FinalNegotiationTurnSchema } from "../negotiation.state.js";

/**
 * IND-397 — seat-scoped turn schemas + counterparty-only accept.
 * Pure unit coverage for the protocol-rules module: the consent asymmetry is
 * schema-enforced, not prompt-enforced.
 */

const assessment = {
  reasoning: "r",
  suggestedRoles: { ownUser: "peer", otherUser: "peer" },
};

function turn(action: string) {
  return { action, assessment, message: null };
}

describe("v2 seat-scoped schemas — consent asymmetry", () => {
  it("initiator accept is structurally impossible", () => {
    expect(InitiatorTurnSchema.safeParse(turn("accept")).success).toBe(false);
    expect(FinalInitiatorTurnSchema.safeParse(turn("accept")).success).toBe(false);
  });

  it("initiator vocabulary: outreach | counter | question | withdraw", () => {
    for (const a of ["outreach", "counter", "question", "withdraw"]) {
      expect(InitiatorTurnSchema.safeParse(turn(a)).success).toBe(true);
    }
    for (const a of ["accept", "decline", "propose", "reject"]) {
      expect(InitiatorTurnSchema.safeParse(turn(a)).success).toBe(false);
    }
  });

  it("counterparty vocabulary: accept | decline | counter | question", () => {
    for (const a of ["accept", "decline", "counter", "question"]) {
      expect(CounterpartyTurnSchema.safeParse(turn(a)).success).toBe(true);
    }
    for (const a of ["outreach", "withdraw", "propose", "reject"]) {
      expect(CounterpartyTurnSchema.safeParse(turn(a)).success).toBe(false);
    }
  });

  it("final turns: counterparty must decide (accept|decline); initiator may withdraw|counter", () => {
    expect(FinalCounterpartyTurnSchema.safeParse(turn("accept")).success).toBe(true);
    expect(FinalCounterpartyTurnSchema.safeParse(turn("decline")).success).toBe(true);
    expect(FinalCounterpartyTurnSchema.safeParse(turn("counter")).success).toBe(false);
    expect(FinalInitiatorTurnSchema.safeParse(turn("withdraw")).success).toBe(true);
    expect(FinalInitiatorTurnSchema.safeParse(turn("counter")).success).toBe(true);
    expect(FinalInitiatorTurnSchema.safeParse(turn("question")).success).toBe(false);
  });
});

describe("allowedActionsFor", () => {
  it("v1 ignores seat (legacy symmetric vocabulary)", () => {
    expect(allowedActionsFor("v1", "initiator")).toEqual(["propose", "accept", "reject", "counter", "question"]);
    expect(allowedActionsFor("v1", "counterparty")).toEqual(["propose", "accept", "reject", "counter", "question"]);
    expect(allowedActionsFor("v1", "counterparty", true)).toEqual(["accept", "reject"]);
  });

  it("v2 scopes by seat, and final turns narrow further", () => {
    expect(allowedActionsFor("v2", "initiator")).toEqual(["outreach", "counter", "question", "withdraw"]);
    expect(allowedActionsFor("v2", "counterparty")).toEqual(["accept", "decline", "counter", "question"]);
    expect(allowedActionsFor("v2", "initiator", true)).toEqual(["withdraw", "counter"]);
    expect(allowedActionsFor("v2", "counterparty", true)).toEqual(["accept", "decline"]);
  });

  it("v2 initiator can never accept in any turn position", () => {
    expect(allowedActionsFor("v2", "initiator")).not.toContain("accept");
    expect(allowedActionsFor("v2", "initiator", true)).not.toContain("accept");
  });
});

describe("turnSchemaFor", () => {
  const v1 = { system: SystemNegotiationTurnSchema, final: FinalNegotiationTurnSchema };

  it("v1 returns the legacy schemas regardless of seat", () => {
    expect(turnSchemaFor("v1", "initiator", false, v1)).toBe(SystemNegotiationTurnSchema);
    expect(turnSchemaFor("v1", "counterparty", false, v1)).toBe(SystemNegotiationTurnSchema);
    expect(turnSchemaFor("v1", "initiator", true, v1)).toBe(FinalNegotiationTurnSchema);
  });

  it("v2 returns the seat-scoped schemas", () => {
    expect(turnSchemaFor("v2", "initiator", false, v1)).toBe(InitiatorTurnSchema);
    expect(turnSchemaFor("v2", "counterparty", false, v1)).toBe(CounterpartyTurnSchema);
    expect(turnSchemaFor("v2", "initiator", true, v1)).toBe(FinalInitiatorTurnSchema);
    expect(turnSchemaFor("v2", "counterparty", true, v1)).toBe(FinalCounterpartyTurnSchema);
  });
});

describe("action semantics", () => {
  it("terminal actions: accept, reject, withdraw, decline", () => {
    for (const a of ["accept", "reject", "withdraw", "decline"]) expect(isTerminalAction(a)).toBe(true);
    for (const a of ["propose", "outreach", "counter", "question", undefined, null]) expect(isTerminalAction(a)).toBe(false);
  });

  it("reject-like actions map to rejected: reject, withdraw, decline (not accept)", () => {
    for (const a of ["reject", "withdraw", "decline"]) expect(isRejectLikeAction(a)).toBe(true);
    for (const a of ["accept", "counter", "question", "outreach", "propose"]) expect(isRejectLikeAction(a)).toBe(false);
  });

  it("fallback is conservative counter; final turns must decide per seat", () => {
    expect(fallbackActionFor("v1", "initiator", false)).toBe("counter");
    expect(fallbackActionFor("v2", "counterparty", false)).toBe("counter");
    expect(fallbackActionFor("v1", "counterparty", true)).toBe("reject");
    expect(fallbackActionFor("v2", "counterparty", true)).toBe("decline");
    expect(fallbackActionFor("v2", "initiator", true)).toBe("counter");
  });

  it("rejectActionFor is seat-appropriate under v2", () => {
    expect(rejectActionFor("v1", "initiator")).toBe("reject");
    expect(rejectActionFor("v2", "initiator")).toBe("withdraw");
    expect(rejectActionFor("v2", "counterparty")).toBe("decline");
  });
});

describe("metadata readers", () => {
  const origEnv = process.env.NEGOTIATION_PROTOCOL_VERSION;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.NEGOTIATION_PROTOCOL_VERSION;
    else process.env.NEGOTIATION_PROTOCOL_VERSION = origEnv;
  });

  it("readProtocolVersion: v1/v2 pass through; absent or junk → null", () => {
    expect(readProtocolVersion({ protocolVersion: "v2" })).toBe("v2");
    expect(readProtocolVersion({ protocolVersion: "v1" })).toBe("v1");
    expect(readProtocolVersion({})).toBeNull();
    expect(readProtocolVersion({ protocolVersion: "v3" })).toBeNull();
    expect(readProtocolVersion(null)).toBeNull();
  });

  it("configuredProtocolVersion: env switch, defaults v1", () => {
    delete process.env.NEGOTIATION_PROTOCOL_VERSION;
    expect(configuredProtocolVersion()).toBe("v1");
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    expect(configuredProtocolVersion()).toBe("v2");
    process.env.NEGOTIATION_PROTOCOL_VERSION = "nonsense";
    expect(configuredProtocolVersion()).toBe("v1");
  });

  it("resolveSeat keys on initiatorUserId, falling back to sourceUserId (never parity)", () => {
    expect(resolveSeat("u-a", { initiatorUserId: "u-a", sourceUserId: "u-b" })).toBe("initiator");
    expect(resolveSeat("u-b", { initiatorUserId: "u-a", sourceUserId: "u-b" })).toBe("counterparty");
    // Pre-stamp task: sourceUserId is the fallback seat anchor
    expect(resolveSeat("u-a", { sourceUserId: "u-a" })).toBe("initiator");
    expect(resolveSeat("u-b", { sourceUserId: "u-a" })).toBe("counterparty");
    // Empty-string stamp is ignored
    expect(resolveSeat("u-a", { initiatorUserId: "", sourceUserId: "u-a" })).toBe("initiator");
  });

  it("seatViolationMessage names the action, seat, version, and allowed set", () => {
    const msg = seatViolationMessage("accept", "initiator", "v2");
    expect(msg).toContain('"accept"');
    expect(msg).toContain("initiator");
    expect(msg).toContain("v2");
    expect(msg).toContain("outreach, counter, question, withdraw");
  });
});
