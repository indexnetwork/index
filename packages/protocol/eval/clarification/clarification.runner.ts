import type { ClarificationCase, ClarifierLike } from "./clarification.types.js";

/** Run the live IntentClarifier for one corpus case. */
export async function runCase(clarifier: ClarifierLike, c: ClarificationCase) {
  return clarifier.invoke(c.input, c.profileContext, c.activeIntentsContext);
}
