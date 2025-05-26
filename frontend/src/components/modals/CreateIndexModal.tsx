"use client";

import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import React from "react";
// import { FolderOpen, Upload } from "lucide-react";

interface CreateIndexModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DialogComponentProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  className?: string;
  children?: React.ReactNode;
}

interface DialogDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  className?: string;
  children?: React.ReactNode;
}

// Create simple wrapper components for dialog parts
const DialogContent = ({ className, children, ...props }: DialogComponentProps) => (
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
    <Dialog.Content
      className={`fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 sm:rounded-lg ${className}`}
      {...props}
    >
      {children}
      <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
);

const DialogHeader = ({ className, children, ...props }: DialogComponentProps) => (
  <div className={`flex flex-col space-y-1.5 text-center sm:text-left ${className}`} {...props}>
    {children}
  </div>
);

const DialogTitle = ({ className, children, ...props }: DialogTitleProps) => (
  <Dialog.Title className={`text-lg font-semibold leading-none tracking-tight ${className}`} {...props}>
    {children}
  </Dialog.Title>
);

const DialogDescription = ({ className, children, ...props }: DialogDescriptionProps) => (
  <Dialog.Description className={`text-sm text-gray-500 ${className}`} {...props}>
    {children}
  </Dialog.Description>
);

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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg mx-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Create New Index</DialogTitle>
          <DialogDescription>
            Create a new index to organize and share your knowledge base.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {!isProcessing && !isSuccess ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="name" className="text-md font-medium font-ibm-plex-mono text-black">
                  <div className="mb-2">Index Name</div>
                </label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className=" px-4 py-3"
                  placeholder="Enter index name..."
                  required
                />
              </div>

              <div className="flex justify-end space-x-3">
                <Button
                  variant="outline" 
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                >
                  Create
                </Button>
              </div>
            </form>
          ) : isProcessing ? (
            <div className="text-center py-8 space-y-6">
              <h2 className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Processing Your Index</h2>
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
              <h2 className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Index Successfully Created!</h2>
              <p className="text-gray-600">
                Your new index &ldquo;{name}&rdquo; has been created and is ready to use.
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
                  onClick={() => onOpenChange(false)}
                >
                  View My Indexes
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog.Root>
  );
} 