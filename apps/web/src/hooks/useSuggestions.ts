import { useState, useEffect, useCallback, useMemo } from 'react';

export interface Suggestion {
  label: string;
  type: 'direct' | 'prompt';
  followupText?: string;
  prefill?: string;
}

// Static starter suggestions - shown when no conversation yet (no context from backend)
export const STATIC_SUGGESTIONS: Suggestion[] = [
  { label: 'Find collaborators', type: 'direct', followupText: 'Find collaborators for my work' },
  { label: 'Looking for investors', type: 'direct', followupText: 'Looking for investors' },
  { label: 'Seeking co-founders', type: 'direct', followupText: 'Seeking co-founders' },
  { label: 'Need technical help with...', type: 'prompt', prefill: 'I need technical help with ' },
  { label: 'Want to connect with...', type: 'prompt', prefill: 'I want to connect with people who ' },
];

interface UseSuggestionsOptions {
  /** Context-aware suggestions from chat done event (useAIChat().suggestions) */
  contextSuggestions?: Suggestion[] | null;
  /** Whether there are messages in the conversation; when true and contextSuggestions exist, use them */
  hasMessages?: boolean;
  /** Intent ID for dynamic refinement suggestions (e.g. intent detail view) */
  intentId?: string;
  /** Selected index ID to filter/contextualize suggestions */
  networkId?: string | null;
  /** Whether to fetch suggestions (e.g., on focus) */
  enabled?: boolean;
}

interface UseSuggestionsResult {
  suggestions: Suggestion[];
  isLoading: boolean;
  /** Refresh suggestions (e.g., after refinement); no-op when using context suggestions */
  refresh: () => Promise<void>;
}

export function useSuggestions({
  contextSuggestions,
  hasMessages = false,
  intentId,
  networkId,
  enabled = true,
}: UseSuggestionsOptions = {}): UseSuggestionsResult {
  const [fetchedSuggestions, setFetchedSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    if (!enabled) return;

    if (intentId) {
      setIsLoading(true);
      try {
        // TODO: Replace with actual API call when intent suggestions API is ready
        await new Promise(resolve => setTimeout(resolve, 300));
        const mockDynamicSuggestions: Suggestion[] = [
          { label: 'Add more details', type: 'prompt', prefill: 'I also want to mention that ' },
          { label: 'Be more specific', type: 'prompt', prefill: 'Specifically, I\'m looking for ' },
          { label: 'Add timeline', type: 'direct', followupText: 'This is urgent, within the next month' },
        ];
        setFetchedSuggestions(mockDynamicSuggestions);
      } catch (error) {
        console.error('Failed to fetch suggestions:', error);
        setFetchedSuggestions([]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setFetchedSuggestions(STATIC_SUGGESTIONS);
  }, [intentId, networkId, enabled]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  // Prefer context suggestions from chat done event when we have messages; otherwise static/fetched
  const suggestions = useMemo(() => {
    if (!enabled) return [];
    if (hasMessages && contextSuggestions != null && contextSuggestions.length > 0) {
      return contextSuggestions;
    }
    return fetchedSuggestions.length > 0 ? fetchedSuggestions : STATIC_SUGGESTIONS;
  }, [enabled, hasMessages, contextSuggestions, fetchedSuggestions]);

  return {
    suggestions,
    isLoading,
    refresh: fetchSuggestions,
  };
}
