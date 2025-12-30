'use client';

import { useState, useEffect, useMemo } from 'react';
import { useIntents } from '@/contexts/APIContext';
import { useIndexFilter } from '@/contexts/IndexFilterContext';
import { useDiscoveryFilter } from '@/contexts/DiscoveryFilterContext';
import { Settings } from 'lucide-react';
import { Intent } from '@/lib/types';
import { useRouter } from 'next/navigation';

export default function LatestIntents() {
  const [intents, setIntents] = useState<Intent[]>([]);
  const [loading, setLoading] = useState(true);
  const intentsService = useIntents();
  const { selectedIndexIds } = useIndexFilter();
  const { discoveryIntents, setDiscoveryIntents } = useDiscoveryFilter();
  const router = useRouter();

  useEffect(() => {
    const fetchIntents = async () => {
      setLoading(true);
      try {
        const response = await intentsService.getIntents(1, 10, false, selectedIndexIds.length > 0 ? selectedIndexIds : undefined);
        if (response.data) {
          setIntents(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch intents:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchIntents();
    
    // Refetch when discovery intents change (new intent created)
    let timeoutId: NodeJS.Timeout | null = null;
    if (discoveryIntents && discoveryIntents.length > 0) {
      // Small delay to ensure backend has processed the new intent
      timeoutId = setTimeout(() => {
        fetchIntents();
      }, 500);
    }
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [intentsService, selectedIndexIds, discoveryIntents]);

  // Add active discovery intent to the list if it's not already there
  const allIntents = useMemo(() => {
    if (!discoveryIntents || discoveryIntents.length === 0) {
      return intents;
    }

    const activeIntent = discoveryIntents[0];
    // Check if active intent is already in the list
    const isAlreadyInList = intents.some(intent => intent.id === activeIntent.id);
    
    if (isAlreadyInList) {
      // Move active intent to the top
      const otherIntents = intents.filter(intent => intent.id !== activeIntent.id);
      return [intents.find(intent => intent.id === activeIntent.id)!, ...otherIntents];
    } else {
      // Add active intent at the top
      const activeIntentAsIntent: Intent = {
        id: activeIntent.id,
        payload: activeIntent.payload,
        summary: activeIntent.summary || null,
        createdAt: activeIntent.createdAt,
        sourceType: undefined,
        sourceId: undefined,
        sourceName: undefined,
        sourceValue: null,
        sourceMeta: null
      };
      return [activeIntentAsIntent, ...intents];
    }
  }, [intents, discoveryIntents]);

  const getDisplayText = (intent: Intent | { id: string; payload: string; summary?: string }): string => {
    return intent.summary && intent.summary.trim().length > 0 
      ? intent.summary 
      : intent.payload;
  };

  const handleIntentClick = (intent: Intent) => {
    // Set this intent as the active discovery intent
    setDiscoveryIntents([{
      id: intent.id,
      payload: intent.payload,
      summary: intent.summary || undefined,
      createdAt: intent.createdAt
    }]);
    // Navigate to inbox if not already there
    if (typeof window !== 'undefined' && !window.location.pathname.includes('/inbox')) {
      router.push('/inbox');
    }
  };

  const isActiveIntent = (intentId: string): boolean => {
    return discoveryIntents?.some(di => di.id === intentId) || false;
  };

  return (
    <div className="bg-white rounded-sm border-black border p-3 pb-6 pt-6">
      <h2 className="text-[14px] font-bold text-black font-ibm-plex-mono mb-4">Latest Intents</h2>
      
      <div className="space-y-1.5">
        {loading ? (
          <div className="text-center text-gray-500 py-4">
            Loading...
          </div>
        ) : allIntents.length === 0 ? (
          <div className="text-center text-gray-500 py-4 text-xs font-ibm-plex-mono">
            No intents yet
          </div>
        ) : (
          allIntents.map((intent) => {
            const displayText = getDisplayText(intent);
            const isActive = isActiveIntent(intent.id);
            return (
              <div
                key={intent.id}
                onClick={() => handleIntentClick(intent)}
                className={`flex items-center justify-between group rounded cursor-pointer px-3 h-10 transition-colors ${
                  isActive 
                    ? 'bg-gray-200 font-bold' 
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center min-w-0 flex-1">
                  <span
                    className={`text-[14px] text-black truncate ${isActive ? 'font-bold' : ''}`}
                    title={displayText}
                  >
                    {displayText}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // Handle settings click
                  }}
                  className="p-1 cursor-pointer rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-200"
                  title="Settings"
                >
                  <Settings className="w-4 h-4 text-gray-600" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

