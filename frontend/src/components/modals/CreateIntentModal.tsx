"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import * as Dialog from "@radix-ui/react-dialog";
import * as Checkbox from "@radix-ui/react-checkbox";
import { useIndexes } from "@/contexts/APIContext";
import { Index } from "@/lib/types";
import { Textarea } from "../ui/textarea";
import { ChevronDown, ChevronUp, Check } from "lucide-react";

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
  onSubmit: (intent: { payload: string; indexIds: string[]; attachments: File[]; isPublic: boolean }) => void;
  initialPayload?: string;
  initialIndexIds?: string[];
  indexId?: string; // Add indexId prop for getIntentPreview call
}

export default function CreateIntentModal({ 
  open, 
  onOpenChange, 
  onSubmit,
  initialPayload = '',
  initialIndexIds = [],
  indexId
}: CreateIntentModalProps) {
  const [payload, setPayload] = useState(initialPayload);
  const [selectedIndexes, setSelectedIndexes] = useState<string[]>(initialIndexIds);
  const [availableIndexes, setAvailableIndexes] = useState<Index[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const indexesService = useIndexes();
  // const [relevantContent, setRelevantContent] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [verifiableProofs, setVerifiableProofs] = useState<VerifiableProof[]>([]);
  const [expandedProofs, setExpandedProofs] = useState<Set<string>>(new Set());
  const [hasInitialized, setHasInitialized] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isPublic, setIsPublic] = useState(false);

  // Fetch indexes when modal opens
  const fetchIndexes = useCallback(async () => {
    try {
      const response = await indexesService.getIndexes();
      setAvailableIndexes(response.indexes || []);
    } catch (error) {
      console.error('Error fetching indexes:', error);
    } finally {
      setLoading(false);
    }
  }, [indexesService]);

  useEffect(() => {
    if (open) {
      fetchIndexes();
    }
  }, [open, fetchIndexes]);

  // Initialize form data when modal opens
  useEffect(() => {
    if (open && !hasInitialized) {
      // Set initial indexes
      setSelectedIndexes([...initialIndexIds]);
      
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
      
      setHasInitialized(true);
    }
  }, [open, hasInitialized, initialIndexIds, initialPayload, indexId, indexesService]);

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      setHasInitialized(false);
      setPayload('');
      setSelectedIndexes([]);
      setAttachments([]);
      setIsSuccess(false);
      setIsProcessing(false);
      setIsLoadingPreview(false);
      setIsPublic(false);
    }
  }, [open]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    
    try {
      await onSubmit({ payload, indexIds: selectedIndexes, attachments, isPublic });
      setPayload('');
      setSelectedIndexes([]);
      setAttachments([]);
      setIsPublic(false);
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
  }, [payload, selectedIndexes, attachments, isPublic, onSubmit, onOpenChange]);

  const toggleIndex = useCallback((indexId: string) => {
    setSelectedIndexes(prev => 
      prev.includes(indexId) 
        ? prev.filter(id => id !== indexId)
        : [...prev, indexId]
    );
  }, []);

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
            <Dialog.Description className="text-sm text-gray-600 mt-2">
              Broadcast your intent to connect with others across selected indexes.
            </Dialog.Description>
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
                          className="min-h-[200px]"
                          placeholder="Enter your intent here..."
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
                    <label className="text-md font-medium font-ibm-plex-mono text-black">
                      <div className="mb-2">Visibility</div>
                    </label>
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="private"
                          name="visibility"
                          checked={!isPublic}
                          onChange={() => setIsPublic(false)}
                          className="text-blue-600"
                        />
                        <label htmlFor="private" className="text-sm text-gray-700 cursor-pointer">
                          Private - Only visible to selected index members
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          id="public"
                          name="visibility"
                          checked={isPublic}
                          onChange={() => setIsPublic(true)}
                          className="text-blue-600"
                        />
                        <label htmlFor="public" className="text-sm text-gray-700 cursor-pointer">
                          Public - Visible to everyone
                        </label>
                      </div>
                    </div>
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

                  {/* Indexes Section */}
                  <div>
                    <label className="text-md font-medium font-ibm-plex-mono text-black">
                      <div className="mb-2">Share when this intent is matched</div>
                    </label>
                    <div className="space-y-2">
                      {loading ? (
                        <div className="text-center py-4 text-gray-500">Loading indexes...</div>
                      ) : availableIndexes.length === 0 ? (
                        <div className="text-center py-4 text-gray-500">No indexes available</div>
                      ) : (
                        availableIndexes.map((index) => (
                          <div key={index.id} className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded-md">
                            <Checkbox.Root
                              id={`index-${index.id}`}
                              checked={selectedIndexes.includes(index.id)}
                              onCheckedChange={() => toggleIndex(index.id)}
                              className="flex h-4 w-4 items-center justify-center rounded border border-gray-300 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                            >
                              <Checkbox.Indicator className="text-white">
                                <Check className="h-3 w-3" />
                              </Checkbox.Indicator>
                            </Checkbox.Root>
                            <label
                              htmlFor={`index-${index.id}`}
                              className="text-sm text-gray-800 font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                            >
                              {index.title}
                              <span className="text-gray-500 text-xs ml-2">({index._count?.members || 0} members)</span>
                            </label>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Examples Section */}
                  <div className="bg-yellow-50 p-4 border border-gray-200">
                    <p className="text-gray-800 text-sm mb-4">Examples:</p>
                    <ol className="text-gray-800 text-sm list-disc list-inside space-y-2">
                      <li>Looking for experienced ZK proof researchers interested in privacy-preserving identity systems</li>
                      <li>Seeking co-founder with ML expertise for healthcare startup with early traction</li>
                      <li>Want to connect with climate tech investors focused on hardware solutions</li>
                    </ol>
                  </div>
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
                    Your intent has been broadcasted across {selectedIndexes.length} selected {selectedIndexes.length === 1 ? 'index' : 'indexes'}.
                  </p>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="border border-gray-200 p-4 rounded-md bg-white">
                      <p className="text-2xl font-bold text-gray-900">{selectedIndexes.length}</p>
                      <p className="text-sm text-gray-600">Indexes Searched</p>
                    </div>
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