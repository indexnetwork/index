/**
 * Fast signal intake flag.
 *
 * Disabled unless FAST_SIGNAL_INTAKE is exactly "true". Gates the deterministic
 * /intents/intake/* funnel; the legacy Signal Agent intake path is untouched.
 */

/** @returns true when /i/new must use the deterministic intake funnel. */
export function isFastSignalIntakeEnabled(): boolean {
  return process.env.FAST_SIGNAL_INTAKE === 'true';
}
