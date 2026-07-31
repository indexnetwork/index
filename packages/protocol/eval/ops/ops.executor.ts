import { open } from "node:fs/promises";

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

interface LiveRun {
  proc: Bun.Subprocess;
  cancelled: boolean;
  /** Resolves with the terminal record `start()` persists, so `cancel()` never returns a stale read. */
  settled: Promise<RunRecord>;
}

/**
 * Spawns a harness as a child process, streaming combined stdout/stderr to the
 * run's log file. argv is passed as an array — there is no shell, so nothing in a
 * RunSpec can be interpreted as a command.
 */
export class LocalProcessRunExecutor implements RunExecutor {
  private readonly store: RunStore;
  private readonly cwd: string;
  private readonly live = new Map<string, LiveRun>();

  constructor(options: LocalProcessRunExecutorOptions) {
    this.store = options.store;
    this.cwd = options.cwd;
  }

  async start(record: RunRecord): Promise<RunRecord> {
    const logFile = await open(this.store.logPath(record.id), "w");
    let settle!: (value: RunRecord) => void;
    let fail!: (reason: unknown) => void;
    const settled = new Promise<RunRecord>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    // start() is the caller that reports failures; cancel() may never await this promise.
    settled.catch(() => {});
    try {
      const proc = Bun.spawn({
        cmd: record.argv,
        cwd: this.cwd,
        env: { ...process.env, ...record.env },
        stdout: logFile.fd,
        stderr: logFile.fd,
        stdin: "ignore",
      });
      const entry: LiveRun = { proc, cancelled: false, settled };
      this.live.set(record.id, entry);
      await this.store.update(record.id, {
        status: "running",
        pid: proc.pid,
        startedAt: new Date().toISOString(),
      });

      const exitCode = await proc.exited;
      const status = entry.cancelled ? "cancelled" : statusFromExitCode(exitCode);
      // The store owns the eval-root convention; the executor never re-derives it from cwd.
      const artifactPath = (await Bun.file(this.store.reportPath(record.id)).exists())
        ? this.store.artifactPathFor(record.id)
        : null;

      const finished = await this.store.update(record.id, {
        status,
        exitCode,
        endedAt: new Date().toISOString(),
        artifactPath,
      });
      settle(finished);
      return finished;
    } catch (error) {
      fail(error);
      throw error;
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
    // The child may already be gone while start() is still writing the terminal record:
    // flagging it here would relabel a normal completion as cancelled.
    if (entry.proc.exitCode === null && entry.proc.signalCode === null) {
      entry.cancelled = true;
      // Harnesses install graceful SIGINT cancellation; SIGKILL would strand partial state.
      entry.proc.kill("SIGINT");
    }
    // Wait for the terminal update so the caller sees the effect of the cancel, not a stale read.
    return await entry.settled;
  }
}

/**
 * Follows a log file: yields everything already written, then each appended chunk
 * until the signal aborts. Replay-then-follow is what makes browser refresh,
 * reconnect and late-join all show complete output.
 */
export async function* tailLog(logPath: string, signal: AbortSignal): AsyncIterable<string> {
  let offset = 0;
  // A single streaming decoder across polls: a multi-byte character split by a poll
  // boundary is held back and completed by the next chunk instead of becoming U+FFFD.
  let decoder = new TextDecoder();
  while (true) {
    const file = Bun.file(logPath);
    const size = (await file.exists()) ? file.size : 0;
    if (size < offset) {
      // The log was truncated or replaced (start() opens with "w"): restart from the top
      // rather than waiting forever for a size that can no longer be reached.
      offset = 0;
      decoder = new TextDecoder();
    }
    if (size > offset) {
      const chunk = decoder.decode(await file.slice(offset, size).bytes(), { stream: true });
      offset = size;
      if (chunk !== "") yield chunk;
    }

    if (signal.aborted) break;

    // Abortable sleep: check signal every 50ms for prompt termination
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(50);
      if (signal.aborted) break;
    }
  }
}
