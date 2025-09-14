'use client';

import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { Index } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface IndexMemberSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: Index;
}

interface MemberIntent {
  id: string;
  payload: string;
  summary?: string;
  createdAt: string;
}

interface MemberSettings {
  indexTitle: string;
  indexPrompt?: string;
  memberPrompt?: string;
  autoAssign: boolean;
  permissions: string[];
  isOwner: boolean;
}

export default function IndexMemberSettings({ open, onOpenChange, index }: IndexMemberSettingsProps) {
  const [isLeaving, setIsLeaving] = useState(false);
  const [autoManage, setAutoManage] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [activeTab, setActiveTab] = useState<'indexed' | 'suggested'>('indexed');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [memberSettings, setMemberSettings] = useState<MemberSettings | null>(null);
  const [indexedIntents, setIndexedIntents] = useState<MemberIntent[]>([]);
  const [suggestedIntents, setSuggestedIntents] = useState<MemberIntent[]>([]);
  const [loadingIntents, setLoadingIntents] = useState(false);
  const [addingIntents, setAddingIntents] = useState<Set<string>>(new Set());
  const [removingIntents, setRemovingIntents] = useState<Set<string>>(new Set());
  const { success, error } = useNotifications();
  const api = useAuthenticatedAPI();

  // Fetch member settings when modal opens
  const fetchMemberSettings = useCallback(async () => {
    try {
      const response = await api.get<MemberSettings>(`/indexes/${index.id}/member-settings`);
      setMemberSettings(response);
      setAutoManage(response.autoAssign);
      setPrompt(response.memberPrompt || '');
    } catch (err) {
      console.error('Failed to fetch member settings:', err);
    }
  }, [api, index.id]);

  // Fetch member intents
  const fetchMemberIntents = useCallback(async (tab: 'indexed' | 'suggested') => {
    try {
      setLoadingIntents(true);
      const response = await api.get<{ intents: MemberIntent[]; tab: string }>(
        `/indexes/${index.id}/member-intents?tab=${tab}`
      );
      
      if (tab === 'indexed') {
        setIndexedIntents(response.intents);
      } else {
        setSuggestedIntents(response.intents);
      }
    } catch (err) {
      console.error('Failed to fetch member intents:', err);
    } finally {
      setLoadingIntents(false);
    }
  }, [api, index.id]);

  // Load data when modal opens
  useEffect(() => {
    if (open) {
      fetchMemberSettings();
      fetchMemberIntents(activeTab);
    }
  }, [open, activeTab, fetchMemberSettings, fetchMemberIntents]);

  const handleLeaveIndex = async () => {
    try {
      setIsLeaving(true);
      await api.post(`/indexes/${index.id}/leave`, {});
      success(`Successfully left ${index.title}`);
      onOpenChange(false);
    } catch (err) {
      error('Failed to leave index');
    } finally {
      setIsLeaving(false);
    }
  };

  const handleSavePrompt = async () => {
    try {
      setIsSavingPrompt(true);
      await api.put(`/indexes/${index.id}/member-settings`, { 
        prompt: prompt.trim() || null,
        autoAssign: memberSettings?.isOwner ? undefined : autoManage 
      });
      success(memberSettings?.isOwner ? 'Index settings saved' : 'Auto-manage settings saved');
      await fetchMemberSettings(); // Refresh settings
    } catch (err) {
      error('Failed to save settings');
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleAddIntent = async (intentId: string) => {
    setAddingIntents(prev => new Set([...prev, intentId]));
    try {
      await api.post(`/indexes/${index.id}/member-intents/${intentId}`, {});
      success('Intent added to index');
      // Refresh intents
      await fetchMemberIntents('indexed');
      await fetchMemberIntents('suggested');
    } catch (err) {
      error('Failed to add intent to index');
    } finally {
      setAddingIntents(prev => {
        const newSet = new Set(prev);
        newSet.delete(intentId);
        return newSet;
      });
    }
  };

  const handleRemoveIntent = async (intentId: string) => {
    setRemovingIntents(prev => new Set([...prev, intentId]));
    try {
      await api.delete(`/indexes/${index.id}/member-intents/${intentId}`);
      success('Intent removed from index');
      // Refresh intents
      await fetchMemberIntents('indexed');
      await fetchMemberIntents('suggested');
    } catch (err) {
      error('Failed to remove intent from index');
    } finally {
      setRemovingIntents(prev => {
        const newSet = new Set(prev);
        newSet.delete(intentId);
        return newSet;
      });
    }
  };

  const handleTabChange = (tab: 'indexed' | 'suggested') => {
    setActiveTab(tab);
    fetchMemberIntents(tab);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">{index.title}</Dialog.Title>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleLeaveIndex}
                disabled={isLeaving}
                variant="outline"
                size="sm"
                className="font-ibm-plex-mono"
              >
                {isLeaving ? 'Leaving...' : 'Leave this index'}
              </Button>
            </div>
          </div>
          
          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        
        <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <h3 className="text-md font-medium font-ibm-plex-mono text-black mb-2">What I'm sharing in {index.title}</h3>
              <p className="text-sm text-gray-600">
                <span className="font-medium">LLM usability</span> research and accessibility improvements. 
                <span className="font-medium"> Agentic AI</span> system development and intent prediction. 
                <span className="font-medium"> AI-driven interface design</span> and human behavior studies. 
                I'm also offering collaboration opportunities with, researchers working on responsible AI development, 
                <span className="font-medium"> UX designers</span> exploring AI interface paradigms, 
                <span className="font-medium"> developers</span> focused on making AI tools more accessible
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium font-ibm-plex-mono text-black">
                {autoManage ? 'Instruct what to share and what to keep private' : `My intents in ${memberSettings?.indexTitle || index.title}`}
              </h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoManage}
                  onChange={(e) => setAutoManage(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Auto manage my intents</span>
              </label>
            </div>

            {autoManage ? (
              <div className="space-y-3">
                <textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., Share my AI-related intents like research papers and projects, but keep personal details private..."
                  className="w-full text-gray-900 p-3 border border-gray-300 rounded-lg resize-none h-24 text-sm font-ibm-plex-mono"
                />
                <div className="flex justify-end">
                  <Button 
                    size="sm" 
                    className="font-ibm-plex-mono"
                    disabled={!prompt.trim() || isSavingPrompt}
                    onClick={handleSavePrompt}
                  >
                    {isSavingPrompt ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex gap-4 border-b border-gray-200 mb-4">
                  <button
                    onClick={() => handleTabChange('indexed')}
                    className={`pb-2 text-sm font-medium font-ibm-plex-mono transition-colors ${
                      activeTab === 'indexed'
                        ? 'border-b-2 border-black text-black'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Indexed ({indexedIntents.length})
                  </button>
                  <button
                    onClick={() => handleTabChange('suggested')}
                    className={`pb-2 text-sm font-medium font-ibm-plex-mono transition-colors ${
                      activeTab === 'suggested'
                        ? 'border-b-2 border-black text-black'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Suggested ({suggestedIntents.length})
                  </button>
                </div>

                <div className="space-y-2">
                  {loadingIntents ? (
                    <div className="text-center py-4 text-gray-500">Loading...</div>
                  ) : activeTab === 'indexed' ? (
                    indexedIntents.length > 0 ? (
                      indexedIntents.map((intent) => (
                        <div key={intent.id}>
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-gray-600">{intent.payload}</p>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-auto py-1 px-2 text-xs font-ibm-plex-mono"
                              onClick={() => handleRemoveIntent(intent.id)}
                              disabled={removingIntents.has(intent.id)}
                            >
                              {removingIntents.has(intent.id) ? (
                                <div className="h-3 w-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                'Remove'
                              )}
                            </Button>
                          </div>
                          <p className="text-xs text-gray-400 mb-3">
                            {new Date(intent.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4 text-gray-500">No intents indexed yet</div>
                    )
                  ) : (
                    suggestedIntents.length > 0 ? (
                      suggestedIntents.map((intent) => (
                        <div key={intent.id} className="flex items-center justify-between mb-6">
                          <p className="text-sm text-gray-600">{intent.payload}</p>
                          <Button 
                            size="sm" 
                            className="h-auto py-1 px-2 text-xs font-ibm-plex-mono"
                            onClick={() => handleAddIntent(intent.id)}
                            disabled={addingIntents.has(intent.id)}
                          >
                            {addingIntents.has(intent.id) ? (
                              <div className="h-3 w-3 border border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              'Add'
                            )}
                          </Button>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4 text-gray-500">No suggested intents available</div>
                    )
                  )}
                </div>
                
              </div>
            )}
          </div>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
