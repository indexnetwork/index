/**
 * Small pill badge indicating a feature is in alpha.
 * Intended to appear next to feature labels that are not yet stable.
 */
export function AlphaBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
      ALPHA
    </span>
  );
}
