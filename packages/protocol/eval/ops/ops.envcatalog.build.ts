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
import { existsSync } from "node:fs";
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
export { ENV_SECRET_KEYS, isCredentialEnvKey } from "./ops.allowlist.js";
import { isCredentialEnvKey } from "./ops.allowlist.js";

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
    // reachableEnvKeys skips a path that does not exist, so a typo'd or moved
    // entry point would derive an empty set for that harness and silently offer
    // an operator nothing, reading as "this harness has no configurable
    // environment" rather than "the scan never ran". The five exact-set
    // assertions catch it for today's harnesses; a sixth added with a bad path
    // would only meet the weak keys-of-the-record check. Refuse here instead, so
    // the failure names the file.
    if (!existsSync(entry)) {
      throw new Error(
        `Harness "${harness}" entry point not found: ${entry}. ` +
          `Fix HARNESS_ENTRY_POINTS in eval/ops/ops.envcatalog.build.ts — a missing entry ` +
          `point would otherwise derive an empty catalogue and offer nothing.`,
      );
    }
    const reachable = reachableEnvKeys(entry, universe);
    // Credentials are dropped by name, not by membership of a two-key list: a
    // denylist that must be updated before the code reading a new secret is
    // written fails open. See isCredentialEnvKey.
    catalog[harness] = [...reachable].filter((key) => !isCredentialEnvKey(key)).sort();
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

/**
 * The engine's copy of the discovery catalogue, rendered as the full text of
 * services/api/src/cli/discovery.flags.ts.
 *
 * A second output rather than a second source. The engine cannot import the
 * catalogue — services/api sets `rootDir: ./src`, so a relative import of a
 * protocol source file is TS6059, and @indexnetwork/protocol exports only its
 * built `dist` entry — so a copy is forced. Generating it means the copy is
 * never typed by hand, and discovery.flags.spec.ts asserts it equals
 * `HARNESS_ENV_KEYS.discovery` besides, so drift fails CI rather than shipping
 * a refusal that names a flag the graph does read.
 */
export function renderEngineFlags(catalog: Record<OpsHarness, string[]>): string {
  const keys = catalog.discovery.map((key) => `  '${key}',`).join("\n");
  return `/**
 * GENERATED LIST — regenerate with:
 *   cd packages/protocol && bun ./eval/ops/ops.envcatalog.build.ts
 *
 * The environment flags this harness may offer: those the discovery graph
 * actually reads, derived by walking the graph's own transitive import closure
 * and collecting \`process.env\` reads.
 *
 * DISCOVERY_ENV_KEYS below is a verbatim copy of \`HARNESS_ENV_KEYS.discovery\`
 * in packages/protocol/eval/ops/ops.envcatalog.ts. It is copied rather than
 * imported because services/api sets \`rootDir: ./src\`, so importing a protocol
 * source file from production code is TS6059, and @indexnetwork/protocol
 * exports only its built \`dist\` entry point. A spec file may reach across, and
 * discovery.flags.spec.ts asserts this copy equals the catalogue exactly — so
 * the duplication cannot drift silently, which is the only thing that made a
 * hand-kept list dangerous.
 *
 * The previous version of this file pinned nine keys by hand. The graph reads
 * twenty-six offerable ones. The nine were the result of scanning against a
 * sixteen-key hand-written allowlist: the list was the limit, not the code, so
 * \`NEGOTIATOR_STANCE\` and eighteen others were refused by a message asserting
 * the graph could not read them — which was false. The list is now derived and
 * the code answers.
 *
 * Credentials are absent by construction: the generator drops any key
 * \`isCredentialEnvKey\` matches, so no configuration reaching this harness can
 * repoint it at another provider account or endpoint.
 */

export const DISCOVERY_ENV_KEYS: readonly string[] = Object.freeze([
${keys}
]);

export type AbEnvConfig = Readonly<Record<string, string>>;

/**
 * Throws when a config names a flag this harness cannot honestly exercise.
 *
 * The refusal is kept — a key the graph never reads is a control that moves
 * nothing, and accepting it would let a run attribute noise to a flag that was
 * never consulted. Only the list it checks against has changed.
 */
export function assertAbEnvConfig(config: AbEnvConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (!DISCOVERY_ENV_KEYS.includes(key)) {
      throw new Error(\`\${key} is not readable by the discovery graph; this harness cannot test it\`);
    }
    if (value.trim() === '') {
      throw new Error(\`\${key} has an empty value; unset it instead of blanking it\`);
    }
  }
}
`;
}

/** services/api, a sibling of packages/protocol in the monorepo. */
const ENGINE_FLAGS_TARGET = path.resolve(PROTOCOL_ROOT, "../../services/api/src/cli/discovery.flags.ts");

if (import.meta.main) {
  const target = path.join(PROTOCOL_ROOT, "eval/ops/ops.envcatalog.ts");
  const catalog = buildEnvCatalog();
  await Bun.write(target, renderEnvCatalog(catalog));
  await Bun.write(ENGINE_FLAGS_TARGET, renderEngineFlags(catalog));
  for (const harness of OPS_HARNESSES) {
    console.log(`${harness.padEnd(12)} ${catalog[harness].length} keys`);
  }
  console.log(`\nWrote ${path.relative(PROTOCOL_ROOT, target)}`);
  console.log(`Wrote ${path.relative(PROTOCOL_ROOT, ENGINE_FLAGS_TARGET)}`);
}
