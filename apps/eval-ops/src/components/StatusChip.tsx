/**
 * Local type alias for RunStatus from packages/protocol/eval/ops/ops.types.ts.
 *
 * Pinned by test to fail if protocol changes. Apps do not import protocol directly.
 */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'regression'
  | 'execution-error'
  | 'insufficient-evidence'
  | 'cancelled'
  | 'interrupted'
  | 'crashed';

const STATUS: Record<RunStatus, { className: string; label: string }> = {
  passed: { className: 'text-term-green', label: '● passed' },
  regression: { className: 'text-term-red', label: '● regression' },
  'execution-error': { className: 'text-term-magenta', label: '● exec error' },
  'insufficient-evidence': { className: 'text-term-yellow', label: '● insufficient' },
  running: { className: 'text-term-cyan', label: '● running' },
  queued: { className: 'text-term-dim', label: '○ queued' },
  cancelled: { className: 'text-term-dim', label: '○ cancelled' },
  interrupted: { className: 'text-term-dim', label: '○ interrupted' },
  crashed: { className: 'text-term-magenta', label: '● crashed' },
};

export interface StatusChipProps {
  status: RunStatus;
}

export function StatusChip({ status }: StatusChipProps) {
  const entry = STATUS[status] ?? { className: 'text-term-dim', label: status };
  return <span className={entry.className}>{entry.label}</span>;
}
