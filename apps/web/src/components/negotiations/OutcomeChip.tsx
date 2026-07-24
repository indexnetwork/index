/**
 * OutcomeChip — compact inline badge for a resolved opportunity's outcome.
 *
 * Used in older negotiation section dividers (IND-570) to show how a past
 * negotiation ended without repeating the full ResolvedBanner.
 */

import { outcomeChipVariant } from './negotiation-turns';

interface OutcomeChipProps {
  /** Raw opportunity status value from the API. */
  status: string | null | undefined;
}

/**
 * Renders a small coloured pill (e.g. "Accepted", "Rejected", "Stalled", "Expired").
 * Returns null when the status maps to no known outcome.
 */
export default function OutcomeChip({ status }: OutcomeChipProps) {
  const variant = outcomeChipVariant(status);
  if (!variant) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium font-ibm-plex-mono ${variant.color} ${variant.bg}`}
      aria-label={`Outcome: ${variant.label}`}
    >
      {variant.label}
    </span>
  );
}
