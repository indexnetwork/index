'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Index } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Copy, Globe, Lock, Trash2, Plus, Check } from 'lucide-react';
import { Input } from '../../ui/input';
import { useIndexes } from '@/contexts/APIContext';
import { Member, PublicPermission } from './types.js';

interface OwnerSettingsTabProps {
  index: Index;
  onIndexUpdate?: (updatedIndex: Index) => void;
}

export default function OwnerSettingsTab({ index, onIndexUpdate }: OwnerSettingsTabProps) {
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [publicAccess, setPublicAccess] = useState<boolean>(() => {
    return !!(index.linkPermissions?.permissions && index.linkPermissions.permissions.length > 0);
  });
  const [anyoneCanJoin, setAnyoneCanJoin] = useState<boolean>(() => {
    return index.linkPermissions?.permissions?.includes('can-write-intents') || false;
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<Member[]>([]);
  const [isCopied, setIsCopied] = useState<string | null>(null);
  const [dropdownPositions, setDropdownPositions] = useState<Record<string, { top: number; left: number; width: number }>>({});

  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const indexesService = useIndexes();


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
    loadMembers();
  }, [loadMembers]);

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

  const handleUpdatePermissions = async (publicAccess: boolean, anyoneCanJoin: boolean) => {
    try {
      setIsUpdatingVisibility(true);
      const permissions: string[] = [];
      
      if (publicAccess) {
        permissions.push('can-discover');
        if (anyoneCanJoin) {
          permissions.push('can-write-intents');
        }
      }
      
      await indexesService.updateLinkPermissions(index.id, permissions);
      const updatedIndex = await indexesService.getIndex(index.id);
      onIndexUpdate?.(updatedIndex);
    } catch (error) {
      console.error('Error updating index permissions:', error);
    } finally {
      setIsUpdatingVisibility(false);
    }
  };

  const handleCopyLink = async (url: string, linkType: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied(linkType);
      setTimeout(() => setIsCopied(null), 1000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handlePublicAccessToggle = () => {
    const newPublicAccess = !publicAccess;
    setPublicAccess(newPublicAccess);
    
    // If turning off public access, also turn off anyone can join
    if (!newPublicAccess) {
      setAnyoneCanJoin(false);
      handleUpdatePermissions(newPublicAccess, false);
    } else {
      handleUpdatePermissions(newPublicAccess, anyoneCanJoin);
    }
  };

  const handleAnyoneCanJoinToggle = () => {
    const newAnyoneCanJoin = !anyoneCanJoin;
    setAnyoneCanJoin(newAnyoneCanJoin);
    handleUpdatePermissions(publicAccess, newAnyoneCanJoin);
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

  // Generate links based on permissions
  const canShowShareLink = publicAccess && index.linkPermissions?.code;
  const canShowMatchlistLink = anyoneCanJoin && index.linkPermissions?.code;
  
  const shareUrl = canShowShareLink && index.linkPermissions?.code ? `${window.location.origin}/vibecheck/${index.linkPermissions.code}` : '';
  const matchlistUrl = canShowMatchlistLink && index.linkPermissions?.code ? `${window.location.origin}/matchlist/${index.linkPermissions.code}` : '';

  return (
    <div className="space-y-8 mt-6 mr-0.5">
      <div className="space-y-4">
        {/* Allow Incognito Visitors Toggle */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-md font-medium font-ibm-plex-mono text-black">Allow Incognito Visitors</h3>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                {publicAccess ? (
                  <Globe className="h-4 w-4" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
              </div>
            </div>
            <p className="text-sm text-gray-600">
              Non-members can view content without signing in or joining. They remain invisible to others.
            </p>
          </div>
          <div className="flex items-center gap-3 ml-4">
            {isUpdatingVisibility && (
              <div className="h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
            )}
            <button
              onClick={() => !isUpdatingVisibility && handlePublicAccessToggle()}
              disabled={isUpdatingVisibility}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                publicAccess ? 'bg-blue-600' : 'bg-gray-300'
              } ${isUpdatingVisibility ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  publicAccess ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Anyone Can Join Toggle */}
        <div className={`flex items-center justify-between p-4 bg-gray-50 rounded-lg transition-opacity ${
          !publicAccess ? 'opacity-50' : ''
        }`}>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-md font-medium font-ibm-plex-mono text-black">Anyone Can Join</h3>
            </div>
            <p className="text-sm text-gray-600">
              Membership is open. People can become members instantly without an invite or approval.
            </p>
          </div>
          <div className="flex items-center gap-3 ml-4">
            <button
              onClick={() => publicAccess && !isUpdatingVisibility && handleAnyoneCanJoinToggle()}
              disabled={!publicAccess || isUpdatingVisibility}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                anyoneCanJoin && publicAccess ? 'bg-blue-600' : 'bg-gray-300'
              } ${!publicAccess || isUpdatingVisibility ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  anyoneCanJoin && publicAccess ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Share Link */}
        {canShowShareLink && (
          <div className="mt-4">
            <div className="mb-2">
              <h4 className="text-sm font-medium text-gray-900">Vibecheck</h4>
              <p className="text-xs text-gray-500">People can anonymously compare themselves to the index</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={shareUrl}
                className="px-4 py-3"
                placeholder="Share link will appear here..."
              />
              <Button
                variant="outline"
                size="sm"
                className={`h-10 px-4 transition-colors ${
                  isCopied === 'share' ? 'bg-green-50 border-green-200 text-green-700' : ''
                }`}
                onClick={() => handleCopyLink(shareUrl, 'share')}
              >
                {isCopied === 'share' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Matchlist Link */}
        {canShowMatchlistLink && (
          <div className="mt-4">
            <div className="mb-2">
              <h4 className="text-sm font-medium text-gray-900">Matchlist</h4>
              <p className="text-xs text-gray-500">People can write intents, be discoverable, and discover others</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={matchlistUrl}
                className="px-4 py-3"
                placeholder="Matchlist link will appear here..."
              />
              <Button
                variant="outline"
                size="sm"
                className={`h-10 px-4 transition-colors ${
                  isCopied === 'matchlist' ? 'bg-green-50 border-green-200 text-green-700' : ''
                }`}
                onClick={() => handleCopyLink(matchlistUrl, 'matchlist')}
              >
                {isCopied === 'matchlist' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-md font-medium font-ibm-plex-mono text-black mb-2">Members</h3>
        <p className="text-sm text-gray-600 mb-3">Assign specific access to individuals or groups</p>
        
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
                className="pl-10 pr-4 py-3"
              />
            </div>
          </div>
          
        </div>
        
        {/* Members list */}
        <div className="space-y-3">
          {members.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-sm text-gray-500">No members added yet</p>
            </div>
          ) : (
            members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium text-sm">
                    {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                  </div>
                  <div>
                    <p className="text-md text-black font-medium">{member.name}</p>
                    <p className="text-sm text-gray-600">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Member role display */}
                  <div className={`px-3 py-2 border border-gray-300 rounded-md bg-white text-sm ${
                    member.permissions.includes('owner') ? 'bg-blue-50 border-blue-200' : 'bg-gray-50'
                  }`}>
                    <span className={`${
                      member.permissions.includes('owner') ? 'text-blue-700 font-medium' : 'text-gray-700'
                    }`}>
                      {getMemberRoleText(member.permissions)}
                    </span>
                  </div>
                  {/* Only show remove button for non-owners */}
                  {!member.permissions.includes('owner') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleRemoveMember(member.id)}
                      title="Remove member"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Portal-rendered dropdowns */}
      {typeof window !== 'undefined' && (
        <>
          {/* Suggestions dropdown */}
          {showSuggestions && dropdownPositions.suggestions && createPortal(
            <div
              ref={suggestionsRef}
              className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
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
                    onClick={() => handleAddMember(user)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 text-left"
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
    </div>
  );
}
