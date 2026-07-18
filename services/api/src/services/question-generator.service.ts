/**
 * QuestionGeneratorService — implements the protocol's QuestionGeneratorReader
 * contract by delegating to `@indexnetwork/protocol`'s `QuestionerAgent` in
 * `discovery` mode (the deprecated `QuestionGenerator` was removed in IND-458).
 * The default LLM-bound agent is constructed lazily on first `generate()` call
 * so module load never demands `OPENROUTER_API_KEY`. Tests inject a fake.
 */
import { QuestionerAgent } from "@indexnetwork/protocol";
import type { DiscoveryQuestionInput, QuestionGenerationResult, QuestionGeneratorReader } from "@indexnetwork/protocol";

import { log } from "../lib/log";

const logger = log.service.from("QuestionGeneratorService");

/** Minimal agent shape — used as the constructor type so tests can inject a fake. */
export type QuestionerAgentLike = Pick<QuestionerAgent, "invoke">;

export class QuestionGeneratorService implements QuestionGeneratorReader {
  private agent: QuestionerAgentLike | undefined;

  constructor(injected?: QuestionerAgentLike) {
    this.agent = injected;
  }

  /** Lazily construct the default agent on first use. */
  private getAgent(): QuestionerAgentLike {
    if (!this.agent) {
      this.agent = new QuestionerAgent();
    }
    return this.agent;
  }

  async generate(
    input: DiscoveryQuestionInput,
    options?: { signal?: AbortSignal },
  ): Promise<QuestionGenerationResult | null> {
    try {
      // The QuestionerAgent is stateless: only `mode` and `context` influence
      // the LLM call. The envelope's userId/sourceType/sourceId are persistence
      // metadata consumed by the QuestionerQueue path, which this inline
      // reader bypasses — the reader contract carries no user identity, so
      // static placeholders are passed here.
      return await this.getAgent().invoke(
        {
          mode: "discovery",
          userId: "inline",
          sourceType: "discovery",
          sourceId: "inline",
          context: input,
        },
        options,
      );
    } catch (err) {
      logger.warn("question-generator threw", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
}
