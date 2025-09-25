'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Index } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Copy, Globe, Lock, Trash2, Plus, Check, X, Settings, Shield } from 'lucide-react';
import { Input } from '../ui/input';
import { useIndexes } from '@/contexts/APIContext';
import { useNotifications } from '@/contexts/NotificationContext';

interface Member {
  id: string;
  name: string;
  email: string;
  permissions: string[];
  avatar?: string;
}

interface OwnerSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: Index;
  onIndexUpdate?: (updatedIndex: Index) => void;
}

export default function OwnerSettingsModal({ open, onOpenChange, index, onIndexUpdate }: OwnerSettingsModalProps) {
  // Tab management
  const [activeTab, setActiveTab] = useState<'settings' | 'access'>('settings');
  
  // Index settings state
  const [title, setTitle] = useState(index.title);
  const [prompt, setPrompt] = useState(index.prompt || '');
  const [originalTitle, setOriginalTitle] = useState(index.title);
  const [originalPrompt, setOriginalPrompt] = useState(index.prompt || '');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isDeletingIndex, setIsDeletingIndex] = useState(false);
  
  // Access control state
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [publicAccess, setPublicAccess] = useState<boolean>(() => {
    return !!(index.linkPermissions?.permissions && index.linkPermissions.permissions.length > 0);
  });
  const [anyoneCanJoin, setAnyoneCanJoin] = useState<boolean>(() => {
    return index.linkPermissions?.permissions?.includes('can-write-intents') || false;
  });
  const [allowVibecheck, setAllowVibecheck] = useState<boolean>(() => {
    return !!(index.linkPermissions?.permissions && index.linkPermissions.permissions.includes('can-discover'));
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<Member[]>([]);
  const [isCopied, setIsCopied] = useState<string | null>(null);
  const [dropdownPositions, setDropdownPositions] = useState<Record<string, { top: number; left: number; width: number }>>({});

  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const indexesService = useIndexes();
  const { success, error } = useNotifications();

  // Load members on mount
  const loadMembers = useCallback(async () => {
    try {
      const membersList = await indexesService.getMembers(index.id);
      setMembers(membersList);
    } catch (error) {
      console.error('Error loading members:', error);
    }
  }, [indexesService, index.id]);

  useEffect(() => {
    if (open) {
      loadMembers();
      // Reset states when modal opens
      setTitle(index.title);
      setPrompt(index.prompt || '');
      setOriginalTitle(index.title);
      setOriginalPrompt(index.prompt || '');
      setPublicAccess(!!(index.linkPermissions?.permissions && index.linkPermissions.permissions.length > 0));
      setAnyoneCanJoin(index.linkPermissions?.permissions?.includes('can-write-intents') || false);
      setAllowVibecheck(!!(index.linkPermissions?.permissions && index.linkPermissions.permissions.includes('can-discover')));
    }
  }, [open, loadMembers, index.linkPermissions, index.title, index.prompt]);

  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSuggestedUsers([]);
      return;
    }

    try {
      const users = await indexesService.searchUsers(query, index.id);
      setSuggestedUsers(users.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        permissions: [] // Will be set when adding member
      })));
    } catch (error) {
      console.error('Error searching users:', error);
      setSuggestedUsers([]);
    }
  }, [indexesService, index.id]);

  // Debounced user search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (memberSearchQuery) {
        searchUsers(memberSearchQuery);
      } else {
        setSuggestedUsers([]);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [memberSearchQuery, searchUsers]);

  // Filter suggestions to exclude existing members
  const filteredSuggestions = suggestedUsers.filter(user =>
    !members.find(member => member.id === user.id)
  );

  // Handle clicking outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node) &&
          searchInputRef.current && !searchInputRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSaveSettings = async () => {
    try {
      setIsSavingSettings(true);
      const updatedIndex = await indexesService.updateIndex(index.id, {
        title: title.trim(),
        prompt: prompt.trim() || null
      });
      setOriginalTitle(title);
      setOriginalPrompt(prompt);
      onIndexUpdate?.(updatedIndex);
      success('Index settings updated successfully');
    } catch (err) {
      console.error('Error updating index:', err);
      error('Failed to update index settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleCancelSettings = () => {
    setTitle(originalTitle);
    setPrompt(originalPrompt);
  };

  const handleDeleteIndex = async () => {
    if (!window.confirm(`Are you sure you want to delete "${index.title}"? This action cannot be undone.`)) {
      return;
    }
    
    try {
      setIsDeletingIndex(true);
      await indexesService.deleteIndex(index.id);
      success('Index deleted successfully');
      onOpenChange(false);
      // Note: Parent component should handle navigation/refresh
    } catch (err) {
      console.error('Error deleting index:', err);
      error('Failed to delete index');
    } finally {
      setIsDeletingIndex(false);
    }
  };

  const handleUpdatePermissions = async (publicAccess: boolean, anyoneCanJoin: boolean, allowVibecheck: boolean) => {
    try {
      setIsUpdatingVisibility(true);
      const permissions: string[] = [];
      
      if (allowVibecheck) {
        permissions.push('can-discover');
      }
      if (publicAccess && anyoneCanJoin) {
        permissions.push('can-write-intents');
      }
      
      await indexesService.updateLinkPermissions(index.id, permissions);
      const updatedIndex = await indexesService.getIndex(index.id);
      onIndexUpdate?.(updatedIndex);
    } catch (err) {
      console.error('Error updating index permissions:', err);
      error('Failed to update access permissions');
    } finally {
      setIsUpdatingVisibility(false);
    }
  };

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/index/${index.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied('link');
      success('Link copied to clipboard');
      setTimeout(() => setIsCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      error('Failed to copy link');
    }
  };

  const handlePublicAccessToggle = () => {
    const newPublicAccess = !publicAccess;
    setPublicAccess(newPublicAccess);
    
    // If turning off public access, also turn off anyone can join
    if (!newPublicAccess) {
      setAnyoneCanJoin(false);
      handleUpdatePermissions(newPublicAccess, false, allowVibecheck);
    } else {
      handleUpdatePermissions(newPublicAccess, anyoneCanJoin, allowVibecheck);
    }
  };

  const handleAnyoneCanJoinToggle = () => {
    const newAnyoneCanJoin = !anyoneCanJoin;
    setAnyoneCanJoin(newAnyoneCanJoin);
    handleUpdatePermissions(publicAccess, newAnyoneCanJoin, allowVibecheck);
  };

  const handleAllowVibecheckToggle = () => {
    const newAllowVibecheck = !allowVibecheck;
    setAllowVibecheck(newAllowVibecheck);
    handleUpdatePermissions(publicAccess, anyoneCanJoin, newAllowVibecheck);
  };

  const handleAddMember = async (user: Member) => {
    try {
      // All new members get basic member permissions
      const defaultPermissions = ['can-read', 'can-write'];
      const newMember = await indexesService.addMember(index.id, user.id, defaultPermissions);
      setMembers(prev => [...prev, newMember]);
      setMemberSearchQuery('');
      setShowSuggestions(false);
    } catch (error) {
      console.error('Error adding member:', error);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await indexesService.removeMember(index.id, memberId);
      setMembers(prev => prev.filter(member => member.id !== memberId));
    } catch (error) {
      console.error('Error removing member:', error);
    }
  };

  const handleSearchInputChange = (value: string) => {
    setMemberSearchQuery(value);
    const shouldShow = value.length > 0;
    
    if (shouldShow && searchContainerRef.current) {
      calculateDropdownPosition(searchContainerRef.current, 'suggestions', searchContainerRef.current.offsetWidth);
    }
    
    setShowSuggestions(shouldShow);
  };

  const calculateDropdownPosition = (buttonElement: HTMLElement, dropdownKey: string, width: number = 256) => {
    const rect = buttonElement.getBoundingClientRect();
    const position = {
      top: rect.bottom + window.scrollY + 4,
      left: rect.right + window.scrollX - width,
      width
    };
    
    setDropdownPositions(prev => ({
      ...prev,
      [dropdownKey]: position
    }));
    
    return position;
  };

  const getMemberRoleText = (permissions: string[]) => {
    // If user is an owner, show that prominently
    if (permissions.includes('owner')) {
      return 'Owner';
    }
    
    return 'Member';
  };

  // Helper functions
  const hasSettingsChanged = title !== originalTitle || prompt !== originalPrompt;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[75vh] flex flex-col z-50">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">
              Owner Settings - {index.title}
            </Dialog.Title>
          </div>
          
          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 mb-6">
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'settings'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Settings className="h-4 w-4" />
              Index Settings
            </button>
            <button
              onClick={() => setActiveTab('access')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'access'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Shield className="h-4 w-4" />
              Access Control
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'settings' && (
              <div className="space-y-6">
                {/* Index Title */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2 font-ibm-plex-mono">
                    Index Title
                  </label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter index title"
                    className="w-full"
                  />
                </div>

                {/* Index Prompt */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2 font-ibm-plex-mono">
                    Index Prompt
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe what people can share in this index..."
                    className="w-full min-h-[100px] px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-ibm-plex-mono text-black text-sm"
                    rows={4}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    This helps guide what kind of intents people can share in your index.
                  </p>
                </div>

                {/* Save/Cancel Buttons */}
                {hasSettingsChanged && (
                  <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
                    <Button
                      onClick={handleSaveSettings}
                      disabled={isSavingSettings}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {isSavingSettings ? (
                        <>
                          <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                          Saving...
                        </>
                      ) : (
                        'Save Changes'
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleCancelSettings}
                      disabled={isSavingSettings}
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                {/* Danger Zone */}
                <div className="pt-6 border-t border-gray-200">
                  <h3 className="text-sm font-medium text-red-900 mb-3 font-ibm-plex-mono">Danger Zone</h3>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-red-900">Delete this index</h4>
                        <p className="text-sm text-red-700 mt-1">
                          Once you delete an index, there is no going back. Please be certain.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={handleDeleteIndex}
                        disabled={isDeletingIndex}
                        className="border-red-300 text-red-700 hover:bg-red-50 hover:border-red-400"
                      >
                        {isDeletingIndex ? (
                          <>
                            <div className="h-4 w-4 border-2 border-red-700 border-t-transparent rounded-full animate-spin mr-2" />
                            Deleting...
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Index
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'access' && (
              <div className="space-y-6">
                {/* Access Control Toggles */}
                <div className="space-y-4">
                  {/* Anyone Can Join / Private Toggle */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-gray-900 font-ibm-plex-mono">Who can join</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyLink}
                        className={`transition-colors ${
                          isCopied === 'link' ? 'bg-green-50 border-green-200 text-green-700' : ''
                        }`}
                      >
                        {isCopied === 'link' ? (
                          <>
                            <Check className="h-4 w-4 mr-2" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy Invitation Link
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (!publicAccess) {
                            setPublicAccess(true);
                            setAnyoneCanJoin(true);
                            handleUpdatePermissions(true, true, allowVibecheck);
                          }
                        }}
                        className={`border-2 p-3 rounded-md text-left transition-all ${
                          publicAccess && anyoneCanJoin
                            ? 'border-[#007EFF] bg-white' 
                            : 'border-[#E0E0E0] bg-[#F8F9FA] hover:border-[#007EFF]'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Globe className={`h-4 w-4 ${publicAccess && anyoneCanJoin ? "text-[#007EFF]" : "text-gray-600"}`} />
                          <h4 className={`text-sm font-medium font-ibm-plex-mono ${publicAccess && anyoneCanJoin ? "text-black" : "text-[#666]"}`}>
                            Anyone can join
                          </h4>
                        </div>
                        <p className="text-xs text-gray-600 font-ibm-plex-mono">
                          People can discover and join freely.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setPublicAccess(false);
                          setAnyoneCanJoin(false);
                          handleUpdatePermissions(false, false, allowVibecheck);
                        }}
                        className={`border-2 p-3 rounded-md text-left transition-all ${
                          !publicAccess || !anyoneCanJoin
                            ? 'border-[#007EFF] bg-white' 
                            : 'border-[#E0E0E0] bg-[#F8F9FA] hover:border-[#007EFF]'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Lock className={`h-4 w-4 ${!publicAccess || !anyoneCanJoin ? "text-[#007EFF]" : "text-gray-600"}`} />
                          <h4 className={`text-sm font-medium font-ibm-plex-mono ${!publicAccess || !anyoneCanJoin ? "text-black" : "text-[#666]"}`}>
                            Private
                          </h4>
                        </div>
                        <p className="text-xs text-gray-600 font-ibm-plex-mono">
                          Only people you invited or people with the invitation link can join.
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Allow Vibecheck Toggle */}
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="allowVibecheck"
                      checked={allowVibecheck}
                      onChange={() => !isUpdatingVisibility && handleAllowVibecheckToggle()}
                      disabled={isUpdatingVisibility}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="allowVibecheck" className="ml-2 text-sm text-black">
                      Allow people to check how they vibe with your index before joining
                    </label>
                    {isUpdatingVisibility && (
                      <div className="ml-2 h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                </div>

                {/* Members Section */}
                <div className="pt-4 border-t border-gray-200">
                  <h4 className="text-sm font-medium font-ibm-plex-mono text-black mb-2">Members</h4>
                  <p className="text-xs text-gray-600 mb-3">Assign specific access to individuals or groups</p>
                  
                  {/* Member picker input */}
                  <div className="relative mb-4">
                    <div className="flex items-center gap-2">
                      <div ref={searchContainerRef} className="relative flex-1">
                        <Plus className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                          ref={searchInputRef}
                          placeholder="Search people by name or email..."
                          value={memberSearchQuery}
                          onChange={(e) => handleSearchInputChange(e.target.value)}
                          onFocus={() => {
                            if (memberSearchQuery) {
                              if (searchContainerRef.current) {
                                calculateDropdownPosition(searchContainerRef.current, 'suggestions', searchContainerRef.current.offsetWidth);
                              }
                              setShowSuggestions(true);
                            }
                          }}
                          className="pl-10 pr-4 py-2 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Members list */}
                  <div className="space-y-2">
                    {members.length === 0 ? (
                      <div className="p-3 text-center">
                        <p className="text-xs text-gray-500">No members added yet</p>
                      </div>
                    ) : (
                      members.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-6 w-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium text-xs">
                              {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm text-black font-medium">{member.name}</p>
                              <p className="text-xs text-gray-600">{member.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className={`px-2 py-1 border border-gray-300 rounded text-xs ${
                              member.permissions.includes('owner') ? 'bg-blue-50 border-blue-200' : 'bg-gray-50'
                            }`}>
                              <span className={`${
                                member.permissions.includes('owner') ? 'text-blue-700 font-medium' : 'text-gray-700'
                              }`}>
                                {getMemberRoleText(member.permissions)}
                              </span>
                            </div>
                            {!member.permissions.includes('owner') && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 h-6 w-6 p-0"
                                onClick={() => handleRemoveMember(member.id)}
                                title="Remove member"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      {/* Portal-rendered dropdowns */}
      {typeof window !== 'undefined' && (
        <>
          {/* Suggestions dropdown */}
          {showSuggestions && dropdownPositions.suggestions && createPortal(
            <div
              ref={suggestionsRef}
              className="fixed z-[100] bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto pointer-events-auto"
              style={{
                top: dropdownPositions.suggestions.top,
                left: dropdownPositions.suggestions.left,
                width: dropdownPositions.suggestions.width
              }}
            >
              {filteredSuggestions.length > 0 ? (
                filteredSuggestions.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleAddMember(user);
                    }}
                    className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 text-left cursor-pointer"
                  >
                    <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium text-sm">
                      {user.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{user.name}</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </div>
                    <Plus className="h-4 w-4 text-gray-400" />
                  </button>
                ))
              ) : memberSearchQuery ? (
                <div className="p-4">
                  <p className="text-sm text-gray-500 text-center">No users found matching "{memberSearchQuery}"</p>
                </div>
              ) : null}
            </div>,
            document.body
          )}
        </>
      )}
    </Dialog.Root>
  );
}