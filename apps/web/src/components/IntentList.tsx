import { useMemo } from 'react';
import { Calendar, ExternalLink, FileText, Link as LinkIcon, Slack, MessageSquare, Handshake } from 'lucide-react';

import { cn } from '@/lib/utils';

interface BaseIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  sourceType?: 'file' | 'link' | 'integration' | 'discovery_form' | 'enrichment';
  sourceId?: string;
  sourceName?: string;
  sourceValue?: string | null;
  sourceMeta?: string | null;
  /**
   * Count of `pending` opportunities anchored on this intent, awaiting the user.
   * Shown next to the date. Undefined/0 renders nothing.
   */
  waitingOpportunityCount?: number;
  /**
   * Count of pending intent-scoped questions awaiting the user. Rendered as a
   * notification badge on the row. Undefined/0 renders nothing.
   */
  pendingQuestionCount?: number;
  /**
   * Lifecycle status (ACTIVE|PAUSED|FULFILLED|EXPIRED). A badge renders only for
   * non-default (non-ACTIVE) values; undefined or ACTIVE renders nothing — the
   * enum is vestigial today, so this is forward-looking. See EDG-53.
   */
  status?: string;
}

/**
 * Renders an intent's lifecycle status as a badge, but only when it is a
 * non-default value. ACTIVE (the schema default) and undefined render nothing,
 * so today this is invisible and purely forward-looking. See EDG-53.
 */
function StatusBadge({ status }: { status?: string }) {
  if (!status || status.toUpperCase() === 'ACTIVE') return null;
  return (
    <span className="flex items-center gap-1 text-xs text-purple-700 font-ibm-plex-mono px-2 py-0.5 rounded-full bg-purple-50 border border-purple-100 capitalize">
      {status.toLowerCase()}
    </span>
  );
}

interface IntentListProps<T extends BaseIntent> {
  intents: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onArchiveIntent?: (intent: T) => void;
  onRemoveIntent?: (intent: T) => void;
  onOpenIntentSource?: (intent: T) => void;
  onIntentClick?: (intent: T) => void;
  newIntentIds?: Set<string>;
  selectedIntentIds?: Set<string>;
  removingIntentIds?: Set<string>;
  className?: string;
}

export default function IntentList<T extends BaseIntent>({
  intents,
  isLoading = false,
  emptyMessage = 'No intents yet',
  onOpenIntentSource,
  onIntentClick,
  newIntentIds = new Set(),
  selectedIntentIds = new Set(),
  className = '',
}: IntentListProps<T>) {
  // Sort intents by creation date (newest first) without grouping
  const sortedIntents = useMemo(() => {
    return [...intents].sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [intents]);

  const getSourceIcon = (type?: string) => {
    switch (type) {
      case 'file': return <FileText className="w-3 h-3" />;
      case 'link': return <LinkIcon className="w-3 h-3" />;
      case 'integration': return <Slack className="w-3 h-3" />; // Assuming mostly Slack for now
      default: return <MessageSquare className="w-3 h-3" />;
    }
  };

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-12", className)}>
        <span className="h-6 w-6 border-2 border-gray-300 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  if (sortedIntents.length === 0) {
    return (
      <div className={cn("text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg", className)}>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {sortedIntents.map((intent) => {
        const summary = (intent.summary && intent.summary.trim().length > 0 ? intent.summary : intent.payload).trim();
        const createdAt = new Date(intent.createdAt);
        const createdLabel = Number.isNaN(createdAt.getTime()) ? null : createdAt.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric'
        });
        const isFresh = newIntentIds.has(intent.id);
        const isSelectedSource = selectedIntentIds.has(intent.id);
        const canOpenSource = intent.sourceType === 'link' && intent.sourceValue && /^https?:/i.test(intent.sourceValue);
        
        return (
          <div 
            key={intent.id}
            role={onIntentClick ? "button" : undefined}
            tabIndex={onIntentClick ? 0 : undefined}
            onClick={onIntentClick ? () => onIntentClick(intent) : undefined}
            onKeyDown={onIntentClick ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onIntentClick(intent);
              }
            } : undefined}
            className={cn(
              "group relative p-4 rounded-lg border transition-all duration-200",
              onIntentClick && "cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30",
              isSelectedSource 
                ? "border-blue-200 bg-blue-50/50" 
                : isFresh
                  ? "border-green-200 bg-green-50/50"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 leading-relaxed font-medium">
                  {summary}
                </p>
                
                <div className="flex items-center gap-3 mt-2.5">
                  {/* Date Badge + waiting-opportunity count */}
                  {createdLabel && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 font-ibm-plex-mono">
                      <Calendar className="w-3 h-3" />
                      <span>{createdLabel}</span>
                    </div>
                  )}

                  {/* Opportunities waiting — next to the date */}
                  {(intent.waitingOpportunityCount ?? 0) > 0 && (
                    <div
                      className="flex items-center gap-1.5 text-xs text-emerald-700 font-ibm-plex-mono"
                      title={`${intent.waitingOpportunityCount} ${intent.waitingOpportunityCount === 1 ? 'opportunity' : 'opportunities'} waiting`}
                    >
                      <Handshake className="w-3 h-3" />
                      <span>{intent.waitingOpportunityCount} waiting</span>
                    </div>
                  )}

                  {/* Source Badge — external origins only (a user's own
                      directly-created signals carry no meaningful source tag) */}
                  {intent.sourceType && ['file', 'link', 'integration'].includes(intent.sourceType) && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 font-ibm-plex-mono px-2 py-0.5 rounded-full bg-gray-100/50 border border-gray-100">
                      {getSourceIcon(intent.sourceType)}
                      <span className="capitalize">{intent.sourceType}</span>
                    </div>
                  )}

                  {/* New Badge */}
                  {isFresh && !isSelectedSource && (
                    <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] tracking-wide font-ibm-plex-mono font-medium uppercase border border-green-200">
                      New
                    </span>
                  )}

                  <StatusBadge status={intent.status} />
                </div>
              </div>

              {/* Right side: pending-question notification (always shown —
                  important signal; muted at zero, highlighted when any) + hover actions */}
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={cn(
                    'text-xs font-ibm-plex-mono px-2 py-0.5 rounded-full',
                    (intent.pendingQuestionCount ?? 0) > 0
                      ? 'bg-[#F26522] text-white'
                      : 'bg-gray-100 text-gray-400 border border-gray-200',
                  )}
                  title={`${intent.pendingQuestionCount ?? 0} pending ${(intent.pendingQuestionCount ?? 0) === 1 ? 'question' : 'questions'}`}
                >
                  {intent.pendingQuestionCount ?? 0}
                </span>

                {/* Open source (link-sourced signals only) */}
                {onOpenIntentSource && canOpenSource && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenIntentSource(intent);
                    }}
                    className="p-1.5 rounded-md text-gray-400 hover:text-black hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-all"
                    title="Open Source"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
