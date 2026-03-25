import { useMemo, useState } from 'react';
import { Calendar, Trash2, ExternalLink, FileText, Link as LinkIcon, Slack, MessageSquare, Share2, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DebugCopyButton } from './DebugCopyButton';

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
  onShareIntent?: (intent: T) => Promise<void>;
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
  onShareIntent,
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

  const [sharedIntentId, setSharedIntentId] = useState<string | null>(null);

  const handleShare = async (e: React.MouseEvent, intent: T) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onShareIntent) return;
    await onShareIntent(intent);
    setSharedIntentId(intent.id);
    setTimeout(() => setSharedIntentId(null), 2000);
  };

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
        const justShared = sharedIntentId === intent.id;
        
        return (
          <div 
            key={intent.id} 
            className={cn(
              "group relative p-4 rounded-lg border transition-all duration-200",
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
                  {/* Date Badge */}
                  {createdLabel && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 font-ibm-plex-mono">
                      <Calendar className="w-3 h-3" />
                      <span>{createdLabel}</span>
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
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <DebugCopyButton fetchPath={`/debug/intents/${intent.id}`} />
                {onShareIntent && (
                  <button
                    onClick={(e) => handleShare(e, intent)}
                    className="p-1.5 rounded-md text-gray-400 hover:text-black hover:bg-gray-100 transition-colors"
                    title={justShared ? "Copied!" : "Share"}
                  >
                    {justShared ? <Check className="w-4 h-4 text-green-600" /> : <Share2 className="w-4 h-4" />}
                  </button>
                )}
                {onOpenIntentSource && canOpenSource && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
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
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
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
        );
      })}
    </div>
  );
}
