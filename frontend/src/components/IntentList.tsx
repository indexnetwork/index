'use client';

import { useMemo } from 'react';
import { getFileCategoryBadge } from '../lib/file-validation';

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
        <span className="h-6 w-6 border-2 border-[#CCCCCC] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (sortedIntents.length === 0) {
    return (
      <div className={`text-xs text-[#666] font-ibm-plex-mono py-4 text-center ${className}`}>
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
          ? 'border-[#99CFFF] bg-[#F0F7FF] shadow-sm shadow-[rgba(0,126,255,0.16)]'
          : isFresh
            ? 'border-[#0A8F5A] bg-[#F1FFF5] shadow-sm shadow-[rgba(10,143,90,0.12)]'
            : 'border-[#E0E0E0] bg-white hover:border-[#CCCCCC]'}`;

        const icon = (() => {
          if (intent.sourceType === 'file') {
            return (
              <span className="text-[10px] px-1.5 py-0.5 border border-[#E0E0E0] rounded-sm font-ibm-plex-mono text-[#333] bg-[#F5F5F5]">
                {getFileCategoryBadge(intent.sourceName || '', intent.sourceMeta ?? undefined)}
              </span>
            );
          }
          if (intent.sourceType === 'link') {
            return (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[#666]"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            );
          }
          if (intent.sourceType === 'integration' && intent.sourceValue) {
            return (
              <div className="h-[18px] w-[18px] rounded-sm bg-white border border-[#E0E0E0] flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/integrations/${intent.sourceValue}.png`} alt="" className="h-4 w-4 object-contain" />
              </div>
            );
          }
          return null;
        })();
        return (
          <div key={intent.id} className={`group ${cardClasses}`}>
            <div className="flex items-center gap-2">
              {createdLabel && (
                <span className="flex items-center gap-1 text-[10px] text-[#777] font-ibm-plex-mono whitespace-nowrap">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-[#777]"
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
                <span className="px-1.5 py-0.5 rounded-full bg-[#0A8F5A] text-white text-[10px] tracking-wide font-ibm-plex-mono uppercase">New</span>
              )}
              {icon}
            </div>
            <div className="mt-1 text-xs text-[#333] font-medium leading-snug line-clamp-3 break-words">{summary}</div>

            <div className="mt-2 flex items-center justify-end gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:absolute lg:right-2 lg:bottom-2">
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
                  className="h-6 w-6 grid place-items-center rounded-md bg-[#F2F2F2] text-red-600 hover:text-red-700 hover:bg-[#E6E6E6]"
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
                    ? 'h-6 w-6 grid place-items-center rounded-sm bg-[#F2F2F2] text-[#555] hover:bg-[#E6E6E6]'
                    : 'h-6 w-6 grid place-items-center rounded-sm bg-[#EEF5FF] text-[#3563E9]'}
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
        );
      })}
    </div>
  );
}
