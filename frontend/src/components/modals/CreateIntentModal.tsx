"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { indexesService, Index } from "@/services/indexes";

interface CreateIntentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (intent: { title: string; indexIds: string[] }) => void;
}

export default function CreateIntentModal({ open, onOpenChange, onSubmit }: CreateIntentModalProps) {
  const [title, setTitle] = useState('');
  const [selectedIndexes, setSelectedIndexes] = useState<string[]>([]);
  const [availableIndexes, setAvailableIndexes] = useState<Index[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchIndexes = async () => {
      try {
        const indexes = await indexesService.getIndexes();
        setAvailableIndexes(indexes);
      } catch (error) {
        console.error('Error fetching indexes:', error);
      } finally {
        setLoading(false);
      }
    };

    if (open) {
      fetchIndexes();
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    
    try {
      await onSubmit({ title, indexIds: selectedIndexes });
      setTitle('');
      setSelectedIndexes([]);
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
  };

  const toggleIndex = (indexId: string) => {
    setSelectedIndexes(prev => 
      prev.includes(indexId) 
        ? prev.filter(id => id !== indexId)
        : [...prev, indexId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg mx-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900 font-ibm-plex">Create New Intent</DialogTitle>
          <DialogDescription>
            Broadcast your intent to connect with others across selected indexes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {!isProcessing && !isSuccess ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="title" className="text-md font-medium font-ibm-plex text-black">
                  <div className="mb-2">What are you looking for?</div>
                </label>
                <textarea
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-100 border border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200 text-gray-800 min-h-[120px] text-md"
                  placeholder="Enter your intent here..."
                  required
                />
              </div>

              <div>
                <label className="text-md font-medium font-ibm-plex text-black">
                  <div className="mb-2">Share when this intent is matched</div>
                </label>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {loading ? (
                    <div className="text-center py-4 text-gray-500">Loading indexes...</div>
                  ) : availableIndexes.length === 0 ? (
                    <div className="text-center py-4 text-gray-500">No indexes available</div>
                  ) : (
                    availableIndexes.map((index) => (
                      <div key={index.id} className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded-md">
                        <Checkbox
                          id={`index-${index.id}`}
                          checked={selectedIndexes.includes(index.id)}
                          onCheckedChange={() => toggleIndex(index.id)}
                        />
                        <label
                          htmlFor={`index-${index.id}`}
                          className="text-sm text-gray-800 font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {index.name}
                          <span className="text-gray-500 text-xs ml-2">({index.members} members)</span>
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="bg-yellow-50 p-4 border border-gray-200">
                <p className="text-gray-800 text-sm mb-4">Examples:</p>
                <ol className="text-gray-800 text-sm list-disc list-inside space-y-2">
                  <li>Looking for experienced ZK proof researchers interested in privacy-preserving identity systems</li>
                  <li>Seeking co-founder with ML expertise for healthcare startup with early traction</li>
                  <li>Want to connect with climate tech investors focused on hardware solutions</li>
                </ol>
              </div>

              <div className="flex justify-end space-x-3">
                <Button
                  variant="outline" 
                  onClick={() => onOpenChange(false)}
                  className="font-medium text-gray-700 rounded-[1px] cursor-pointer hover:bg-gray-50"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="font-medium bg-gray-800 rounded-[1px] cursor-pointer hover:bg-black text-white"
                >
                  Broadcast Intent
                </Button>
              </div>
            </form>
          ) : isProcessing ? (
            <div className="text-center py-8 space-y-6">
              <h2 className="text-xl font-bold text-gray-900 font-ibm-plex">Processing Your Intent</h2>
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
              <h2 className="text-xl font-bold text-gray-900 font-ibm-plex">Intent Successfully Created!</h2>
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
      </DialogContent>
    </Dialog>
  );
} 