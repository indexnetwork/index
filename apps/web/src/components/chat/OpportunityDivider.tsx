import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { cn, formatChatDayLabel } from '@/lib/utils';
import type { ChatContextOpportunity } from '@/services/opportunities';

interface OpportunityDividerProps {
  /** One or more opportunities accepted in the same time slot (already grouped upstream). */
  opportunities: ChatContextOpportunity[];
  /** When true, the inline summary panel is visible on first render (used in empty chats so the context is immediately legible). Defaults to false. */
  defaultExpanded?: boolean;
}

const HEADLINE_MAX = 60;

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

/** Placeholder for accepted-opportunity summaries while chat context loads. */
export function OpportunityDividerSkeleton() {
  return (
    <div className="my-4 animate-pulse" data-testid="opportunity-divider-skeleton" aria-label="Loading accepted opportunities">
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-gray-200" />
        <span className="h-3 w-72 max-w-[55%] rounded bg-gray-200" />
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <div className="mx-auto mt-3 max-w-md space-y-2">
        {[0, 1].map((index) => (
          <div key={index} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
            <div className="h-4 w-4/5 rounded bg-gray-200" />
            <div className="mt-2 h-3 w-full rounded bg-gray-200" />
            <div className="mt-1.5 h-3 w-3/4 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Centered divider chip rendered between messages to mark the moment a shared
 * opportunity was accepted. Click toggles inline expansion showing the
 * personalized summary and a link to the opportunity detail. When multiple
 * opportunities were accepted in the same time slot, shows the earliest
 * headline plus a "+N more" affordance and lists all of them on expansion.
 */
export default function OpportunityDivider({ opportunities, defaultExpanded = false }: OpportunityDividerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const panelId = useId();
  if (opportunities.length === 0) return null;
  const [first, ...rest] = opportunities;
  const extra = rest.length;
  const headline = truncate(first.headline, HEADLINE_MAX);
  const date = first.acceptedAt ? formatChatDayLabel(first.acceptedAt) : '';

  return (
    <div className="my-4">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          'w-full flex items-center gap-2 text-xs text-gray-400',
          'hover:text-gray-600 transition-colors',
        )}
      >
        <span className="flex-1 h-px bg-gray-200" />
        <span className="flex items-center gap-1.5 normal-case tracking-normal">
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Accepted &ldquo;{headline}&rdquo;</span>
          {extra > 0 && (
            <span className="text-gray-400">+{extra} more</span>
          )}
          <span className="text-gray-400">&middot; {date}</span>
        </span>
        <span className="flex-1 h-px bg-gray-200" />
      </button>

      {expanded && (
        <div id={panelId} className="mt-3 mx-auto max-w-md text-xs text-gray-600 space-y-2">
          {opportunities.map((opp) => (
            <div key={opp.opportunityId} className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
              <p className="font-medium text-gray-700">{opp.headline}</p>
              {opp.personalizedSummary && (
                <p className="mt-1 text-gray-500">{opp.personalizedSummary}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
