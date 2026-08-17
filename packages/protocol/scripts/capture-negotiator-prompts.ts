#!/usr/bin/env bun
/**
 * Capture the rendered IndexNegotiator system prompt across a fixed input
 * matrix and print it as JSON.
 *
 * Used to generate (and, from an older revision, to independently re-verify)
 * `src/negotiations/tests/fixtures/negotiator-advocate-prompts.golden.json` —
 * the byte-identical guard for `NEGOTIATOR_STANCE=advocate` (IND-611).
 *
 *   bun scripts/capture-negotiator-prompts.ts > /tmp/prompts.json
 *
 * Deliberately provider-free: it drives the `callModel` seam, exactly like the
 * prompt specs, so no OPENROUTER_API_KEY round-trip happens. A dummy key is
 * still required because `createStructuredModel` is constructed eagerly.
 */
import { IndexNegotiator, type NegotiationAgentInput } from "../src/negotiations/negotiation.agent.js";
import { PROMPT_MATRIX } from "../src/negotiations/tests/fixtures/negotiator-prompt-matrix.js";

class Capturing extends IndexNegotiator {
  prompt = "";
  constructor(private readonly output: unknown) {
    super({ turnTimeoutMs: 1000 });
  }
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.prompt = chatMessages[0].content;
    return this.output;
  }
}

function validTurn(action: string) {
  return {
    action,
    assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
    message: null,
  };
}

async function main(): Promise<void> {
  process.env.OPENROUTER_API_KEY ||= "dummy-key-for-prompt-capture";
  const out: Record<string, string> = {};
  for (const entry of PROMPT_MATRIX) {
    const agent = new Capturing(validTurn(entry.action));
    await agent.invoke(entry.input as NegotiationAgentInput);
    out[entry.id] = agent.prompt;
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
