"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Globe, Lock } from "lucide-react";

interface CreateIndexModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (index: { name: string; prompt?: string; joinPolicy?: 'anyone' | 'invite_only' }) => Promise<void>;
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

export default function CreateIndexModal({ open, onOpenChange, onSubmit }: CreateIndexModalProps) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [joinPolicy, setJoinPolicy] = useState<'anyone' | 'invite_only'>('invite_only');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      return;
    }
    
    try {
      await onSubmit({ name: name.trim(), prompt: prompt.trim() || undefined, joinPolicy });
      setName('');
      setPrompt('');
      setJoinPolicy('invite_only');
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating index:', error);
      // You might want to show an error state here
    }
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
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="name" className="text-md font-medium font-ibm-plex-mono text-black">
                <div className="mb-2">Index Name</div>
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                className=" px-4 py-3"
                placeholder="Enter index name..."
                required
                minLength={1}
              />
            </div>

            <div>
              <label htmlFor="prompt" className="text-md font-medium font-ibm-plex-mono text-black">
                <div className="mb-2">Prompt (Optional)</div>
              </label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                placeholder="Define what people can share in this index..."
                rows={3}
              />
            </div>

            <div>
              <label className="text-md font-medium font-ibm-plex-mono text-black">
                <div className="mb-2">Who can join</div>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setJoinPolicy('anyone')}
                  className={`border-2 p-3 rounded-md text-left transition-all ${
                    joinPolicy === 'anyone'
                      ? 'border-[#007EFF] bg-white' 
                      : 'border-[#E0E0E0] bg-[#F8F9FA] hover:border-[#007EFF]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Globe className={`h-4 w-4 ${joinPolicy === 'anyone' ? "text-[#007EFF]" : "text-gray-600"}`} />
                    <h4 className={`text-sm font-medium font-ibm-plex-mono ${joinPolicy === 'anyone' ? "text-black" : "text-[#666]"}`}>
                      Anyone can join
                    </h4>
                  </div>
                  <p className="text-xs text-gray-600 font-ibm-plex-mono">
                    People can discover and join freely.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setJoinPolicy('invite_only')}
                  className={`border-2 p-3 rounded-md text-left transition-all ${
                    joinPolicy === 'invite_only'
                      ? 'border-[#007EFF] bg-white' 
                      : 'border-[#E0E0E0] bg-[#F8F9FA] hover:border-[#007EFF]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Lock className={`h-4 w-4 ${joinPolicy === 'invite_only' ? "text-[#007EFF]" : "text-gray-600"}`} />
                    <h4 className={`text-sm font-medium font-ibm-plex-mono ${joinPolicy === 'invite_only' ? "text-black" : "text-[#666]"}`}>
                      Private
                    </h4>
                  </div>
                  <p className="text-xs text-gray-600 font-ibm-plex-mono">
                    Only people with the invitation link can join.
                  </p>
                </button>
              </div>
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
                disabled={!name.trim()}
              >
                Create
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog.Root>
  );
} 