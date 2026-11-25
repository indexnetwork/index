import type { ChatContextOpportunity } from '@/services/opportunities';

/** A plain date, never "today" or "yesterday": the note stays true as the chat ages. */
function shortDate(iso?: string | null) {
  const at = Date.parse(iso ?? '');
  if (!Number.isFinite(at)) return '';
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Why two people are talking, where it came up in the chat: what each of them
 * is after, with the day the match was made in small type. A later match with
 * the same person lands further down, between the messages around it.
 */
export default function OpportunityEvent({ opportunity }: { opportunity: ChatContextOpportunity }) {
  const date = shortDate(opportunity.foundAt ?? opportunity.acceptedAt);
  return (
    <div className="pl-ev">
      {opportunity.sides ? (
        <>
          <p>{opportunity.sides.viewer}</p>
          <p>{opportunity.sides.peer}</p>
        </>
      ) : (
        <p>{opportunity.personalizedSummary || opportunity.headline}</p>
      )}
      {date && <div className="pl-ev-d">{date}</div>}
    </div>
  );
}
