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

import { ENV_FLAG_METADATA } from "./ops.metadata.js";
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
 * The graph READS twenty-eight; two of those are credentials, so twenty-six are
 * OFFERED. (The scorecard harnesses read ten each and offer eight, by the same
 * two exclusions.) The list was the limit, not the code — so the list is gone
 * and the code answers.
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
  // The credentials the graph itself reads, so the engine can refuse them for
  // the real reason. Derived from the same scan rather than listed: a credential
  // added to the graph tomorrow must not fall through to "cannot read it".
  const credentialKeys = [...reachableEnvKeys(
    path.join(PROTOCOL_ROOT, HARNESS_ENTRY_POINTS.discovery),
    [...referencedEnvKeys(CANDIDATE_ROOTS.map((dir) => path.join(PROTOCOL_ROOT, dir)))],
  )]
    .filter((key) => isCredentialEnvKey(key))
    .sort()
    .map((key) => `  '${key}',`)
    .join("\n");

  // Each offered flag's accepted shape, copied from ENV_FLAG_METADATA so the
  // engine refuses exactly what the site refuses. Without this the engine
  // accepts any non-blank string, and a value the graph does not recognise does
  // not fail there — it falls back, so the run measures the default while the
  // artifact records the value the operator typed.
  const offered = new Set(catalog.discovery);
  const valueRules = ENV_FLAG_METADATA
    .filter((meta) => offered.has(meta.key))
    .map((meta) => {
      const fields = [`kind: '${meta.kind}'`];
      if (meta.values !== undefined) fields.push(`values: [${meta.values.map((value) => `'${value}'`).join(", ")}]`);
      if (meta.min !== undefined) fields.push(`min: ${meta.min}`);
      // `max` is emitted for the same reason as `min`: NEGOTIATOR_TURN_TIMEOUT_MS
      // is capped at MAX_SAFE_INTEGER because the value reaches
      // AbortSignal.timeout(), which throws RangeError above it. Dropping the
      // ceiling here let a CLI-direct run crash where the site refused.
      if (meta.max !== undefined) fields.push(`max: ${meta.max}`);
      return `  ${meta.key}: { ${fields.join(", ")} },`;
    })
    .sort()
    .join("\n");
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
 * Credentials, refused separately from unreadable keys because the reason
 * differs and the operator acts on it differently.
 *
 * The discovery graph genuinely reads OPENROUTER_API_KEY and
 * OPENROUTER_BASE_URL — they are absent from the catalogue because they are
 * credentials, not because they are inert. Telling an operator the graph cannot
 * read them would be false, and would send someone hunting for a code path that
 * is right there.
 */
const CREDENTIAL_KEYS: readonly string[] = Object.freeze([
${credentialKeys}
]);

/**
 * What each offered flag's own read site accepts, mirrored from
 * ENV_FLAG_METADATA in packages/protocol/eval/ops/ops.metadata.ts.
 *
 * Needed because an unrecognised value does not fail at the read site — it
 * falls back. \`DISCOVERY_PROFILE_SOURCE=user-context\` (hyphen) warns once and
 * runs \`premise\`, so without this check a run would measure the default while
 * its artifact recorded the value the operator typed.
 */
interface EnvValueRule {
  kind: 'enum' | 'boolean' | 'csv-enum' | 'integer' | 'number' | 'string' | 'json-model-map';
  values?: readonly string[];
  min?: number;
  max?: number;
}

/**
 * Exported for discovery.flags.spec.ts, which cross-checks every field of every
 * shared key against ENV_FLAG_METADATA. A sampled cross-check missed an entire
 * missing field (\`max\`) once; an exhaustive one needs to see the rules.
 */
export const ENV_VALUE_RULES: Readonly<Record<string, EnvValueRule>> = Object.freeze({
${valueRules}
});

/** The problem with \`value\` for this flag, or null when the graph will honour it. */
export function discoveryEnvValueIssue(key: string, value: string): string | null {
  const rule = ENV_VALUE_RULES[key];
  if (rule === undefined) return null;
  switch (rule.kind) {
    case 'enum':
    case 'boolean':
      return rule.values?.includes(value) === true
        ? null
        : \`must be one of: \${rule.values?.join(', ') ?? '(no values defined)'}\`;
    case 'csv-enum': {
      const allowed = rule.values ?? [];
      const tokens = value.split(',').map((token) => token.trim().toLowerCase()).filter((token) => token !== '');
      const legal = tokens.length > 0 && tokens.every((token) => allowed.includes(token));
      return legal ? null : \`must be a comma-separated list of: \${allowed.join(', ') || '(no values defined)'}\`;
    }
    case 'integer':
      if (!/^\\d+$/.test(value)) return 'must be an integer';
      if (rule.min !== undefined && Number(value) < rule.min) return \`must be an integer of at least \${rule.min}\`;
      if (rule.max !== undefined && Number(value) > rule.max) return \`must be an integer of at most \${rule.max}\`;
      return null;
    case 'number': {
      // Mirrors ops.metadata.ts: the read sites parse with Number.parseFloat,
      // which returns NaN for '0x10' where Number() returns 16, and which
      // discards a trailing tail ('7abc' -> 7). Validating with Number() let
      // '0x10' through as sixteen days while the graph fell back to its 7-day
      // default, so the artifact named a difference that never ran.
      const trimmed = value.trim();
      if (!/^[+-]?(\\d+\\.?\\d*|\\.\\d+)(e[+-]?\\d+)?$/i.test(trimmed)) return 'must be a positive number in decimal notation';
      const parsed = Number.parseFloat(trimmed);
      if (!Number.isFinite(parsed) || parsed <= 0) return 'must be a positive number';
      if (rule.min !== undefined && parsed < rule.min) return \`must be at least \${rule.min}\`;
      if (rule.max !== undefined && parsed > rule.max) return \`must be at most \${rule.max}\`;
      return null;
    }
    case 'json-model-map':
      // Deliberately not validated here. The site's rule for this flag is not
      // 'parseable JSON' but 'names a reviewed model and a known agent', and the
      // reviewed-model list lives in the ops registry, which this package cannot
      // import (services/api sets rootDir ./src). Duplicating that list here is
      // the drift this whole module exists to prevent, and a stale copy would
      // refuse a model the site had just approved. A malformed value still fails
      // at the read site rather than being silently ignored — readModelOverrides
      // throws — so the failure is loud either way.
      return null;
    case 'string':
      return null;
  }
}

/**
 * Throws when a config names a flag this harness cannot honestly exercise, or
 * gives one a value the graph will not honour.
 *
 * The refusal is kept — a key the graph never reads is a control that moves
 * nothing, and accepting it would let a run attribute noise to a flag that was
 * never consulted. Only the list it checks against has changed.
 */
export function assertAbEnvConfig(config: AbEnvConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (CREDENTIAL_KEYS.includes(key)) {
      throw new Error(
        \`\${key} is a credential and is never configurable from a run; the discovery graph does read it, \`
        + 'but letting a run set it would repoint the run at another provider account or endpoint',
      );
    }
    if (!DISCOVERY_ENV_KEYS.includes(key)) {
      throw new Error(\`\${key} is not readable by the discovery graph; this harness cannot test it\`);
    }
    if (value.trim() === '') {
      throw new Error(\`\${key} has an empty value; unset it instead of blanking it\`);
    }
    const issue = discoveryEnvValueIssue(key, value);
    if (issue !== null) {
      throw new Error(
        \`\${key}=\${value} \${issue}. The graph does not refuse a value it does not recognise, it falls back \`
        + 'to its default, so this run would measure the default and record the value you typed',
      );
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
