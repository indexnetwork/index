/**
 * Turns a harness's console output into structured run progress.
 *
 * A real harness log is not the clean idiom the usage text suggests. Cases are
 * announced with process.stdout.write, then the evaluator's unconditional
 * verbose logger dumps multi-line objects, and the score lands later:
 *
 *   Running 40 case(s) × 3 run(s) against google/gemini-2.5-flash…
 *     is_a/identity-basic … [OpportunityEvaluator:invokeEntityBundle] Done {
 *       total: 1,
 *       …20 more lines of debug…
 *     }
 *   3/3                                  ← completion, alone on its own line
 *     location/known-mismatch … [debug…  ← next case starts
 *
 * So: a case STARTS on a line beginning "  <id> … " (anything may follow on
 * that line) and is COMPLETED by a line that is exactly "N/M" or "N/M (flaky)".
 * A new start with no completion seen closes the previous case as unknown.
 * This module is pure — no Bun or DOM APIs — so the web client imports it
 * directly and parses live chunks and replayed logs with the same code.
 * Harnesses are untouched: CLI and CI output do not change.
 */

export interface CaseProgress {
  id: string;
  /** null when the completion line was never seen (in flight, or missed). */
  passes: number | null;
  runs: number | null;
  flaky: boolean;
  done: boolean;
}

export interface RunProgress {
  /** From the "Running N case(s)…" header; null until it arrives. */
  totalCases: number | null;
  runsPerCase: number | null;
  model: string | null;
  /** Cases seen so far, in order; the last entry may be in flight. */
  cases: CaseProgress[];
  completed: number;
  /** Completed cases where passes === runs. */
  passed: number;
  /** Completed cases where passes !== runs (flaky or failing). */
  failed: number;
  current: CaseProgress | null;
}

// "Running 40 case(s) × 3 run(s) against anthropic/claude-x (judge off)…"
const HEADER_RE = /^Running (\d+) case\(s\) × (\d+) run\(s\) against (.+?)(?: \(judge off\))?…/;
// "  is_a/identity-basic … 1/1" — start and completion on one line (quiet output).
const CASE_INLINE_RE = /^ {2}(\S+) …\s+(\d+)\/(\d+)( \(flaky\))?\s*$/;
// "  is_a/identity-basic … " possibly followed by debug noise on the same line.
const CASE_START_RE = /^ {2}(\S+) …/;
// "3/3" or "1/3 (flaky)" — the completion, alone on its own line.
const CASE_DONE_RE = /^(\d+)\/(\d+)( \(flaky\))?$/;

// CSI sequences (colour, cursor movement) the harness or its dependencies may emit.
// eslint-disable-next-line no-control-regex -- matching ESC is the point
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function emptyProgress(): RunProgress {
  return {
    totalCases: null,
    runsPerCase: null,
    model: null,
    cases: [],
    completed: 0,
    passed: 0,
    failed: 0,
    current: null,
  };
}

/** A start line while another case is open means its completion was missed. */
function closeOpenAsUnknown(progress: RunProgress): void {
  const last = progress.cases[progress.cases.length - 1];
  if (last !== undefined && !last.done) last.done = true;
}

function applyLine(progress: RunProgress, line: string): void {
  const header = HEADER_RE.exec(line);
  if (header) {
    progress.totalCases = Number(header[1]);
    progress.runsPerCase = Number(header[2]);
    progress.model = header[3];
    return;
  }
  const inline = CASE_INLINE_RE.exec(line);
  if (inline) {
    closeOpenAsUnknown(progress);
    progress.cases.push({
      id: inline[1],
      passes: Number(inline[2]),
      runs: Number(inline[3]),
      flaky: inline[4] !== undefined,
      done: true,
    });
    return;
  }
  const start = CASE_START_RE.exec(line);
  if (start) {
    closeOpenAsUnknown(progress);
    progress.cases.push({ id: start[1], passes: null, runs: null, flaky: false, done: false });
    return;
  }
  const done = CASE_DONE_RE.exec(line);
  if (done) {
    const last = progress.cases[progress.cases.length - 1];
    if (last !== undefined && !last.done) {
      last.passes = Number(done[1]);
      last.runs = Number(done[2]);
      last.flaky = done[3] !== undefined;
      last.done = true;
    }
    return;
  }
  // Anything else — debug dumps, retry notices, scorecard output — is not progress.
}

function recompute(progress: RunProgress): void {
  progress.completed = progress.cases.filter((c) => c.done).length;
  progress.passed = progress.cases.filter((c) => c.done && c.passes !== null && c.passes === c.runs).length;
  progress.failed = progress.cases.filter((c) => c.done && c.passes !== null && c.passes !== c.runs).length;
  const last = progress.cases[progress.cases.length - 1];
  progress.current = last !== undefined && !last.done ? last : null;
}

/**
 * Incremental parser for a live stream. Chunks may split lines anywhere;
 * state lives across push() calls, so a case stays "in flight" while the
 * evaluator's debug output scrolls past.
 */
export class HarnessProgressParser {
  private buffer = "";
  private readonly progress = emptyProgress();

  push(chunk: string): void {
    this.buffer += chunk.replace(ANSI_RE, "");
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      applyLine(this.progress, this.buffer.slice(0, newline).replace(/\r$/, ""));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
    }
    recompute(this.progress);
  }

  snapshot(): RunProgress {
    return { ...this.progress, cases: this.progress.cases.map((c) => ({ ...c })) };
  }
}

/** Parses a complete log in one shot — replayed runs, finished runs, tests. */
export function parseHarnessProgress(text: string): RunProgress {
  const parser = new HarnessProgressParser();
  parser.push(text);
  return parser.snapshot();
}
