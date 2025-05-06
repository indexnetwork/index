"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FolderOpen, Upload } from "lucide-react";

interface CreateIndexModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreateIndexModal({ open, onOpenChange }: CreateIndexModalProps) {
  const [name, setName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('Creating index:', { name, selectedFiles });
    
    setName('');
    setSelectedFiles([]);
    setIsProcessing(false);
    setIsSuccess(true);
    
    setTimeout(() => {
      setIsSuccess(false);
      onOpenChange(false);
    }, 3000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg mx-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900 font-ibm-plex">Create New Index</DialogTitle>
          <DialogDescription>
            Create a new index to organize and share your knowledge base.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {!isProcessing && !isSuccess ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-900 mb-2">
                  Index Name
                </label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-100 border border-gray-500"
                  placeholder="Enter index name..."
                  required
                />
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
                  Create
                </Button>
              </div>
            </form>
          ) : isProcessing ? (
            <div className="text-center py-8 space-y-6">
              <h2 className="text-xl font-bold text-gray-900 font-ibm-plex">Processing Your Index</h2>
              <p className="text-gray-600">
                Your index is being created. This will just take a moment...
              </p>
              <div className="flex justify-center space-x-2">
                {['1', '2', '3', '4', '5', '6', '7', '8'].map((number) => (
                  <div
                    key={number}
                    className="w-8 h-8 flex items-center justify-center bg-[#1a2634] text-gray-300 border border-gray-200 rounded-md"
                  >
                    {number}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 space-y-6">
              <h2 className="text-xl font-bold text-gray-900 font-ibm-plex">Index Successfully Created!</h2>
              <p className="text-gray-600">
                Your new index "{name}" has been created and is ready to use.
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div className="border border-gray-200 p-4 rounded-md bg-white">
                  <p className="text-2xl font-bold text-gray-900">0</p>
                  <p className="text-sm text-gray-600">Documents</p>
                </div>
                <div className="border border-gray-200 p-4 rounded-md bg-white">
                  <p className="text-2xl font-bold text-gray-900">0</p>
                  <p className="text-sm text-gray-600">Members</p>
                </div>
                <div className="border border-gray-200 p-4 rounded-md bg-white">
                  <p className="text-2xl font-bold text-gray-900">Ready</p>
                  <p className="text-sm text-gray-600">Status</p>
                </div>
              </div>
              <div className="flex justify-center">
                <Button
                  className="font-medium bg-gray-800 hover:bg-black text-white"
                  onClick={() => onOpenChange(false)}
                >
                  View My Indexes
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
} 