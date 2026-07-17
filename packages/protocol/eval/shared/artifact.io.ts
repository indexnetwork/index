/**
 * Collision-safe persistence for versioned eval artifacts.
 *
 * - Reads parse + validate through the shared envelope schema and surface
 *   actionable errors for corrupt/truncated JSON.
 * - Writes validate first, then go through a same-directory temp file and an
 *   atomic rename, so an interrupted write can never replace a previous valid
 *   artifact with a partial one.
 * - Overwrites are refused by default (`force` opts in), and a write plan can
 *   be asserted up front so multi-output runs fail before *any* output is
 *   written and inputs can never double as outputs.
 */
import { randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseEvalArtifact, type EvalArtifactEnvelope, type ParseEvalArtifactOptions } from "./artifact.js";
import type { ScorecardLike } from "./types.js";

/**
 * Reads and validates an eval artifact envelope from disk.
 *
 * @returns The validated envelope, or `null` when the file does not exist.
 * @throws Actionable errors for unreadable/corrupt JSON and any envelope violation.
 */
export async function readEvalArtifact<P extends ScorecardLike = ScorecardLike>(
  filePath: string,
  options: ParseEvalArtifactOptions,
): Promise<EvalArtifactEnvelope<P> | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  let value: unknown;
  try {
    value = await file.json();
  } catch (err) {
    throw new Error(`Eval artifact at ${filePath} is not valid JSON (corrupt or truncated write?)`, { cause: err });
  }
  try {
    return parseEvalArtifact<P>(value, options);
  } catch (err) {
    throw new Error(`${filePath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

export interface WriteEvalArtifactOptions {
  /** Allow replacing an existing file. Defaults to false (refuse overwrite). */
  force?: boolean;
}

/**
 * Validates and atomically writes an eval artifact envelope.
 *
 * The envelope is re-parsed before serialization (invalid artifacts can never
 * reach disk), written to a same-directory temp file, and renamed into place.
 * Existing destinations are refused unless `force` is set.
 */
export async function writeEvalArtifact(
  filePath: string,
  envelope: EvalArtifactEnvelope,
  options: WriteEvalArtifactOptions = {},
): Promise<void> {
  const validated = parseEvalArtifact(envelope, { expectedType: envelope.artifactType });
  if (!options.force && (await Bun.file(filePath).exists())) {
    throw new Error(
      `Refusing to overwrite existing eval artifact at ${filePath}; pass --force to replace it`,
    );
  }
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await writeFile(tempPath, JSON.stringify(validated, null, 2) + "\n");
    await rename(tempPath, filePath);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

export interface EvalWriteOutput {
  path: string;
  /**
   * Marks the sanctioned in-place update flow (e.g. `--update-baseline`
   * rewriting the baseline it just diffed against). Exempts the output from
   * the input-collision rule but NOT from overwrite consent.
   */
  updatesInput?: boolean;
}

export interface EvalWritePlan {
  /** Paths this run reads (committed baselines, rolling run dirs, …). */
  inputs?: string[];
  /** Every output the run may write, declared up front. */
  outputs: (string | EvalWriteOutput)[];
  /** Explicit overwrite consent (the CLI's `--force`). */
  force?: boolean;
}

/**
 * Asserts an entire write plan before any output is produced.
 *
 * Rejects: an output path listed twice, an output that would clobber an input
 * (unless it is the declared in-place update flow), and — without `force` —
 * any already-existing destination. Because every violation is reported before
 * the first write, a run can never leave a partial multi-output combination
 * behind.
 */
export async function assertEvalWritePlan(plan: EvalWritePlan): Promise<void> {
  const inputs = new Set((plan.inputs ?? []).map((p) => path.resolve(p)));
  const outputs = plan.outputs.map((entry) =>
    typeof entry === "string" ? { path: path.resolve(entry) } : { ...entry, path: path.resolve(entry.path) },
  );

  const seen = new Set<string>();
  for (const output of outputs) {
    if (seen.has(output.path)) {
      throw new Error(`Output path declared twice: ${output.path}; refusing to run`);
    }
    seen.add(output.path);
    if (!output.updatesInput && inputs.has(output.path)) {
      throw new Error(`Output path would overwrite an input artifact: ${output.path}; refusing to run`);
    }
  }

  if (!plan.force) {
    const existing: string[] = [];
    for (const output of outputs) {
      if (await Bun.file(output.path).exists()) existing.push(output.path);
    }
    if (existing.length > 0) {
      throw new Error(
        `Refusing to overwrite existing output(s) without --force:\n  ${existing.join("\n  ")}`,
      );
    }
  }
}
