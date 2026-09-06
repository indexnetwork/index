import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Copy, Globe, Lock, Trash2, Plus, Check, ChevronRight, ChevronLeft, RotateCw, Shield, ShieldOff } from 'lucide-react';

import { Network } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/Tooltip';
import { useAuthContext } from '@/contexts/AuthContext';
import { Member } from '@/services/networks';
import UserAvatar from '@/components/UserAvatar';
import { useNavigate } from 'react-router';
import { log } from '@/lib/logger';

const logger = log.ui.from('AccessTab');

interface AccessTabProps {
  network: Network;
  networkId: string;
  networkService: ReturnType<typeof import('@/contexts/APIContext').useNetworks>;
  onUpdated: (network: Network) => void;
  success: (msg: string, detail?: string) => void;
  error: (msg: string) => void;
  info: (msg: string, detail?: string, duration?: number) => void;
}

export default function AccessTab({
  network,
  networkId,
  networkService,
  onUpdated,
  success,
  error,
  info: _info,
}: AccessTabProps) {
  const navigate = useNavigate();
  const { user: currentUser } = useAuthContext();

  const [anyoneCanJoin, setAnyoneCanJoin] = useState(network.permissions?.joinPolicy === 'anyone');
  const [members, setMembers] = useState<Member[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [suggestedUsers, setSuggestedUsers] = useState<Member[]>([]);
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchIsLoading, setSearchIsLoading] = useState(false);
  const [searchHasQueried, setSearchHasQueried] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [invitationLink, setInvitationLink] = useState<{ code: string } | null>(null);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [isRegeneratingLink, setIsRegeneratingLink] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [roleChangeTarget, setRoleChangeTarget] = useState<{ member: Member; newRole: 'owner' | 'member' } | null>(null);

  const [isAddingMember, setIsAddingMember] = useState(false);
  const [membersPage, setMembersPage] = useState(1);
  const MEMBERS_PAGE_SIZE = 10;

  /* eslint-disable react-hooks/set-state-in-effect -- syncs local state from prop changes */
  useEffect(() => {
    setAnyoneCanJoin(network.permissions?.joinPolicy === 'anyone');
    if (network.permissions?.invitationLink?.code) {
      setInvitationLink({ code: network.permissions.invitationLink.code });
    } else {
      setInvitationLink(null);
    }
  }, [network.id, network.permissions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadMembers = useCallback(async () => {
    setIsMembersLoading(true);
    try {
      const response = await networkService.getMembers(networkId, {});
      setMembers(response.members);
    } catch (err) {
      logger.error('Error loading members', { error: err });
    } finally {
      setIsMembersLoading(false);
    }
  }, [networkService, networkId]);

  useEffect(() => {
    loadMembers(); // eslint-disable-line react-hooks/set-state-in-effect -- load on mount
  }, [loadMembers]);

  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSuggestedUsers([]);
      setSearchHasQueried(false);
      return;
    }
    setSearchIsLoading(true);
    try {
      const users = await networkService.searchUsers(query, networkId);
      setSuggestedUsers(users.map(u => ({ ...u, permissions: [] })));
      setSearchHasQueried(true);
    } catch (err) {
      logger.error('Error searching users', { error: err });
      setSuggestedUsers([]);
    } finally {
      setSearchIsLoading(false);
    }
  }, [networkService, networkId]);

  useEffect(() => {
    setMembersPage(1); // eslint-disable-line react-hooks/set-state-in-effect -- reset page on search change
    const timeoutId = setTimeout(() => {
      if (memberSearchQuery) searchUsers(memberSearchQuery);
      else { setSuggestedUsers([]); setSearchHasQueried(false); }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [memberSearchQuery, searchUsers]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleUpdatePermissions = async (joinPolicy: boolean) => {
    try {
      await networkService.updatePermissions(networkId, {
        joinPolicy: joinPolicy ? 'anyone' : 'invite_only',
      });
      const updatedNetwork = await networkService.getNetwork(networkId);
      onUpdated(updatedNetwork);
      if (updatedNetwork.permissions?.invitationLink?.code) {
        setInvitationLink({ code: updatedNetwork.permissions.invitationLink.code });
      }
    } catch (err) {
      logger.error('Error updating permissions', { error: err });
      error('Failed to update permissions');
    }
  };

  const handleCopyLink = async () => {
    if (!invitationLink?.code) return;
    const url = `${window.location.origin}/l/${invitationLink.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied(true);
      success('Link copied');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      error('Failed to copy link');
    }
  };

  const handleRegenerateLink = async () => {
    setIsRegeneratingLink(true);
    try {
      const updatedNetwork = await networkService.regenerateInvitationLink(networkId);
      onUpdated(updatedNetwork);
      if (updatedNetwork.permissions?.invitationLink?.code) {
        setInvitationLink({ code: updatedNetwork.permissions.invitationLink.code });
      }
      setShowRegenerateConfirm(false);
      success('Invitation link regenerated');
    } catch (err) {
      logger.error('Error regenerating invitation link', { error: err });
      error('Failed to regenerate invitation link');
    } finally {
      setIsRegeneratingLink(false);
    }
  };

  const handleAddMember = async (memberUser: Member) => {
    try {
      const newMember = await networkService.addMember(networkId, memberUser.id, ['member']);
      setMembers(prev => [...prev, newMember]);
      setMemberSearchQuery('');
      setSuggestedUsers([]);
      setShowSuggestions(false);
      setSearchHasQueried(false);
    } catch (err) {
      logger.error('Error adding member', { error: err });
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await networkService.removeMember(networkId, memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId));
    } catch (err) {
      logger.error('Error removing member', { error: err });
    }
  };

  const handleUpdateMemberRole = async (memberId: string, newRole: 'owner' | 'member') => {
    try {
      const permissions = newRole === 'owner' ? ['owner'] : ['member'];
      const updated = await networkService.updateMemberPermissions(networkId, memberId, permissions);
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, permissions: updated.permissions } : m));
      success(`Role updated to ${newRole}`);
    } catch (err) {
      logger.error('Error updating member role', { error: err });
      error(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleInviteMember = async (email: string) => {
    if (isAddingMember) return;
    setIsAddingMember(true);
    try {
      const result = await networkService.inviteMember(networkId, email);
      setMemberSearchQuery('');
      setSuggestedUsers([]);
      setShowSuggestions(false);
      setSearchHasQueried(false);
      await loadMembers();
      success(result.alreadyMember ? 'Already a member' : 'Member added');
    } catch (err) {
      logger.error('Error inviting member', { error: err });
      error('Failed to invite member');
    } finally {
      setIsAddingMember(false);
    }
  };

  const filteredSuggestions = suggestedUsers.filter(u => !members.find(m => m.id === u.id));
  const filteredMembers = useMemo(() =>
    (memberSearchQuery.trim()
      ? members.filter(m => m.name.toLowerCase().includes(memberSearchQuery.toLowerCase()))
      : members
    ),
    [members, memberSearchQuery]
  );
  const totalMembersPages = Math.max(1, Math.ceil(filteredMembers.length / MEMBERS_PAGE_SIZE));
  const safePage = Math.min(membersPage, totalMembersPages);
  const paginatedMembers = filteredMembers.slice(
    (safePage - 1) * MEMBERS_PAGE_SIZE,
    safePage * MEMBERS_PAGE_SIZE
  );
  const noResults = searchHasQueried && filteredSuggestions.length === 0 && filteredMembers.length === 0;

  return (
    <>
      <div className="space-y-8">

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">Visibility</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setAnyoneCanJoin(true); handleUpdatePermissions(true); }}
              className={`flex items-center gap-2.5 p-3 border rounded-sm text-left transition-colors duration-150 ${anyoneCanJoin ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400'}`}
            >
              <Globe className={`h-4 w-4 flex-shrink-0 ${anyoneCanJoin ? 'text-black' : 'text-gray-400'}`} />
              <div>
                <p className="text-sm font-medium text-black">Public</p>
                <p className="text-xs text-gray-400">Anyone can join</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => { setAnyoneCanJoin(false); handleUpdatePermissions(false); }}
              className={`flex items-center gap-2.5 p-3 border rounded-sm text-left transition-colors duration-150 ${!anyoneCanJoin ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400'}`}
            >
              <Lock className={`h-4 w-4 flex-shrink-0 ${!anyoneCanJoin ? 'text-black' : 'text-gray-400'}`} />
              <div>
                <p className="text-sm font-medium text-black">Private</p>
                <p className="text-xs text-gray-400">Invite only</p>
              </div>
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">
            Invitation link
          </p>
          <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-sm bg-gray-50">
            <code className="flex-1 text-xs text-gray-500 truncate">
              {invitationLink
                ? `${typeof window !== 'undefined' ? window.location.origin : ''}/l/${invitationLink.code}`
                : 'Loading...'}
            </code>
            <Tooltip content="Regenerate link">
              <button
                type="button"
                aria-label="Regenerate invitation link"
                onClick={() => setShowRegenerateConfirm(true)}
                disabled={!invitationLink || isRegeneratingLink}
                className="flex-shrink-0 p-1 rounded-sm text-gray-400 hover:text-black transition-colors disabled:opacity-50"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <button
              type="button"
              aria-label="Copy invitation link"
              onClick={handleCopyLink}
              disabled={!invitationLink}
              className={`flex-shrink-0 p-1 rounded-sm transition-colors disabled:opacity-50 ${isCopied ? 'text-green-600' : 'text-gray-400 hover:text-black'}`}
            >
              {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Members */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">
            Members <span className="normal-case font-normal">({members.length})</span>
          </p>

          {/* Smart search input */}
          <div ref={searchContainerRef} className="relative mb-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Plus className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                <Input
                  ref={searchInputRef}
                  placeholder="Search by name or add by email..."
                  value={memberSearchQuery}
                  onChange={(e) => {
                    setMemberSearchQuery(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Dropdown: new users to add (not already in list) */}
            {showSuggestions && memberSearchQuery.trim() && !searchIsLoading && filteredSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-sm shadow-sm z-10 max-h-40 overflow-y-auto">
                {filteredSuggestions.map((u) => (
                  <button key={u.id} onClick={() => handleAddMember(u)} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-left">
                    <UserAvatar id={u.id} name={u.name} avatar={(u as Member).avatar} size={24} />
                    <span className="text-sm text-black flex-1 truncate">{u.name}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">Add</span>
                  </button>
                ))}
              </div>
            )}

            {/* No results: add by email or show empty state */}
            {showSuggestions && memberSearchQuery.trim() && !searchIsLoading && noResults && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-sm shadow-sm z-10">
                {memberSearchQuery.includes('@') ? (
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 text-left disabled:opacity-50"
                    onClick={() => handleInviteMember(memberSearchQuery)}
                    disabled={isAddingMember}
                  >
                    <div className="h-6 w-6 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Plus className="h-3.5 w-3.5 text-gray-500" />
                    </div>
                    <span className="text-sm text-black flex-1 truncate">
                      {`Invite "${memberSearchQuery}"`}
                    </span>
                  </button>
                ) : (
                  <div className="px-3 py-2.5 text-sm text-gray-400">No results found</div>
                )}
              </div>
            )}
          </div>

          {isMembersLoading ? (
            <div className="space-y-0.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <div className="h-7 w-7 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
                  <div className="h-3.5 rounded bg-gray-100 animate-pulse flex-1" style={{ maxWidth: `${60 + (i % 3) * 15}%` }} />
                </div>
              ))}
            </div>
          ) : (
          <>
          <div className="space-y-0.5">
            {paginatedMembers.map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-3 py-2 rounded-sm hover:bg-gray-50 transition-colors group">
                <button
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  onClick={() => navigate(`/u/${member.id}`)}
                >
                  <UserAvatar
                    id={member.id}
                    name={member.name}
                    avatar={member.avatar}
                    size={28}
                  />
                  <span className="text-sm flex-1 truncate flex items-center gap-1.5 text-black">
                    {member.name}
                  </span>
                </button>
                {member.permissions.includes('owner') && (
                  <span className="group-hover:hidden text-xs px-1.5 py-0.5 rounded-sm font-medium bg-gray-900 text-white flex-shrink-0">
                    Owner
                  </span>
                )}
                {!member.permissions.includes('owner') && (
                  <span className="group-hover:hidden text-xs px-1.5 py-0.5 rounded-sm font-medium flex-shrink-0 bg-gray-200 text-gray-700">
                    {member.permissions.includes('member') ? 'Member' : 'Contact'}
                  </span>
                )}
                {/* Role change: promote member → owner */}
                {!member.permissions.includes('owner') && member.permissions.includes('member') && member.id !== currentUser?.id && (
                  <Tooltip content="Promote to owner">
                    <button
                      type="button"
                      aria-label="Promote to owner"
                      onClick={() => setRoleChangeTarget({ member, newRole: 'owner' })}
                      className="hidden group-hover:block p-1 text-gray-300 hover:text-gray-900 transition-colors flex-shrink-0"
                    >
                      <Shield className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                )}
                {/* Role change: demote owner → member */}
                {member.permissions.includes('owner') && member.id !== currentUser?.id && (
                  <Tooltip content="Demote to member">
                    <button
                      type="button"
                      aria-label="Demote to member"
                      onClick={() => setRoleChangeTarget({ member, newRole: 'member' })}
                      className="hidden group-hover:block p-1 text-gray-300 hover:text-gray-900 transition-colors flex-shrink-0"
                    >
                      <ShieldOff className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                )}
                {!member.permissions.includes('owner') && (
                  <Tooltip content="Remove member">
                    <button
                      onClick={() => handleRemoveMember(member.id)}
                      className="hidden group-hover:block p-1 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                )}
              </div>
            ))}
          </div>
          {totalMembersPages > 1 && (
            <div className="flex items-center justify-between pt-3 mt-1 border-t border-gray-100">
              <span className="text-xs text-gray-400">
                {(safePage - 1) * MEMBERS_PAGE_SIZE + 1}–{Math.min(safePage * MEMBERS_PAGE_SIZE, filteredMembers.length)} of {filteredMembers.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMembersPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="p-1 rounded-sm text-gray-400 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-gray-500 min-w-[3rem] text-center">
                  {safePage} / {totalMembersPages}
                </span>
                <button
                  onClick={() => setMembersPage(p => Math.min(totalMembersPages, p + 1))}
                  disabled={safePage === totalMembersPages}
                  className="p-1 rounded-sm text-gray-400 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
          </>
          )}
        </div>

      </div>

      {/* Regenerate invitation link dialog */}
      <AlertDialog.Root open={showRegenerateConfirm} onOpenChange={(open) => { if (!open && !isRegeneratingLink) setShowRegenerateConfirm(false); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">
              Regenerate invitation link?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">
              The current link will stop working immediately. Anyone with the old link will no longer be able to join.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={isRegeneratingLink}>Cancel</Button>
              </AlertDialog.Cancel>
              <Button onClick={handleRegenerateLink} disabled={isRegeneratingLink}>
                {isRegeneratingLink ? 'Regenerating...' : 'Regenerate'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {/* Role change dialog */}
      <AlertDialog.Root open={roleChangeTarget !== null} onOpenChange={(open) => { if (!open) setRoleChangeTarget(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">
              {roleChangeTarget?.newRole === 'owner' ? 'Promote' : 'Demote'} {roleChangeTarget?.member.name || 'this member'}?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">
              {roleChangeTarget?.newRole === 'owner'
                ? 'This will give them full control of this community — they can manage settings, members, and integrations.'
                : 'This will remove their owner privileges. They will remain a member but won\'t be able to manage settings or members.'}
            </AlertDialog.Description>
            <div className="flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="outline">Cancel</Button>
              </AlertDialog.Cancel>
              <Button onClick={async () => {
                if (!roleChangeTarget) return;
                await handleUpdateMemberRole(roleChangeTarget.member.id, roleChangeTarget.newRole);
                setRoleChangeTarget(null);
              }}>
                {roleChangeTarget?.newRole === 'owner' ? 'Promote to Owner' : 'Demote to Member'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

    </>
  );
}
