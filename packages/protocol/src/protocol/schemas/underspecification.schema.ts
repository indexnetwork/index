import { z } from "zod";

/**
 * Canonical QUD repair categories for underspecified intents.
 *
 * The intent clarifier classifies which repair an underspecified utterance
 * needs before discovery runs.
 */
export const UnderspecificationTypeSchema = z.enum([
  "missing_constituent",
  "missing_constraint",
  "open_alternative_set",
]);

export type UnderspecificationType = z.infer<typeof UnderspecificationTypeSchema>;
