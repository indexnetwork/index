'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Index } from '@/lib/types';
import { X, Plus } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { createIntentsService } from '@/services/intents';

interface MemberIntent {
  id: string;
  payload: string;
  summary?: string;
  createdAt: string;
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

  const { success, error } = useNotifications();
  const api = useAuthenticatedAPI();
  const intentsService = useMemo(() => createIntentsService(api), [api]);

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
      const response = await api.get<{ intents: MemberIntent[] }>(
        `/indexes/${index.id}/member-intents`
      );
      setIndexedIntents(response.intents);
    } catch (err) {
      console.error('Failed to fetch member intents:', err);
    } finally {
      setLoadingIndexed(false);
    }
  }, [api, index.id]);

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
      setUsedTags(new Set());
      setSuggestedTags([]);
      setSuggestionsFetched(false);
    }
  }, [open, fetchMemberSettings, fetchMemberIntents]);

  // Auto-refresh intents every 3 seconds
  useEffect(() => {
    if (!open) return;
    
    const interval = setInterval(() => {
      api.get<{ intents: MemberIntent[] }>(`/indexes/${index.id}/member-intents`)
        .then(response => setIndexedIntents(response.intents))
        .catch(err => console.error('Failed to refresh member intents:', err));
    }, 2000);

    return () => clearInterval(interval);
  }, [api, index.id, open]);

  // Fetch tag suggestions once when modal opens
  useEffect(() => {
    if (open && !suggestionsFetched && !loadingSuggestions) {
      fetchTagSuggestions();
    }
  }, [open, suggestionsFetched, loadingSuggestions, fetchTagSuggestions]);


  const handleLeaveIndex = async () => {
    try {
      setIsLeaving(true);
      await api.post(`/indexes/${index.id}/leave`, {});
      success(`Successfully left ${index.title}`);
      onOpenChange(false);
    } catch {
      error('Failed to leave index');
    } finally {
      setIsLeaving(false);
    }
  };

  const handleSavePrompt = async () => {
    try {
      setIsSavingPrompt(true);
      await api.put(`/indexes/${index.id}/member-settings`, { 
        prompt: prompt.trim() || null,
        autoAssign: true // Temporary: always set to true for now
      });
      success('Settings saved');
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
      await api.delete(`/indexes/${index.id}/member-intents/${intentId}`);
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

  // Group intents by date (similar to LibraryModal)
  const intentsByDate = useMemo(() => {
    const msPerDay = 24 * 60 * 60 * 1000;
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const ordered = [...indexedIntents].sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const sections: Array<{ label: string; key: string; items: MemberIntent[] }> = [];
    const bucket = new Map<string, { label: string; items: MemberIntent[] }>();

    for (const intent of ordered) {
      const createdDate = new Date(intent.createdAt);
      if (Number.isNaN(createdDate.getTime())) {
        if (!bucket.has('unknown')) bucket.set('unknown', { label: 'Undated', items: [] });
        bucket.get('unknown')!.items.push(intent);
        continue;
      }
      const startOfCreated = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());
      const diff = Math.round((startOfToday.getTime() - startOfCreated.getTime()) / msPerDay);
      let label: string;
      if (diff === 0) label = 'Today';
      else if (diff === 1) label = 'Yesterday';
      else {
        const dateStr = createdDate.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          year: createdDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
        });
        label = dateStr;
      }
      const key = `${startOfCreated.getTime()}-${label}`;
      if (!bucket.has(key)) bucket.set(key, { label, items: [] });
      bucket.get(key)!.items.push(intent);
    }

    const sortedKeys = Array.from(bucket.keys()).sort((a, b) => {
      const [timeA] = a.split('-');
      const [timeB] = b.split('-');
      return Number(timeB) - Number(timeA);
    });

    for (const key of sortedKeys) {
      const entry = bucket.get(key);
      if (entry) sections.push({ label: entry.label, key, items: entry.items });
    }

    return sections;
  }, [indexedIntents]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-in fade-in duration-200" />
        <Dialog.Content className="fixed inset-0 w-screen h-[100dvh] p-4 rounded-none bg-[#FAFAFA] border border-[#E0E0E0] text-gray-900 shadow-lg focus:outline-none overflow-hidden overflow-x-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[96vw] sm:h-auto sm:max-h-[85vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6 transition-all sm:duration-300 sm:max-w-[1020px]">
          <div className="flex items-center justify-between mb-4 sm:mb-6 sticky top-0 bg-[#FAFAFA] z-10">
            <Dialog.Title className="text-xl font-bold text-[#333] font-ibm-plex-mono">
              {index.title} - Member Settings
            </Dialog.Title>
            <Button
              onClick={handleLeaveIndex}
              disabled={isLeaving}
              variant="outline"
              className="font-ibm-plex-mono text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
            >
              {isLeaving ? 'Leaving...' : 'Leave index'}
            </Button>
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
                  <div className="mt-3 mb-3">
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
                        placeholder="e.g., Share my AI-related intents like research papers and projects, but keep personal details private..."
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
                      {hasUnsavedChanges && (
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
            <aside className={`${activeMobileSection === 'intents' ? 'flex flex-col' : 'hidden'} lg:flex lg:flex-col w-full flex-shrink-0 rounded-lg bg-[#FAFAFA] shadow-[0_1px_3px_rgba(15,23,42,0.08)] max-h-[70vh] lg:max-h-none overflow-y-auto overflow-x-hidden lg:w-[340px]`}>
              <div className="flex items-center justify-between pb-2 border-b border-[#E4E4E4] pl-3 pr-3">
                <h3 className="text-sm font-bold font-ibm-plex-mono text-[#333]">My Intents</h3>
                <span className="text-xs text-[#666] font-ibm-plex-mono">{indexedIntents.length}</span>
              </div>
              
              <div className="mt-3 flex-1 pr-3 space-y-3 p-3 pt-0">
                {loadingIndexed ? (
                  <div className="flex items-center justify-center py-6">
                    <span className="h-6 w-6 border-2 border-[#CCCCCC] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : intentsByDate.length === 0 ? (
                  <div className="text-xs text-[#666] font-ibm-plex-mono py-4 text-center">
                    <p>No intents indexed yet</p>
                  </div>
                ) : (
                  intentsByDate.map((section) => (
                    <div key={section.key} className="space-y-2">
                      <div className="w-full flex items-center justify-between text-xs font-ibm-plex-mono font-medium text-[#444] border-b border-[#E8E8E8] pb-1">
                        <span>{section.label}</span>
                        <span className="text-[10px] text-[#777]">{section.items.length}</span>
                      </div>
                      <div className="space-y-2">
                        {section.items.map((intent) => {
                          const summary = (intent.summary && intent.summary.trim().length > 0 ? intent.summary : intent.payload).trim();
                          const createdAt = new Date(intent.createdAt);
                          const createdLabel = Number.isNaN(createdAt.getTime()) ? null : createdAt.toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric'
                          });

                          return (
                            <div key={intent.id} className="group relative border border-[#E0E0E0] bg-white hover:border-[#CCCCCC] rounded-lg px-2.5 py-2 transition-colors md:px-3 md:py-2.5">
                              {createdLabel && (
                                <div className="flex items-center justify-end gap-2 mb-1">
                                  <span className="flex items-center gap-1 text-[10px] text-[#777] font-ibm-plex-mono whitespace-nowrap">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#777]">
                                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                      <line x1="16" y1="2" x2="16" y2="6" />
                                      <line x1="8" y1="2" x2="8" y2="6" />
                                      <line x1="3" y1="10" x2="21" y2="10" />
                                    </svg>
                                    {createdLabel}
                                  </span>
                                </div>
                              )}
                              <div className="mt-1 text-xs text-[#333] font-medium leading-snug line-clamp-3 break-words">{summary}</div>
                              <div className="mt-2 flex items-center justify-end gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:absolute lg:right-2 lg:bottom-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleRemoveIntent(intent.id);
                                  }}
                                  disabled={removingIntents.has(intent.id)}
                                  className="h-6 w-6 grid place-items-center rounded-md bg-[#F2F2F2] text-red-600 hover:text-red-700 hover:bg-[#E6E6E6]"
                                  aria-label="Remove intent"
                                >
                                  {removingIntents.has(intent.id) ? (
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
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
