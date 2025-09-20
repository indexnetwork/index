'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Index } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Copy, Globe, Lock, Trash2, Plus, ChevronDown, Check } from 'lucide-react';
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
  const [showPermissionsDropdown, setShowPermissionsDropdown] = useState(false);
  const [showMemberDropdowns, setShowMemberDropdowns] = useState<Record<string, boolean>>({});
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(() => {
    return index.linkPermissions?.permissions || [];
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<Member[]>([]);
  const [isCopied, setIsCopied] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const permissionsDropdownRef = useRef<HTMLDivElement>(null);
  const memberDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const indexesService = useIndexes();

  // Available public permissions
  const availablePermissions: PublicPermission[] = [
    {
      id: 'can-discover',
      label: 'Can discover',
      description: 'Allow others to anonymously compare themselves to your index.'
    },
    {
      id: 'can-write-intents',
      label: 'Can write intents',
      description: 'Let others create their own intents, become discoverable, and explore others.'
    },
    {
      id: 'can-view-files',
      label: 'Can view files',
      description: 'Enable others to view or download files in this index.'
    }
  ];

  const memberPermissions = [
    { id: 'can-write', label: 'Can write', description: 'Members can create files and intents' },
    { id: 'can-read', label: 'Can read', description: 'Member can view files and intents' },
  ];

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
        permissions: ['can-write'] // Default permissions for new users
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
      if (permissionsDropdownRef.current && !permissionsDropdownRef.current.contains(event.target as Node)) {
        setShowPermissionsDropdown(false);
      }
      
      // Close member dropdowns when clicking outside
      Object.keys(showMemberDropdowns).forEach(memberId => {
        const dropdownRef = memberDropdownRefs.current[memberId];
        if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
          setShowMemberDropdowns(prev => ({ ...prev, [memberId]: false }));
        }
      });
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMemberDropdowns]);

  const handleUpdatePermissions = async (permissions: string[]) => {
    try {
      setIsUpdatingVisibility(true);
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

  const handlePermissionToggle = (permissionId: string) => {
    const updatedPermissions = selectedPermissions.includes(permissionId)
      ? selectedPermissions.filter(id => id !== permissionId)
      : [...selectedPermissions, permissionId];
    
    setSelectedPermissions(updatedPermissions);
    handleUpdatePermissions(updatedPermissions);
  };

  const handleAddMember = async (user: Member) => {
    try {
      const newMember = await indexesService.addMember(index.id, user.id, user.permissions);
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

  const handleMemberPermissionToggle = async (memberId: string, permission: string) => {
    const member = members.find(m => m.id === memberId);
    if (!member) return;

    const hasPermission = member.permissions.includes(permission);
    const newPermissions = hasPermission
      ? member.permissions.filter(p => p !== permission)
      : [...member.permissions, permission];

    try {
      const updatedMember = await indexesService.updateMemberPermissions(index.id, memberId, newPermissions);
      setMembers(prev => prev.map(member => 
        member.id === memberId ? updatedMember : member
      ));
    } catch (error) {
      console.error('Error updating member permissions:', error);
    }
  };

  const handleSearchInputChange = (value: string) => {
    setMemberSearchQuery(value);
    setShowSuggestions(value.length > 0);
  };

  const toggleMemberDropdown = (memberId: string) => {
    setShowMemberDropdowns(prev => ({
      ...prev,
      [memberId]: !prev[memberId]
    }));
  };

  const getMemberPermissionsText = (permissions: string[]) => {
    if (permissions.length === 0) {
      return 'No access';
    }
    return permissions.length === 1 
      ? '1 permission' 
      : `${permissions.length} permissions`;
  };

  // Generate links based on permissions
  const canShowShareLink = (selectedPermissions.includes('can-write-intents') || selectedPermissions.includes('can-discover')) && index.linkPermissions?.code;
  const canShowMatchlistLink = selectedPermissions.includes('can-write-intents') && index.linkPermissions?.code;
  
  const shareUrl = canShowShareLink && index.linkPermissions?.code ? `${window.location.origin}/vibecheck/${index.linkPermissions.code}` : '';
  const matchlistUrl = canShowMatchlistLink && index.linkPermissions?.code ? `${window.location.origin}/matchlist/${index.linkPermissions.code}` : '';

  return (
    <div className="space-y-8 mt-6">
      <div>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mt-2 mb-2">
              <h3 className="text-md font-medium font-ibm-plex-mono text-black">Public Access</h3>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                {selectedPermissions.length > 0 ? (
                  <Globe className="h-4 w-4" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
              </div>
            </div>
            <p className="text-sm text-gray-600">
              Grant access to anyone with the link
            </p>
          </div>
          <div className="flex items-center gap-3 ml-4">
            {isUpdatingVisibility && (
              <div className="h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
            )}
            <div className="relative">
              <button
                onClick={() => !isUpdatingVisibility && setShowPermissionsDropdown(!showPermissionsDropdown)}
                disabled={isUpdatingVisibility}
                className={`flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md bg-white text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isUpdatingVisibility ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                }`}
              >
                <span className="text-gray-700">
                  {selectedPermissions.length === 0 
                    ? 'No access' 
                    : selectedPermissions.length === 1 
                      ? '1 permission' 
                      : `${selectedPermissions.length} permissions`
                  }
                </span>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </button>
              
              {showPermissionsDropdown && (
                <div
                  ref={permissionsDropdownRef}
                  className="absolute top-full right-0 z-50 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg"
                >
                  <div className="p-2">
                    {availablePermissions.map((permission) => (
                      <label
                        key={permission.id}
                        className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-md cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPermissions.includes(permission.id)}
                          onChange={() => handlePermissionToggle(permission.id)}
                          className="mt-0.5 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-900">
                            {permission.label}
                          </div>
                          <div className="text-xs text-gray-500">
                            {permission.description}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
            <div className="relative flex-1">
              <Plus className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                ref={searchInputRef}
                placeholder="Search people by name or email..."
                value={memberSearchQuery}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                onFocus={() => memberSearchQuery && setShowSuggestions(true)}
                className="pl-10 pr-4 py-3"
              />
            </div>
          </div>
          
          {/* Suggestions dropdown */}
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div
              ref={suggestionsRef}
              className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
            >
              {filteredSuggestions.map((user) => (
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
              ))}
            </div>
          )}
          
          {/* No results message */}
          {showSuggestions && memberSearchQuery && filteredSuggestions.length === 0 && (
            <div
              ref={suggestionsRef}
              className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4"
            >
              <p className="text-sm text-gray-500 text-center">No users found matching "{memberSearchQuery}"</p>
            </div>
          )}
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
                  {/* Member permissions dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => toggleMemberDropdown(member.id)}
                      className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md bg-white text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      <span className="text-gray-700">
                        {getMemberPermissionsText(member.permissions)}
                      </span>
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    </button>
                    
                    {showMemberDropdowns[member.id] && (
                      <div
                        ref={(el) => { memberDropdownRefs.current[member.id] = el; }}
                        className="absolute top-full right-0 z-50 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg"
                      >
                        <div className="p-2">
                          {memberPermissions.map((permission) => (
                            <label
                              key={permission.id}
                              className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-md cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={member.permissions.includes(permission.id)}
                                onChange={() => handleMemberPermissionToggle(member.id, permission.id)}
                                className="mt-0.5 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                              />
                              <div className="flex-1">
                                <div className="text-sm font-medium text-gray-900">
                                  {permission.label}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {permission.description}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    onClick={() => handleRemoveMember(member.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
