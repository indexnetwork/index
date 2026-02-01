'use client';

import { useMemo } from 'react';

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
}

interface IntentListProps<T extends BaseIntent> {
  intents: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onArchiveIntent?: (intent: T) => void;
  onRemoveIntent?: (intent: T) => void;
  onOpenIntentSource?: (intent: T) => void;
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
  newIntentIds = new Set(),
  selectedIntentIds = new Set(),
  removingIntentIds = new Set(),
  className = '',
}: IntentListProps<T>) {
  // Sort intents by creation date (newest first) without grouping
  const sortedIntents = useMemo(() => {
    return [...intents].sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [intents]);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center py-6 ${className}`}>
        <span className="h-6 w-6 border-2 border-border border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (sortedIntents.length === 0) {
    return (
      <div className={`text-xs text-muted-foreground font-ibm-plex-mono py-4 text-center ${className}`}>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
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
        
        const cardClasses = `relative border rounded-sm px-2.5 py-2 transition-colors md:px-3 md:py-2.5 ${isSelectedSource
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-950 dark:border-blue-700 shadow-sm shadow-blue-500/20'
          : isFresh
            ? 'border-green-600 bg-green-50 dark:bg-green-950 dark:border-green-700 shadow-sm shadow-green-500/20'
            : 'border-border bg-card hover:border-muted-foreground'}`;

        return (
          <div key={intent.id} className={`group ${cardClasses}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {createdLabel && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-ibm-plex-mono whitespace-nowrap">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-muted-foreground"
                    >
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    {createdLabel}
                  </span>
                )}
                {isFresh && !isSelectedSource && (
                  <span className="px-1.5 py-0.5 rounded-full bg-green-600 text-white text-[10px] tracking-wide font-ibm-plex-mono uppercase">New</span>
                )}
              </div>
              
              <div className="flex items-center gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                {(onArchiveIntent || onRemoveIntent) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (onRemoveIntent) {
                        onRemoveIntent(intent);
                      } else if (onArchiveIntent) {
                        onArchiveIntent(intent);
                      }
                    }}
                    disabled={removingIntentIds.has(intent.id)}
                    className="h-6 w-6 grid place-items-center rounded-md bg-muted text-red-600 hover:text-red-700 hover:bg-muted/80 dark:text-red-400 dark:hover:text-red-300"
                    aria-label={onRemoveIntent ? "Remove intent" : "Archive intent"}
                  >
                    {removingIntentIds.has(intent.id) ? (
                      <div className="h-3 w-3 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3,6 5,6 21,6"></polyline>
                        <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                      </svg>
                    )}
                  </button>
                )}
                {onOpenIntentSource && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenIntentSource(intent);
                    }}
                    className={canOpenSource
                      ? 'h-6 w-6 grid place-items-center rounded-sm bg-muted text-muted-foreground hover:bg-muted/80'
                      : 'h-6 w-6 grid place-items-center rounded-sm bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400'}
                    aria-label={canOpenSource ? 'Open source' : 'View source details'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="7 7 17 7 17 17"></polyline>
                      <line x1="7" y1="17" x2="17" y2="7"></line>
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="mt-1 text-xs text-foreground font-medium leading-snug line-clamp-3 break-words">{summary}</div>
          </div>
        );
      })}
    </div>
  );
}
