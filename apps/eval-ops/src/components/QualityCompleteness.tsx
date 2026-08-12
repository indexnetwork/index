import type { ArtifactRef } from '../api/client';

export function QualityCompleteness({
  completeness,
  className,
}: {
  completeness: ArtifactRef['qualityCompleteness'];
  className?: string;
}) {
  const value = completeness === undefined
    ? 'unavailable'
    : `${completeness.completedSlots}/${completeness.requestedSlots}`;

  return (
    <span className={className}>
      <span className="font-mono">{value}</span>{' '}
      <span className="text-term-dim">completed/requested</span>
    </span>
  );
}
