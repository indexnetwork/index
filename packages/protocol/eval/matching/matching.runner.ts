import type {
  EvaluatorInput,
  EvaluatedOpportunityWithActors,
} from "../../src/opportunity/opportunity.evaluator.js";
import type { MatchingCase } from "./matching.types.js";

/** Minimal evaluator surface the runner needs (real OpportunityEvaluator satisfies this). */
export interface EvaluatorLike {
  invokeEntityBundle(
    input: EvaluatorInput,
    options: { minScore?: number; returnAll?: boolean },
  ): Promise<EvaluatedOpportunityWithActors[]>;
}

/**
 * Run a case `runs` times. Uses minScore:30 + returnAll so reject bands and
 * sub-threshold scores are visible to the scorer rather than filtered out.
 */
export async function runCase(
  evaluator: EvaluatorLike,
  c: MatchingCase,
  runs: number,
): Promise<EvaluatedOpportunityWithActors[][]> {
  const outputs: EvaluatedOpportunityWithActors[][] = [];
  for (let i = 0; i < runs; i++) {
    outputs.push(await evaluator.invokeEntityBundle(c.input, { minScore: 30, returnAll: true }));
  }
  return outputs;
}
