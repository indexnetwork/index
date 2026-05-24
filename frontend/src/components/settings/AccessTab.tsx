import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, Globe, Lock, Trash2, Plus, Check, ChevronRight, ChevronLeft, Upload, Download, X, RotateCw } from 'lucide-react';

import { Network } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/Tooltip';
import { useAuthenticatedAPI } from '@/lib/api';
import { useAuthContext } from '@/contexts/AuthContext';
import { createUsersService } from '@/services/users';
import { Member } from '@/services/networks';
import { validateFile } from '@/lib/file-validation';
import { parseCsvText, type ImportRow, type ParsedCsvResult } from '@/lib/csv-import';
import CsvPreviewModal from '@/components/modals/CsvPreviewModal';
import UserAvatar from '@/components/UserAvatar';
import GhostBadge from '@/components/GhostBadge';
import { useNavigate } from 'react-router';

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
  const api = useAuthenticatedAPI();
  const { user: currentUser } = useAuthContext();
  const usersService = createUsersService(api);

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
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [resendTarget, setResendTarget] = useState<Member | null>(null);
  const [isResendInFlight, setIsResendInFlight] = useState(false);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview] = useState<ParsedCsvResult | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);

  const [isAddingMember, setIsAddingMember] = useState(false);
  const [contactsPage, setContactsPage] = useState(1);
  const CONTACTS_PAGE_SIZE = 10;

  /* eslint-disable react-hooks/set-state-in-effect -- syncs local state from prop changes */
  useEffect(() => {
    setAnyoneCanJoin(network.permissions?.joinPolicy === 'anyone');
    if (network.permissions?.invitationLink?.code && network.permissions.joinPolicy === 'invite_only') {
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
      console.error('Error loading members:', err);
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
      console.error('Error searching users:', err);
      setSuggestedUsers([]);
    } finally {
      setSearchIsLoading(false);
    }
  }, [networkService, networkId]);

  useEffect(() => {
    setContactsPage(1); // eslint-disable-line react-hooks/set-state-in-effect -- reset page on search change
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
      console.error('Error updating permissions:', err);
      error('Failed to update permissions');
    }
  };

  const handleCopyLink = async () => {
    const url = anyoneCanJoin
      ? `${window.location.origin}/index/${networkId}`
      : `${window.location.origin}/l/${invitationLink?.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied(true);
      success('Link copied');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      error('Failed to copy link');
    }
  };

  const handleAddMember = async (memberUser: Member) => {
    if (network.isExperiment) {
      await handleInviteMember(memberUser.email);
      return;
    }
    try {
      const newMember = await networkService.addMember(networkId, memberUser.id, ['member']);
      setMembers(prev => [...prev, newMember]);
      setMemberSearchQuery('');
      setSuggestedUsers([]);
      setShowSuggestions(false);
      setSearchHasQueried(false);
    } catch (err) {
      console.error('Error adding member:', err);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      if (network.isPersonal) {
        await usersService.removeContact(memberId);
      } else {
        await networkService.removeMember(networkId, memberId);
      }
      setMembers(prev => prev.filter(m => m.id !== memberId));
    } catch (err) {
      console.error('Error removing member:', err);
    }
  };

  const handleAddContact = async (email: string) => {
    if (isAddingMember) return;
    setIsAddingMember(true);
    try {
      await usersService.addContact(email);
      setMemberSearchQuery('');
      setSuggestedUsers([]);
      setShowSuggestions(false);
      setSearchHasQueried(false);
      await loadMembers();
      success('Contact added');
    } catch (err) {
      console.error('Error adding contact:', err);
      error('Failed to add contact');
    } finally {
      setIsAddingMember(false);
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
      const toast = result.agentProvisioned
        ? 'Invitation sent'
        : result.alreadyMember
          ? 'Already a member'
          : 'Member added';
      success(toast);
    } catch (err) {
      console.error('Error inviting member:', err);
      error('Failed to invite member');
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleConfirmResend = async () => {
    if (!resendTarget) return;
    setIsResendInFlight(true);
    try {
      const result = await networkService.resendInvite(networkId, resendTarget.id);
      success(`Invitation resent to ${result.email}${result.rotated ? ' (key rotated)' : ''}`);
      setResendTarget(null);
    } catch (err) {
      console.error('Resend invite failed', err);
      error('Failed to resend invitation');
    } finally {
      setIsResendInFlight(false);
    }
  };

  const handleCsvFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (csvInputRef.current) csvInputRef.current.value = '';
    if (!file) return;

    const validation = validateFile(file);
    if (!validation.isValid) {
      setCsvError(validation.message || 'Invalid file');
      return;
    }

    setCsvError(null);
    try {
      const text = await file.text();
      const result = parseCsvText(text);
      if (!result.hasEmailColumn) {
        setCsvPreview(result);
        return;
      }
      setCsvPreview(result);
    } catch {
      error('Failed to read CSV file');
    }
  }, [error]);

  const handleCsvConfirm = useCallback(async (rows: ImportRow[]) => {
    try {
      const result = await networkService.importMembers(networkId, rows);
      setCsvPreview(null);
      const suffix = result.ownersNotified > 0
        ? ` · credentials emailed to ${result.ownersNotified} owner${result.ownersNotified !== 1 ? 's' : ''}`
        : '';
      success(`Imported ${result.imported} member${result.imported !== 1 ? 's' : ''}${result.skipped > 0 ? ` · ${result.skipped} skipped` : ''}${suffix}`);
      await loadMembers();
    } catch {
      error('Import failed');
    }
  }, [networkService, networkId, loadMembers, success, error]);

  const filteredSuggestions = suggestedUsers.filter(u => !members.find(m => m.id === u.id));
  const filteredMembers = useMemo(() =>
    (memberSearchQuery.trim()
      ? members.filter(m => m.name.toLowerCase().includes(memberSearchQuery.toLowerCase()))
      : members
    ).slice().sort((a, b) => (a.isGhost ? 1 : 0) - (b.isGhost ? 1 : 0)),
    [members, memberSearchQuery]
  );
  const totalContactsPages = Math.max(1, Math.ceil(filteredMembers.length / CONTACTS_PAGE_SIZE));
  const safePage = Math.min(contactsPage, totalContactsPages);
  const paginatedMembers = filteredMembers.slice(
    (safePage - 1) * CONTACTS_PAGE_SIZE,
    safePage * CONTACTS_PAGE_SIZE
  );
  const noResults = searchHasQueried && filteredSuggestions.length === 0 && filteredMembers.length === 0;

  return (
    <>
      <div className="space-y-8">

        {/* Who can join — experiment networks are always private */}
        {!network.isPersonal && !network.isExperiment && (
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
        )}

        {/* Share link — not applicable for experiment networks */}
        {!network.isPersonal && !network.isExperiment && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">
              {anyoneCanJoin ? 'Network Link' : 'Invitation Link'}
            </p>
            <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-sm bg-gray-50">
              <code className="flex-1 text-xs text-gray-500 truncate">
                {anyoneCanJoin
                  ? `${typeof window !== 'undefined' ? window.location.origin : ''}/index/${networkId}`
                  : invitationLink ? `${typeof window !== 'undefined' ? window.location.origin : ''}/l/${invitationLink.code}` : 'Loading...'}
              </code>
              <button onClick={handleCopyLink} className={`flex-shrink-0 p-1 rounded-sm transition-colors ${isCopied ? 'text-green-600' : 'text-gray-400 hover:text-black'}`}>
                {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        )}

        {/* Members */}
        <div>
          {!network.isPersonal && (
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">
              Members <span className="normal-case font-normal">({members.length})</span>
            </p>
          )}

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
              {network.isExperiment && (
                <>
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleCsvFile}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    onClick={() => setShowCsvModal(true)}
                    className="flex-shrink-0 gap-1.5 h-10"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Import CSV
                  </Button>
                </>
              )}
            </div>
            {csvError && (
              <p className="text-xs text-red-600 mt-1">{csvError}</p>
            )}

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
                    onClick={() => network.isExperiment ? handleInviteMember(memberSearchQuery) : handleAddContact(memberSearchQuery)}
                    disabled={isAddingMember}
                  >
                    <div className="h-6 w-6 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Plus className="h-3.5 w-3.5 text-gray-500" />
                    </div>
                    <span className="text-sm text-black flex-1 truncate">
                      {network.isExperiment ? `Invite "${memberSearchQuery}"` : `Add "${memberSearchQuery}"`}
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
                    blur={member.isGhost}
                  />
                  <span className="text-sm flex-1 truncate flex items-center gap-1.5 text-black">
                    {member.name}
                    {member.isGhost && <GhostBadge />}
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
                {network.isExperiment && (
                  <Tooltip content="Resend invitation · expires old key">
                    <button
                      onClick={() => setResendTarget(member)}
                      className="hidden group-hover:block p-1 text-gray-300 hover:text-blue-500 transition-colors flex-shrink-0"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
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
          {totalContactsPages > 1 && (
            <div className="flex items-center justify-between pt-3 mt-1 border-t border-gray-100">
              <span className="text-xs text-gray-400">
                {(safePage - 1) * CONTACTS_PAGE_SIZE + 1}–{Math.min(safePage * CONTACTS_PAGE_SIZE, filteredMembers.length)} of {filteredMembers.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setContactsPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="p-1 rounded-sm text-gray-400 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-gray-500 min-w-[3rem] text-center">
                  {safePage} / {totalContactsPages}
                </span>
                <button
                  onClick={() => setContactsPage(p => Math.min(totalContactsPages, p + 1))}
                  disabled={safePage === totalContactsPages}
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

      {/* Resend invite dialog */}
      <AlertDialog.Root open={resendTarget !== null} onOpenChange={(open) => { if (!open) setResendTarget(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">
              Resend invitation to {resendTarget?.id === currentUser?.id ? 'yourself' : (resendTarget?.name || 'this member')}?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">
              This rotates {resendTarget?.id === currentUser?.id ? 'your' : 'their'} access key. The previous key will stop working immediately.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={isResendInFlight}>Cancel</Button>
              </AlertDialog.Cancel>
              <Button onClick={handleConfirmResend} disabled={isResendInFlight}>
                {isResendInFlight ? 'Sending...' : 'Resend'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {/* CSV modal */}
      <Dialog.Root open={showCsvModal} onOpenChange={setShowCsvModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg w-full max-w-sm z-[100] focus:outline-none">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <Dialog.Title className="text-lg font-bold text-gray-900">Import CSV</Dialog.Title>
              <Dialog.Close asChild>
                <button className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-600">
                Upload a CSV file with member data. The file must have an <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">email</code> column. Optional columns: <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">name</code>, <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">bio</code>, <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">location</code>, and any social links (e.g. <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">linkedin</code>, <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">github</code>, <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">twitter</code>, <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">website</code>).
              </p>
              <button
                type="button"
                onClick={() => {
                  const csv = 'email,name,bio,location,linkedin,github,twitter,website\njane@example.com,Jane Doe,Product designer,Berlin,https://linkedin.com/in/janedoe,janedoe,@janedoe,https://janedoe.com\njohn@example.com,John Smith,Full-stack developer,San Francisco,,johnsmith,,\n';
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'example-import.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-black transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download example CSV
              </button>
              <Button
                className="w-full gap-2"
                onClick={() => {
                  setShowCsvModal(false);
                  csvInputRef.current?.click();
                }}
              >
                <Upload className="h-4 w-4" />
                Choose file
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* CSV preview modal */}
      {csvPreview && (
        <CsvPreviewModal
          open={!!csvPreview}
          onOpenChange={(open) => { if (!open) setCsvPreview(null); }}
          valid={csvPreview.valid}
          invalid={csvPreview.invalid}
          columns={csvPreview.columns}
          hasEmailColumn={csvPreview.hasEmailColumn}
          onConfirm={handleCsvConfirm}
        />
      )}
    </>
  );
}
