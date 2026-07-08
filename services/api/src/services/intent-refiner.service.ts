/**
 * IntentRefinerService — thin wrapper around `@indexnetwork/protocol`'s
 * `IntentRefiner`. The default LLM-bound refiner is constructed lazily on
 * first `refine()` call so module load never demands `OPENROUTER_API_KEY`.
 * Tests inject a fake.
 *
 * Any failure degrades to `null` — callers fall back to a non-LLM strategy.
 */
import { IntentRefiner } from "@indexnetwork/protocol";
import type { IntentRefinerInput } from "@indexnetwork/protocol";

import { log } from "../lib/log";

const logger = log.service.from("IntentRefinerService");

/** Minimal refiner shape — used as the constructor type so tests can inject a fake. */
export interface IntentRefinerLike {
  refine(input: IntentRefinerInput, options?: { signal?: AbortSignal }): Promise<string | null>;
}

export class IntentRefinerService {
  private refiner: IntentRefinerLike | undefined;

  constructor(injected?: IntentRefinerLike) {
    this.refiner = injected;
  }

  /** Lazily construct the default refiner on first use. */
  private getRefiner(): IntentRefinerLike {
    if (!this.refiner) {
      this.refiner = new IntentRefiner();
    }
    return this.refiner;
  }

  async refine(
    input: IntentRefinerInput,
    options?: { signal?: AbortSignal },
  ): Promise<string | null> {
    try {
      return await this.getRefiner().refine(input, options);
    } catch (err) {
      logger.warn("intent-refiner threw", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
}
