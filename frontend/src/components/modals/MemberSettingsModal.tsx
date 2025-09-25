'use client';

import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Index } from '@/lib/types';
import { X } from 'lucide-react';
import MemberSettingsTab from './IndexSettingsModal/MemberSettingsTab';

interface MemberSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: Index;
}

export default function MemberSettingsModal({ open, onOpenChange, index }: MemberSettingsModalProps) {
  const handleLeave = () => {
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[75vh] flex flex-col z-50">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">
              Member Settings - {index.title}
            </Dialog.Title>
          </div>
          
          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>

          {/* Content */}
          <div className="flex-1">
            <MemberSettingsTab 
              index={index} 
              onLeave={handleLeave}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
