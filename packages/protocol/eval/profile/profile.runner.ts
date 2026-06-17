import { repeatRuns } from "../shared/index.js";
import { PROFILE_EVAL_MAX_ATTEMPTS, PROFILE_EVAL_RETRY_DELAY_MS } from "./profile.constants.js";
import { findPII } from "./profile.pii.js";
import type { ProfileCase, ProfileRunDetail } from "./profile.types.js";

/** Minimal generator surface the runner needs (real ProfileGenerator satisfies this). */
export interface GeneratorLike {
  invoke(input: string): Promise<{
    output: {
      identity: { name: string; bio: string; location: string };
      narrative: { context: string };
      attributes: { interests: string[]; skills: string[] };
    };
  }>;
}

export interface RunCaseOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

/** Invoke the generator once and normalize its output (computing PII hits in public fields). */
async function invokeOnce(generator: GeneratorLike, c: ProfileCase): Promise<ProfileRunDetail> {
  const { output } = await generator.invoke(c.input);
  const { identity, narrative, attributes } = output;
  const piiHits = findPII([
    identity.name,
    identity.bio,
    identity.location,
    narrative.context,
    ...attributes.skills,
    ...attributes.interests,
  ]);
  return {
    name: identity.name,
    bio: identity.bio,
    location: identity.location,
    context: narrative.context,
    interests: attributes.interests,
    skills: attributes.skills,
    piiHits,
  };
}

/**
 * Run a profile case `runs` times, retrying transient live-model failures.
 *
 * @param generator - The profile generator under test.
 * @param c - The case to run.
 * @param runs - Number of repetitions.
 * @param options - Retry tuning (defaults from profile constants).
 * @returns One normalized detail per run.
 */
export async function runCase(
  generator: GeneratorLike,
  c: ProfileCase,
  runs: number,
  options: RunCaseOptions = {},
): Promise<ProfileRunDetail[]> {
  return repeatRuns(() => invokeOnce(generator, c), runs, {
    maxAttempts: options.maxAttempts ?? PROFILE_EVAL_MAX_ATTEMPTS,
    retryDelayMs: options.retryDelayMs ?? PROFILE_EVAL_RETRY_DELAY_MS,
    label: "profile eval",
  });
}
