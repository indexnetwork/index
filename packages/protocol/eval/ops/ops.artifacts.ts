import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { EVAL_BASELINE_ARTIFACT_TYPE, EVAL_RUN_REPORT_ARTIFACT_TYPE, parseEvalArtifact, type EvalArtifactEnvelope } from "../shared/index.js";
import { OPS_HARNESSES } from "./ops.registry.js";
import type { ArtifactRef, IndexIssue, IndexResult, OpsHarness } from "./ops.types.js";

export interface ArtifactSource {
  list(): Promise<IndexResult>;
  read(id: string): Promise<EvalArtifactEnvelope>;
}

/** Encodes a path relative to eval/ as a URL-safe, addressable id. */
export function encodeArtifactId(relPath: string): string {
  return Buffer.from(relPath, "utf8").toString("base64url");
}

/**
 * Decodes an artifact id back to its relative path.
 * @throws when the decoded path escapes the eval directory.
 */
export function decodeArtifactId(id: string): string {
  const relPath = Buffer.from(id, "base64url").toString("utf8");
  const normalized = path.normalize(relPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Artifact id resolves outside the eval directory: ${relPath}`);
  }
  return normalized;
}

const isOpsHarness = (value: unknown): value is OpsHarness =>
  typeof value === "string" && (OPS_HARNESSES as readonly string[]).includes(value);

export interface FsArtifactSourceOptions {
  /** Absolute path to packages/protocol/eval. */
  evalDir: string;
  /** Absolute path to the launched-run directory. Defaults to <evalDir>/.ops-runs. */
  opsRunsDir?: string;
}

/** Indexes committed baselines, CLI run reports, and launched-run reports off the filesystem. */
export class FsArtifactSource implements ArtifactSource {
  private readonly evalDir: string;
  private readonly opsRunsDir: string;

  constructor(options: FsArtifactSourceOptions) {
    this.evalDir = options.evalDir;
    this.opsRunsDir = options.opsRunsDir ?? path.join(options.evalDir, ".ops-runs");
  }

  async list(): Promise<IndexResult> {
    const refs: ArtifactRef[] = [];
    const issues: IndexIssue[] = [];
    for (const file of await this.candidateFiles()) {
      const relPath = path.relative(this.evalDir, file);
      try {
        const ref = await this.readRef(file, relPath);
        if (ref !== null) refs.push(ref);
      } catch (error) {
        issues.push({ path: relPath, message: error instanceof Error ? error.message : String(error) });
      }
    }
    refs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { refs, issues };
  }

  async read(id: string): Promise<EvalArtifactEnvelope> {
    const relPath = decodeArtifactId(id);
    const absolute = path.join(this.evalDir, relPath);
    const value = await Bun.file(absolute).json();
    return this.parse(value);
  }

  private async candidateFiles(): Promise<string[]> {
    const files: string[] = [];
    // Not every registered harness keeps artifacts here. A harness that has
    // never been run has no runs/ directory yet, one that has no baseline (and
    // never will, like discovery) has no baselines/ directory, and
    // discovery's CLI writes under services/api/eval entirely — its
    // site-launched runs arrive through .ops-runs below. jsonFilesIn treats
    // every one of those as "nothing to index" rather than as a failure.
    for (const harness of OPS_HARNESSES) {
      for (const dir of ["baselines", "runs"]) {
        files.push(...(await jsonFilesIn(path.join(this.evalDir, harness, dir))));
      }
    }
    for (const runDir of await subdirectoriesOf(this.opsRunsDir)) {
      files.push(...(await jsonFilesIn(runDir)));
    }
    return files;
  }

  private parse(value: unknown): EvalArtifactEnvelope {
    const artifactType = (value as { artifactType?: unknown })?.artifactType;
    const expectedType =
      artifactType === EVAL_BASELINE_ARTIFACT_TYPE ? EVAL_BASELINE_ARTIFACT_TYPE : EVAL_RUN_REPORT_ARTIFACT_TYPE;
    return parseEvalArtifact(value, { expectedType });
  }

  private async readRef(absolute: string, relPath: string): Promise<ArtifactRef | null> {
    let value: unknown;
    try {
      value = await Bun.file(absolute).json();
    } catch (error) {
      throw new Error(`not valid JSON (corrupt or truncated write?): ${String(error)}`, { cause: error });
    }
    const harness = (value as { harness?: unknown })?.harness;
    // Out-of-scope harnesses are ignored, not reported: their artifacts are valid,
    // they simply have no scorecard presentation here.
    if (!isOpsHarness(harness)) return null;

    const envelope = this.parse(value);
    const stats = await stat(absolute);
    const completeness = envelope.completeness as { complete?: boolean };
    return {
      id: encodeArtifactId(relPath),
      harness,
      kind: envelope.artifactType === EVAL_BASELINE_ARTIFACT_TYPE ? "baseline" : "run",
      path: relPath,
      schemaVersion: envelope.schemaVersion,
      createdAt: envelope.createdAt,
      models: [...envelope.models],
      runs: envelope.runs,
      selection: { fullCorpus: envelope.selection.fullCorpus, filters: { ...envelope.selection.filters } },
      git: { revision: envelope.git.revision, dirty: envelope.git.dirty },
      corpusFingerprint: envelope.corpusFingerprint,
      configFingerprint: envelope.configFingerprint,
      aggregatePassRate: envelope.payload.aggregatePassRate,
      caseCount: envelope.payload.cases.length,
      complete: typeof completeness.complete === "boolean" ? completeness.complete : null,
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  }
}

/**
 * JSON files directly in `dir`, or none when the directory cannot be read at
 * all — most often because it does not exist. An absent directory is a normal
 * state here, not an error, so it contributes nothing instead of failing the
 * whole index.
 */
async function jsonFilesIn(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

async function subdirectoriesOf(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}
