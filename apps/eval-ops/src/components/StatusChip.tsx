const STATUS: Record<string, { className: string; label: string }> = {
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

export function StatusChip({ status }: { status: string }) {
  const entry = STATUS[status] ?? { className: 'text-term-dim', label: status };
  return <span className={entry.className}>{entry.label}</span>;
}
