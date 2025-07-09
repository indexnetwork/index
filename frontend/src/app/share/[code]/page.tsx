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

export default function SharePage({ params }: SharePageProps) {
  const resolvedParams = use(params);
  const [isDragging, setIsDragging] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [index, setIndex] = useState<Index | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // New state for vibecheck flow
  const [isProcessing, setIsProcessing] = useState(false);
  const [vibeCheckResults, setVibeCheckResults] = useState<{ aiSynthesis?: string; score?: number }[]>([]);
  const [showVibeCheck, setShowVibeCheck] = useState(false);
  const [autoRequestConnection, setAutoRequestConnection] = useState(false);
  
  // New state for tracking uploaded files and multi-step process
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isCreatingConnection, setIsCreatingConnection] = useState(false);

  const { login, authenticated, ready } = usePrivy();
  const connectionsService = useConnections();
  const indexesService = useIndexes();
  const intentsService = useIntents();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const fetchIndex = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Use the public indexes service to get the index by share code
      const index = await publicIndexesService.getIndexByShareCode(resolvedParams.code);
      
      setIndex(index);
    } catch (error: unknown) {
      console.error('Error fetching index:', error);
      setError(error instanceof Error ? error.message : 'Index not found or access denied');
      setIndex(null);
    } finally {
      setLoading(false);
    }
  }, [resolvedParams.code]);

  useEffect(() => {
    fetchIndex();
  }, [fetchIndex]);

  // Check for stored vibecheck results after login redirect
  useEffect(() => {
    try {
      const storedVibeCheck = localStorage.getItem(`vibecheck_${resolvedParams.code}`);
      if (storedVibeCheck) {
        try {
          const parsed = JSON.parse(storedVibeCheck);
          setVibeCheckResults(parsed.results);
          setShowVibeCheck(true);
          setAutoRequestConnection(parsed.autoRequest);
          
          // Note: We cannot restore actual File objects from localStorage,
          // but the vibecheck service already has the files on the server side
          // so the multi-step process will work with the existing uploaded files
          console.log('Restored vibecheck results from localStorage');
        } catch (error) {
          console.error('Failed to parse stored vibecheck results:', error);
          localStorage.removeItem(`vibecheck_${resolvedParams.code}`);
        }
      }
    } catch (error) {
      console.warn('localStorage not available:', error);
    }
  }, [resolvedParams.code]);



  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const processFiles = async (files: File[]) => {
    if (!index || files.length === 0) return;

    setIsProcessing(true);
    setShowVibeCheck(false);

    try {
      // Store files for later use in index creation
      setUploadedFiles(files);
      
      const vibeCheckResult = await vibecheckService.runVibeCheckWithFiles(resolvedParams.code, files);
      
      if (!vibeCheckResult.success) {
        throw new Error(vibeCheckResult.error || 'Vibecheck failed');
      }

      // Set the vibecheck results with synthesis and score
      setVibeCheckResults([{ 
        aiSynthesis: vibeCheckResult.synthesis || '', 
        score: vibeCheckResult.score || 0 
      }]);
      setShowVibeCheck(true);
      
    } catch (error) {
      console.error('Error processing files:', error);
      setError(error instanceof Error ? error.message : 'Failed to process files');
    } finally {
      setIsProcessing(false);
    }
  };

   const handleDrop = async (e: React.DragEvent) => {
     e.preventDefault();
     setIsDragging(false);
     
     const droppedFiles = Array.from(e.dataTransfer.files);
     await processFiles(droppedFiles);
   };

   const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
     const selectedFiles = Array.from(e.target.files || []);
     await processFiles(selectedFiles);
     // Reset the input so the same file can be selected again
     if (fileInputRef.current) {
       fileInputRef.current.value = '';
     }
   };

   const handleBrowseClick = () => {
     fileInputRef.current?.click();
   };

  const handleRequestConnection = useCallback(async () => {
    // Check if user is authenticated, if not, store vibecheck results and trigger login
    if (ready && !authenticated) {
      // Store vibecheck results in localStorage before login redirect
      try {
        const vibeCheckData = {
          results: vibeCheckResults,
          autoRequest: true,
          uploadedFiles: uploadedFiles.map(f => ({ name: f.name, size: f.size, type: f.type })) // Store file metadata
        };
        localStorage.setItem(`vibecheck_${resolvedParams.code}`, JSON.stringify(vibeCheckData));
        console.log('Stored vibecheck results in localStorage before login');
      } catch (error) {
        console.warn('Failed to store vibecheck results in localStorage:', error);
      }
      login();
      return;
    }

    if (!authenticated) {
      console.log('Authentication not ready yet');
      return;
    }

    if (!index?.user?.id) {
      console.error('No target user found');
      return;
    }

    try {
      setIsCreatingConnection(true);

      // Step 1: Create new index
      const newIndex = await indexesService.createIndex({
        title: `Collaboration with ${index.user.name}`
      });

      // Step 2: Upload files to the new index (skip if no files available, e.g., after login redirect)
      if (uploadedFiles.length > 0) {
        for (const file of uploadedFiles) {
          await indexesService.uploadFile(newIndex.id, file);
        }
      } else {
        console.log('No files to upload - skipping file upload step (likely after login redirect)');
      }

      // Step 3: Get suggested intents for the new index
      const suggestedIntentsResponse = await indexesService.getSuggestedIntents(newIndex.id);
      const suggestedIntents = suggestedIntentsResponse.intents || [];

      // Step 4: Add suggested intents (up to 5)
      const intentsToAdd = suggestedIntents.slice(0, 2);
      
      for (const suggestedIntent of intentsToAdd) {
        await intentsService.createIntent({
          payload: suggestedIntent.payload,
          indexIds: [newIndex.id],
          isIncognito: false
        });
      }

      // Step 5: Request connection
      await connectionsService.requestConnection(index.user.id);

      setRequestSent(true);
      setAutoRequestConnection(false);

      // Clear stored vibecheck results after successful connection request
      try {
        localStorage.removeItem(`vibecheck_${resolvedParams.code}`);
      } catch (error) {
        console.warn('Failed to clear vibecheck results from localStorage:', error);
      }

      console.log('Multi-step connection request completed successfully');

    } catch (error) {
      console.error('Error in multi-step connection request:', error);
      
      // Handle specific error cases
      if (error && typeof error === 'object' && 'response' in error && 
          (error as { response?: { error?: string } }).response?.error === "Cannot request in current state: REQUEST") {
        setRequestSent(true);
        return;
      }
      setError(error instanceof Error ? error.message : 'Failed to process connection request');
    } finally {
      setIsCreatingConnection(false);
    }
    }, [ready, authenticated, vibeCheckResults, uploadedFiles, index, login, indexesService, intentsService, connectionsService, resolvedParams.code]);

  // Auto-trigger connection request after authentication
  useEffect(() => {
    let isMounted = true;
    
    if (authenticated && autoRequestConnection && showVibeCheck && vibeCheckResults.length > 0 && index?.user?.id) {
      const score = vibeCheckResults[0]?.score || 0;
      if (score > 0.5) {
        console.log('Auto-triggering connection request after login');
        // Use the same multi-step process
        handleRequestConnection()
          .then(() => {
            if (isMounted) {
              console.log('Auto-connection request successful');
            }
          })
          .catch((error) => {
            if (isMounted) {
              console.error('Auto-connection request failed:', error);
              setAutoRequestConnection(false);
            }
          });
      }
    }
    
    return () => {
      isMounted = false;
    };
  }, [authenticated, autoRequestConnection, showVibeCheck, vibeCheckResults, index?.user?.id, handleRequestConnection, resolvedParams.code]);

    const handleStartOver = () => {
    // Clear all vibecheck-related state
    setVibeCheckResults([]);
    setShowVibeCheck(false);
    setRequestSent(false);
    setAutoRequestConnection(false);
    setIsProcessing(false);
    
    // Clear new multi-step process state
    setUploadedFiles([]);
    setIsCreatingConnection(false);
    
    // Clear localStorage
    try {
      localStorage.removeItem(`vibecheck_${resolvedParams.code}`);
    } catch (error) {
      console.warn('Failed to clear vibecheck results from localStorage:', error);
    }
  };



  if (loading) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Loading...</div>
      </ClientLayout>
    );
  }

  if (error) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">
          <h2 className="text-xl font-bold mb-2">Access Denied</h2>
          <p>{error}</p>
        </div>
      </ClientLayout>
    );
  }

  if (!index) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Index not found</div>
      </ClientLayout>
    );
  }

  // Check permissions
  const canViewFiles = index.linkPermissions?.permissions.includes('can-view-files') || false;
  const canMatch = index.linkPermissions?.permissions.includes('can-match') || false;

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
              <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono">{index.title}</h1>
            </div>
            <p className="text-sm text-gray-500 font-ibm-plex-mono">Created {formatDate(index.createdAt)}</p>
          </div>
        </div>

        {canViewFiles && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="space-y-3 w-full">
              <div className="flex justify-between items-center">
                <h2 className="text-xl mt-2 font-semibold text-gray-900">Files</h2>
              </div>
              <div className="space-y-2 flex-1">
                {index.files?.map((file, fileIndex) => (
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

        {canMatch && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="w-full">
              {!showVibeCheck && !isProcessing && (
                <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-4">Curious how your work fits in?</h3>
              )}
              
              {isProcessing && (
                <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-4">Running vibecheck...</h3>
              )}
              
              {showVibeCheck && !isProcessing && (
                <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-4">What could happen here</h3>
              )}
              
              {!showVibeCheck && !isProcessing && (
                <>
                  <div className="mt-4 p-4 bg-white border border-gray-200 rounded-lg">
                    <div className="flex items-start space-x-4">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-700 mb-2">Drop your files and get instant vibe check.</h3>
                        <p className="text-sm text-gray-500">
                          Once uploaded, you'll receive a detailed breakdown of how your content aligns with our mutual goals and potential collaboration opportunities. 
                        </p>
                        { false && 
                        <div className="flex flex-wrap gap-2">
                          <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                            <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                              <Image src="/avatars/agents/privado.svg" alt="ProofLayer" width={16} height={16} />
                            </div>
                            <span className="font-medium text-gray-900">ProofLayer</span>
                            <span className="text-gray-500 text-sm">Due Diligence Agent</span>
                          </div>

                          <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                            <div className="w-6 h-6 bg-purple-100 rounded-lg flex items-center justify-center">
                              <Image src="/avatars/agents/reputex.svg" alt="Threshold" width={16} height={16} />
                            </div>
                            <span className="font-medium text-gray-900">Threshold</span>
                            <span className="text-gray-500 text-sm">Network Manager Agent</span>
                          </div>

                          <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                            <div className="w-6 h-6 bg-indigo-100 rounded-lg flex items-center justify-center">
                              <Image src="/avatars/agents/hapi.svg" alt="Aspecta" width={16} height={16} />
                            </div>
                            <span className="font-medium text-gray-900">Aspecta</span>
                            <span className="text-gray-500 text-sm">Reputation Agent</span>
                          </div>

                          <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                            <div className="w-6 h-6 bg-teal-100 rounded-lg flex items-center justify-center">
                              <Image src="/avatars/agents/trusta.svg" alt="Semantic Relevancy" width={16} height={16} />
                            </div>
                            <span className="font-medium text-gray-900">Semantic Relevancy</span>
                            <span className="text-gray-500 text-sm">Relevancy Agent</span>
                          </div>
                        </div>
                        }
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
                         isDragging 
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

              {isProcessing && (
                <div className=" text-center">
                  <div className="flex items-center justify-center">
                    <Image 
                    className="h-auto"
                    src={'/loading2.gif'} 
                    alt="Hero Illustration" 
                    width={300} 
                    height={200} 
                    style={{
                      imageRendering: 'auto',
                    }}
                  />
                  </div>
                  <p className="text-gray-800 text-sm mt-1">This may take a moment...</p>
                </div>
              )}

              {showVibeCheck && !isProcessing && (
                <div className="mt-4 space-y-4">
                  {vibeCheckResults.length > 0 && (
                    <div className="mb-4">
                      {/* Score and Avatars Display */}
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
                              {Math.round((vibeCheckResults[0].score || 0) * 100)}%
                            </div>
                            <div className="text-sm text-gray-500">Pulse</div>
                          </div>
                          
                          <div className="flex items-center gap-4">
                            <div>
                              <div className="font-semibold text-gray-900 text-right">{index?.user?.name || 'User'}</div>
                              <div className="text-sm text-gray-500 text-right">Index Owner</div>
                            </div>
                            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-lg font-bold text-blue-600">{(index?.user?.name || 'U').charAt(0)}</span>
                            </div>
                          </div>
                        </div>

                      </div>

                      {/* Synthesis Text */}
                      {vibeCheckResults[0].aiSynthesis && (
                        <div className="space-y-2">
                          <div className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_a]:text-[#FC44E7] [&_a]:underline [&_a]:hover:opacity-80 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm">
                            <ReactMarkdown>
                              {vibeCheckResults[0].aiSynthesis}
                            </ReactMarkdown>
                          </div>
                        </div>
                      )}

                      {!vibeCheckResults[0].aiSynthesis && (
                        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                          <p className="text-yellow-800">
                            Vibecheck completed but no detailed analysis was generated. Please try again or contact support.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6">
                {showVibeCheck && vibeCheckResults.length > 0 && (vibeCheckResults[0].score || 0) <= 0.5 && (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-center mb-4">
                    <p className="text-yellow-800 font-medium">Collaboration potential is moderate</p>
                    <p className="text-yellow-700 text-sm mt-1">
                      Based on the analysis, there may be limited synergy for collaboration at this time.
                    </p>
                  </div>
                )}
                


                {autoRequestConnection && authenticated && !isCreatingConnection && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-center mb-4">
                    <div className="flex items-center justify-center mb-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    </div>
                    <p className="text-blue-700 font-medium">Sending connection request...</p>
                    <p className="text-blue-600 text-sm mt-1">Please wait while we process your request.</p>
                  </div>
                )}
                
                {showVibeCheck && vibeCheckResults.length > 0 && (
                  <div className="flex gap-3">
                    <Button
                      onClick={handleStartOver}
                      variant="bordered"
                      className="flex-1"
                    >
                      Start over
                    </Button>
                    
                    {!requestSent && !autoRequestConnection && (vibeCheckResults[0].score || 0) >= 0.5 && (
                      <Button
                        onClick={handleRequestConnection}
                        variant="bordered"
                        className="flex-1 text-white border-black border-b-2"
                        style={{ background: '#3f6ed9' }}
                        disabled={isCreatingConnection}
                      >
                        {isCreatingConnection 
                          ? 'Creating Connection...' 
                          : 'Request Connection'
                        }
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!canViewFiles && !canMatch && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-center items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="text-center">
              <h3 className="text-xl mt-2 font-semibold text-gray-900 mb-2">Limited Access</h3>
              <p className="text-gray-600">You have limited access to this index.</p>
            </div>
          </div>
        )}
      </div>

      {/* Request Processing/Sent Modal */}
      <Dialog.Root open={isCreatingConnection || requestSent}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg max-w-md w-full mx-4 p-6 z-50">
            {isCreatingConnection && !requestSent ? (
              // Creating connection state
              <>
                <div className="flex justify-between items-center mb-4">
                  <Dialog.Title className="text-xl font-bold text-gray-900">Creating connection</Dialog.Title>
                </div>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-center py-6">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
                  </div>
                  <p className="text-gray-600 text-sm text-center">
                    Please wait while we create your index and intents.
                  </p>
                </div>
              </>
            ) : (
              // Request sent state
              <>
                <div className="flex justify-between items-center mb-4">
                  <Dialog.Title className="text-xl font-bold text-gray-900">Request sent</Dialog.Title>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <p className="text-gray-700 mb-2">
                      Your request sent to <strong>{index?.user?.name || 'the user'}</strong>.
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
                        onClick={() => setRequestSent(false)}
                      >
                        Done
                      </Button>
                      <Button
                        className="flex-1 bg-black text-white hover:bg-gray-800"
                        onClick={() => router.push('/inbox')}
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