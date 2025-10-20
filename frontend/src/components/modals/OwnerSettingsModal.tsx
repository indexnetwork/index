'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Index } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Copy, Globe, Lock, Trash2, Plus, Check, X, ChevronRight, ChevronDown } from 'lucide-react';
import { Input } from '../ui/input';
import { useIndexes } from '@/contexts/APIContext';
import { useIndexesState } from '@/contexts/IndexesContext';
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
  const [isDangerZoneExpanded, setIsDangerZoneExpanded] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  
  // Access control state
  const [isUpdatingVibeCheckPermission, setIsUpdatingVibeCheckPermission] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [anyoneCanJoin, setAnyoneCanJoin] = useState<boolean>(() => {
    return index.permissions?.joinPolicy === 'anyone';
  });
  const [allowVibecheck, setAllowVibecheck] = useState<boolean>(() => {
    return index.permissions?.allowGuestVibeCheck || false;
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<Member[]>([]);
  const [isCopied, setIsCopied] = useState<string | null>(null);
  const [dropdownPositions, setDropdownPositions] = useState<Record<string, { top: number; left: number; width: number }>>({});
  const [invitationLink, setInvitationLink] = useState<{ code: string; createdAt: string } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const indexesService = useIndexes();
  const { updateIndex, removeIndex } = useIndexesState();
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
      setAnyoneCanJoin(index.permissions?.joinPolicy === 'anyone');
      setAllowVibecheck(index.permissions?.allowGuestVibeCheck || false);
      
      // Initialize invitation link for private mode
      if (index.permissions?.invitationLink?.code && index.permissions.joinPolicy === 'invite_only') {
        setInvitationLink({
          code: index.permissions.invitationLink.code,
          createdAt: new Date().toISOString()
        });
      } else {
        setInvitationLink(null);
      }
    }
  }, [open, loadMembers, index.permissions, index.title, index.prompt]);

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
    if (!title.trim()) {
      error('Title cannot be empty');
      return;
    }
    
    try {
      setIsSavingSettings(true);
      const updatedIndex = await indexesService.updateIndex(index.id, {
        title: title.trim(),
        prompt: prompt.trim() || null
      });
      setOriginalTitle(title);
      setOriginalPrompt(prompt);
      updateIndex(updatedIndex); // Update global state
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
    setShowDeleteConfirmation(true);
  };

  const handleConfirmDelete = async () => {
    try {
      setIsDeletingIndex(true);
      await indexesService.deleteIndex(index.id);
      removeIndex(index.id); // Update global state
      success('Index deleted successfully');
      setShowDeleteConfirmation(false);
      onOpenChange(false);
    } catch (err) {
      console.error('Error deleting index:', err);
      error('Failed to delete index');
    } finally {
      setIsDeletingIndex(false);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirmation(false);
    setDeleteConfirmationText('');
  };

  const handleUpdatePermissions = async (anyoneCanJoin: boolean, allowVibecheck: boolean) => {
    try {
      if (allowVibecheck === true || allowVibecheck === false) setIsUpdatingVibeCheckPermission(true);
      
      await indexesService.updatePermissions(index.id, {
        joinPolicy: anyoneCanJoin ? 'anyone' : 'invite_only',
        allowGuestVibeCheck: allowVibecheck
      });
      const updatedIndex = await indexesService.getIndex(index.id);
      updateIndex(updatedIndex); // Update global state
      onIndexUpdate?.(updatedIndex);
    } catch (err) {
      console.error('Error updating index permissions:', err);
      error('Failed to update access permissions');
    } finally {
      setIsUpdatingVibeCheckPermission(false);
    }
  };

  const handleCopyLink = async (linkType: 'index' | 'invitation', code?: string) => {
    const url = linkType === 'index' 
      ? `${window.location.origin}/i/${index.id}`
      : `${window.location.origin}/l/${code}`;
    
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied(linkType === 'index' ? 'index-link' : `invitation-${code}`);
      success('Link copied to clipboard');
      setTimeout(() => setIsCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      error('Failed to copy link');
    }
  };

  const handleEditInvitationLink = async () => {
    try {
      // Use the dedicated regenerate endpoint
      const updatedIndex = await indexesService.regenerateInvitationLink(index.id);
      
      if (updatedIndex.permissions?.invitationLink?.code) {
        setInvitationLink({
          code: updatedIndex.permissions.invitationLink.code,
          createdAt: new Date().toISOString()
        });
        success('Invitation link updated');
      } else {
        error('Failed to update invitation link - no code generated');
      }
    } catch (err) {
      console.error('Error updating invitation link:', err);
      error('Failed to update invitation link');
    }
  };

  const handleAllowVibecheckToggle = () => {
    const newAllowVibecheck = !allowVibecheck;
    setAllowVibecheck(newAllowVibecheck);
    handleUpdatePermissions(anyoneCanJoin, newAllowVibecheck);
  };

  const handleAddMember = async (user: Member) => {
    try {
      // All new members get basic member permissions
      const defaultPermissions = ['member'];
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
  const isDeleteConfirmationValid = deleteConfirmationText === index.title;

  return (
    <Dialog.Root open={open} onOpenChange={(newOpen) => {
      // Only close if we're not interacting with the dropdown
      if (!newOpen && showSuggestions) {
        return; // Don't close modal if dropdown is open
      }
      onOpenChange(newOpen);
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[85vh] flex flex-col z-50">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">
              Configure {index.title} 
            </Dialog.Title>
          </div>
          
          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-2 px-2 mr-2 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'settings'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
               Settings
            </button>
            <button
              onClick={() => setActiveTab('access')}
              className={`flex items-center gap-2 px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'access'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Access Control
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 mt-4 overflow-y-auto">
            {activeTab === 'settings' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2 font-ibm-plex-mono">
                    Title
                  </label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter index title"
                    className="w-full"
                    required
                    minLength={1}
                  />
                </div>

                {/* Index Prompt */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2 font-ibm-plex-mono">
                    Prompt
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
                <div className="flex justify-end space-x-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancelSettings}
                    disabled={isSavingSettings}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings || !hasSettingsChanged || !title.trim()}
                  >
                    {isSavingSettings ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>

                {/* Danger Zone */}
                <div className="pt-6 border-t border-gray-200">
                  <button
                    onClick={() => setIsDangerZoneExpanded(!isDangerZoneExpanded)}
                    className="flex items-center gap-2 text-sm font-medium text-red-900 font-ibm-plex-mono hover:text-red-700 transition-colors"
                  >
                    {isDangerZoneExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    Danger Zone
                  </button>
                  
                  {isDangerZoneExpanded && (
                    <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-medium text-red-900">Delete this index</h4>
                          <p className="text-sm text-red-700 mt-1">
                            Deleting an index is permanent.
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
                  )}
                </div>
              </div>
            )}

            {activeTab === 'access' && (
              <div className="space-y-6">
                {/* Access Control Toggles */}
                <div className="">
                  {/* Anyone Can Join / Private Toggle */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-gray-900 font-ibm-plex-mono">Who can join</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!anyoneCanJoin) {
                            setAnyoneCanJoin(true);
                            await handleUpdatePermissions(true, allowVibecheck);
                            // Clear invitation link when switching to public
                            setInvitationLink(null);
                          }
                        }}
                        className={`border-2 p-3 rounded-md text-left transition-all ${
                          anyoneCanJoin
                            ? 'border-[#007EFF] bg-white' 
                            : 'border-[#E0E0E0] bg-[#F8F9FA] hover:border-[#007EFF]'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Globe className={`h-4 w-4 ${anyoneCanJoin ? "text-[#007EFF]" : "text-gray-600"}`} />
                          <h4 className={`text-sm font-medium font-ibm-plex-mono ${anyoneCanJoin ? "text-black" : "text-[#666]"}`}>
                            Anyone can join
                          </h4>
                        </div>
                        <p className="text-xs text-gray-600 font-ibm-plex-mono">
                          People can discover and join freely.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          setAnyoneCanJoin(false);
                          await handleUpdatePermissions(false, allowVibecheck);
                          // Get the updated index to ensure we have the invitation link
                          try {
                            const updatedIndex = await indexesService.getIndex(index.id);
                            if (updatedIndex.permissions?.invitationLink?.code) {
                              setInvitationLink({
                                code: updatedIndex.permissions.invitationLink.code,
                                createdAt: new Date().toISOString()
                              });
                            }
                          } catch (err) {
                            console.error('Error fetching updated index:', err);
                          }
                        }}
                        className={`border-2 p-3 rounded-md text-left transition-all ${
                          !anyoneCanJoin
                            ? 'border-[#007EFF] bg-white' 
                            : 'border-[#E0E0E0] bg-[#F8F9FA] hover:border-[#007EFF]'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <Lock className={`h-4 w-4 ${!anyoneCanJoin ? "text-[#007EFF]" : "text-gray-600"}`} />
                          <h4 className={`text-sm font-medium font-ibm-plex-mono ${!anyoneCanJoin ? "text-black" : "text-[#666]"}`}>
                            Private
                          </h4>
                        </div>
                        <p className="text-xs text-gray-600 font-ibm-plex-mono">
                          Only people with the invitation link can join.
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Link Section */}
                  <div className="pt-4">
                    {anyoneCanJoin ? (
                      // Show Index Link for "Anyone can join"
                      <div>
                        <h4 className="text-sm font-medium font-ibm-plex-mono text-black mb-2">Index Link</h4>
                        <p className="text-xs text-gray-600 mb-3">Share this link - anyone can discover and join your index</p>
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                          <Globe className="h-4 w-4 text-gray-500" />
                          <code className="flex-1 text-xs text-gray-700 font-mono">
                            {window.location.origin}/i/{index.id}
                          </code>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyLink('index')}
                            className={`transition-colors ${
                              isCopied === 'index-link' ? 'bg-green-50 border-green-200 text-green-700' : ''
                            }`}
                          >
                            {isCopied === 'index-link' ? (
                              <>
                                <Check className="h-4 w-4 mr-2" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4 mr-2" />
                                Copy
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      // Show Invitation Links for Private
                      <div>
                        <h4 className="text-sm font-medium font-ibm-plex-mono text-black mb-2">Invitation Link</h4>
                        <div className="flex items-center text-xs text-gray-600 mb-3">
                          <span>Share this link with people you want to invite to your index.</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleEditInvitationLink}
                            disabled={!invitationLink}
                            className="text-blue-600 ml-1 hover:text-blue-700 h-auto p-0"
                          >
                            Regenerate
                          </Button>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                          <Lock className="h-4 w-4 text-gray-500" />
                          <code className="flex-1 text-xs text-gray-700 font-mono">
                            {invitationLink ? 
                              `${window.location.origin}/l/${invitationLink.code}` :
                              'Loading...'
                            }
                          </code>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => invitationLink && handleCopyLink('invitation', invitationLink.code)}
                            disabled={!invitationLink}
                            className={`transition-colors ${
                              invitationLink && isCopied === `invitation-${invitationLink.code}` ? 'bg-green-50 border-green-200 text-green-700' : ''
                            }`}
                          >
                            {invitationLink && isCopied === `invitation-${invitationLink.code}` ? (
                              <>
                                <Check className="h-4 w-4 mr-2" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4 mr-2" />
                                Copy
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {false && (
                  <div className="mt-2 flex items-center">
                    <input
                      type="checkbox"
                      id="allowVibecheck"
                      checked={allowVibecheck}
                      onChange={() => !isUpdatingVibeCheckPermission && handleAllowVibecheckToggle()}
                      disabled={isUpdatingVibeCheckPermission}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="allowVibecheck" className="ml-2 text-sm text-black">
                      Allow people to check how they vibe with your index before joining
                    </label>
                    {isUpdatingVibeCheckPermission && (
                      <div className="ml-2 h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                  )}

                </div>
                

                {/* Members Section */}
                <div className="">
                  
                <h3 className="text-sm font-medium text-gray-900 font-ibm-plex-mono">Members</h3>
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
              className="fixed z-[200] bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto pointer-events-auto"
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmation && (
        <Dialog.Root open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[60]" />
            <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-[#2f3136] rounded-lg shadow-lg p-6 w-full max-w-md z-[70]">
              <div className="mb-4">
                <Dialog.Title className="text-xl font-bold text-white mb-4">
                  Delete '{index.title}'
                </Dialog.Title>
                <p className="text-[#b9bbbe] text-sm mb-6">
                  Are you sure you want to delete <span className="text-orange-400 font-medium">{index.title}</span>? This action cannot be undone.
                </p>
                
                <div className="mb-6">
                  <label className="block text-sm font-medium text-[#b9bbbe] mb-2">
                    Enter index name
                  </label>
                  <Input
                    value={deleteConfirmationText}
                    onChange={(e) => setDeleteConfirmationText(e.target.value)}
                    placeholder=""
                    className="w-full bg-[#40444b] border-[#40444b] text-white placeholder-[#72767d] focus:border-blue-500 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
              </div>
              
              <div className="flex justify-end space-x-3">
                <Button
                  variant="outline"
                  onClick={handleCancelDelete}
                  disabled={isDeletingIndex}
                  className="bg-transparent border-[#4f545c] text-white hover:bg-[#4f545c] hover:border-[#4f545c]"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmDelete}
                  disabled={isDeletingIndex || !isDeleteConfirmationValid}
                  className="bg-[#ed4245] hover:bg-[#c03537] text-white border-0"
                >
                  {isDeletingIndex ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Deleting...
                    </>
                  ) : (
                    'Delete Index'
                  )}
                </Button>
              </div>
              
              <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
                <X className="h-4 w-4 text-[#b9bbbe]" />
                <span className="sr-only">Close</span>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </Dialog.Root>
  );
}