/**
 * Neutral empty state for the intent-page Questions surfaces (IND-439).
 *
 * The 2026-07-18 visibility audit found the question funnel could be empty at
 * every stage with no user-facing explanation. This state is deliberately
 * informational — no warning colors, no deprioritization cues.
 */
export function QuestionsEmptyState({ className }: { className?: string }) {
  return (
    <div
      data-testid="questions-empty-state"
      className={`text-sm text-gray-500 font-ibm-plex-mono py-8 px-4 text-center border border-dashed border-gray-200 rounded-lg ${className ?? ''}`}
    >
      No open questions right now — your agent asks when new matches need a decision.
    </div>
  );
}
