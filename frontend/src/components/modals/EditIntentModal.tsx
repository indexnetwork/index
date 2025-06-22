"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import * as Dialog from "@radix-ui/react-dialog";
import * as Checkbox from "@radix-ui/react-checkbox";
import { useIndexes } from "@/contexts/APIContext";
import { Index, Intent } from "@/lib/types";
import { Textarea } from "../ui/textarea";
import { Check, Lock, Globe } from "lucide-react";

interface EditIntentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (intent: { id: string; payload: string; indexIds: string[]; isPublic: boolean }) => void;
  intent: Intent | null;
}

export default function EditIntentModal({ 
  open, 
  onOpenChange, 
  onSubmit,
  intent
}: EditIntentModalProps) {
  const [payload, setPayload] = useState('');
  const [selectedIndexes, setSelectedIndexes] = useState<string[]>([]);
  const [availableIndexes, setAvailableIndexes] = useState<Index[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const indexesService = useIndexes();
  const [hasInitialized, setHasInitialized] = useState(false);
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
    if (open && intent && !hasInitialized) {
      setPayload(intent.payload || '');
      setSelectedIndexes(intent.indexes?.map(idx => idx.indexId) || []);
      setIsPublic(intent.isPublic || false);
      setHasInitialized(true);
    }
  }, [open, intent, hasInitialized]);

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      setHasInitialized(false);
      setPayload('');
      setSelectedIndexes([]);
      setIsSuccess(false);
      setIsProcessing(false);
      setIsPublic(false);
    }
  }, [open]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent) return;
    
    setIsProcessing(true);
    
    try {
      await onSubmit({ 
        id: intent.id,
        payload, 
        indexIds: selectedIndexes,
        isPublic
      });
      setIsSuccess(true);
      
      setTimeout(() => {
        setIsSuccess(false);
        onOpenChange(false);
      }, 2000);
    } catch (error) {
      console.error('Error updating intent:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [intent, payload, selectedIndexes, isPublic, onSubmit, onOpenChange]);

  const toggleIndex = useCallback((indexId: string) => {
    setSelectedIndexes(prev => 
      prev.includes(indexId) 
        ? prev.filter(id => id !== indexId)
        : [...prev, indexId]
    );
  }, []);

  if (!intent) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-[50%] top-[50%] max-h-[85vh] w-[90vw] max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-md bg-white p-6 shadow-lg focus:outline-none overflow-hidden flex flex-col">
          <div className="flex-shrink-0 mb-6">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Edit Intent</Dialog.Title>
            <Dialog.Description className="text-sm text-gray-600 mt-2">
              Update your intent details and visibility settings.
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
                      </div>
                    </div>
                  </div>

                  {/* Visibility Section */}
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-md font-medium font-ibm-plex-mono text-black">Visibility</h3>
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            {isPublic ? (
                              <>
                                <Globe className="h-4 w-4" />
                              </>
                            ) : (
                              <>
                                <Lock className="h-4 w-4" />
                              </>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">
                          {isPublic 
                            ? "This intent will be disclosed to people you're relevant to"
                            : "This intent remains private even when you match with others"
                          }
                        </p>
                      </div>
                      <div className="flex items-center gap-3 ml-4">
                        <button
                          type="button"
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 cursor-pointer ${
                            isPublic ? 'bg-blue-600' : 'bg-gray-300'
                          }`}
                          onClick={() => setIsPublic(!isPublic)}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              isPublic ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>

                </form>
              ) : isProcessing ? (
                <div className="text-center py-8 space-y-6">
                  <h2 className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Updating Your Intent</h2>
                  <p className="text-gray-600">
                    Your intent is being updated. This will just take a moment...
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
                  <h2 className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Intent Successfully Updated!</h2>
                  <p className="text-gray-600">
                    Your intent has been updated and is now live.
                  </p>
                  <div className="flex justify-center">
                    <Button
                      className="font-medium bg-gray-800 hover:bg-black text-white"
                      onClick={() => onOpenChange(false)}
                    >
                      Close
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
                Update Intent
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
} 