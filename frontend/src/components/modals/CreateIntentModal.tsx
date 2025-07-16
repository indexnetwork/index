"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import * as Dialog from "@radix-ui/react-dialog";
import { useIndexes } from "@/contexts/APIContext";
import { Textarea } from "../ui/textarea";
import { ChevronDown, ChevronUp, EyeOff, Globe } from "lucide-react";

interface VerifiableProof {
  id: string;
  name: string;
  type: 'pdf' | 'markdown' | 'json' | 'text';
  size: number;
  verified: boolean;
  verificationDate: string;
  content: string;
}

interface CreateIntentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (intent: { payload: string; attachments: File[]; isIncognito: boolean; indexIds: string[] }) => Promise<void>;
  initialPayload?: string;
  indexId?: string; // Add indexId prop for getIntentPreview call
}

export default function CreateIntentModal({ 
  open, 
  onOpenChange, 
  onSubmit,
  initialPayload = '',
  indexId
}: CreateIntentModalProps) {
  const [payload, setPayload] = useState(initialPayload);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const indexesService = useIndexes();
  // const [relevantContent, setRelevantContent] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [verifiableProofs, setVerifiableProofs] = useState<VerifiableProof[]>([]);
  const [expandedProofs, setExpandedProofs] = useState<Set<string>>(new Set());
  const [hasInitialized, setHasInitialized] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isIncognito, setIsIncognito] = useState(false);
  const [availableIndexes, setAvailableIndexes] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedIndexIds, setSelectedIndexIds] = useState<string[]>([]);
  const [isLoadingIndexes, setIsLoadingIndexes] = useState(false);
  const [isGlobalDiscoveryEnabled, setIsGlobalDiscoveryEnabled] = useState(true);

  // Get global index ID from environment
  const globalIndexId = process.env.NEXT_PUBLIC_GLOBAL_INDEX_ID;

  // Compute final index IDs including global discovery
  const finalIndexIds = useMemo(() => {
    return selectedIndexIds
    /*
    return isGlobalDiscoveryEnabled && globalIndexId 
      ? [...selectedIndexIds, globalIndexId] 
      : selectedIndexIds;
      */
  }, [isGlobalDiscoveryEnabled, globalIndexId, selectedIndexIds]);

  // Initialize form data when modal opens
  useEffect(() => {
    if (open && !hasInitialized) {
      
      // Set initial payload immediately
      if (initialPayload) {
        setPayload(initialPayload);
        
        // If we have indexId, fetch enhanced content
        if (indexId) {
          
          setIsLoadingPreview(true);
          indexesService.getIntentPreview(indexId, initialPayload)
            .then((processedPayload) => {
              // Append the enhanced content to the initial payload
              setPayload(processedPayload);
            })
            .catch((error) => {
              console.error('Error processing intent:', error);
              // Keep the original payload if enhancement fails
            })
            .finally(() => {
              setIsLoadingPreview(false);
            });
        }
      } else {
        setPayload('');
      }

      // Fetch available indexes
      setIsLoadingIndexes(true);
      indexesService.getIndexes()
        .then((response) => {
          
          setAvailableIndexes(response.indexes || []);
          // Pre-select the current index if provided
          if (indexId) {
            setSelectedIndexIds([indexId]);
          }
        })
        .catch((error) => {
          console.error('Error fetching indexes:', error);
        })
        .finally(() => {
          setIsLoadingIndexes(false);
        });
      
      setHasInitialized(true);
    }
  }, [open, hasInitialized, initialPayload, indexId, indexesService]);

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      setHasInitialized(false);
      setPayload('');
      setAttachments([]);
      setIsSuccess(false);
      setIsProcessing(false);
      setIsLoadingPreview(false);
      setIsIncognito(false);
      setAvailableIndexes([]);
      setSelectedIndexIds([]);
      setIsLoadingIndexes(false);
      setIsGlobalDiscoveryEnabled(true);
    }
  }, [open]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    
    try {
      await onSubmit({ payload, attachments, isIncognito, indexIds: finalIndexIds });
      setPayload('');
      setAttachments([]);
      setIsIncognito(false);
      setSelectedIndexIds([]);
      setIsGlobalDiscoveryEnabled(true);
      setIsSuccess(true);
      
      setTimeout(() => {
        setIsSuccess(false);
        onOpenChange(false);
      }, 3000);
    } catch (error) {
      console.error('Error creating intent:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [payload, attachments, isIncognito, finalIndexIds, onSubmit, onOpenChange]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(file => {
      const validTypes = [
        'application/pdf',
        'text/markdown',
        'application/json',
        'text/plain'
      ];
      return validTypes.includes(file.type);
    });
    
    setAttachments(prev => [...prev, ...validFiles]);
  }, []);

  const handleFileRemove = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleProofSelect = useCallback((proof: VerifiableProof) => {
    // Convert VerifiableProof to File and add to attachments
    const file = new File(
      [proof.content],
      proof.name,
      { type: `application/${proof.type}` }
    );
    setAttachments(prev => [...prev, file]);
  }, []);

  const handleProofRemove = useCallback((proofId: string) => {
    setVerifiableProofs(prev => prev.filter(p => p.id !== proofId));
    // Also remove from attachments if it was added
    setAttachments(prev => prev.filter(f => !f.name.includes(proofId)));
  }, []);

  const toggleProofExpansion = useCallback((proofId: string) => {
    setExpandedProofs(prev => {
      const next = new Set(prev);
      if (next.has(proofId)) {
        next.delete(proofId);
      } else {
        next.add(proofId);
      }
      return next;
    });
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-[50%] top-[50%] max-h-[85vh] w-[90vw] max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-md bg-white p-6 shadow-lg focus:outline-none overflow-hidden flex flex-col">
          <div className="flex-shrink-0 mb-6">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Create New Intent</Dialog.Title>
            
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="space-y-6 pr-2">
              {!isProcessing && !isSuccess ? (
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Title Section */}
                  <div>
                    <label htmlFor="title" className="text-md font-medium font-ibm-plex-mono text-black">
                      <div className="mb-2">What are you looking for?</div>
                    </label>
                    <div className="space-y-4">
                      <div className="relative">
                        <Textarea
                          id="payload"
                          value={payload}
                          onChange={(e) => setPayload(e.target.value)}
                          className="min-h-[150px]"
                          placeholder="Enter your intent here... (e.g. Looking for experienced ZK proof researchers interested in privacy-preserving identity system)"
                          required
                        />
                        {isLoadingPreview && (
                          <div className="absolute bottom-2 right-2 flex items-center gap-2 bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs">
                            <div className="w-3 h-3 border border-blue-700 border-t-transparent rounded-full animate-spin" />
                            Enhancing with context...
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Visibility Section */}
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-md font-medium font-ibm-plex-mono text-black">Incognito Mode</h3>
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            {!isIncognito ? (
                              <>
                                <Globe className="h-4 w-4" />
                              </>
                            ) : (
                              <>
                                <EyeOff className="h-4 w-4" />
                              </>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">
                          {!isIncognito 
                            ? "Your intent is visible to relevant people"
                            : "Your intent stays hidden - no one can see you"
                          }
                        </p>
                      </div>
                      <div className="flex items-center gap-3 ml-4">
                        <button
                          type="button"
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 cursor-pointer ${
                            isIncognito ? 'bg-blue-600' : 'bg-gray-300'
                          }`}
                          onClick={() => setIsIncognito(!isIncognito)}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              isIncognito ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                  {/* Global Discovery Section */}
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-md font-medium font-ibm-plex-mono text-black">Global Discovery</h3>
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Globe className="h-4 w-4" />
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">
                          {isGlobalDiscoveryEnabled 
                            ? "Your intent will be indexed globally across the network"
                            : "Your intent will only be visible in selected indexes"
                          }
                        </p>
                      </div>
                      <div className="flex items-center gap-3 ml-4">
                        <button
                          type="button"
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 cursor-pointer ${
                            isGlobalDiscoveryEnabled ? 'bg-blue-600' : 'bg-gray-300'
                          }`}
                          onClick={() => setIsGlobalDiscoveryEnabled(!isGlobalDiscoveryEnabled)}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              isGlobalDiscoveryEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>


                  {/* Index Selection Section */}
                  <div>
                    <div className="mb-2">
                      <h3 className="text-md font-medium font-ibm-plex-mono text-black">Index this intent</h3>
                      <p className="text-sm text-gray-600">
                        Select which indexes your intent should be accessible in
                      </p>
                    </div>
                    
                    {isLoadingIndexes ? (
                      <div className="flex items-center gap-2 p-3 border border-gray-200 rounded-md">
                        <div className="w-4 h-4 border border-gray-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm text-gray-600">Loading indexes...</span>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-md p-2">
                        {availableIndexes.length === 0 ? (
                          <div className="text-sm text-gray-500 p-2 text-center">
                            No indexes available
                          </div>
                        ) : (
                          availableIndexes.map((index) => (
                            <label
                              key={index.id}
                              className="flex items-center space-x-3 p-1 hover:bg-gray-50 rounded cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedIndexIds.includes(index.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedIndexIds(prev => [...prev, index.id]);
                                  } else {
                                    setSelectedIndexIds(prev => prev.filter(id => id !== index.id));
                                  }
                                }}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                              />
                              <span className="text-sm font-medium text-gray-900">
                                {index.title}
                              </span>
                            </label>
                          ))
                        )}
                      </div>
                    )}

                  </div>

                  {false && (
                    <>
                      {/* Verifiable Proofs Section */}
                      <div>
                        <label className="text-md font-medium font-ibm-plex-mono text-black">
                          <div className="mb-2">Verifiable Proofs</div>
                        </label>
                        <div className="space-y-3">
                          {verifiableProofs.map((proof) => (
                            <div 
                              key={proof.id}
                              className="bg-gray-50 rounded-md border border-gray-200 overflow-hidden"
                            >
                              <div className="flex items-center justify-between p-3">
                                <div className="flex items-center space-x-3">
                                  <div className="w-10 h-10 flex items-center justify-center bg-blue-100 rounded">
                                    {proof.type === 'pdf' && '📄'}
                                    {proof.type === 'markdown' && '📝'}
                                    {proof.type === 'json' && '⚙️'}
                                    {proof.type === 'text' && '📄'}
                                  </div>
                                  <div>
                                    <div className="flex items-center space-x-2">
                                      <p className="text-sm font-medium text-gray-900">{proof.name}</p>
                                      {proof.verified && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                          Verified
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-gray-500">
                                      {(proof.size / 1024).toFixed(1)} KB - Verified on {proof.verificationDate}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleProofSelect(proof)}
                                  >
                                    Add
                                  </Button>
                                  <button
                                    type="button"
                                    onClick={() => toggleProofExpansion(proof.id)}
                                    className="text-gray-400 hover:text-gray-600 p-1"
                                  >
                                    {expandedProofs.has(proof.id) ? (
                                      <ChevronUp className="h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleProofRemove(proof.id)}
                                    className="text-gray-400 hover:text-gray-600"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                              
                              {expandedProofs.has(proof.id) && (
                                <div className="px-3 pb-3 pt-2 border-t border-gray-200">
                                  <div className="bg-white rounded-md p-3 text-sm text-gray-700">
                                    {proof.content}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* File Attachments Section */}
                      <div>
                        <label className="text-md font-medium font-ibm-plex-mono text-black">
                          <div className="mb-2">Additional Attachments</div>
                        </label>
                        <div 
                          className={`border-2 border-dashed rounded-md p-4 transition-colors ${
                            isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragging(true);
                          }}
                          onDragLeave={(e) => {
                            e.preventDefault();
                            setIsDragging(false);
                          }}
                          onDrop={handleFileDrop}
                        >
                          <div className="text-center">
                            <p className="text-sm text-gray-600 mb-2">
                              Drag and drop additional files here
                            </p>
                            <p className="text-xs text-gray-500">
                              Supported formats: PDF, Markdown, JSON, Text
                            </p>
                          </div>
                        </div>

                        {attachments.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {attachments.map((file, index) => (
                              <div 
                                key={index}
                                className="flex items-center justify-between p-2 bg-gray-50 rounded-md"
                              >
                                <div className="flex items-center space-x-2">
                                  <div className="w-8 h-8 flex items-center justify-center bg-blue-100 rounded">
                                    {file.type === 'application/pdf' && '📄'}
                                    {file.type === 'text/markdown' && '📝'}
                                    {file.type === 'application/json' && '⚙️'}
                                    {file.type === 'text/plain' && '📄'}
                                  </div>
                                  <div>
                                    <p className="text-sm font-medium text-gray-900">{file.name}</p>
                                    <p className="text-xs text-gray-500">
                                      {(file.size / 1024).toFixed(1)} KB
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleFileRemove(index)}
                                  className="text-gray-400 hover:text-gray-600"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}




                </form>
              ) : isProcessing ? (
                <div className="text-center py-8 space-y-6">
                  <h2 className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Processing Your Intent</h2>
                  <p className="text-gray-600">
                    Your intent is being processed and broadcasted. This will just take a moment...
                  </p>
                  <div className="flex justify-center space-x-2">
                    {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((letter) => (
                      <div
                        key={letter}
                        className="w-8 h-8 flex items-center justify-center bg-[#1a2634] text-gray-300 border border-gray-200 rounded-md"
                      >
                        {letter}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 space-y-6">
                  <h2 className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Intent Successfully Created!</h2>
                  <p className="text-gray-600">
                    Your intent has been registered.
                  </p>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="border border-gray-200 p-4 rounded-md bg-white">
                      <p className="text-2xl font-bold text-gray-900">~24h</p>
                      <p className="text-sm text-gray-600">Estimated Time</p>
                    </div>
                    <div className="border border-gray-200 p-4 rounded-md bg-white">
                      <p className="text-2xl font-bold text-gray-900">85%</p>
                      <p className="text-sm text-gray-600">Match Probability</p>
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <Button
                      className="font-medium bg-gray-800 hover:bg-black text-white"
                      onClick={() => onOpenChange(false)}
                    >
                      View My Intents
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Fixed Action Buttons */}
          {!isProcessing && !isSuccess && (
            <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200 flex-shrink-0">
              <Dialog.Close asChild>
                <Button variant="outline">
                  Cancel
                </Button>
              </Dialog.Close>
                                <Button
                type="submit"
                onClick={(e) => {
                  e.preventDefault();
                  handleSubmit(e);
                }}
                disabled={finalIndexIds.length === 0 || !payload.trim()}
              >
                Broadcast Intent
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
} 