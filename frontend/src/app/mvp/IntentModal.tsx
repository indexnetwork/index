"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { X } from "lucide-react";

interface IntentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Sample indexes data
const SAMPLE_INDEXES = [
  { id: 1, name: "Portfolio", members: 3, lastUpdated: "May 4" },
  { id: 2, name: "2025 Thesis", members: 10, lastUpdated: "May 4" },
  { id: 3, name: "2024 Thesis", members: 3, lastUpdated: "May 4" },
  { id: 4, name: "AI Startups", members: 2, lastUpdated: "May 4" },
  { id: 5, name: "Web3 Startups", members: 2, lastUpdated: "May 4" },
  { id: 6, name: "Climate Startups", members: 2, lastUpdated: "May 4" },
];

export default function IntentModal({ open, onOpenChange }: IntentModalProps) {
  const [title, setTitle] = useState('');
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([2, 3, 4]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('Creating intent:', { title, selectedIndexes });
    
    setTitle('');
    setSelectedIndexes([]);
    setIsProcessing(false);
    setIsSuccess(true);
    
    setTimeout(() => {
      setIsSuccess(false);
      onOpenChange(false);
    }, 3000);
  };

  const toggleIndex = (indexId: number) => {
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
                <label htmlFor="title" className="block text-sm font-medium text-gray-900 mb-2">
                  What are you looking for?
                </label>
                <textarea
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-100 border border-gray-500  focus:outline-none focus:ring-2 focus:ring-gray-200 text-gray-800 min-h-[120px] text-md"
                  placeholder="Enter your intent here..."
                  required
                />
              </div>

              <div className="bg-yellow-50 p-4 border border-gray-200">
                <p className="text-gray-800 text-sm mb-4">Examples:</p>
                <ul className="text-gray-800 text-sm list-disc list-inside space-y-2">
                  <li>Looking for experienced ZK proof researchers interested in privacy-preserving identity systems</li>
                  <li>Seeking co-founder with ML expertise for healthcare startup with early traction</li>
                  <li>Want to connect with climate tech investors focused on hardware solutions</li>
                </ul>
              </div>

              <div className="flex justify-end space-x-3">
                <Button
                  variant="outline" 
                  onClick={() => onOpenChange(false)}
                  className="font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="font-medium bg-gray-800 hover:bg-black text-white"
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