'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { Index } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { createIntentsService } from '@/services/intents';
import { MemberIntent, MemberSettings, TagSuggestion } from './types.js';

interface MemberSettingsTabProps {
  index: Index;
  onLeave: () => void;
}

export default function MemberSettingsTab({ index, onLeave }: MemberSettingsTabProps) {
  const [isLeaving, setIsLeaving] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [memberSettings, setMemberSettings] = useState<MemberSettings | null>(null);
  const [indexedIntents, setIndexedIntents] = useState<MemberIntent[]>([]);
  const [loadingIndexed, setLoadingIndexed] = useState(false);
  const [removingIntents, setRemovingIntents] = useState<Set<string>>(new Set());
  const [removingAll, setRemovingAll] = useState(false);
  const [usedTags, setUsedTags] = useState<Set<string>>(new Set());
  const [suggestedTags, setSuggestedTags] = useState<TagSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsFetched, setSuggestionsFetched] = useState(false);

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
    fetchMemberSettings();
    fetchMemberIntents();
    setUsedTags(new Set());
    setSuggestedTags([]);
    setSuggestionsFetched(false);
  }, [fetchMemberSettings, fetchMemberIntents]);

  // Auto-refresh intents every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      api.get<{ intents: MemberIntent[] }>(`/indexes/${index.id}/member-intents`)
        .then(response => setIndexedIntents(response.intents))
        .catch(err => console.error('Failed to refresh member intents:', err));
    }, 2000);

    return () => clearInterval(interval);
  }, [api, index.id]);

  // Fetch tag suggestions once when intents are loaded
  useEffect(() => {
    if (loadingIndexed) return; // Wait for intents to finish loading
    if (loadingSuggestions) return; // Don't make additional requests while already loading
    if (suggestionsFetched) return; // Don't refetch if we already have results (even if empty)
    if (indexedIntents.length > 0) {
      fetchTagSuggestions();
    }
  }, [indexedIntents, loadingIndexed, loadingSuggestions, suggestionsFetched]); // Removed fetchTagSuggestions to prevent infinite loop

  const handleLeaveIndex = async () => {
    try {
      setIsLeaving(true);
      await api.post(`/indexes/${index.id}/leave`, {});
      success(`Successfully left ${index.title}`);
      onLeave();
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

  const handleRemoveAllIntents = async () => {
    try {
      setRemovingAll(true);
      await Promise.all(indexedIntents.map(intent => 
        api.delete(`/indexes/${index.id}/member-intents/${intent.id}`)
      ));
      success('All intents removed from index');
      await fetchMemberIntents();
    } catch {
      error('Failed to remove all intents');
    } finally {
      setRemovingAll(false);
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
    <div className="flex flex-col h-full">
      {/* Fixed header section */}
      <div className="flex-shrink-0">
        <div className="mt-3 mb-3 flex items-center justify-between min-h-[32px]">
          <h3 className="text-sm font-medium font-ibm-plex-mono text-black">
            Instruct what to share and what to keep private
          </h3>
          <div className="flex gap-2">
            {hasUnsavedChanges && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                className="font-ibm-plex-mono"
              >
                Discard
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSavePrompt}
              disabled={isSavingPrompt || !hasUnsavedChanges}
              className="font-ibm-plex-mono"
            >
              {isSavingPrompt ? 'Updating...' : 'Update'}
            </Button>
          </div>
        </div>

        <div>
          <div className="relative border border-gray-300 rounded-lg p-3">
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Share my AI-related intents like research papers and projects, but keep personal details private..."
              className="w-full text-gray-900 resize-none h-15 text-sm font-ibm-plex-mono outline-none"
            />
            
            {/* Tag suggestions */}
            <div className="flex gap-2 mt-2 overflow-hidden min-h-[28px] items-center">
              {loadingSuggestions ? (
                <div className="text-xs text-gray-500 italic flex items-center gap-2">
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
        </div>
      </div>

      {/* Fixed intent list header */}
      <div className="flex-shrink-0 mt-6 mb-4 flex items-center justify-between">
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

      {/* Scrollable intent list */}
      <div className=" overflow-y-scroll min-h-0 max-h-[300px]">
        <div className="space-y-2 pr-2">
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
                      <div>Remove</div>
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

      {/* Leave button at bottom */}
      <div className="flex-shrink-0 mt-4 pt-4 border-t border-gray-200">
        <Button
          onClick={handleLeaveIndex}
          disabled={isLeaving}
          variant="outline"
          size="sm"
          className="font-ibm-plex-mono text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
        >
          {isLeaving ? 'Leaving...' : 'Leave this index'}
        </Button>
      </div>
    </div>
  );
}
