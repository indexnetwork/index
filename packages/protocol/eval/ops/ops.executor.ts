import { open } from "node:fs/promises";
import path from "node:path";

import { statusFromExitCode, type RunStore } from "./ops.store.js";
import type { RunRecord } from "./ops.types.js";

export interface RunExecutor {
  start(record: RunRecord): Promise<RunRecord>;
  cancel(id: string): Promise<RunRecord>;
}

export interface LocalProcessRunExecutorOptions {
  store: RunStore;
  /** Working directory for the child. Always packages/protocol in production use. */
  cwd: string;
}

/**
 * Spawns a harness as a child process, streaming combined stdout/stderr to the
 * run's log file. argv is passed as an array — there is no shell, so nothing in a
 * RunSpec can be interpreted as a command.
 */
export class LocalProcessRunExecutor implements RunExecutor {
  private readonly store: RunStore;
  private readonly cwd: string;
  private readonly live = new Map<string, { proc: Bun.Subprocess; cancelled: boolean }>();

  constructor(options: LocalProcessRunExecutorOptions) {
    this.store = options.store;
    this.cwd = options.cwd;
  }

  async start(record: RunRecord): Promise<RunRecord> {
    const logFile = await open(this.store.logPath(record.id), "w");
    try {
      const proc = Bun.spawn({
        cmd: record.argv,
        cwd: this.cwd,
        env: { ...process.env, ...record.env },
        stdout: logFile.fd,
        stderr: logFile.fd,
        stdin: "ignore",
      });
      const entry = { proc, cancelled: false };
      this.live.set(record.id, entry);
      await this.store.update(record.id, {
        status: "running",
        pid: proc.pid,
        startedAt: new Date().toISOString(),
      });

      const exitCode = await proc.exited;
      const status = entry.cancelled ? "cancelled" : statusFromExitCode(exitCode);
      const artifactPath = (await Bun.file(this.store.reportPath(record.id)).exists())
        ? path.relative(path.join(this.cwd, "eval"), this.store.reportPath(record.id))
        : null;

      return await this.store.update(record.id, {
        status,
        exitCode,
        endedAt: new Date().toISOString(),
        artifactPath,
      });
    } finally {
      this.live.delete(record.id);
      await logFile.close();
    }
  }

  async cancel(id: string): Promise<RunRecord> {
    const entry = this.live.get(id);
    if (entry === undefined) {
      const record = await this.store.get(id);
      if (record === null) throw new Error(`Unknown run id: ${id}`);
      return record;
    }
    entry.cancelled = true;
    // Harnesses install graceful SIGINT cancellation; SIGKILL would strand partial state.
    entry.proc.kill("SIGINT");
    const record = await this.store.get(id);
    if (record === null) throw new Error(`Unknown run id: ${id}`);
    return record;
  }
}

/**
 * Follows a log file: yields everything already written, then each appended chunk
 * until the signal aborts. Replay-then-follow is what makes browser refresh,
 * reconnect and late-join all show complete output.
 */
export async function* tailLog(logPath: string, signal: AbortSignal): AsyncIterable<string> {
  let offset = 0;
  while (true) {
    const file = Bun.file(logPath);
    const size = await file.exists() ? file.size : 0;
    if (size > offset) {
      yield await file.slice(offset, size).text();
      offset = size;
    }
    
    if (signal.aborted) break;
    
    // Abortable sleep: check signal every 50ms for prompt termination
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(50);
      if (signal.aborted) break;
    }
  }
}
