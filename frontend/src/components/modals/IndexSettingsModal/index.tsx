'use client';

import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAuthenticatedAPI } from '@/lib/api';
import { Index } from '@/lib/types';
import { X } from 'lucide-react';
import MemberSettingsTab from './MemberSettingsTab';
import OwnerSettingsTab from './OwnerSettingsTab';
import { MemberSettings, TabType } from './types';

interface IndexSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: Index;
  onIndexUpdate?: (updatedIndex: Index) => void;
}

export default function IndexSettingsModal({ open, onOpenChange, index, onIndexUpdate }: IndexSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('member');
  const [memberSettings, setMemberSettings] = useState<MemberSettings | null>(null);
  
  const api = useAuthenticatedAPI();

  // Fetch member settings when modal opens
  const fetchMemberSettings = useCallback(async () => {
    try {
      const response = await api.get<MemberSettings>(`/indexes/${index.id}/member-settings`);
      setMemberSettings(response);
    } catch (err) {
      console.error('Failed to fetch member settings:', err);
    }
  }, [api, index.id]);

  // Load data when modal opens
  useEffect(() => {
    if (open) {
      fetchMemberSettings();
    }
  }, [open, fetchMemberSettings]);

  const handleLeave = () => {
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[75vh] flex flex-col z-50">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">{index.title}</Dialog.Title>
          </div>
          
          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 mb-4">
            <button
              onClick={() => setActiveTab('member')}
              className={`py-2 mr-4 text-sm font-medium font-ibm-plex-mono border-b-2 transition-colors ${
                activeTab === 'member'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Member Settings
            </button>
            {memberSettings?.isOwner && (
              <button
                onClick={() => setActiveTab('owner')}
                className={`py-2 text-sm font-medium font-ibm-plex-mono border-b-2 transition-colors ${
                  activeTab === 'owner'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Owner Settings
              </button>
            )}
          </div>

          {/* Tab Content */}
          <div className="flex-1">
            <div className={`h-full ${activeTab === 'member' ? 'block' : 'hidden'}`}>
              <MemberSettingsTab 
                index={index} 
                onLeave={handleLeave}
              />
            </div>
            {memberSettings?.isOwner && (
              <div className={`h-full ${activeTab === 'owner' ? 'block' : 'hidden'}`}>
                <OwnerSettingsTab 
                  index={index} 
                  onIndexUpdate={onIndexUpdate}
                />
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
