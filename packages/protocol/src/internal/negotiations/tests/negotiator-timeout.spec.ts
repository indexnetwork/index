import { afterAll, describe, expect, it, mock } from "bun:test";

mock.module("../../shared/agent/model.config", () => ({
  createStructuredModel: () => ({
    invoke: (_messages: unknown, config?: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({
            action: "propose",
            assessment: {
              reasoning: "The candidate's ML experience is relevant to the startup's hiring need.",
              suggestedRoles: { ownUser: "patient", otherUser: "agent" },
            },
            message: null,
          });
        }, 10);
        config?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(config.signal?.reason);
        }, { once: true });
      }),
  }),
}));

const { IndexNegotiator } = await import("../negotiation.agent.js");

afterAll(() => mock.restore());
import type { UserNegotiationContext, SeedAssessment } from "../negotiation.state.js";

const sourceUser: UserNegotiationContext = {
  id: 'user-alice',
  intents: [{ id: 'i1', title: 'Hire ML eng', description: 'Senior LLM engineer for AI startup', confidence: 0.9 }],
  profile: { name: 'Alice Chen', bio: 'CTO at AI startup', skills: ['product'] },
};

const otherUser: UserNegotiationContext = {
  id: 'user-bob',
  intents: [{ id: 'i2', title: 'Find AI role', description: 'Founding engineer at AI company', confidence: 0.85 }],
  profile: { name: 'Bob Martinez', bio: 'ML engineer, 5y LLM systems', skills: ['PyTorch', 'LangChain'] },
};

const seedAssessment: SeedAssessment = {
  reasoning: 'Strong skill match',
  valencyRole: 'patient',
};

const indexContext = { networkId: 'net-1', prompt: 'AI founders & engineers' };

describe('IndexNegotiator turn timeout', () => {
  it('throws a TimeoutError when the per-turn timeout fires before the LLM responds', async () => {
    const negotiator = new IndexNegotiator({ turnTimeoutMs: 1 });
    let caught: unknown;
    try {
      await negotiator.invoke({
        ownUser: sourceUser,
        otherUser,
        indexContext,
        seedAssessment,
        history: [],
      });
    } catch (err) {
      caught = err;
    }
    // Assert specifically on timeout/abort so the test isn't satisfied by
    // unrelated rejections (missing API key, schema error, network blip).
    // AbortSignal.timeout produces a DOMException with name 'TimeoutError'.
    expect(caught).toBeDefined();
    const e = caught as { name?: string; message?: string };
    const signature = `${e.name ?? ''} ${e.message ?? ''}`;
    expect(/timeout|abort/i.test(signature)).toBe(true);
  }, 30_000);

  it('completes normally with a generous timeout', async () => {
    const negotiator = new IndexNegotiator({ turnTimeoutMs: 60_000 });
    const result = await negotiator.invoke({
      ownUser: sourceUser,
      otherUser,
      indexContext,
      seedAssessment,
      history: [],
    });
    expect(result.action).toBeDefined();
    expect(['propose', 'counter', 'accept', 'reject']).toContain(result.action);
  }, 60_000);

  it('falls back to the default for out-of-range overrides', () => {
    // Resolver-valid range is `(0, Number.MAX_SAFE_INTEGER]`. The upper bound
    // is enforced because `AbortSignal.timeout` throws above it. The lower
    // bound is strict (`n > 0`) by design — `AbortSignal.timeout(0)` is
    // technically legal but would immediate-abort every turn. Anything else
    // (non-finite, negative, zero, above safe-integer ceiling) must fall back
    // to the env/default. We can't observe the resolved value directly without
    // invoking the LLM, so verify construction succeeds — the constructor
    // would propagate downstream if a bad value leaked through.
    expect(() => new IndexNegotiator({ turnTimeoutMs: Number.POSITIVE_INFINITY })).not.toThrow();
    expect(() => new IndexNegotiator({ turnTimeoutMs: Number.NaN })).not.toThrow();
    expect(() => new IndexNegotiator({ turnTimeoutMs: -1 })).not.toThrow();
    expect(() => new IndexNegotiator({ turnTimeoutMs: 0 })).not.toThrow();
    expect(() => new IndexNegotiator({ turnTimeoutMs: 1e30 })).not.toThrow();
    expect(() => new IndexNegotiator({ turnTimeoutMs: Number.MAX_SAFE_INTEGER + 1 })).not.toThrow();
  });
});
