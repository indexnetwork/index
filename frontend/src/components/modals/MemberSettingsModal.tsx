'use client';

import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Index } from '@/lib/types';
import { Plus } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAPI } from '@/contexts/APIContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { useIndexesState } from '@/contexts/IndexesContext';
import { Button } from '@/components/ui/button';
import IntentList from '@/components/IntentList';
import { QueueStatus } from '@/services/queue';

interface MemberIntent {
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

interface MemberSettings {
  indexTitle: string;
  indexPrompt?: string;
  memberPrompt?: string;
  autoAssign: boolean;
  permissions: string[];
  isOwner: boolean;
}

interface TagSuggestion {
  value: string;
  score: number;
}

interface MemberSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: Index;
}

export default function MemberSettingsModal({ open, onOpenChange, index }: MemberSettingsModalProps) {
  const [isLeaving, setIsLeaving] = useState(false);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [memberSettings, setMemberSettings] = useState<MemberSettings | null>(null);
  const [indexedIntents, setIndexedIntents] = useState<MemberIntent[]>([]);
  const [loadingIndexed, setLoadingIndexed] = useState(false);
  const [removingIntents, setRemovingIntents] = useState<Set<string>>(new Set());
  const [usedTags, setUsedTags] = useState<Set<string>>(new Set());
  const [suggestedTags, setSuggestedTags] = useState<TagSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsFetched, setSuggestionsFetched] = useState(false);
  const [activeMobileSection, setActiveMobileSection] = useState<'settings' | 'intents'>('settings');
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);

  const { success, error } = useNotifications();
  const { removeIndex } = useIndexesState();
  const { indexesService, intentsService } = useAPI();
  const api = useAuthenticatedAPI(); // Keep for specialized endpoints

  // Check if there are unsaved changes
  const hasUnsavedChanges = prompt !== originalPrompt;

  // Fetch member settings
  const fetchMemberSettings = useCallback(async () => {
    try {
      const response = await api.get<MemberSettings>(`/indexes/${index.id}/member-settings`);
      setMemberSettings(response);
      setPrompt(response.memberPrompt || '');
      setOriginalPrompt(response.memberPrompt || '');
    } catch (err) {
      console.error('Failed to fetch member settings:', err);
    }
  }, [api, index.id]);

  // Fetch member intents
  const fetchMemberIntents = useCallback(async () => {
    try {
      setLoadingIndexed(true);
      const intents = await indexesService.getMemberIntents(index.id);
      setIndexedIntents(intents);
    } catch (err) {
      console.error('Failed to fetch member intents:', err);
    } finally {
      setLoadingIndexed(false);
    }
  }, [indexesService, index.id]);

  // Fetch queue status
  const fetchQueueStatus = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const response = await api.get<{ jobCounts?: Record<string, { pending: number; active: number; completed: number }>; totalPending?: number }>('/queue/status');
      // Map the response from jobCounts to friendly property names
      if (response?.jobCounts) {
        const status: QueueStatus = {
          indexIntent: response.jobCounts['index_intent'] || { pending: 0, active: 0, completed: 0 },
          generateIntents: response.jobCounts['generate_intents'] || { pending: 0, active: 0, completed: 0 },
          semanticRelevancy: response.jobCounts['broker_semantic_relevancy'] || { pending: 0, active: 0, completed: 0 },
          totalPending: response.totalPending || 0
        };
        setQueueStatus(status);
      }
    } catch (error) {
      if (!options?.silent) {
        console.error('Failed to fetch queue status:', error);
      }
      // Set default state on error
      setQueueStatus(null);
    }
  }, [api]);

  // Fetch tag suggestions
  const fetchTagSuggestions = useCallback(async () => {
    try {
      setLoadingSuggestions(true);
      const result = await intentsService.suggestTags(
        '',
        index.id,
        5
      );
      setSuggestedTags(result.suggestions);
      setSuggestionsFetched(true);
    } catch (err) {
      console.error('Failed to fetch tag suggestions:', err);
      setSuggestedTags([]);
      setSuggestionsFetched(true);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [intentsService, index.id]);

  // Load data on mount
  useEffect(() => {
    if (open) {
      fetchMemberSettings();
      fetchMemberIntents();
      fetchQueueStatus();
      setUsedTags(new Set());
      setSuggestedTags([]);
      setSuggestionsFetched(false);
    }
  }, [open, fetchMemberSettings, fetchMemberIntents, fetchQueueStatus]);

  // Auto-refresh intents and queue status every second
  useEffect(() => {
    if (!open) return;
    
    const interval = setInterval(async () => {
      try {
        const intents = await indexesService.getMemberIntents(index.id);
        setIndexedIntents(intents);
        void fetchQueueStatus({ silent: true });
      } catch (err) {
        console.error('Failed to refresh member intents:', err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [indexesService, index.id, open, fetchQueueStatus]);

  // Fetch tag suggestions once when modal opens
  useEffect(() => {
    if (open && !suggestionsFetched && !loadingSuggestions) {
      fetchTagSuggestions();
    }
  }, [open, suggestionsFetched, loadingSuggestions, fetchTagSuggestions]);


  const handleLeaveIndexClick = () => {
    setShowConfirmLeave(true);
  };

  const handleConfirmLeave = async () => {
    try {
      setIsLeaving(true);
      setShowConfirmLeave(false);
      await api.post(`/indexes/${index.id}/leave`, {});
      removeIndex(index.id); // Update global state
      success(`Successfully left ${index.title}`);
      onOpenChange(false);
    } catch {
      error('Failed to leave index');
    } finally {
      setIsLeaving(false);
    }
  };

  const handleCancelLeave = () => {
    setShowConfirmLeave(false);
  };

  const handleSavePrompt = async () => {
    try {
      setIsSavingPrompt(true);
      await api.put(`/indexes/${index.id}/member-settings`, { 
        prompt: prompt.trim() || null,
        autoAssign: true // Temporary: always set to true for now
      });
      success('Member settings updated');
      setOriginalPrompt(prompt);
      await fetchMemberSettings();
    } catch {
      error('Failed to save settings');
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleRemoveIntent = async (intentId: string) => {
    setRemovingIntents(prev => new Set([...prev, intentId]));
    try {
      await indexesService.removeMemberIntent(index.id, intentId);
      success('Intent removed from index');
      await fetchMemberIntents();
    } catch {
      error('Failed to remove intent from index');
    } finally {
      setRemovingIntents(prev => {
        const newSet = new Set(prev);
        newSet.delete(intentId);
        return newSet;
      });
    }
  };


  const handleCancel = () => {
    setPrompt(originalPrompt);
  };

  const handleTagClick = (tagValue: string) => {
    const separator = prompt.trim() ? ', ' : '';
    setPrompt(prompt + separator + tagValue);
    setUsedTags(prev => new Set([...prev, tagValue]));
  };

  // Get visible tags
  const visibleTags = suggestedTags
    .filter(suggestion => !usedTags.has(suggestion.value))
    .slice(0, 5);


  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-in fade-in duration-200" />
        <Dialog.Content className="fixed inset-0 w-screen h-[85dvh] p-4 rounded-none bg-[#FAFAFA] border border-[#E0E0E0] text-gray-900 shadow-lg focus:outline-none overflow-hidden overflow-x-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[96vw] sm:h-auto sm:max-h-[72vh] sm:min-h-[500px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6 transition-all sm:duration-300 sm:max-w-[1020px]">
          <div className="flex items-center justify-between mb-8 sm:mb-6 sticky top-0 bg-[#FAFAFA] z-10">
            <Dialog.Title className="text-xl font-bold text-[#333] font-ibm-plex-mono">
              {index.title} - Member Settings
            </Dialog.Title>
            {!memberSettings?.isOwner && (
              <Button
                onClick={handleLeaveIndexClick}
                disabled={isLeaving}
                variant="outline"
                className="font-ibm-plex-mono text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
              >
                {isLeaving ? 'Leaving...' : 'Leave index'}
              </Button>
            )}
          </div>

          <div className="lg:hidden mb-3 flex items-center gap-2 rounded-lg bg-[#F2F2F2] p-1">
            <button
              type="button"
              className={`relative flex-1 px-3 py-1.5 text-xs font-ibm-plex-mono rounded-md transition-colors ${activeMobileSection === 'settings' ? 'bg-white text-[#222] shadow-sm' : 'text-[#555]'}`}
              onClick={() => setActiveMobileSection('settings')}
            >
              Settings
            </button>
            <button
              type="button"
              className={`relative flex-1 px-3 py-1.5 text-xs font-ibm-plex-mono rounded-md transition-colors ${activeMobileSection === 'intents' ? 'bg-white text-[#222] shadow-sm' : 'text-[#555]'}`}
              onClick={() => setActiveMobileSection('intents')}
            >
              Intents
              <span className="ml-1 text-[10px] text-[#666]">({indexedIntents.length})</span>
            </button>
          </div>

          <div className="relative flex flex-col lg:flex-row gap-3.5 lg:gap-4 flex-1 overflow-hidden">
            <div className={`${activeMobileSection === 'settings' ? 'block' : 'hidden'} lg:block lg:w-[620px] lg:flex-shrink-0 min-w-0`}>
              <div className="space-y-2 sm:space-y-3 lg:space-y-4">
                {/* Member Settings Section */}
                <section className="pr-2">
                  <div className="mb-3">
                    <h3 className="text-sm font-medium font-ibm-plex-mono text-[#333]">
                      Instruct what to share and what to keep private
                    </h3>
                  </div>

                  <div>
                    <div className="relative border border-[#E0E0E0] rounded-lg p-3">
                      <textarea
                        id="prompt"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="e.g., Share my Slack intents about AI research, include my Notion notes about collaboration, but keep personal documents private..."
                        className="w-full text-[#333] resize-none h-25 text-sm font-ibm-plex-mono outline-none bg-transparent"
                      />
                      
                      {/* Tag suggestions */}
                      <div className="flex gap-2 mt-2 overflow-hidden min-h-[28px] items-center">
                        {loadingSuggestions ? (
                          <div className="text-xs text-[#666] italic flex items-center gap-2">
                            <svg className="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 16 16" fill="none">
                              <circle className="opacity-25" cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2" />
                              <path className="opacity-75" fill="currentColor" d="M15 8A7 7 0 1 1 8 1v2a5 5 0 1 0 5 5h2z"/>
                            </svg>
                            finding inspirations...
                          </div>
                        ) : visibleTags.length > 0 ? (
                          visibleTags.map((suggestion) => (
                            <button
                              key={suggestion.value}
                              onClick={() => handleTagClick(suggestion.value)}
                              className="px-3 py-1 bg-gray-800 text-white rounded-full text-xs font-ibm-plex-mono hover:bg-gray-700 transition-colors cursor-pointer flex-shrink-0 flex items-center gap-1"
                              title={`Score: ${suggestion.score.toFixed(2)}`}
                            >
                              <Plus className="h-3 w-3" />
                              {suggestion.value}
                            </button>
                          ))
                        ) : null}
                      </div>
                    </div>
                    
                    {/* Update/Discard buttons */}
                    <div className="flex gap-2 mt-3 justify-end">
                      {hasUnsavedChanges && !isSavingPrompt && (
                        <Button
                          variant="outline"
                          onClick={handleCancel}
                          className="font-ibm-plex-mono"
                        >
                          Discard
                        </Button>
                      )}
                      <Button
                        onClick={handleSavePrompt}
                        disabled={isSavingPrompt || !hasUnsavedChanges}
                        className="font-ibm-plex-mono"
                      >
                        {isSavingPrompt ? 'Updating...' : 'Update'}
                      </Button>
                    </div>
                  </div>
                </section>

              </div>
            </div>

            {/* Intents Panel */}
            <aside className={`${activeMobileSection === 'intents' ? 'flex flex-col' : 'hidden'} lg:flex lg:flex-col w-full pr-3 flex-shrink-0 rounded-lg bg-[#FAFAFA] shadow-[0_1px_3px_rgba(15,23,42,0.08)] max-h-[70vh] lg:max-h-none overflow-x-hidden lg:w-[340px]`}>
              <div className="flex items-center justify-between pb-2 border-b border-[#E4E4E4] pl-3 pr-3">
                <h3 className="text-sm font-bold font-ibm-plex-mono text-[#333]">My Intents in this Index</h3>
                <span className="text-xs text-[#666] font-ibm-plex-mono">{indexedIntents.length}</span>
              </div>
              
              <div className="pt-3 flex-1 pr-3 space-y-3 p-3 pt-0 overflow-y-scroll">
                {/* Queue Status */}
                {queueStatus?.indexIntent && ((queueStatus.indexIntent.pending ?? 0) > 0 || (queueStatus.indexIntent.active ?? 0) > 0) && (
                  <div className="mb-3 text-[10px] font-ibm-plex-mono text-[#666] bg-[#F8F9FA] px-2 py-1.5 rounded-sm border border-[#E0E0E0]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1">
                        {(queueStatus.indexIntent.active ?? 0) > 0 && (
                          <span className="h-1.5 w-1.5 bg-[#0A8F5A] rounded-full animate-pulse"></span>
                        )}
                        Indexing Intents
                      </span>
                      <span className="font-medium">
                        {(() => {
                          const total = (queueStatus.indexIntent.active ?? 0) + (queueStatus.indexIntent.pending ?? 0);
                          return `${total} task${total === 1 ? '' : 's'}`;
                        })()}
                      </span>
                    </div>
                  </div>
                )}
                <IntentList
                  intents={indexedIntents}
                  isLoading={loadingIndexed}
                  emptyMessage="No intents indexed yet"
                  onRemoveIntent={(intent) => handleRemoveIntent(intent.id)}
                  removingIntentIds={removingIntents}
                />
              </div>
            </aside>
          </div>
        </Dialog.Content>

        {/* Confirmation Modal */}
        {showConfirmLeave && (
          <Dialog.Root open={showConfirmLeave} onOpenChange={setShowConfirmLeave}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-black/60 animate-in fade-in duration-200 z-50" />
              <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-[420px] bg-[#FAFAFA] border border-[#E0E0E0] rounded-lg p-6 shadow-xl focus:outline-none animate-in fade-in zoom-in-95 duration-200 z-50">
                <Dialog.Title className="text-lg font-bold text-[#333] font-ibm-plex-mono mb-3">
                  Leave Index
                </Dialog.Title>
                <Dialog.Description className="text-sm text-[#555] font-ibm-plex-mono mb-6 leading-relaxed">
                  Are you sure you want to leave <span className="font-semibold text-[#333]">&quot;{index.title}&quot;</span>? This action cannot be undone and you will lose access to all shared intents in this index.
                </Dialog.Description>
                <div className="flex gap-3 justify-end">
                  <Button
                    onClick={handleCancelLeave}
                    variant="outline"
                    className="font-ibm-plex-mono"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirmLeave}
                    disabled={isLeaving}
                    className="font-ibm-plex-mono bg-red-600 hover:bg-red-700 text-white"
                  >
                    {isLeaving ? 'Leaving...' : 'Leave Index'}
                  </Button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
