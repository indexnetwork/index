import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { NegotiationScreener, ScreenDecisionSchema, configuredScreenMode, NEGOTIATION_SCREEN_MODES, type NegotiationScreenerInput } from "../negotiation.screen.js";

/**
 * IND-398 — screener unit behavior.
 *
 * Pins:
 * - env parsing: off is the code default (flag-flip pattern), invalid values
 *   coerce to off, all three modes parse,
 * - decision schema shape (evidence required, outreachAngle/memoryHints optional),
 * - invoke: valid model output returned as-is; schema-invalid output throws
 *   (the graph node owns fail-open),
 * - prompt assembly: discovery query becomes the PRIMARY criterion rule;
 *   counterparty context paragraph and both intent sets are included.
 */

const origEnv = process.env.NEGOTIATION_SCREEN_MODE;

afterAll(() => {
  if (origEnv === undefined) delete process.env.NEGOTIATION_SCREEN_MODE;
  else process.env.NEGOTIATION_SCREEN_MODE = origEnv;
});

describe("configuredScreenMode", () => {
  beforeEach(() => {
    delete process.env.NEGOTIATION_SCREEN_MODE;
  });

  it("defaults to off when unset", () => {
    expect(configuredScreenMode()).toBe("off");
  });

  it("parses every documented mode", () => {
    for (const mode of NEGOTIATION_SCREEN_MODES) {
      process.env.NEGOTIATION_SCREEN_MODE = mode;
      expect(configuredScreenMode()).toBe(mode);
    }
  });

  it("coerces unrecognized values to off", () => {
    process.env.NEGOTIATION_SCREEN_MODE = "loud";
    expect(configuredScreenMode()).toBe("off");
    process.env.NEGOTIATION_SCREEN_MODE = "";
    expect(configuredScreenMode()).toBe("off");
  });
});

describe("ScreenDecisionSchema", () => {
  it("accepts a full decision", () => {
    const parsed = ScreenDecisionSchema.safeParse({
      decision: "reach_out",
      reasoning: "strong fit",
      outreachAngle: "shared ML focus",
      evidence: { counterpartyPremiseFit: "fits", intentAlignment: "aligned", memoryHints: null },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a minimal pass (no outreachAngle, no memoryHints)", () => {
    const parsed = ScreenDecisionSchema.safeParse({
      decision: "pass",
      reasoning: "vague overlap",
      evidence: { counterpartyPremiseFit: "weak", intentAlignment: "none" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown decisions and missing evidence", () => {
    expect(ScreenDecisionSchema.safeParse({
      decision: "maybe",
      reasoning: "x",
      evidence: { counterpartyPremiseFit: "", intentAlignment: "" },
    }).success).toBe(false);
    expect(ScreenDecisionSchema.safeParse({
      decision: "pass",
      reasoning: "x",
    }).success).toBe(false);
  });
});

/** Screener with the model round-trip stubbed via the protected seam. */
class SeamScreener extends NegotiationScreener {
  public capturedMessages: Array<{ role: string; content: string }> = [];
  constructor(private output: unknown) {
    super();
  }
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.capturedMessages = chatMessages;
    return this.output;
  }
}

const baseInput: NegotiationScreenerInput = {
  clientUser: {
    id: "u-client",
    intents: [{ id: "i1", title: "Find ML engineer", description: "Need ML expertise", confidence: 0.9 }],
    profile: { name: "Alice", bio: "PM building AI startup" },
  },
  counterpartyUser: {
    id: "u-counter",
    intents: [{ id: "i2", title: "Seeking PM co-founder", description: "Wants product partner", confidence: 0.8 }],
    profile: { name: "Bob", bio: "Senior ML engineer" },
  },
  counterpartyContext: "Bob has shipped three recommendation systems.",
  seedAssessment: { reasoning: "complementary skills", valencyRole: "peer" },
  indexContext: { networkId: "net-1", prompt: "AI startup co-founders" },
};

describe("NegotiationScreener.invoke", () => {
  it("returns the parsed decision on valid model output", async () => {
    const screener = new SeamScreener({
      decision: "reach_out",
      reasoning: "clear complementary fit",
      outreachAngle: "co-founder search",
      evidence: { counterpartyPremiseFit: "ships ML", intentAlignment: "PM seeks ML, ML seeks PM" },
    });

    const decision = await screener.invoke(baseInput);

    expect(decision.decision).toBe("reach_out");
    expect(decision.outreachAngle).toBe("co-founder search");
  });

  it("throws on schema-invalid model output (graph node owns fail-open)", async () => {
    const screener = new SeamScreener({ decision: "shrug", reasoning: 42 });
    await expect(screener.invoke(baseInput)).rejects.toThrow(/failed validation/);
  });

  it("includes counterparty context, both intent sets, and the seed reasoning in the prompt", async () => {
    const screener = new SeamScreener({
      decision: "pass",
      reasoning: "r",
      evidence: { counterpartyPremiseFit: "", intentAlignment: "" },
    });
    await screener.invoke(baseInput);

    const user = screener.capturedMessages.find((m) => m.role === "user")!.content;
    expect(user).toContain("Bob has shipped three recommendation systems.");
    expect(user).toContain("Find ML engineer");
    expect(user).toContain("Seeking PM co-founder");
    expect(user).toContain("complementary skills");
    const system = screener.capturedMessages.find((m) => m.role === "system")!.content;
    expect(system).toContain("Alice");
    expect(system).toContain("AI startup co-founders");
    // No query → intents are the criterion
    expect(system).toContain("No explicit search query");
  });

  it("promotes an explicit discovery query to the PRIMARY criterion", async () => {
    const screener = new SeamScreener({
      decision: "pass",
      reasoning: "r",
      evidence: { counterpartyPremiseFit: "", intentAlignment: "" },
    });
    await screener.invoke({ ...baseInput, discoveryQuery: "ML engineers" });

    const system = screener.capturedMessages.find((m) => m.role === "system")!.content;
    expect(system).toContain('searched for "ML engineers"');
    expect(system).toContain("PRIMARY criterion");
    const user = screener.capturedMessages.find((m) => m.role === "user")!.content;
    expect(user).toContain('Search query: "ML engineers"');
  });
});
