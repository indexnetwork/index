"use client";

import { useState, useEffect, use, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Index, IntentStakesByUserResponse, User, APIResponse } from "@/lib/types";
import Image from "next/image";
import ClientLayout from "@/components/ClientLayout";
import { usePrivy } from '@privy-io/react-auth';
import { useConnections, useIntents, useSynthesis } from '@/contexts/APIContext';
import { indexesService as publicIndexesService } from '@/services/indexes';
import ReactMarkdown from "react-markdown";
import { formatDate } from "@/lib/utils";
import { getAvatarUrl } from "@/lib/file-utils";
import { useAuthenticatedAPI } from '@/lib/api';

import ConnectionActions, { ConnectionAction } from "@/components/ConnectionActions";
import { Play, Pause } from "lucide-react";
import IntentForm from "@/components/IntentForm";
import { intentSuggestionsService, IntentSuggestion } from "@/services/intentSuggestions";

interface MatchlistPageProps {
  params: Promise<{
    code: string;
  }>;
}

// Consolidated state type
type MatchlistPageState = {
  // Core data
  index: Index | null;
  user: User | null;
  
  // Flow state
  step: 'loading' | 'intent-form' | 'intent-creating' | 'auth-required' | 'onboarding-required' | 'discovery-results' | 'error';
  
  // Intent data
  intentPayload: string;
  createdIntentId: string | null;
  
  // Discovery data
  discoveryResults: IntentStakesByUserResponse[];
  
  // Connection management
  connectionStatuses: Record<string, 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped'>;
  
  // Synthesis management
  syntheses: Record<string, string>;
  synthesisLoading: Record<string, boolean>;
  
  // Error handling
  error: string | null;
  
  // UI state
  isSubmitting: boolean;
  isPaused: boolean;
  isRefreshing: boolean;
  autoCreateIntent: boolean;
};

export default function MatchlistPage({ params }: MatchlistPageProps) {
  const resolvedParams = use(params);
  const [state, setState] = useState<MatchlistPageState>({
    index: null,
    user: null,
    step: 'loading',
    intentPayload: '',
    createdIntentId: null,
    discoveryResults: [],
    connectionStatuses: {},
    syntheses: {},
    synthesisLoading: {},
    error: null,
    isSubmitting: false,
    isPaused: false,
    isRefreshing: false,
    autoCreateIntent: false,
  });

  const { login, authenticated, ready } = usePrivy();
  const api = useAuthenticatedAPI();
  const connectionsService = useConnections();
  const intentsService = useIntents();
  const synthesisService = useSynthesis();
  const fetchedSynthesesRef = useRef<Set<string>>(new Set());

  // Fetch synthesis 
  const fetchSynthesis = useCallback(async (targetUserId: string, intentId?: string) => {
    const currentIntentId = intentId || state.createdIntentId;
    
    if (fetchedSynthesesRef.current.has(targetUserId)) {
      return; // Already fetched or in progress
    }

    if (!currentIntentId) {
      return; // No intent created yet
    }

    fetchedSynthesesRef.current.add(targetUserId);
    setState(prev => ({ 
      ...prev, 
      synthesisLoading: { ...prev.synthesisLoading, [targetUserId]: true }
    }));

    try {
      const response = await synthesisService.generateVibeCheck({
        targetUserId,
      });
      setState(prev => ({ 
        ...prev, 
        syntheses: { ...prev.syntheses, [targetUserId]: response.synthesis }
      }));
    } catch (error) {
      console.error('Error fetching synthesis:', error);
      // Remove from fetched ref so it can be retried
      fetchedSynthesesRef.current.delete(targetUserId);
      // Set empty synthesis on error to avoid infinite loading
      setState(prev => ({ 
        ...prev, 
        syntheses: { ...prev.syntheses, [targetUserId]: "" }
      }));
    } finally {
      setState(prev => ({ 
        ...prev, 
        synthesisLoading: { ...prev.synthesisLoading, [targetUserId]: false }
      }));
    }
  }, [synthesisService, state.createdIntentId]);

  // Fetch connection status
  const fetchConnectionStatus = useCallback(async (targetUserId: string) => {
    try {
      const status = await connectionsService.getConnectionStatus(targetUserId);
      
      // Convert API status to ConnectionActions format
      let connectionStatus: 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped' = 'none';
      
      if (status.status) {
        switch (status.status) {
          case 'REQUEST':
            connectionStatus = status.isInitiator ? 'pending_sent' : 'pending_received';
            break;
          case 'ACCEPT':
            connectionStatus = 'connected';
            break;
          case 'DECLINE':
            connectionStatus = 'declined';
            break;
          case 'SKIP':
            connectionStatus = 'skipped';
            break;
          case 'CANCEL':
            connectionStatus = 'none'; // Canceled connections reset to none
            break;
          default:
            connectionStatus = 'none';
        }
      }
      
      setState(prev => ({ 
        ...prev, 
        connectionStatuses: { ...prev.connectionStatuses, [targetUserId]: connectionStatus }
      }));
    } catch (error) {
      console.error('Error fetching connection status:', error);
      // Default to 'none' on error
      setState(prev => ({ 
        ...prev, 
        connectionStatuses: { ...prev.connectionStatuses, [targetUserId]: 'none' }
      }));
    }
  }, [connectionsService]);

  // Fetch discovery results
  const fetchDiscoveryResults = useCallback(async (showLoading = true, intentId?: string) => {
    try {
      if (showLoading) {
        // Only show loading if explicitly requested (not for background refreshes)
        setState(prev => ({ ...prev, isSubmitting: true }));
      } else {
        // Set refreshing state for background updates
        setState(prev => ({ ...prev, isRefreshing: true }));
      }
      
      const discoveryResults = await intentsService.getStakesByIndexCode(resolvedParams.code);
      setState(prev => ({ 
        ...prev, 
        discoveryResults,
        ...(showLoading ? { isSubmitting: false } : { isRefreshing: false })
      }));

      // Fetch connection status and synthesis for all discovered users
      const currentIntentId = intentId || state.createdIntentId;
      discoveryResults.forEach(userStake => {
        fetchConnectionStatus(userStake.user.id);
        fetchSynthesis(userStake.user.id, currentIntentId || undefined);
      });

    } catch (error) {
      console.error('Error fetching discovery results:', error);
      if (showLoading) {
        setState(prev => ({ ...prev, isSubmitting: false }));
      } else {
        setState(prev => ({ ...prev, isRefreshing: false }));
      }
    }
  }, [intentsService, resolvedParams.code, fetchConnectionStatus, fetchSynthesis, state.createdIntentId]);

  // Main flow effect - handles all the complex logic in one place
  useEffect(() => {
    const handleFlow = async () => {
      try {
        switch (state.step) {
          case 'loading':
            // Load index
            const index = await publicIndexesService.getIndexByShareCode(resolvedParams.code);
            setState(prev => ({ ...prev, index, step: 'intent-form' }));
            
            // Check for stored intent (after user logs in)
            if (authenticated) {
              const storedIntent = localStorage.getItem(`matchlist_intent_${resolvedParams.code}`);
              if (storedIntent) {
                const parsed = JSON.parse(storedIntent);
                console.log('Found stored intent after login, generating suggestions:', parsed.payload);
                
                // Clear stored intent
                localStorage.removeItem(`matchlist_intent_${resolvedParams.code}`);
                
                // Refresh user data to check onboarding status
                try {
                  const response = await api.get<APIResponse<User>>('/auth/me');
                  if (response.user) {
                    setState(prev => ({ ...prev, user: response.user || null }));
                    
                    // Check if user needs onboarding before creating intent
                    if (!response.user.intro || response.user.intro.trim() === '') {
                      setState(prev => ({ 
                        ...prev, 
                        step: 'onboarding-required',
                        autoCreateIntent: true
                      }));
                      return;
                    }
                  }
                } catch (error) {
                  console.error('Failed to fetch user:', error);
                  setState(prev => ({ ...prev, step: 'error', error: 'Failed to fetch user data' }));
                  return;
                }
                
                // Auto-create the intent with AI suggestions
                try {
                  setState(prev => ({ ...prev, step: 'intent-creating' }));
                  
                  // Generate suggestions from stored input
                  const suggestionsResult = await intentSuggestionsService.generateSuggestions({
                    payload: parsed.payload || undefined,
                    files: [] // No files in stored intent for now
                  });

                  const intentsToCreate: string[] = [];

                  if (suggestionsResult.success && suggestionsResult.suggestedIntents.length > 0) {
                    intentsToCreate.push(...suggestionsResult.suggestedIntents.map(s => s.payload));
                    console.log(`Creating ${suggestionsResult.suggestedIntents.length} intents from stored input suggestions`);
                  } else {
                    intentsToCreate.push(parsed.payload);
                    console.log('Using original stored input as single intent');
                  }
                  
                  // Create all intents from suggestions
                  const createdIntents = [];
                  for (let i = 0; i < intentsToCreate.length; i++) {
                    try {
                      const createdIntent = await intentsService.createIntentViaShareCode(
                        resolvedParams.code,
                        intentsToCreate[i],
                        false
                      );
                      createdIntents.push(createdIntent);
                      console.log(`Stored intent ${i + 1}/${intentsToCreate.length} created`);
                    } catch (error) {
                      console.error(`Failed to create stored intent ${i + 1}:`, error);
                    }
                  }

                  if (createdIntents.length > 0) {
                    const primaryIntent = createdIntents[0];
                    setState(prev => ({ 
                      ...prev, 
                      createdIntentId: primaryIntent.id,
                      step: 'discovery-results'
                    }));

                    // Fetch discovery results for the primary intent
                    await fetchDiscoveryResults(true, primaryIntent.id);
                  } else {
                    throw new Error('Failed to create any intents from stored data');
                  }
                } catch (error) {
                  console.error('Error creating stored intent:', error);
                  setState(prev => ({ ...prev, step: 'intent-form' }));
                }
              }
            }
            break;

          case 'auth-required':
            // Trigger login (only if not already authenticated)
            if (!authenticated) {
              login();
            }
            break;

          case 'onboarding-required':
            // User needs to complete onboarding - modal will be shown
            break;
        }
      } catch (error) {
        console.error('Flow error:', error);
        
        // Handle specific permission errors
        let errorMessage = 'Something went wrong';
        if (error instanceof Error) {
          if (error.message.includes('does not allow intent creation')) {
            errorMessage = 'You don\'t have permission to create intents in this shared index.';
          } else if (error.message.includes('Shared index does not allow intent creation')) {
            errorMessage = 'This shared index doesn\'t allow creating new intents.';
          } else {
            errorMessage = error.message;
          }
        }
        
        setState(prev => ({ 
          ...prev, 
          step: 'error', 
          error: errorMessage,
          isSubmitting: false
        }));
      }
    };

    // Handle user authentication and onboarding check
    const checkUserState = async () => {
      if (authenticated && ready && !state.user) {
        try {
          const response = await api.get<APIResponse<User>>('/auth/me');
          if (response.user) {
            setState(prev => ({ ...prev, user: response.user || null }));
            
            // Check if needs onboarding for auto-create intent
            if (!response.user.intro || response.user.intro.trim() === '') {
              if (state.autoCreateIntent) {
                setState(prev => ({ ...prev, step: 'onboarding-required' }));
              }
            } else {
              // User is ready, check if should auto-create intent
              if (state.autoCreateIntent && (state.step === 'auth-required' || state.step === 'onboarding-required')) {
                // Re-trigger stored intent creation after auth/onboarding
                setState(prev => ({ ...prev, step: 'loading' }));
              }
            }
          }
        } catch (error) {
          console.error('Failed to fetch user:', error);
        }
      }
    };

    if (state.step !== 'error') {
      handleFlow();
      checkUserState();
    }
  }, [state.step, authenticated, ready, resolvedParams.code, state.autoCreateIntent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for onboarding completion from Header modal
  useEffect(() => {
    // Check for existing onboarding completion flag
    const checkOnboardingCompletion = () => {
      if (state.step === 'onboarding-required') {
        try {
          const completed = localStorage.getItem('onboarding_completed');
          if (completed) {
            setState(prev => ({ ...prev, step: 'loading' }));
            localStorage.removeItem('onboarding_completed');
          }
        } catch (error) {
          console.warn('Failed to check onboarding completion:', error);
        }
      }
    };

    // Check initially
    checkOnboardingCompletion();

    // Listen for storage changes (from other tabs/windows)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'onboarding_completed' && state.step === 'onboarding-required') {
        setState(prev => ({ ...prev, step: 'loading' }));
        localStorage.removeItem('onboarding_completed');
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Poll for changes in the same tab (since localStorage events don't fire in same tab)
    const pollInterval = setInterval(checkOnboardingCompletion, 500);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(pollInterval);
    };
  }, [state.step]);

  // Poll discovery results every 5 seconds when in discovery-results step
  useEffect(() => {
    if (state.step !== 'discovery-results') {
      return; // Only poll when showing discovery results
    }

    const interval = setInterval(() => {
      if (!state.isPaused) {
        fetchDiscoveryResults(false); // Don't show loading for background refreshes
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [state.step, state.isPaused, fetchDiscoveryResults]);

  // Handle intent form submission and creation
  const handleIntentSubmission = useCallback(async (data: { payload: string; files: File[]; vibeCheckIndex?: string }) => {
    console.log('=== CREATING INTENT FROM SUGGESTIONS ===');
    console.log('Original input:', data.payload);
    console.log('Files:', data.files);
    
    if (!data.payload.trim() && data.files.length === 0) {
      console.error('No content provided');
      return;
    }
    
    setState(prev => ({ ...prev, isSubmitting: true }));

    try {
      if (!ready || !authenticated) {
        // Store intent data for after login
        localStorage.setItem(`matchlist_intent_${resolvedParams.code}`, JSON.stringify({
          payload: data.payload,
          files: data.files.map(f => ({ name: f.name, size: f.size, type: f.type })) // Store file metadata
        }));
        setState(prev => ({ 
          ...prev, 
          step: 'auth-required',
          autoCreateIntent: true,
          isSubmitting: false
        }));
        return;
      }

      if (!state.user?.intro || state.user.intro.trim() === '') {
        // Store intent data for after onboarding
        localStorage.setItem(`matchlist_intent_${resolvedParams.code}`, JSON.stringify({
          payload: data.payload,
          files: data.files.map(f => ({ name: f.name, size: f.size, type: f.type })) // Store file metadata
        }));
        setState(prev => ({ 
          ...prev, 
          step: 'onboarding-required',
          autoCreateIntent: true,
          isSubmitting: false
        }));
        return;
      }

      // Set intent creating state
      setState(prev => ({ ...prev, step: 'intent-creating' }));

      // First, generate suggestions from the input
      console.log('Generating suggestions to create multiple intents...');
      const suggestionsResult = await intentSuggestionsService.generateSuggestions({
        payload: data.payload.trim() || undefined,
        files: data.files
      });

      const intentsToCreate: string[] = [];

      if (suggestionsResult.success && suggestionsResult.suggestedIntents.length > 0) {
        // Use all AI suggestions as separate intents
        intentsToCreate.push(...suggestionsResult.suggestedIntents.map(s => s.payload));
        
        console.log('=== CREATING MULTIPLE INTENTS FROM AI SUGGESTIONS ===');
        console.log('Original input:', data.payload);
        console.log(`Creating ${suggestionsResult.suggestedIntents.length} intents from suggestions:`);
        
        suggestionsResult.suggestedIntents.forEach((suggestion: IntentSuggestion, index: number) => {
          console.log(`  ${index + 1}. ${suggestion.payload} (${Math.round(suggestion.confidence * 100)}%)`);
        });
      } else {
        // Fallback to original input
        intentsToCreate.push(data.payload.trim());
        console.log('No suggestions generated, using original input as single intent');
      }

      // Create all intents
      const createdIntents = [];
      console.log(`Creating ${intentsToCreate.length} intents...`);
      
      for (let i = 0; i < intentsToCreate.length; i++) {
        const intentPayload = intentsToCreate[i];
        try {
          const createdIntent = await intentsService.createIntentViaShareCode(
            resolvedParams.code,
            intentPayload,
            false // isIncognito
          );
          createdIntents.push(createdIntent);
          console.log(`Intent ${i + 1}/${intentsToCreate.length} created:`, {
            id: createdIntent.id,
            payload: intentPayload.substring(0, 100) + (intentPayload.length > 100 ? '...' : '')
          });
        } catch (error) {
          console.error(`Failed to create intent ${i + 1}:`, error);
        }
      }

      if (createdIntents.length === 0) {
        throw new Error('Failed to create any intents');
      }

      console.log(`=== Successfully created ${createdIntents.length} intents ===`);
      
      // Use the first created intent for discovery results
      const primaryIntent = createdIntents[0];
      
      setState(prev => ({ 
        ...prev, 
        createdIntentId: primaryIntent.id,
        step: 'discovery-results',
        isSubmitting: false
      }));

      // Fetch discovery results for the primary intent
      await fetchDiscoveryResults(true, primaryIntent.id);

    } catch (error) {
      console.error('Error creating intent:', error);
      
      // Handle specific permission errors
      let errorMessage = 'Something went wrong';
      if (error instanceof Error) {
        if (error.message.includes('does not allow intent creation')) {
          errorMessage = 'You don\'t have permission to create intents in this shared index.';
        } else if (error.message.includes('Shared index does not allow intent creation')) {
          errorMessage = 'This shared index doesn\'t allow creating new intents.';
        } else {
          errorMessage = error.message;
        }
      }
      
      setState(prev => ({ 
        ...prev, 
        step: 'error', 
        error: errorMessage,
        isSubmitting: false
      }));
    }
  }, [ready, authenticated, resolvedParams.code, intentsService, fetchDiscoveryResults, state.user]);

  // Get connection status for a user
  const getConnectionStatus = (userId: string): 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped' => {
    return state.connectionStatuses[userId] || 'none';
  };

  // Handle connection actions
  const handleConnectionAction = async (action: ConnectionAction, userId: string) => {
    try {
      console.log(`Connection action: ${action} for user: ${userId}`);
      
      switch (action) {
        case 'REQUEST':
          await connectionsService.requestConnection(userId);
          break;
        case 'SKIP':
          await connectionsService.skipConnection(userId);
          break;
        case 'ACCEPT':
          await connectionsService.acceptConnection(userId);
          break;
        case 'DECLINE':
          await connectionsService.declineConnection(userId);
          break;
        case 'CANCEL':
          await connectionsService.cancelConnection(userId);
          break;
      }

      // Refresh the connection status for this specific user
      await fetchConnectionStatus(userId);
    } catch (error) {
      console.error('Error handling connection action:', error);
    }
  };


  // Render based on state
  if (state.step === 'loading') {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Loading...</div>
      </ClientLayout>
    );
  }

  if (state.step === 'error') {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">
          <h2 className="text-xl font-bold mb-2">Error</h2>
          <p>{state.error}</p>
        </div>
      </ClientLayout>
    );
  }

  if (!state.index) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Index not found</div>
      </ClientLayout>
    );
  }

  // Check permissions
  const canMatch = state.index.linkPermissions?.permissions.includes('can-match') || false;
  const canWriteIntents = state.index.linkPermissions?.permissions.includes('can-write-intents') || false;

  if (!canMatch && !canWriteIntents) {
    return (
      <ClientLayout>
        <div className="max-w-4xl mx-auto mt-10 mb-30 w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
          backgroundImage: 'url(/grid.png)',
          backgroundColor: 'white',
          backgroundSize: '888px'
        }}>
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-center items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="text-center">
              <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-2">Limited Access</h3>
              <p className="text-gray-600">This index does not allow matching or intent creation.</p>
            </div>
          </div>
        </div>
      </ClientLayout>
    );
  }

  if (!canWriteIntents) {
    return (
      <ClientLayout>
        <div className="max-w-4xl mx-auto mt-10 mb-30 w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
          backgroundImage: 'url(/grid.png)',
          backgroundColor: 'white',
          backgroundSize: '888px'
        }}>
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-center items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="text-center">
              <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-2">Intent Creation Not Allowed</h3>
              <p className="text-gray-600">This shared index does not allow creating new intents.</p>
              {canMatch && (
                <p className="text-gray-500 text-sm mt-2">You can view existing matches but cannot add your own intent.</p>
              )}
            </div>
          </div>
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      {/* Main Content */}
      <div className="max-w-4xl mx-auto mt-10 mb-30 w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>
        
        {/* Header */}
        <div className="bg-white px-4 pt-4 pb-4 mb-4 border border-black border-b-0 border-b-2">
          <div className="flex flex-wrap sm:flex-nowrap justify-between items-start gap-4">
            <div className="w-full sm:flex-1 sm:min-w-0 mb-0 sm:mb-0">
              <div className="mb-2">
                <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono break-words">
                  {state.index.title}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <Image
                  src={getAvatarUrl(state.index.user)}
                  alt={state.index.user.name}
                  width={20}
                  height={20}
                  className="rounded-full"
                />
                <span className="text-sm text-gray-500">{state.index.user.name}</span>
                <span className="text-sm text-gray-400">•</span>
                <span className="text-sm text-gray-500">{formatDate(state.index.createdAt)}</span>
              </div>
            </div>
            {state.step === 'discovery-results' && (
              <div className="flex gap-2 flex-shrink-0 sm:self-center">
                <Button 
                  variant="bordered" 
                  size="sm"
                  onClick={() => setState(prev => ({ ...prev, isPaused: !prev.isPaused }))}
                >
                  <div className="flex items-center gap-2">
                    {state.isPaused ? (
                      <Play className="h-4 w-4" />
                    ) : (
                      <Pause className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline">{state.isPaused ? 'Resume' : 'Pause'}</span>
                  </div>
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Intent Form */}
        {state.step === 'intent-form' && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="w-full">
              <h3 className=" text-xl font-ibm-plex-mono mt-2 font-semibold text-gray-900 mb-2">What's the vibe? Find your match.</h3>
              <p className="text-sm font-ibm-plex-mono text-gray-800 mb-6">Connect with people within this index. By sharing your vibe, you enable the agents to surface tailored connections, opportunities, and collaborations aligned with your goals.</p>
              <IntentForm
                onSubmit={handleIntentSubmission}
                isSubmitting={state.isSubmitting}
                submitButtonText="Find Matches"
              />
            </div>
          </div>
        )}

        {/* Intent Creating */}
        {state.step === 'intent-creating' && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="w-full text-center">
              <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-4">Creating your intent...</h3>
              <div className="flex items-center justify-center">
                <Image 
                  className="h-auto"
                  src={'/loading2.gif'} 
                  alt="Loading" 
                  width={300} 
                  height={200} 
                />
              </div>
              <p className="text-gray-800 text-sm mt-1">Finding relevant connections...</p>
            </div>
          </div>
        )}



        {/* Discovery Results */}
        {state.step === 'discovery-results' && (
          <div className="w-full">
            {/* Connection Cards Grid - Matching Intent Detail Page */}
            <div className="grid grid-cols-1 gap-6">
              {state.discoveryResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center bg-white border border-black border-b-0 border-b-2 px-6 pb-8">
                  <Image 
                    className="h-auto"
                    src={'/generic.png'} 
                    alt="Hero Illustration" 
                    width={300} 
                    height={200} 
                    style={{
                      imageRendering: 'auto',
                    }}
                  />
                  <p className="text-gray-900 font-500 font-ibm-plex-mono text-md mt-4 text-center">
                    No matches found in this index. Try adjusting your intent or check back later.
                  </p>
                </div>
              ) : (
                state.discoveryResults.map((userStake) => (
                  <div key={userStake.user.id} className="bg-white border border-black border-b-0 border-b-2 p-6">
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <Image
                          src={getAvatarUrl(userStake.user)}
                          alt={userStake.user.name}
                          width={48}
                          height={48}
                          className="rounded-full"
                        />
                        <div>
                          <h2 className="text-lg font-medium text-gray-900">{userStake.user.name}</h2>
                        </div>
                      </div>
                      {/* Connection Actions */}
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <ConnectionActions
                          userId={userStake.user.id}
                          userName={userStake.user.name}
                          connectionStatus={getConnectionStatus(userStake.user.id)}
                          onAction={handleConnectionAction}
                          size="sm"
                        />
                      </div>
                    </div>

                    {/* Synthesis Section - What could happen here */}
                    {(state.synthesisLoading[userStake.user.id] || state.syntheses[userStake.user.id]) && (
                      <div className="mb-6">
                        <h3 className="font-medium text-gray-700 mb-3">What could happen here</h3>
                        <div className="relative min-h-[100px]">
                          {state.synthesisLoading[userStake.user.id] ? (
                            <div className="text-gray-500 animate-pulse">
                              ...
                            </div>
                          ) : (
                            <div className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_a]:text-[#ec6767] [&_a]:font-bold [&_a]:underline [&_a]:hover:opacity-80 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm">
                              <ReactMarkdown>
                                {state.syntheses[userStake.user.id]}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      </div>
    </ClientLayout>
  );
} 