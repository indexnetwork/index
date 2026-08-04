import { open } from "node:fs/promises";

import { statusFromExitCode, type RunStore } from "./ops.store.js";
import type { RunRecord, RunStatus } from "./ops.types.js";

/** One command of a run. A harness run is the one-step case. */
export interface ExecutionStep {
  /** Written to the log ahead of the command, so a multi-step run reads back. */
  label: string;
  argv: readonly string[];
  /** Absolute working directory for the child. */
  cwd: string;
  /** Environment merged over the parent process environment. */
  env: Record<string, string>;
}

export interface RunExecutor {
  /**
   * Runs `steps` in order, stopping at the first non-zero exit, or the record's
   * own argv when `steps` is omitted. Callers that need a different working
   * directory or extra environment pass steps, so there is exactly one spawn,
   * log and status-mapping path.
   *
   * Two callers do: the guarded fixture reset, whose pipeline is several
   * commands; and a harness whose script does not live in packages/protocol or
   * whose own gate demands credentials this server holds (discovery-ab is both).
   * A one-step plan is still one command, so it keeps the numbered harness
   * exit-code contract — see {@link terminalStatus}.
   */
  start(record: RunRecord, steps?: readonly ExecutionStep[]): Promise<RunRecord>;
  cancel(id: string): Promise<RunRecord>;
}

export interface LocalProcessRunExecutorOptions {
  store: RunStore;
  /**
   * Working directory for a child spawned without a step plan: packages/protocol
   * in production use, where the four scorecard harnesses' scripts live. A step
   * carries its own cwd and this is not consulted for it.
   */
  cwd: string;
}

interface LiveRun {
  /** Null before the first step is spawned and between steps. */
  proc: Bun.Subprocess | null;
  cancelled: boolean;
  /** Resolves with the terminal record `start()` persists, so `cancel()` never returns a stale read. */
  settled: Promise<RunRecord>;
}

/**
 * Spawns a harness as a child process, streaming combined stdout/stderr to the
 * run's log file. argv is passed as an array — there is no shell, so nothing in a
 * RunSpec can be interpreted as a command.
 *
 * A step's environment is handed to the child and written nowhere: the log
 * receives the child's own output, and a step label (which names the step, never
 * its environment) only for a plan of more than one command. That is what lets a
 * caller inject a credential the run record must not carry.
 */
export class LocalProcessRunExecutor implements RunExecutor {
  private readonly store: RunStore;
  private readonly cwd: string;
  private readonly live = new Map<string, LiveRun>();

  constructor(options: LocalProcessRunExecutorOptions) {
    this.store = options.store;
    this.cwd = options.cwd;
  }

  async start(record: RunRecord, steps?: readonly ExecutionStep[]): Promise<RunRecord> {
    const plan: readonly ExecutionStep[] = steps ?? [
      { label: record.spec.kind, argv: record.argv, cwd: this.cwd, env: record.env },
    ];
    if (plan.length === 0 || plan.some((step) => step.argv.length === 0)) {
      throw new Error(`Run ${record.id} has no command to execute`);
    }
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
      const entry: LiveRun = { proc: null, cancelled: false, settled };
      this.live.set(record.id, entry);

      let exitCode = 0;
      let index = 0;
      for (const step of plan) {
        // A cancel that lands between steps stops the pipeline instead of flushing
        // a database and then abandoning the seed that would refill it.
        if (entry.cancelled) break;
        if (plan.length > 1) await logFile.write(`\n[eval-ops] ${step.label}: ${step.argv.join(" ")}\n`);
        // Re-checked after that await: a cancel landing inside it sets `cancelled`
        // while `entry.proc` is still null, so its kill is a no-op. Without this the
        // step would spawn and run to completion — and if it were the flush, the
        // operator's cancel would leave the database flushed and unseeded.
        if (entry.cancelled) break;
        const proc = Bun.spawn({
          cmd: [...step.argv],
          cwd: step.cwd,
          env: { ...process.env, ...step.env },
          stdout: logFile.fd,
          stderr: logFile.fd,
          stdin: "ignore",
        });
        entry.proc = proc;
        await this.store.update(
          record.id,
          index === 0
            ? { status: "running", pid: proc.pid, startedAt: new Date().toISOString() }
            : { pid: proc.pid },
        );
        exitCode = await proc.exited;
        entry.proc = null;
        index += 1;
        if (exitCode !== 0) break;
      }
      const status = entry.cancelled ? "cancelled" : terminalStatus(plan, exitCode);
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
    if (entry.proc === null || (entry.proc.exitCode === null && entry.proc.signalCode === null)) {
      entry.cancelled = true;
      // Harnesses install graceful SIGINT cancellation; SIGKILL would strand partial state.
      entry.proc?.kill("SIGINT");
    }
    // Wait for the terminal update so the caller sees the effect of the cancel, not a stale read.
    return await entry.settled;
  }
}

/**
 * Maps a finished plan onto a run status.
 *
 * The numbered exit-code contract belongs to the harnesses, so it is applied only
 * to the single-command case. A pipeline of audited CLIs reports nothing finer
 * than success or failure, and calling a failed flush a "regression" would be a lie.
 */
function terminalStatus(plan: readonly ExecutionStep[], exitCode: number): RunStatus {
  if (plan.length === 1) return statusFromExitCode(exitCode);
  return exitCode === 0 ? "passed" : "execution-error";
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
