'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/contexts/NotificationContext';
import { useIntegrationsService } from '@/services/integrations';

interface SlackChannelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration: {
    id: string;
    type: string;
    name: string;
  };
  onSuccess?: () => void;
}

interface Channel {
  id: string;
  name: string;
}

export default function SlackChannelModal({
  open,
  onOpenChange,
  integration,
  onSuccess
}: SlackChannelModalProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { success, error } = useNotifications();
  const integrationsService = useIntegrationsService();
  const loadingRef = useRef(false);

  const loadChannels = useCallback(async () => {
    // Prevent multiple simultaneous requests
    if (loadingRef.current) return;
    
    loadingRef.current = true;
    setLoading(true);
    try {
      const response = await integrationsService.getSlackChannels(integration.id);
      setChannels(response.channels);
      // Initialize selected channels from the response
      if (response.selectedChannels && response.selectedChannels.length > 0) {
        setSelectedChannelIds(new Set(response.selectedChannels));
      } else {
        setSelectedChannelIds(new Set());
      }
    } catch (err) {
      console.error('Failed to load channels:', err);
      error('Failed to load Slack channels');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [integration.id, integrationsService, error]);

  useEffect(() => {
    if (open) {
      loadChannels();
    } else {
      // Reset state when modal closes
      setSelectedChannelIds(new Set());
      setSearchQuery('');
    }
  }, [open, loadChannels]);

  const handleToggleChannel = (channelId: string) => {
    setSelectedChannelIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(channelId)) {
        newSet.delete(channelId);
      } else {
        newSet.add(channelId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const filteredChannels = getFilteredChannels();
    if (selectedChannelIds.size === filteredChannels.length && filteredChannels.length > 0) {
      setSelectedChannelIds(new Set());
    } else {
      setSelectedChannelIds(new Set(filteredChannels.map(ch => ch.id)));
    }
  };

  const handleSave = async () => {
    if (selectedChannelIds.size === 0) {
      error('Please select at least one channel');
      return;
    }

    setSaving(true);
    try {
      await integrationsService.saveSlackChannels(integration.id, Array.from(selectedChannelIds));
      success('Slack channels configured successfully');
      onOpenChange(false);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      console.error('Failed to save channels:', err);
      error('Failed to save channel configuration');
    } finally {
      setSaving(false);
    }
  };

  const getFilteredChannels = () => {
    if (!searchQuery.trim()) return channels;
    const query = searchQuery.toLowerCase();
    return channels.filter(ch => ch.name.toLowerCase().includes(query));
  };

  const filteredChannels = getFilteredChannels();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-in fade-in duration-200 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-[600px] bg-white border border-gray-200 rounded-lg p-6 shadow-xl focus:outline-none animate-in fade-in zoom-in-95 duration-200 z-50 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <Dialog.Title className="text-lg font-bold text-black font-ibm-plex-mono">
              Select Channels
            </Dialog.Title>
            <button
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 disabled:opacity-50"
            >
              <X className="h-4 w-4 text-gray-600" />
              <span className="sr-only">Close</span>
            </button>
          </div>

          <p className="text-sm text-black font-ibm-plex-mono mb-4">
            Choose which Slack channels to sync messages from. You can select multiple channels.
          </p>

          {/* Search and Select All */}
          <div className="space-y-3 mb-4">
            <input
              type="text"
              placeholder="Search channels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-ibm-plex-mono text-black"
            />
            
            <div className="flex items-center justify-between">
              <button
                onClick={handleSelectAll}
                className="text-sm text-blue-600 hover:text-blue-700 font-ibm-plex-mono disabled:opacity-50"
                disabled={loading || filteredChannels.length === 0}
              >
                {selectedChannelIds.size === filteredChannels.length && filteredChannels.length > 0
                  ? 'Deselect All'
                  : 'Select All'}
              </button>
              <span className="text-sm text-black font-ibm-plex-mono">
                {selectedChannelIds.size} selected
              </span>
            </div>
          </div>

          {/* Channels List */}
          <div className="border border-gray-200 rounded-lg mb-6">
            {loading ? (
              <div className="text-center py-8">
                <div className="h-8 w-8 border-2 border-gray-300 border-t-black rounded-full animate-spin mx-auto" />
              </div>
            ) : filteredChannels.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-black font-ibm-plex-mono">
                  {searchQuery ? 'No channels found matching your search' : 'No channels available'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 max-h-[400px] overflow-y-auto">
                {filteredChannels.map((channel) => (
                  <button
                    key={channel.id}
                    onClick={() => handleToggleChannel(channel.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                          selectedChannelIds.has(channel.id)
                            ? 'bg-blue-600 border-blue-600'
                            : 'border-gray-300'
                        }`}
                      >
                        {selectedChannelIds.has(channel.id) && (
                          <Check className="h-3 w-3 text-white" />
                        )}
                      </div>
                      <span className="text-sm font-ibm-plex-mono text-black">
                        #{channel.name}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="font-ibm-plex-mono"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || selectedChannelIds.size === 0}
              className="bg-black text-white hover:bg-gray-800 disabled:opacity-50 font-ibm-plex-mono"
            >
              {saving ? 'Saving...' : 'Save Channels'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

