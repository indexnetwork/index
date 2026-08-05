/**
 * Which harnesses read which environment keys — the questions the generated
 * catalogue answers, asked in the two directions the product needs.
 *
 * Lives beside ops.envcatalog.ts rather than in it because that file is
 * GENERATED: a function written there would be erased by the next generator
 * run. And it lives here rather than in ops.profiles.ts, its original home,
 * because the browser app needs both answers — the launch page names the keys a
 * saved config sets that the chosen harness will not read, and the configs page
 * annotates each key with the harnesses that do — while ops.profiles.ts imports
 * node:crypto and node:fs/promises and can never enter the Vite bundle.
 *
 * So this module must stay dependency-free, exactly like ops.allowlist.ts,
 * ops.metadata.ts and ops.sides.ts. ops.profiles.ts re-exports both functions
 * under their original names, so every server-side import site is unchanged.
 */

import { HARNESS_ENV_KEYS } from "./ops.envcatalog.js";
import type { OpsHarness } from "./ops.types.js";

/** Every harness whose own code reads `key`, in registry order. */
export function harnessesReading(key: string): OpsHarness[] {
  return (Object.keys(HARNESS_ENV_KEYS) as OpsHarness[]).filter((harness) =>
    HARNESS_ENV_KEYS[harness].includes(key),
  );
}

/**
 * Keys a saved config carries that the chosen harness does not read.
 *
 * The counterpart to the ad-hoc refusal in validateConfigOverrides, and the
 * distinction is the whole of spec §6. Both describe "a key this harness will
 * not read"; they differ in who chose it and when:
 *
 * - **Ad-hoc override** — the operator typed this key for THIS run, having
 *   already chosen the harness. There is no reading under which they meant it
 *   to do nothing, so it is refused (400) and the run does not start.
 * - **Saved config** — the config was written once, without naming a harness,
 *   and may be deliberately shared with one that DOES read the key. Refusing it
 *   would make a legitimate config unlaunchable against any harness but the
 *   union of its keys. So the run proceeds and the keys are reported, named, as
 *   recorded-but-not-read.
 *
 * The value is still injected into the child environment either way: this
 * reports what the harness will ignore, it does not filter it. Filtering would
 * make the run record disagree with the process that ran.
 */
export function unreadEnvKeys(harness: OpsHarness, env: Record<string, string>): string[] {
  const readable = HARNESS_ENV_KEYS[harness];
  return Object.keys(env).filter((key) => !readable.includes(key)).sort();
}
