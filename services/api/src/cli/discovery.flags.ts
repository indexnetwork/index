/**
 * The only environment flags this harness may offer: those the discovery graph
 * actually reads. The list is asserted against a fresh scan of the graph's
 * import closure (discovery.flags.spec.ts) rather than trusted, because a
 * hand-maintained copy is exactly how sixteen editable flags came to move
 * nothing at all.
 *
 * The scanner that performs that check now lives in
 * packages/protocol/eval/ops/ops.envscan.ts, where it derives the catalogue for
 * every harness rather than this one. It cannot be imported here: services/api
 * sets `rootDir: ./src`, so importing a protocol source file from production
 * code is TS6059. The spec file may import it, because tsconfig excludes specs.
 */

export const AB_FLAGS: readonly string[] = Object.freeze([
  'DISCOVERY_ALLOWED_TYPES',
  'DISCOVERY_CONTEXT_TO_INTENT',
  'DISCOVERY_PROFILE_SOURCE',
  'DISCOVERY_REJECTION_COOLDOWN_DAYS',
  'DISCOVERY_SOURCE_PREMISE_LIMIT',
  'NEGOTIATION_INCLUDE_OTHER_INTENTS',
  'NEGOTIATION_MAX_TURNS_AMBIENT',
  'NEGOTIATION_MAX_TURNS_CHAT',
  'RUN_OPPORTUNITY_EVAL_IN_PARALLEL',
]);

export type AbEnvConfig = Readonly<Record<string, string>>;

/** Throws when a config names a flag this harness cannot honestly exercise. */
export function assertAbEnvConfig(config: AbEnvConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (!AB_FLAGS.includes(key)) {
      throw new Error(`${key} is not readable by the discovery graph; this harness cannot test it`);
    }
    if (value.trim() === '') {
      throw new Error(`${key} has an empty value; unset it instead of blanking it`);
    }
  }
}
