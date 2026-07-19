import { useMemo } from 'react';
import { Calendar, Trash2, ExternalLink, FileText, Link as LinkIcon, Slack, MessageSquare, Network, AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DebugCopyButton } from './DebugCopyButton';

/**
 * Grace window after creation during which an intent with zero network
 * memberships is shown as "Evaluating…" rather than "Not in any network".
 * Network assignment runs async (HyDE queue) shortly after creation, so a
 * freshly-created intent legitimately has no memberships for a short while.
 */
const NETWORK_EVAL_GRACE_MS = 10 * 60 * 1000;

interface IntentNetwork {
  id: string;
  title: string;
}

/**
 * Whether an intent is still within the post-creation grace window, during
 * which zero memberships reads as "evaluating" rather than "orphaned".
 * A plain (non-component) function so the render-time clock read stays out of
 * component bodies — mirrors `NegotiationHistory.timeAgo`.
 */
function isWithinEvalGrace(createdAt: string): boolean {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return Number.isFinite(ageMs) && ageMs < NETWORK_EVAL_GRACE_MS;
}

interface BaseIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  sourceType?: 'file' | 'link' | 'integration';
  sourceId?: string;
  sourceName?: string;
  sourceValue?: string | null;
  sourceMeta?: string | null;
  /**
   * Networks this intent is registered to. `undefined` means the caller did
   * not supply membership data (membership UI is suppressed); an empty array
   * means the intent is registered to no networks (pending or orphaned).
   */
  networks?: IntentNetwork[];
  /**
   * Lifecycle status (ACTIVE|PAUSED|FULFILLED|EXPIRED). A badge renders only for
   * non-default (non-ACTIVE) values; undefined or ACTIVE renders nothing — the
   * enum is vestigial today, so this is forward-looking. See EDG-53.
   */
  status?: string;
  /** Canonical intent-scoped pending questions supplied by the list API. */
  pendingQuestionCount?: number;
}

/**
 * Renders an intent's network membership as chips, or a pending/orphaned badge
 * when it belongs to none. Returns null when membership data wasn't provided,
 * so callers that don't fetch memberships render nothing extra.
 */
function NetworkMembership({ networks, createdAt }: { networks?: IntentNetwork[]; createdAt: string }) {
  if (networks === undefined) return null;

  if (networks.length > 0) {
    const shown = networks.slice(0, 2);
    const extra = networks.length - shown.length;
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {shown.map((n) => (
          <span
            key={n.id}
            className="flex items-center gap-1 text-xs text-blue-700 font-ibm-plex-mono px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100"
          >
            <Network className="w-3 h-3 shrink-0" />
            <span className="max-w-[140px] truncate">{n.title}</span>
          </span>
        ))}
        {extra > 0 && (
          <span className="text-xs text-blue-700 font-ibm-plex-mono px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100">
            +{extra}
          </span>
        )}
      </div>
    );
  }

  if (isWithinEvalGrace(createdAt)) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-gray-500 font-ibm-plex-mono px-2 py-0.5 rounded-full bg-gray-100/50 border border-gray-100">
        <span className="h-2.5 w-2.5 border border-gray-300 border-t-gray-500 rounded-full animate-spin" />
        Evaluating…
      </span>
    );
  }

  return (
    <span
      className="flex items-center gap-1 text-xs text-amber-700 font-ibm-plex-mono px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200"
      title="This intent isn't registered to any network yet. It will be re-evaluated when you join a matching network."
    >
      <AlertTriangle className="w-3 h-3 shrink-0" />
      Not in any network
    </span>
  );
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
  onArchiveIntent,
  onRemoveIntent,
  onOpenIntentSource,
  onIntentClick,
  newIntentIds = new Set(),
  selectedIntentIds = new Set(),
  removingIntentIds = new Set(),
  className = '',
}: IntentListProps<T>) {
  // Keep active intents actionable first, then show newest first within each lifecycle group.
  const sortedIntents = useMemo(() => {
    return [...intents].sort((a, b) => {
      const aIsActive = !a.status || a.status.toUpperCase() === 'ACTIVE';
      const bIsActive = !b.status || b.status.toUpperCase() === 'ACTIVE';
      if (aIsActive !== bIsActive) return aIsActive ? -1 : 1;
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
        const isRemoving = removingIntentIds.has(intent.id);
        const isActive = !intent.status || intent.status.toUpperCase() === 'ACTIVE';
        
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
            <div
              data-testid={`intent-card-layout-${intent.id}`}
              className="flex flex-col gap-3 sm:pointer-fine:flex-row sm:pointer-fine:items-start sm:pointer-fine:justify-between sm:pointer-fine:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 leading-relaxed font-medium">
                  {summary}
                </p>
                
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {/* Date Badge */}
                  {createdLabel && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 font-ibm-plex-mono">
                      <Calendar className="w-3 h-3" />
                      <span>{createdLabel}</span>
                    </div>
                  )}

                  {/* Active signals continue running in the background. */}
                  {isActive && (
                    <div
                      data-testid={`intent-live-indicator-${intent.id}`}
                      className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 font-ibm-plex-mono"
                    >
                      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      live
                    </div>
                  )}

                  {/* Source Badge */}
                  {intent.sourceType && (
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

                  {/* Network membership: chips, or pending/orphaned badge */}
                  <NetworkMembership networks={intent.networks} createdAt={intent.createdAt} />
                  <StatusBadge status={intent.status} />
                </div>
              </div>

              <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:pointer-fine:w-auto sm:pointer-fine:shrink-0 sm:pointer-fine:flex-nowrap sm:pointer-fine:justify-end">
                {typeof intent.pendingQuestionCount === 'number' && intent.pendingQuestionCount > 0 && (
                  <span
                    data-testid={`intent-pending-question-badge-${intent.id}`}
                    className="flex items-center gap-1 whitespace-nowrap rounded-full bg-[#4091BB] px-2.5 py-1 text-xs font-semibold text-white shadow-sm font-ibm-plex-mono"
                    title={`${intent.pendingQuestionCount} ${intent.pendingQuestionCount === 1 ? 'question' : 'questions'} to answer`}
                  >
                    <MessageSquare className="h-3 w-3 shrink-0" />
                    {intent.pendingQuestionCount} to answer
                  </span>
                )}

                {/* Touch/small layouts keep actions visible. Larger fine-pointer layouts reveal them on intent. */}
                <div
                  data-testid={`intent-actions-${intent.id}`}
                  className="ml-auto flex items-center gap-1 transition-opacity sm:pointer-fine:pointer-events-none sm:pointer-fine:opacity-0 sm:pointer-fine:group-hover:pointer-events-auto sm:pointer-fine:group-hover:opacity-100 sm:pointer-fine:group-focus-within:pointer-events-auto sm:pointer-fine:group-focus-within:opacity-100"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <DebugCopyButton fetchPath={`/debug/intents/${intent.id}`} />
                  {onOpenIntentSource && canOpenSource && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        onOpenIntentSource(intent);
                      }}
                      className="p-1.5 rounded-md text-gray-400 hover:text-black hover:bg-gray-100 transition-colors"
                      title="Open Source"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  )}

                  {(onArchiveIntent || onRemoveIntent) && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        if (onRemoveIntent) {
                          onRemoveIntent(intent);
                        } else if (onArchiveIntent) {
                          onArchiveIntent(intent);
                        }
                      }}
                      disabled={isRemoving}
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                      title={onRemoveIntent ? "Remove" : "Archive"}
                    >
                      {isRemoving ? (
                        <div className="h-4 w-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
