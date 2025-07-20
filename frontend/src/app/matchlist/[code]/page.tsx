"use client";

import { useState, useEffect, use, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Index, IntentStakesByUserResponse } from "@/lib/types";
import Image from "next/image";
import ClientLayout from "@/components/ClientLayout";
import { usePrivy } from '@privy-io/react-auth';
import { useConnections, useIntents, useSynthesis } from '@/contexts/APIContext';
import { indexesService as publicIndexesService } from '@/services/indexes';
import ReactMarkdown from "react-markdown";
import { formatDate } from "@/lib/utils";
import { getAvatarUrl } from "@/lib/file-utils";

import ConnectionActions, { ConnectionAction } from "@/components/ConnectionActions";
import { Play, Pause } from "lucide-react";

interface MatchlistPageProps {
  params: Promise<{
    code: string;
  }>;
}

// Consolidated state type
type MatchlistPageState = {
  // Core data
  index: Index | null;
  
  // Flow state
  step: 'loading' | 'intent-form' | 'intent-creating' | 'auth-required' | 'discovery-results' | 'error';
  
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
};

export default function MatchlistPage({ params }: MatchlistPageProps) {
  const resolvedParams = use(params);
  const [state, setState] = useState<MatchlistPageState>({
    index: null,
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
  });

  const { login, authenticated, ready } = usePrivy();
  const connectionsService = useConnections();
  const intentsService = useIntents();
  const synthesisService = useSynthesis();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  // Main flow effect
  useEffect(() => {
    const handleFlow = async () => {
      try {
        switch (state.step) {
          case 'loading':
            // Load index
            const index = await publicIndexesService.getIndexByShareCode(resolvedParams.code);
            setState(prev => ({ ...prev, index, step: 'intent-form' }));
            
            // Check for stored intent
            if (authenticated) {
              const storedIntent = localStorage.getItem(`matchlist_intent_${resolvedParams.code}`);
              if (storedIntent) {
                const parsed = JSON.parse(storedIntent);
                setState(prev => ({ 
                  ...prev, 
                  intentPayload: parsed.payload,
                  step: 'intent-creating'
                }));
              }
            }
            break;

          case 'intent-creating':
            if (authenticated && state.intentPayload.trim()) {
              // Create intent via share code - this will check can-write-intents permission
              const createdIntent = await intentsService.createIntentViaShareCode(
                resolvedParams.code,
                state.intentPayload,
                false // isIncognito
              );

              setState(prev => ({ 
                ...prev, 
                createdIntentId: createdIntent.id,
                step: 'discovery-results'
              }));

              // Clear stored intent
              localStorage.removeItem(`matchlist_intent_${resolvedParams.code}`);

              // Fetch discovery results
              await fetchDiscoveryResults(true, createdIntent.id);
            }
            break;

          case 'auth-required':
            // Store intent and trigger login
            if (!authenticated && state.intentPayload.trim()) {
              localStorage.setItem(`matchlist_intent_${resolvedParams.code}`, JSON.stringify({
                payload: state.intentPayload
              }));
              login();
            }
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

    if (state.step !== 'error') {
      handleFlow();
    }
  }, [state.step, authenticated, ready, resolvedParams.code]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Handle intent form submission
  const handleIntentSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!state.intentPayload.trim()) return;
    
    setState(prev => ({ ...prev, isSubmitting: true }));

    if (!ready || !authenticated) {
      setState(prev => ({ 
        ...prev, 
        step: 'auth-required'
      }));
      return;
    }

    setState(prev => ({ ...prev, step: 'intent-creating' }));
  }, [ready, authenticated, state.intentPayload]);

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

  // Handle starting over
  const handleStartOver = useCallback(() => {
    setState(prev => ({
      ...prev,
      step: 'intent-form',
      intentPayload: '',
      createdIntentId: null,
      discoveryResults: [],
      connectionStatuses: {},
      syntheses: {},
      synthesisLoading: {},
      isSubmitting: false,
      isPaused: false,
      isRefreshing: false,
    }));
    
    // Reset the fetched syntheses ref
    fetchedSynthesesRef.current.clear();
    
    localStorage.removeItem(`matchlist_intent_${resolvedParams.code}`);
  }, [resolvedParams.code]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [state.intentPayload]);

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
                <h1 className="text-xl font-bold font-ibm-plex-mono text-gray-900 break-words">
                  {state.index.title}
                </h1>
              </div>
              <div className="pt-0">
                <p className="text-gray-500 font-ibm-plex-mono text-sm mt-1">
                  Created {formatDate(state.index.createdAt)}
                </p>
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
                <Button 
                  variant="bordered" 
                  size="sm"
                  onClick={handleStartOver}
                >
                  Start Over
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Intent Form */}
        {state.step === 'intent-form' && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="w-full">
              <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-4">What are you looking for?</h3>
              
              <div className="mt-4 p-4 bg-white border border-gray-200 rounded-lg mb-4">
                <div className="flex items-start space-x-4">
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-700 mb-2">Express your intent and discover relevant connections.</h3>
                    <p className="text-sm text-gray-500">
                      Share what you're seeking, working on, or interested in. Our system will match you with people in this index who have relevant experience or complementary goals.
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleIntentSubmit} className="space-y-4">
                <div>
                  <textarea
                    ref={textareaRef}
                    value={state.intentPayload}
                    onChange={(e) => setState(prev => ({ ...prev, intentPayload: e.target.value }))}
                    placeholder="Describe what you're looking for, working on, or hoping to achieve..."
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none overflow-hidden"
                    rows={3}
                    disabled={state.isSubmitting}
                    style={{ color: "black" }}
                  />
                </div>
                
                <div className="flex gap-3">
                  <Button
                    type="submit"
                    disabled={!state.intentPayload.trim() || state.isSubmitting}
                    className="flex-1 bg-black text-white hover:bg-gray-800 border-b-2 border-black"
                  >
                    {state.isSubmitting ? 'Processing...' : 'Find Matches'}
                  </Button>
                </div>
              </form>
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