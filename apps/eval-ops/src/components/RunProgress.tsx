import { useEffect, useState } from 'react';

import type { CaseProgress, RunProgress } from '../../../../packages/protocol/eval/ops/ops.progress';

export interface RunProgressViewProps {
  progress: RunProgress;
  /** Epoch ms when each case was first seen, for live durations. */
  caseStartedAt: ReadonlyMap<string, number>;
  /** Run start, epoch ms; drives the elapsed readout. */
  runStartedAt: number | null;
  /** True while the run is live; freezes timers otherwise. */
  live: boolean;
}

/**
 * The followable face of a run: where it is, what each case did, and which one
 * is working right now. The raw harness output stays available behind a toggle
 * in the parent — this view replaces it as the primary readout.
 */
export function RunProgressView({ progress, caseStartedAt, runStartedAt, live }: RunProgressViewProps) {
  // One ticker for both the elapsed readout and the in-flight case timer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  const total = progress.totalCases;
  const done = progress.completed;
  const fraction = total !== null && total > 0 ? done / total : 0;
  const filled = Math.round(fraction * 20);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-term-green font-mono">{bar}</span>
        <span>
          {total !== null ? `${done}/${total} cases` : `${done} cases`}
        </span>
        <span className="text-term-dim">
          {progress.passed} passed
          {progress.failed > 0 && <span className="text-term-red"> · {progress.failed} failed</span>}
        </span>
        {runStartedAt !== null && (
          <span className="text-term-dim ml-auto">{formatClock(Math.max(0, now - runStartedAt))}</span>
        )}
      </div>

      {progress.current !== null && (
        <div className="text-term-cyan">
          ● running {progress.current.id}
          <span className="text-term-dim ml-4">
            {formatClock(Math.max(0, now - (caseStartedAt.get(progress.current.id) ?? now)))}
          </span>
        </div>
      )}

      <div className="space-y-1">
        {progress.cases.filter((c) => c.done).map((c) => (
          <CaseRow key={c.id} c={c} durationMs={durationOf(c, caseStartedAt, live)} />
        ))}
      </div>
    </div>
  );
}

function durationOf(
  c: CaseProgress,
  caseStartedAt: ReadonlyMap<string, number>,
  live: boolean,
): number | null {
  // Durations exist only for cases this session watched finish; replayed logs
  // carry no timing, so their rows show '—' rather than a fabricated number.
  if (!live) return null;
  const started = caseStartedAt.get(c.id);
  const finished = caseStartedAt.get(`${c.id}::done`);
  if (started === undefined || finished === undefined) return null;
  return finished - started;
}

function CaseRow({ c, durationMs }: { c: CaseProgress; durationMs: number | null }) {
  const unknown = c.passes === null || c.runs === null;
  const passed = !unknown && c.passes === c.runs;
  const partial = !unknown && !passed && (c.passes as number) > 0;
  const icon = unknown ? '?' : passed ? '✓' : partial ? '◐' : '✗';
  const colour = unknown
    ? 'text-term-dim'
    : passed
      ? 'text-term-green'
      : partial || c.flaky
        ? 'text-term-yellow'
        : 'text-term-red';
  const verdict = unknown
    ? 'unknown'
    : passed
      ? 'passed'
      : `${c.passes}/${c.runs} passed${c.flaky ? ' (flaky)' : ''}`;

  return (
    <div className="flex gap-4 font-mono text-sm">
      <span className={colour}>{icon}</span>
      <span className="flex-1">{c.id}</span>
      <span className={colour}>{verdict}</span>
      <span className="text-term-dim w-12 text-right">
        {durationMs !== null ? formatClock(durationMs) : '—'}
      </span>
    </div>
  );
}

function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `0:${String(seconds).padStart(2, '0')}`;
}
