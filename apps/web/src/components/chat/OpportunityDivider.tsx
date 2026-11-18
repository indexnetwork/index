import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { cn, formatChatDayLabel } from '@/lib/utils';
import type { ChatContextOpportunity } from '@/services/opportunities';
import { useTranslation } from 'react-i18next';
import TranslatedMark from '@/components/TranslatedMark';
import { useContentTranslation } from '@/lib/content-translation';

interface OpportunityDividerProps {
  /** One or more opportunities accepted in the same time slot (already grouped upstream). */
  opportunities: ChatContextOpportunity[];
  /** When true, the inline summary panel is visible on first render (used in empty chats so the context is immediately legible). Defaults to false. */
  defaultExpanded?: boolean;
}

const HEADLINE_MAX = 60;

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

/** One opportunity in the expanded panel; headline and summary are agent-written. */
function OpportunitySummary({ opp }: { opp: ChatContextOpportunity }) {
  const headline = useContentTranslation(opp.headline);
  const summary = useContentTranslation(opp.personalizedSummary);
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
      <p className="font-medium text-gray-700">{headline.text}</p>
      {opp.personalizedSummary && (
        <>
          <p className="mt-1 text-gray-500">{summary.text}</p>
          <TranslatedMark state={summary} />
        </>
      )}
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
  const { t } = useTranslation();
  const shownFirstHeadline = useContentTranslation(opportunities[0]?.headline);
  if (opportunities.length === 0) return null;
  const [first, ...rest] = opportunities;
  const extra = rest.length;
  const headline = truncate(shownFirstHeadline.text, HEADLINE_MAX);
  const date = first.acceptedAt ? formatChatDayLabel(first.acceptedAt) : '';

  return (
    <div className="my-4 opp-divider">
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
          <span>{first.status === 'pending' ? t('Matched “{{headline}}”', { headline }) : t('Accepted “{{headline}}”', { headline })}</span>
          {extra > 0 && (
            <span className="text-gray-400">{t('+{{n}} more', { n: extra })}</span>
          )}
          <span className="text-gray-400">&middot; {date}</span>
        </span>
        <span className="flex-1 h-px bg-gray-200" />
      </button>

      {expanded && (
        <div id={panelId} className="mt-3 mx-auto max-w-md text-xs text-gray-600 space-y-2">
          {opportunities.map((opp) => (
            <OpportunitySummary key={opp.opportunityId} opp={opp} />
          ))}
        </div>
      )}
    </div>
  );
}
