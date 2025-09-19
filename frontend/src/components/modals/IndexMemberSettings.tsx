'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { Index } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { X, Plus } from 'lucide-react';
import { createIntentsService } from '@/services/intents';

interface IndexMemberSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: Index;
}

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
  tag: string;
  relevanceScore: number;
  relatedIntentIds: string[];
  description?: string;
}

export default function IndexMemberSettings({ open, onOpenChange, index }: IndexMemberSettingsProps) {
  const [isLeaving, setIsLeaving] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [memberSettings, setMemberSettings] = useState<MemberSettings | null>(null);
  const [indexedIntents, setIndexedIntents] = useState<MemberIntent[]>([]);
  const [loadingIndexed, setLoadingIndexed] = useState(false);
  const [addingIntents, setAddingIntents] = useState<Set<string>>(new Set());
  const [removingIntents, setRemovingIntents] = useState<Set<string>>(new Set());
  const [removingAll, setRemovingAll] = useState(false);
  const [usedTags, setUsedTags] = useState<Set<string>>(new Set());
  const [suggestedTags, setSuggestedTags] = useState<TagSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const { success, error } = useNotifications();
  const api = useAuthenticatedAPI();
  const intentsService = useMemo(() => createIntentsService(api), [api]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = prompt !== originalPrompt;

  // Fetch member settings when modal opens
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
  const fetchMemberIntents = useCallback(async (tab: 'indexed') => {
    try {
      if (tab === 'indexed') {
        setLoadingIndexed(true);
        const response = await api.get<{ intents: MemberIntent[] }>(
          `/indexes/${index.id}/member-intents`
        );
        setIndexedIntents(response.intents);
      }
    } catch (err) {
      console.error('Failed to fetch member intents:', err);
    } finally {
      if (tab === 'indexed') {
        setLoadingIndexed(false);
      }
    }
  }, [api, index.id]);

  // Fetch tag suggestions (only based on intents, not prompt)
  const fetchTagSuggestions = useCallback(async () => {
    try {
      setLoadingSuggestions(true);
      const result = await intentsService.suggestTags(
        '', // Empty prompt to get general intent themes
        index.id,
        8 // Get more suggestions since they're static
      );
      setSuggestedTags(result.suggestions);
    } catch (err) {
      console.error('Failed to fetch tag suggestions:', err);
      setSuggestedTags([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [intentsService, index.id]);

  // Load data when modal opens
  useEffect(() => {
    if (open) {
      fetchMemberSettings();
      // Fetch indexed intents when modal opens
      fetchMemberIntents('indexed');
      // Reset used tags when modal opens
      setUsedTags(new Set());
      // Clear suggestions
      setSuggestedTags([]);
    }
  }, [open, fetchMemberSettings, fetchMemberIntents]);

  // Fetch tag suggestions once when intents are loaded
  useEffect(() => {
    if (open && indexedIntents.length > 0 && suggestedTags.length === 0) {
      fetchTagSuggestions();
    }
  }, [open, indexedIntents.length, fetchTagSuggestions, suggestedTags.length]);

  const handleLeaveIndex = async () => {
    try {
      setIsLeaving(true);
      await api.post(`/indexes/${index.id}/leave`, {});
      success(`Successfully left ${index.title}`);
      onOpenChange(false);
    } catch (err) {
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
        autoAssign: memberSettings?.isOwner ? undefined : false 
      });
      success('Settings saved');
      setOriginalPrompt(prompt); // Update original prompt after saving
      await fetchMemberSettings(); // Refresh settings
    } catch (err) {
      error('Failed to save settings');
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleAddIntent = async (intentId: string) => {
    setAddingIntents(prev => new Set([...prev, intentId]));
    try {
      await api.post(`/indexes/${index.id}/member-intents/${intentId}`, {});
      success('Intent added to index');
      // Refresh intents
      await fetchMemberIntents('indexed');
    } catch (err) {
      error('Failed to add intent to index');
    } finally {
      setAddingIntents(prev => {
        const newSet = new Set(prev);
        newSet.delete(intentId);
        return newSet;
      });
    }
  };

  const handleRemoveIntent = async (intentId: string) => {
    setRemovingIntents(prev => new Set([...prev, intentId]));
    try {
      await api.delete(`/indexes/${index.id}/member-intents/${intentId}`);
      success('Intent removed from index');
      // Refresh intents
      await fetchMemberIntents('indexed');
    } catch (err) {
      error('Failed to remove intent from index');
    } finally {
      setRemovingIntents(prev => {
        const newSet = new Set(prev);
        newSet.delete(intentId);
        return newSet;
      });
    }
  };

  const handleRemoveAllIntents = async () => {
    try {
      setRemovingAll(true);
      // Remove all intents one by one
      await Promise.all(indexedIntents.map(intent => 
        api.delete(`/indexes/${index.id}/member-intents/${intent.id}`)
      ));
      success('All intents removed from index');
      // Refresh intents
      await fetchMemberIntents('indexed');
    } catch (err) {
      error('Failed to remove all intents');
    } finally {
      setRemovingAll(false);
    }
  };

  const handleCancel = () => {
    setPrompt(originalPrompt);
  };

  const handleTagClick = (tag: string) => {
    // Add the tag to the prompt textarea
    const separator = prompt.trim() ? ', ' : '';
    setPrompt(prompt + separator + tag);
    // Mark this tag as used
    setUsedTags(prev => new Set([...prev, tag]));
  };

  // Get visible tags (first 5 unused tags from suggestions)
  const visibleTags = suggestedTags
    .filter(suggestion => !usedTags.has(suggestion.tag))
    .slice(0, 5);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">{index.title}</Dialog.Title>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleLeaveIndex}
                disabled={isLeaving}
                variant="outline"
                size="sm"
                className="font-ibm-plex-mono"
              >
                {isLeaving ? 'Leaving...' : 'Leave this index'}
              </Button>
            </div>
          </div>
          
          <Dialog.Close 
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100"
            onClick={(e) => {
              if (hasUnsavedChanges) {
                e.preventDefault();
                if (confirm('You have unsaved changes. Are you sure you want to close?')) {
                  onOpenChange(false);
                }
              }
            }}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        
        <div className="space-y-6">
          <div>
            <div className="mt-12 mb-3 flex items-center justify-between min-h-[32px]">
              <h3 className="text-sm font-medium font-ibm-plex-mono text-black">
                Instruct what to share and what to keep private
              </h3>
              {/* Save/Discard buttons aligned to the right of the label */}
              {hasUnsavedChanges && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancel}
                    className="font-ibm-plex-mono"
                  >
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSavePrompt}
                    disabled={isSavingPrompt}
                    className="font-ibm-plex-mono"
                  >
                    {isSavingPrompt ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              )}
            </div>

            <div>
              <div className="relative border border-gray-300 rounded-lg p-3">
                <textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., Share my AI-related intents like research papers and projects, but keep personal details private..."
                  className="w-full text-gray-900 resize-none h-20 text-sm font-ibm-plex-mono outline-none"
                />
                
                {/* Tag suggestions based on your intents */}
                <div className="flex gap-2 mt-2 overflow-hidden min-h-[28px] items-center">
                  {loadingSuggestions ? (
                    <div className="text-xs text-gray-500 italic">Analyzing your intents...</div>
                  ) : visibleTags.length > 0 ? (
                    visibleTags.map((suggestion) => (
                      <button
                        key={suggestion.tag}
                        onClick={() => handleTagClick(suggestion.tag)}
                        className="px-3 py-1 bg-gray-800 text-white rounded-full text-xs font-ibm-plex-mono hover:bg-gray-700 transition-colors cursor-pointer flex-shrink-0 flex items-center gap-1"
                        title={suggestion.description || `Based on ${suggestion.relatedIntentIds.length} of your intents`}
                      >
                        <Plus className="h-3 w-3" />
                        {suggestion.tag}
                      </button>
                    ))
                  ) : indexedIntents.length === 0 ? (
                    <div className="text-xs text-gray-500 italic">Add intents to see tag suggestions</div>
                  ) : null}
                </div>
              </div>
            </div>
            
            <div className="mt-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-medium font-ibm-plex-mono text-black">
                    My intents in {memberSettings?.indexTitle || index.title} {loadingIndexed ? '' : `(${indexedIntents.length})`}
                  </h3>
                  {indexedIntents.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRemoveAllIntents}
                      disabled={removingAll}
                      className="font-ibm-plex-mono text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                    >
                      {removingAll ? 'Removing...' : 'Remove all'}
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  {loadingIndexed ? (
                    <div className="text-center py-4 text-gray-500">Loading...</div>
                  ) : (
                    indexedIntents.length > 0 ? (
                      indexedIntents.map((intent) => (
                        <div
                          key={intent.id}
                          className="group flex items-center justify-between p-3 px-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="text-xs font-ibm-plex-mono font-medium text-gray-900">{intent.summary || intent.payload}</h4>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleRemoveIntent(intent.id);
                            }}
                            disabled={removingIntents.has(intent.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            {removingIntents.has(intent.id) ? (
                              <div className="h-4 w-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <div>
                                Remove
                              </div>
                            )}
                          </Button>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4 text-gray-500">No intents indexed yet</div>
                    )
                  )}
                </div>
              </div>
          </div>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
