/**
 * Builds the per-harness environment catalogue by scanning the code, and
 * renders it as the committed `ops.envcatalog.ts`.
 *
 * Both the generator script (`bun ./eval/ops/ops.envcatalog.build.ts`) and the
 * drift test import `buildEnvCatalog` from here, so the committed file and the
 * test are checked against one derivation rather than two that can disagree.
 * A test that reimplemented the scan would drift from the generator, and the
 * pair would agree with each other while both were wrong.
 *
 * Not importable by the browser app: this reaches the filesystem through
 * `ops.envscan.ts`. Its *output* is dependency-free and is what the app reads.
 */
import path from "node:path";

import { reachableEnvKeys, referencedEnvKeys } from "./ops.envscan.js";
import { OPS_HARNESSES } from "./ops.registry.js";
import type { OpsHarness } from "./ops.types.js";

/** packages/protocol, derived from this file's location rather than the cwd. */
export const PROTOCOL_ROOT: string = path.resolve(import.meta.dir, "../..");

// Defined in ops.allowlist.ts (dependency-free) because the second guard,
// validateConfigOverrides, sits in a module chain the browser bundle reaches.
// Re-exported here so the generator and its tests keep importing it from the
// module that uses it.
export { ENV_SECRET_KEYS } from "./ops.allowlist.js";
import { ENV_SECRET_KEYS } from "./ops.allowlist.js";

/**
 * The file whose transitive imports define what each harness can read.
 *
 * Each harness's *own* entry point, never a shared barrel: a barrel would hand
 * every harness the union of everything, which is the inert-flag problem in a
 * new costume — an operator setting a control that cannot move the number.
 *
 * `discovery` points at the opportunity graph rather than an `eval/` script
 * because the graph is the code whose behaviour that harness measures. The
 * harness spawns the real graph under two environments and compares outcomes,
 * so the graph's closure is exactly the set of knobs that can change a result.
 */
export const HARNESS_ENTRY_POINTS: Readonly<Record<OpsHarness, string>> = Object.freeze({
  matching: "eval/matching/matching.eval.ts",
  profile: "eval/profile/profile.eval.ts",
  premise: "eval/premise/premise.eval.ts",
  opportunity: "eval/opportunity/opportunity.eval.ts",
  discovery: "src/opportunity/application/opportunity.graph.ts",
});

/** Roots searched for candidate keys. A superset costs nothing; a subset caps the answer. */
const CANDIDATE_ROOTS = ["src", "eval"] as const;

/**
 * The catalogue, derived fresh from the code.
 *
 * The candidate universe is itself derived — every `process.env.KEY` named
 * anywhere under src/ and eval/ — rather than supplied. Handing this function a
 * fixed candidate list is what produced the nine-flag offer it replaces: the
 * scan could only ever return a subset of the list it was given, so the list,
 * not the code, decided what an operator could configure.
 */
export function buildEnvCatalog(root: string = PROTOCOL_ROOT): Record<OpsHarness, string[]> {
  const universe = [...referencedEnvKeys(CANDIDATE_ROOTS.map((dir) => path.join(root, dir)))];
  const catalog = {} as Record<OpsHarness, string[]>;
  for (const harness of OPS_HARNESSES) {
    const entry = path.join(root, HARNESS_ENTRY_POINTS[harness]);
    const reachable = reachableEnvKeys(entry, universe);
    catalog[harness] = [...reachable].filter((key) => !ENV_SECRET_KEYS.includes(key)).sort();
  }
  return catalog;
}

/** The committed module's full text, so the generator and the drift test compare like with like. */
export function renderEnvCatalog(catalog: Record<OpsHarness, string[]>): string {
  const entries = OPS_HARNESSES.map((harness) => {
    const keys = catalog[harness].map((key) => `    "${key}",`).join("\n");
    return `  ${harness}: Object.freeze([\n${keys}\n  ]),`;
  }).join("\n");

  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate with:
 *   cd packages/protocol && bun ./eval/ops/ops.envcatalog.build.ts
 *
 * Every environment variable each harness can actually read, derived by walking
 * that harness's own transitive import closure and collecting \`process.env\`
 * reads (eval/ops/ops.envscan.ts). Credentials are excluded — see
 * ENV_SECRET_KEYS in ops.envcatalog.build.ts.
 *
 * Hand-editing this file is pointless: eval/ops/tests/envcatalog.spec.ts
 * regenerates the catalogue and fails on any difference, so an edit here is
 * either reverted by the next generator run or caught by CI.
 *
 * This module is dependency-free so the browser app can import it, the same
 * constraint ops.allowlist.ts documents for itself. The scanner that produces
 * it uses node:fs and Bun.Transpiler and must never be imported by the app.
 *
 * Why derived rather than maintained: the site once offered nine flags for
 * discovery because a scan was run against a hand-written sixteen-key list.
 * The graph reads twenty-eight. The list was the limit, not the code — so the
 * list is gone and the code answers.
 */
import type { OpsHarness } from "./ops.types.js";

export const HARNESS_ENV_KEYS: Readonly<Record<OpsHarness, readonly string[]>> = Object.freeze({
${entries}
});
`;
}

if (import.meta.main) {
  const target = path.join(PROTOCOL_ROOT, "eval/ops/ops.envcatalog.ts");
  const catalog = buildEnvCatalog();
  await Bun.write(target, renderEnvCatalog(catalog));
  for (const harness of OPS_HARNESSES) {
    console.log(`${harness.padEnd(12)} ${catalog[harness].length} keys`);
  }
  console.log(`\nWrote ${path.relative(PROTOCOL_ROOT, target)}`);
}
