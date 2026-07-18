import { executeRuns, type EvalEvidencePolicy, type EvalRunBatch } from "../shared/index.js";
import { PROFILE_EVAL_ATTEMPT_TIMEOUT_MS, PROFILE_EVAL_MAX_ATTEMPTS, PROFILE_EVAL_RETRY_DELAY_MS } from "./profile.constants.js";
import { findPII } from "./profile.pii.js";
import type { ProfileCase, ProfileRunDetail } from "./profile.types.js";

export interface GeneratorLike {
  invoke(input: string, options?: { signal?: AbortSignal }): Promise<{
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
  attemptTimeoutMs?: number;
  policy?: EvalEvidencePolicy;
  signal?: AbortSignal;
}

async function invokeOnce(generator: GeneratorLike, c: ProfileCase, signal: AbortSignal): Promise<ProfileRunDetail> {
  const { output } = await generator.invoke(c.input, { signal });
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

/** Run every configured slot and retain all retry/failure evidence. */
export async function runCase(
  generator: GeneratorLike,
  c: ProfileCase,
  runs: number,
  options: RunCaseOptions = {},
): Promise<EvalRunBatch<ProfileRunDetail>> {
  return executeRuns(({ signal }) => invokeOnce(generator, c, signal), runs, {
    caseId: c.id,
    maxAttempts: options.maxAttempts ?? PROFILE_EVAL_MAX_ATTEMPTS,
    retryDelayMs: options.retryDelayMs ?? PROFILE_EVAL_RETRY_DELAY_MS,
    attemptTimeoutMs: options.attemptTimeoutMs ?? PROFILE_EVAL_ATTEMPT_TIMEOUT_MS,
    policy: options.policy,
    signal: options.signal,
    label: "profile eval",
  });
}
