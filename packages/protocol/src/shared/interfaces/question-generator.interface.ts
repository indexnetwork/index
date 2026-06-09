/**
 * @deprecated Use QuestionerAgent instead. Will be removed in a future version.
 *
 * Protocol-level read contract for decision-question generation. Implementations
 * live in the backend (see `QuestionGeneratorService`) and are injected into the
 * protocol via `ProtocolDeps`/`ToolContext`. The protocol module never constructs
 * its own LLM-bound `QuestionGenerator` — callers inject one (or `undefined` to
 * opt out).
 */
import type { DiscoveryQuestionInput } from "../schemas/discovery-question.schema.js";
import type { QuestionGenerationResult } from "../schemas/question.schema.js";

export interface QuestionGeneratorReader {
  /**
   * Run the question generator over a single discovery turn.
   *
   * @param input  Discovery turn payload (query + negotiation digests + chat context).
   * @param options.signal  Optional AbortSignal. When aborted (deadline reached or
   *   upstream cancel) the in-flight LLM call is cancelled and `null` is returned —
   *   discovery still emits its response, just without questions.
   * @returns The structured result, or `null` when generation failed,
   *   guardrails dropped all candidates, the underlying LLM threw, or
   *   the call was aborted.
   */
  generate(
    input: DiscoveryQuestionInput,
    options?: { signal?: AbortSignal },
  ): Promise<QuestionGenerationResult | null>;
}
