"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Plus } from "lucide-react";
import React from "react";

interface CreateAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (agent: {
    name: string;
    prompt: string;
    triggers: string[];
    audience: string[];
  }) => void;
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

export default function CreateAgentModal({ open, onOpenChange, onSubmit }: CreateAgentModalProps) {
  const [newAgent, setNewAgent] = useState({
    name: '',
    prompt: '',
    triggers: [''],
    audience: ['']
  });

  const addTrigger = () => {
    setNewAgent(prev => ({
      ...prev,
      triggers: [...prev.triggers, '']
    }));
  };

  const updateTrigger = (index: number, value: string) => {
    setNewAgent(prev => ({
      ...prev,
      triggers: prev.triggers.map((trigger, i) => i === index ? value : trigger)
    }));
  };

  const removeTrigger = (index: number) => {
    setNewAgent(prev => ({
      ...prev,
      triggers: prev.triggers.filter((_, i) => i !== index)
    }));
  };

  const addAudience = () => {
    setNewAgent(prev => ({
      ...prev,
      audience: [...prev.audience, '']
    }));
  };

  const updateAudience = (index: number, value: string) => {
    setNewAgent(prev => ({
      ...prev,
      audience: prev.audience.map((aud, i) => i === index ? value : aud)
    }));
  };

  const removeAudience = (index: number) => {
    setNewAgent(prev => ({
      ...prev,
      audience: prev.audience.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(newAgent);
    
    // Reset form
    setNewAgent({
      name: '',
      prompt: '',
      triggers: [''],
      audience: ['']
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl mx-auto max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900 font-ibm-plex-mono">
            Deploy New Broker Agent
          </DialogTitle>
          <DialogDescription>
            Create a broker agent with custom logic to identify and stake on matches
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="agent-name" className="text-md font-medium font-ibm-plex-mono text-black">
              <div className="mb-2">Agent Name</div>
            </label>
            <Input
              id="agent-name"
              value={newAgent.name}
              onChange={(e) => setNewAgent(prev => ({ ...prev, name: e.target.value }))}
              className="px-4 py-3"
              placeholder="e.g., AI Research Connector"
              required
            />
          </div>
          
          <div>
            <label htmlFor="agent-prompt" className="text-md font-medium font-ibm-plex-mono text-black">
              <div className="mb-2">Agent Prompt</div>
            </label>
            <Textarea
              id="agent-prompt"
              value={newAgent.prompt}
              onChange={(e) => setNewAgent(prev => ({ ...prev, prompt: e.target.value }))}
              rows={3}
              className="px-4 py-3"
              placeholder="Describe what patterns or connections this agent should identify..."
              required
            />
          </div>
          
          <div>
            <label className="text-md font-medium font-ibm-plex-mono text-black">
              <div className="mb-2">Triggers</div>
            </label>
            <div className="space-y-2">
              {newAgent.triggers.map((trigger, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={trigger}
                    onChange={(e) => updateTrigger(index, e.target.value)}
                    className="flex-1 px-4 py-3"
                    placeholder="When should this agent activate?"
                    required
                  />
                  {newAgent.triggers.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeTrigger(index)}
                      className="text-red-600 hover:text-red-700"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTrigger}
                className="text-gray-700"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Trigger
              </Button>
            </div>
          </div>
          
          <div>
            <label className="text-md font-medium font-ibm-plex-mono text-black">
              <div className="mb-2">Target Audience</div>
            </label>
            <div className="space-y-2">
              {newAgent.audience.map((aud, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={aud}
                    onChange={(e) => updateAudience(index, e.target.value)}
                    className="flex-1 px-4 py-3"
                    placeholder="Target index or audience segment"
                    required
                  />
                  {newAgent.audience.length > 1 && (
                    <Button
                      type="button"
                      variant="outline" 
                      size="sm"
                      onClick={() => removeAudience(index)}
                      className="text-red-600 hover:text-red-700"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm" 
                onClick={addAudience}
                className="text-gray-700"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Audience
              </Button>
            </div>
          </div>
          
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              Deploy Agent
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
} 