"use client";

import { useState, useEffect, use, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, ArrowUpRight } from "lucide-react";
import { Index } from "@/lib/types";
import Image from "next/image";
import ClientLayout from "@/components/ClientLayout";
import { getIndexFileUrl } from "@/lib/file-utils";
import { usePrivy } from '@privy-io/react-auth';
import { useConnections, useIndexes, useIntents } from '@/contexts/APIContext';
import { indexesService as publicIndexesService } from '@/services/indexes';
import { useAuthenticatedAPI } from '@/lib/api';
import { User, APIResponse } from '@/lib/types';
import { vibecheckService } from '@/services/vibecheck';
import ReactMarkdown from "react-markdown";
import { formatDate } from "@/lib/utils";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from 'next/navigation';

interface SharePageProps {
  params: Promise<{
    code: string;
  }>;
}

// Consolidated state type
type SharePageState = {
  // Core data
  index: Index | null;
  user: User | null;
  
  // Flow state
  step: 'loading' | 'ready' | 'vibecheck-running' | 'vibecheck-results' | 'auth-required' | 'onboarding-required' | 'connection-processing' | 'connection-sent' | 'error';
  
  // Data
  uploadedFiles: File[];
  vibeCheckResults: { aiSynthesis?: string; score?: number };
  error: string | null;
  
  // Flags
  isDragging: boolean;
  autoRequestConnection: boolean;
  currentStep: string;
  connectionRequestSent: boolean;
};

export default function SharePage({ params }: SharePageProps) {
  const resolvedParams = use(params);
  const [state, setState] = useState<SharePageState>({
    index: null,
    user: null,
    step: 'loading',
    uploadedFiles: [],
    vibeCheckResults: {},
    error: null,
    isDragging: false,
    autoRequestConnection: false,
    currentStep: '',
    connectionRequestSent: false,
  });

  const { login, authenticated, ready } = usePrivy();
  const api = useAuthenticatedAPI();
  const connectionsService = useConnections();
  const indexesService = useIndexes();
  const intentsService = useIntents();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Main flow effect - handles all the complex logic in one place
  useEffect(() => {
    const handleFlow = async () => {
      try {
        switch (state.step) {
          case 'loading':
            // Load index
            const index = await publicIndexesService.getIndexByShareCode(resolvedParams.code);
            setState(prev => ({ ...prev, index, step: 'ready' }));
            
            // Check for stored vibecheck results
            if (authenticated) {
              const storedVibeCheck = localStorage.getItem(`vibecheck_${resolvedParams.code}`);
              if (storedVibeCheck) {
                const parsed = JSON.parse(storedVibeCheck);
                setState(prev => ({ 
                  ...prev, 
                  vibeCheckResults: parsed.results[0] || {},
                  step: 'vibecheck-results',
                  autoRequestConnection: parsed.autoRequest || false
                }));
              }
            }
            break;

          case 'vibecheck-running':
            if (state.uploadedFiles.length > 0) {
              const vibeCheckResult = await vibecheckService.runVibeCheckWithFiles(resolvedParams.code, state.uploadedFiles);
              if (vibeCheckResult.success) {
                setState(prev => ({
                  ...prev,
                  vibeCheckResults: { 
                    aiSynthesis: vibeCheckResult.synthesis || '', 
                    score: vibeCheckResult.score || 0 
                  },
                  step: 'vibecheck-results'
                }));
                
                // Store temp files in localStorage for later retrieval
                if (vibeCheckResult.tempFiles) {
                  localStorage.setItem(`vibecheck_${resolvedParams.code}`, JSON.stringify({
                    results: [{ 
                      aiSynthesis: vibeCheckResult.synthesis || '', 
                      score: vibeCheckResult.score || 0 
                    }],
                    tempFiles: vibeCheckResult.tempFiles,
                    autoRequest: state.autoRequestConnection
                  }));
                }
              } else {
                setState(prev => ({ ...prev, step: 'error', error: vibeCheckResult.error || 'Vibecheck failed' }));
              }
            }
            break;

          case 'auth-required':
            // Store vibecheck results and trigger login (only if not already authenticated)
            if (!authenticated) {
              if (state.vibeCheckResults.aiSynthesis) {
                const stored = localStorage.getItem(`vibecheck_${resolvedParams.code}`);
                const existing = stored ? JSON.parse(stored) : {};
                localStorage.setItem(`vibecheck_${resolvedParams.code}`, JSON.stringify({
                  results: [state.vibeCheckResults],
                  tempFiles: existing.tempFiles || [],
                  autoRequest: state.autoRequestConnection
                }));
              }
              login();
            }
            break;

          case 'onboarding-required':
            // User needs to complete onboarding - modal will be shown
            break;

          case 'connection-processing':
            if (authenticated && state.index?.user?.id) {
              // Check for existing index or create new one
              // setState(prev => ({ ...prev, currentStep: 'Checking for existing index...' }));
              const indexesResponse = await indexesService.getIndexes(1, 100);
              
              let targetIndex = indexesResponse.indexes?.find((index: Index) => index.title === 'My Vibe');
              
              if (!targetIndex) {
                setState(prev => ({ ...prev, currentStep: 'Creating your index...' }));
                targetIndex = await indexesService.createIndex({
                  title: `My Vibe`
                });
              }
              
              const newIndex = targetIndex;

              // Upload files from temp storage if any
              const stored = localStorage.getItem(`vibecheck_${resolvedParams.code}`);
              if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed.tempFiles && parsed.tempFiles.length > 0) {
                  setState(prev => ({ ...prev, currentStep: 'Uploading files...' }));
                  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
                  
                  for (const tempFile of parsed.tempFiles) {
                    try {
                      const response = await fetch(`${apiUrl}/vibecheck/temp/${tempFile.id}`);
                      if (response.ok) {
                        const blob = await response.blob();
                        const file = new File([blob], tempFile.name, { type: tempFile.type });
                        await indexesService.uploadFile(newIndex.id, file);
                      }
                    } catch (error) {
                      console.warn('Failed to retrieve temp file:', error);
                    }
                  }
                }
              }

              // Get and add suggested intents
              setState(prev => ({ ...prev, currentStep: 'Creating intents...' }));
              const suggestedIntentsResponse = await indexesService.getSuggestedIntents(newIndex.id);
              const intentsToAdd = (suggestedIntentsResponse.intents || []).slice(0, 2);
              
              for (const suggestedIntent of intentsToAdd) {
                await intentsService.createIntent({
                  payload: suggestedIntent.payload,
                  indexIds: [newIndex.id],
                  isIncognito: false
                });
              }

              // Request connection
              setState(prev => ({ ...prev, currentStep: 'Requesting connection...' }));
              await connectionsService.requestConnection(state.index.user.id);

              setState(prev => ({ ...prev, step: 'connection-sent', connectionRequestSent: true }));
              
              // Clear stored data
              localStorage.removeItem(`vibecheck_${resolvedParams.code}`);
            }
            break;
        }
      } catch (error) {
        console.error('Flow error:', error);
        setState(prev => ({ 
          ...prev, 
          step: 'error', 
          error: error instanceof Error ? error.message : 'Something went wrong' 
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
            
            // Check if needs onboarding
            if (!response.user.intro || response.user.intro.trim() === '') {
              if (state.autoRequestConnection) {
                setState(prev => ({ ...prev, step: 'onboarding-required' }));
              }
            } else {
              // User is ready, check if should auto-connect
              if (state.autoRequestConnection && (state.step === 'vibecheck-results' || state.step === 'auth-required')) {
                setState(prev => ({ ...prev, step: 'connection-processing' }));
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
  }, [state.step, authenticated, ready, resolvedParams.code, state.autoRequestConnection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for onboarding completion from Header modal
  useEffect(() => {
    // Check for existing onboarding completion flag
    const checkOnboardingCompletion = () => {
      if (state.step === 'onboarding-required') {
        try {
          const completed = localStorage.getItem('onboarding_completed');
          if (completed) {
            setState(prev => ({ ...prev, step: 'connection-processing' }));
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
        setState(prev => ({ ...prev, step: 'connection-processing' }));
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

  // Event handlers
  const handleFileUpload = useCallback(async (files: File[]) => {
    if (!state.index || files.length === 0) return;
    
    setState(prev => ({ 
      ...prev, 
      uploadedFiles: files, 
      step: 'vibecheck-running' 
    }));
  }, [state.index]);

  const handleRequestConnection = useCallback(() => {
    if (!ready || !authenticated) {
      setState(prev => ({ 
        ...prev, 
        step: 'auth-required',
        autoRequestConnection: true 
      }));
      return;
    }

    if (!state.user?.intro || state.user.intro.trim() === '') {
      setState(prev => ({ 
        ...prev, 
        step: 'onboarding-required',
        autoRequestConnection: true 
      }));
      return;
    }

    setState(prev => ({ ...prev, step: 'connection-processing' }));
  }, [ready, authenticated, state.user]);



  const handleStartOver = useCallback(() => {
    setState(prev => ({
      ...prev,
      step: 'ready',
      uploadedFiles: [],
      vibeCheckResults: {},
      autoRequestConnection: false,
      currentStep: '',
      connectionRequestSent: false,
    }));
    
    localStorage.removeItem(`vibecheck_${resolvedParams.code}`);
  }, [resolvedParams.code]);

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setState(prev => ({ ...prev, isDragging: true }));
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setState(prev => ({ ...prev, isDragging: false }));
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setState(prev => ({ ...prev, isDragging: false }));
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    await handleFileUpload(droppedFiles);
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    await handleFileUpload(selectedFiles);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
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
  const canViewFiles = state.index.linkPermissions?.permissions.includes('can-view-files') || false;
  const canDiscover = state.index.linkPermissions?.permissions.includes('can-discover') || false;

  return (
    <ClientLayout>
      {/* Main Content */}
      <div className="max-w-4xl mx-auto mt-10 mb-30 w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>
        
        <div className="flex flex-col sm:flex-row py-4 px-2 sm:px-4 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono">{state.index.title}</h1>
            </div>
            <p className="text-sm text-gray-500 font-ibm-plex-mono">Created {formatDate(state.index.createdAt)}</p>
          </div>
        </div>

        {canViewFiles && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="space-y-3 w-full">
              <div className="flex justify-between items-center">
                <h2 className="text-xl mt-2 font-semibold text-gray-900">Files</h2>
              </div>
              <div className="space-y-2 flex-1">
                {state.index.files?.map((file, fileIndex) => (
                  <div
                    key={fileIndex}
                    className="flex items-center justify-between px-4 py-1 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          className="p-0"
                          size="lg"
                          onClick={() => {
                            const fileUrl = getIndexFileUrl(file);
                            window.open(fileUrl, '_blank');
                          }}
                        >
                          <h4 className="text-lg font-medium font-ibm-plex-mono text-gray-900 cursor-pointer">{file.name}</h4>
                          <ArrowUpRight className="ml-1 h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-sm text-gray-500">
                        {file.size} bytes • {formatDate(file.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {canDiscover && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="w-full">
              {state.step === 'ready' && (
                <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-4">Curious how your work fits in?</h3>
              )}
              
              {state.step === 'vibecheck-running' && (
                <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-4">Running vibecheck...</h3>
              )}
              
              {(state.step === 'vibecheck-results' || state.step === 'auth-required' || state.step === 'onboarding-required' || state.step === 'connection-processing' || state.step === 'connection-sent') && (
                <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-4">What could happen here</h3>
              )}
              
              {state.step === 'ready' && (
                <>
                  <div className="mt-4 p-4 bg-white border border-gray-200 rounded-lg">
                    <div className="flex items-start space-x-4">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-700 mb-2">Drop your files and get instant vibe check.</h3>
                        <p className="text-sm text-gray-500">
                          Once uploaded, you'll receive a detailed breakdown of how your content aligns with our mutual goals and potential collaboration opportunities. 
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                     <input
                       ref={fileInputRef}
                       type="file"
                       multiple
                       onChange={handleFileInputChange}
                       className="hidden"
                       accept=".pdf,.doc,.docx,.txt,.md,.json,.csv,.xlsx,.xls,.ppt,.pptx"
                     />
                     <div 
                       className={`mt-4 border-2 border-dashed p-6 flex flex-col items-center justify-center transition-colors cursor-pointer ${
                         state.isDragging 
                           ? "border-gray-400 bg-gray-100" 
                           : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                       }`}
                       onDragOver={handleDragOver}
                       onDragLeave={handleDragLeave}
                       onDrop={handleDrop}
                       onClick={handleBrowseClick}
                     >
                       <Upload className="h-8 w-8 text-gray-400 mb-2" />
                       <p className="text-sm text-gray-600 text-center">
                         Drag & drop your files here, or click to browse
                       </p>
                     </div>
                   </div>
                </>
              )}

              {state.step === 'vibecheck-running' && (
                <div className="text-center">
                  <div className="flex items-center justify-center">
                    <Image 
                      className="h-auto"
                      src={'/loading2.gif'} 
                      alt="Loading" 
                      width={300} 
                      height={200} 
                    />
                  </div>
                  <p className="text-gray-800 text-sm mt-1">This may take a moment...</p>
                </div>
              )}

              {(state.step === 'vibecheck-results' || state.step === 'auth-required' || state.step === 'onboarding-required' || state.step === 'connection-processing' || state.step === 'connection-sent') && (
                <div className="mt-4 space-y-4">
                  <div className="mb-4">
                    <div className="bg-white py-3">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                            <span className="text-lg font-bold text-gray-600">You</span>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">You</div>
                          </div>
                        </div>
                        
                        <div className="text-center">
                          <div className="text-3xl font-bold text-green-600 mb-1">
                            {Math.round((state.vibeCheckResults.score || 0) * 100)}%
                          </div>
                          <div className="text-sm text-gray-500">Pulse</div>
                        </div>
                        
                        <div className="flex items-center gap-4">
                          <div>
                            <div className="font-semibold text-gray-900 text-right">{state.index?.user?.name || 'User'}</div>
                            <div className="text-sm text-gray-500 text-right">Index Owner</div>
                          </div>
                          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                            <span className="text-lg font-bold text-blue-600">{(state.index?.user?.name || 'U').charAt(0)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {state.vibeCheckResults.aiSynthesis && (
                      <div className="space-y-2">
                        <div className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_a]:text-[#ec6767] [&_a]:font-bold [&_a]:underline [&_a]:hover:opacity-80 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm">
                          <ReactMarkdown>
                            {state.vibeCheckResults.aiSynthesis}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-6">
                    {(state.vibeCheckResults.score || 0) <= 0.5 && (
                      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-center mb-4">
                        <p className="text-yellow-800 font-medium">Collaboration potential is moderate</p>
                        <p className="text-yellow-700 text-sm mt-1">
                          Based on the analysis, there may be limited synergy for collaboration at this time.
                        </p>
                      </div>
                    )}
                    
                    <div className="flex gap-3">
                      {!state.connectionRequestSent && (
                        <Button
                          onClick={handleStartOver}
                          variant="bordered"
                          className="flex-1"
                        >
                          Start over
                        </Button>
                      )}
                      
                      {(state.vibeCheckResults.score || 0) >= 0.5 && (
                        <Button
                          onClick={handleRequestConnection}
                          variant="bordered"
                          className="flex-1 text-white border-black border-b-2"
                          style={{ background: state.connectionRequestSent ? '#6b7280' : '#3f6ed9' }}
                          disabled={state.step === 'auth-required' || state.step === 'onboarding-required' || state.step === 'connection-processing' || state.connectionRequestSent}
                        >
                          {state.connectionRequestSent ? 'Request sent' :
                           state.step === 'auth-required' ? 'Authenticating...' : 
                           state.step === 'onboarding-required' ? 'Complete Onboarding' : 
                           state.step === 'connection-processing' ? 'Processing Connection...' :
                           'Request Connection'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {!canViewFiles && !canDiscover && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-center items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="text-center">
              <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-2">Limited Access</h3>
              <p className="text-gray-600">You have limited access to this index.</p>
            </div>
          </div>
        )}
      </div>

      {/* Connection Processing/Sent Modal */}
      <Dialog.Root open={state.step === 'connection-processing' || state.step === 'connection-sent'}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg max-w-md w-full mx-4 p-6 z-50">
            {state.step === 'connection-processing' ? (
              <>
                <div className="flex justify-between items-center mb-4">
                  <Dialog.Title className="text-xl font-bold text-gray-900">Preparing Connection</Dialog.Title>
                </div>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                  
                  <div className="text-center">
                    <p className="text-gray-700 font-medium mb-2">
                      {state.currentStep || 'Initializing...'}
                    </p>
                    <p className="text-gray-600 text-sm">
                      Hang tight—our agents are setting up your connection and scoping out awesome ways you can team up!
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center mb-4">
                  <Dialog.Title className="text-xl font-bold text-gray-900">Request sent</Dialog.Title>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <p className="text-gray-700 mb-2">
                      Your request sent to <strong>{state.index?.user?.name || 'the user'}</strong>.
                    </p>
                    <p className="text-gray-700 mb-4">
                      You'll be connected through your preferred channel if they accept.
                    </p>
                    <p className="text-gray-600 text-sm">
                      You can cancel the request anytime from the <strong>Pending</strong> tab.
                    </p>
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex justify-between gap-3">
                      <Button
                        variant="bordered"
                        className="flex-1"
                        onClick={() => setState(prev => ({ ...prev, step: 'vibecheck-results' }))}
                      >
                        Done
                      </Button>
                      <Button
                        className="flex-1 bg-black text-white hover:bg-gray-800"
                        onClick={() => router.push('/inbox?tab=pending')}
                      >
                        Go to Inbox
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>


    </ClientLayout>
  );
} 