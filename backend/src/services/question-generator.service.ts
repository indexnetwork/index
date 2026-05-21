/**
 * QuestionGeneratorService — implements the protocol's QuestionGeneratorReader
 * contract by delegating to `@indexnetwork/protocol`'s `QuestionGenerator`. The
 * default LLM-bound generator is constructed lazily on first `generate()` call
 * so module load never demands `OPENROUTER_API_KEY`. Tests inject a fake.
 */
import { QuestionGenerator } from "@indexnetwork/protocol";
import type {
  DiscoveryQuestionInput,
  QuestionGenerationResult,
  QuestionGeneratorReader,
} from "@indexnetwork/protocol";

import { log } from "../lib/log";

const logger = log.service.from("QuestionGeneratorService");

/** Minimal generator shape — used as the constructor type so tests can inject a fake. */
export interface QuestionGeneratorLike {
  generate(
    input: DiscoveryQuestionInput,
    options?: { signal?: AbortSignal },
  ): Promise<QuestionGenerationResult | null>;
}

export class QuestionGeneratorService implements QuestionGeneratorReader {
  private generator: QuestionGeneratorLike | undefined;

  constructor(injected?: QuestionGeneratorLike) {
    this.generator = injected;
  }

  /** Lazily construct the default generator on first use. */
  private getGenerator(): QuestionGeneratorLike {
    if (!this.generator) {
      this.generator = new QuestionGenerator();
    }
    return this.generator;
  }

  async generate(
    input: DiscoveryQuestionInput,
    options?: { signal?: AbortSignal },
  ): Promise<QuestionGenerationResult | null> {
    try {
      return await this.getGenerator().generate(input, options);
    } catch (err) {
      logger.warn("question-generator threw", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
}
