import { randomBytes } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import type { IndexIssue, RunRecord, RunSpec, RunStatus } from "./ops.types.js";

/** Maps the documented harness exit-code contract onto a run status. */
export function statusFromExitCode(code: number): RunStatus {
  switch (code) {
    case 0:
      return "passed";
    case 1:
      return "regression";
    case 2:
      return "execution-error";
    case 3:
      return "insufficient-evidence";
    default:
      return "crashed";
  }
}

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "passed",
  "regression",
  "execution-error",
  "insufficient-evidence",
  "cancelled",
  "interrupted",
  "crashed",
]);

export interface CreateRunInput {
  spec: RunSpec;
  argv: string[];
  env: Record<string, string>;
  profileFingerprint: string;
  experimental: boolean;
  workload: number;
}

export interface ListResult {
  records: RunRecord[];
  issues: IndexIssue[];
}

export interface RunStore {
  create(input: CreateRunInput): Promise<RunRecord>;
  update(id: string, patch: Partial<RunRecord>): Promise<RunRecord>;
  get(id: string): Promise<RunRecord | null>;
  list(): Promise<ListResult>;
  /** Absolute path of the run's stdout log. */
  logPath(id: string): string;
  /** Absolute path the harness should write its report to. */
  reportPath(id: string): string;
  /**
   * The run's report path expressed the way artifact ids are: relative to eval/.
   * Owning this here keeps the eval-root convention in one place instead of
   * letting callers re-derive it from a cwd.
   * @throws when the run id would resolve outside the eval directory.
   */
  artifactPathFor(id: string): string;
  /** Marks orphaned `running` records as interrupted. Returns the records it changed. */
  reconcile(): Promise<RunRecord[]>;
}

export interface FsRunStoreOptions {
  /** Absolute path to packages/protocol/eval. Artifact paths are recorded relative to it. */
  evalDir: string;
  /** Absolute path to the launched-run directory. Defaults to <evalDir>/.ops-runs, and must live inside evalDir. */
  opsRunsDir?: string;
  /** Injectable liveness probe, so tests need no real child process. */
  isProcessAlive?: (pid: number) => boolean;
}

/** Filesystem-backed run records: one directory per run, durable across restarts. */
export class FsRunStore implements RunStore {
  private readonly evalDir: string;
  private readonly rootDir: string;
  private readonly isProcessAlive: (pid: number) => boolean;

  constructor(options: FsRunStoreOptions) {
    this.evalDir = options.evalDir;
    this.rootDir = options.opsRunsDir ?? path.join(options.evalDir, ".ops-runs");
    // Reports are addressed relative to eval/, so a run root outside it could never
    // produce a usable artifact path. Fail at construction rather than at run time.
    assertInsideEvalDir(this.evalDir, this.rootDir, `Ops run directory escapes the eval directory: ${this.rootDir}`);
    this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  }

  async create(input: CreateRunInput): Promise<RunRecord> {
    const id = newRunId();
    const record: RunRecord = {
      id,
      spec: input.spec,
      argv: input.argv,
      env: input.env,
      profileFingerprint: input.profileFingerprint,
      experimental: input.experimental,
      status: "queued",
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      exitCode: null,
      pid: null,
      artifactPath: null,
      workload: input.workload,
    };
    await mkdir(this.dir(id), { recursive: true });
    await this.write(record);
    return record;
  }

  async update(id: string, patch: Partial<RunRecord>): Promise<RunRecord> {
    const current = await this.get(id);
    if (current === null) throw new Error(`Unknown run id: ${id}`);
    const next = { ...current, ...patch, id: current.id };
    await this.write(next);
    return next;
  }

  async get(id: string): Promise<RunRecord | null> {
    const file = Bun.file(path.join(this.dir(id), "meta.json"));
    if (!(await file.exists())) return null;
    return (await file.json()) as RunRecord;
  }

  async list(): Promise<ListResult> {
    let entries: string[];
    try {
      entries = (await readdir(this.rootDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return { records: [], issues: [] };
    }
    const records: RunRecord[] = [];
    const issues: IndexIssue[] = [];
    for (const id of entries) {
      try {
        const record = await this.get(id);
        if (record !== null) records.push(record);
      } catch (error) {
        issues.push({
          path: `${id}/meta.json`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      records: records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
      issues,
    };
  }

  logPath(id: string): string {
    return path.join(this.dir(id), "stdout.log");
  }

  reportPath(id: string): string {
    return path.join(this.dir(id), "report.json");
  }

  artifactPathFor(id: string): string {
    const reportPath = this.reportPath(id);
    return assertInsideEvalDir(this.evalDir, reportPath, `Run id resolves outside the eval directory: ${id}`);
  }

  async reconcile(): Promise<RunRecord[]> {
    const changed: RunRecord[] = [];
    const { records } = await this.list();
    for (const record of records) {
      // Terminal statuses are already final.
      if (TERMINAL.has(record.status)) continue;
      // A running record with a live process is still valid.
      if (record.status === "running" && record.pid !== null && this.isProcessAlive(record.pid)) continue;
      // Everything else is orphaned: queued records from a dead process, or running records without a live pid.
      changed.push(await this.update(record.id, { status: "interrupted", endedAt: new Date().toISOString() }));
    }
    return changed;
  }

  private dir(id: string): string {
    return path.join(this.rootDir, id);
  }

  private async write(record: RunRecord): Promise<void> {
    await Bun.write(path.join(this.dir(record.id), "meta.json"), `${JSON.stringify(record, null, 2)}\n`);
  }
}

/** Returns the eval-relative path, or throws when `target` is not inside `evalDir`. */
function assertInsideEvalDir(evalDir: string, target: string, message: string): string {
  const relative = path.relative(evalDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(message);
  return relative;
}

function defaultIsProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Time-ordered, collision-resistant run id: sortable by creation time. */
function newRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
}
