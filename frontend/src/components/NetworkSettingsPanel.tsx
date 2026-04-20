import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Copy, Globe, Lock, Trash2, Plus, Check, ChevronRight, ChevronDown, ChevronLeft, Camera } from 'lucide-react';
import { Network } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useNetworks } from '@/contexts/APIContext';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { createIntegrationsService, type ComposioConnection } from '@/services/integrations';
import { createUsersService } from '@/services/users';
import { Member } from '@/services/networks';
import { validateFiles } from '@/lib/file-validation';

/** Toolkits available for connection. Add entries here when enabling new Composio integrations. */
const AVAILABLE_TOOLKITS = ['gmail', 'slack'] as const;

const TOOLKIT_LABELS: Record<string, string> = { gmail: 'Gmail', slack: 'Slack' };
const toolkitLabel = (t: string) => TOOLKIT_LABELS[t] ?? t;
import NetworkAvatar, { resolveNetworkImageSrc } from '@/components/NetworkAvatar';
import UserAvatar from '@/components/UserAvatar';
import GhostBadge from '@/components/GhostBadge';
import { useNavigate } from 'react-router';

interface NetworkSettingsPanelProps {
  index: Network;
  onDeleted?: () => void;
  activeTab: 'settings' | 'access' | 'integrations';
}

export default function NetworkSettingsPanel({ index, onDeleted, activeTab }: NetworkSettingsPanelProps) {
  const networksService = useNetworks();
  const navigate = useNavigate();
  const { networks, updateNetwork, removeNetwork } = useNetworksState();
  const { success, error, info } = useNotifications();
  const api = useAuthenticatedAPI();

  const currentIndex = networks?.find(idx => idx.id === index.id) || index;

  const [title, setTitle] = useState(currentIndex.title || '');
  const [prompt, setPrompt] = useState(currentIndex.prompt || '');
  const [imageUrl, setImageUrl] = useState<string | null>(currentIndex.imageUrl ?? null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImageRequested, setRemoveImageRequested] = useState(false);
  const [originalTitle, setOriginalTitle] = useState(currentIndex.title || '');
  const [originalPrompt, setOriginalPrompt] = useState(currentIndex.prompt || '');
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(currentIndex.imageUrl ?? null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isDeletingIndex, setIsDeletingIndex] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDangerZoneExpanded, setIsDangerZoneExpanded] = useState(false);

  const [anyoneCanJoin, setAnyoneCanJoin] = useState(currentIndex.permissions?.joinPolicy === 'anyone');
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

  const usersService = createUsersService(api);

  const [connections, setConnections] = useState<ComposioConnection[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [pendingToolkit, setPendingToolkit] = useState<string | null>(null);

  useEffect(() => {
    setTitle(currentIndex.title);
    setPrompt(currentIndex.prompt || '');
    setImageUrl(currentIndex.imageUrl ?? null);
    setOriginalTitle(currentIndex.title);
    setOriginalPrompt(currentIndex.prompt || '');
    setOriginalImageUrl(currentIndex.imageUrl ?? null);
    setImageFile(null);
    setImagePreview(null);
    setRemoveImageRequested(false);
    setAnyoneCanJoin(currentIndex.permissions?.joinPolicy === 'anyone');
    setDeleteConfirmationText('');
    setIsDangerZoneExpanded(false);
    if (currentIndex.permissions?.invitationLink?.code && currentIndex.permissions.joinPolicy === 'invite_only') {
      setInvitationLink({ code: currentIndex.permissions.invitationLink.code });
    } else {
      setInvitationLink(null);
    }
  }, [currentIndex.id, currentIndex.title, currentIndex.prompt, currentIndex.imageUrl, currentIndex.permissions]);

  const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validation = validateFiles([file], 'avatar');
      if (!validation.isValid) {
        error(validation.message || 'Invalid image file');
        e.target.value = '';
        return;
      }
      setImageFile(file);
      setRemoveImageRequested(false);
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  }, []);

  const handleRemoveImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    setRemoveImageRequested(true);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }, []);

  const loadMembers = useCallback(async () => {
    setIsMembersLoading(true);
    try {
      const response = await networksService.getMembers(index.id, {});
      setMembers(response.members);
    } catch (err) {
      console.error('Error loading members:', err);
    } finally {
      setIsMembersLoading(false);
    }
  }, [networksService, index.id]);

  useEffect(() => {
    if (activeTab === 'access') loadMembers();
  }, [activeTab]);

  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSuggestedUsers([]);
      setSearchHasQueried(false);
      return;
    }
    setSearchIsLoading(true);
    try {
      const users = await networksService.searchUsers(query, index.id);
      setSuggestedUsers(users.map(u => ({ ...u, permissions: [] })));
      setSearchHasQueried(true);
    } catch (err) {
      console.error('Error searching users:', err);
      setSuggestedUsers([]);
    } finally {
      setSearchIsLoading(false);
    }
  }, [networksService, index.id]);

  useEffect(() => {
    setContactsPage(1);
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

  const loadConnections = useCallback(async () => {
    try {
      const integrationsService = createIntegrationsService(api);
      const response = await integrationsService.getConnections(index.id);
      setConnections(response.connections);
    } catch (err) {
      console.error('Failed to load connections:', err);
      setConnections([]);
    } finally {
      setConnectionsLoaded(true);
    }
  }, [api, index.id]);

  useEffect(() => {
    if (activeTab === 'integrations') loadConnections();
  }, [activeTab, loadConnections]);

  const handleSaveSettings = async () => {
    if (!title.trim()) {
      error('Title cannot be empty');
      return;
    }
    try {
      setIsSavingSettings(true);
      let finalImageUrl: string | null = imageUrl;
      if (imageFile) {
        finalImageUrl = await networksService.uploadNetworkImage(imageFile);
      } else if (removeImageRequested) {
        finalImageUrl = null;
      }
      const updatedIndex = await networksService.updateNetwork(index.id, {
        title: title.trim(),
        prompt: prompt.trim() || null,
        imageUrl: finalImageUrl
      });
      setOriginalTitle(title);
      setOriginalPrompt(prompt);
      setOriginalImageUrl(finalImageUrl);
      setImageFile(null);
      setImagePreview(null);
      setRemoveImageRequested(false);
      setImageUrl(finalImageUrl);
      updateNetwork(updatedIndex);
      success('Settings updated');
    } catch (err) {
      console.error('Error updating index:', err);
      error('Failed to update settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleDeleteIndex = async () => {
    try {
      setIsDeletingIndex(true);
      await networksService.deleteNetwork(index.id);
      removeNetwork(index.id);
      success('Network deleted');
      setShowDeleteConfirmation(false);
      onDeleted?.();
    } catch (err) {
      console.error('Error deleting index:', err);
      error('Failed to delete network');
    } finally {
      setIsDeletingIndex(false);
    }
  };

  const handleUpdatePermissions = async (joinPolicy: boolean) => {
    try {
      await networksService.updatePermissions(index.id, {
        joinPolicy: joinPolicy ? 'anyone' : 'invite_only',
      });
      const updatedIndex = await networksService.getNetwork(index.id);
      updateNetwork(updatedIndex);
      if (updatedIndex.permissions?.invitationLink?.code) {
        setInvitationLink({ code: updatedIndex.permissions.invitationLink.code });
      }
    } catch (err) {
      console.error('Error updating permissions:', err);
      error('Failed to update permissions');
    }
  };

  const handleCopyLink = async () => {
    const url = anyoneCanJoin
      ? `${window.location.origin}/network/${index.id}`
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
    try {
      const newMember = await networksService.addMember(index.id, memberUser.id, ['member']);
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
      if (index.isPersonal) {
        await usersService.removeContact(memberId);
      } else {
        await networksService.removeMember(index.id, memberId);
      }
      setMembers(prev => prev.filter(m => m.id !== memberId));
    } catch (err) {
      console.error('Error removing member:', err);
    }
  };

  const [isAddingContact, setIsAddingContact] = useState(false);
  const CONTACTS_PAGE_SIZE = 10;
  const [contactsPage, setContactsPage] = useState(1);

  const handleAddContact = async (email: string) => {
    if (isAddingContact) return;
    setIsAddingContact(true);
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
      setIsAddingContact(false);
    }
  };

  const autoImportContacts = async (toolkit: string) => {
    const svc = createIntegrationsService(api);
    info(`Importing contacts from ${toolkitLabel(toolkit)}...`, undefined, 30000);
    try {
      const result = await svc.importContacts(toolkit, index.id);
      const label = index.isPersonal ? 'contacts' : 'members';
      success(`Imported ${result.imported} ${label}`, `${result.newContacts} new, ${result.existingContacts} already in your network`);
    } catch {
      error(`Failed to import ${toolkitLabel(toolkit)} contacts`);
    }
  };

  const linkAndImport = async (toolkit: string) => {
    const svc = createIntegrationsService(api);
    try {
      await svc.linkIntegration(toolkit, index.id);
      await loadConnections();
      autoImportContacts(toolkit);
    } catch {
      error(`Failed to link ${toolkitLabel(toolkit)} to this index`);
    }
  };

  const handleConnect = async (toolkit: string) => {
    const integrationsService = createIntegrationsService(api);
    setPendingToolkit(toolkit);

    // Check if user already has a Composio connection for this toolkit (user-level)
    try {
      const allConns = await integrationsService.getConnections();
      const existingConn = allConns.connections.find(c => c.toolkit === toolkit);
      if (existingConn) {
        // Already OAuth'd -- just link to this index
        success(`${toolkitLabel(toolkit)} connected`);
        await linkAndImport(toolkit);
        setPendingToolkit(null);
        return;
      }
    } catch {
      // Fall through to OAuth flow
    }

    try {
      const response = await integrationsService.connect(toolkit);
      const width = 600, height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      const popup = window.open(response.redirectUrl, 'oauth', `width=${width},height=${height},left=${left},top=${top}`);

      if (!popup) {
        error('Popup blocked. Please allow popups and try again.');
        setPendingToolkit(null);
        return;
      }

      let oauthSucceeded = false;

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'oauth_callback' && event.data?.status === 'success') {
          oauthSucceeded = true;
          window.removeEventListener('message', onMessage);
          popup?.close();
          success(`${toolkitLabel(toolkit)} connected`);
          setPendingToolkit(null);
          linkAndImport(toolkit);
        } else if (event.data?.type === 'oauth_callback') {
          window.removeEventListener('message', onMessage);
          popup?.close();
          error(`Failed to connect ${toolkitLabel(toolkit)}`);
          setPendingToolkit(null);
        }
      };
      window.addEventListener('message', onMessage);

      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', onMessage);
          if (!oauthSucceeded) {
            loadConnections();
            setPendingToolkit(null);
          }
        }
      }, 1000);
    } catch {
      error(`Failed to connect ${toolkitLabel(toolkit)}`);
      setPendingToolkit(null);
    }
  };

  const handleUnlink = async (toolkit: string) => {
    const integrationsService = createIntegrationsService(api);
    setPendingToolkit(toolkit);
    try {
      await integrationsService.unlinkIntegration(toolkit, index.id);
      success(`${toolkitLabel(toolkit)} removed from this index`);
      await loadConnections();
    } catch {
      error(`Failed to remove ${toolkitLabel(toolkit)}`);
    } finally {
      setPendingToolkit(null);
    }
  };

  const displayImageUrl = imagePreview ? imagePreview : (removeImageRequested ? null : imageUrl);
  const hasImageChanged = (imageFile !== null) || removeImageRequested || (imageUrl !== originalImageUrl && !imageFile && !removeImageRequested);
  const hasSettingsChanged = title !== originalTitle || prompt !== originalPrompt || hasImageChanged;
  const isDeleteConfirmationValid = deleteConfirmationText === currentIndex.title;
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
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Identity header: circle image left, title/placeholder right */}
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={isSavingSettings}
              className="relative flex-shrink-0 group cursor-pointer disabled:cursor-not-allowed"
            >
              <div className="w-[72px] h-[72px] rounded-full overflow-hidden">
                {displayImageUrl ? (
                  <img src={resolveNetworkImageSrc(displayImageUrl)} alt="Network" width={72} height={72} loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <NetworkAvatar id={index.id} title={title || index.title} size={72} rounded="full" />
                )}
              </div>
              <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center">
                <Camera className="w-4 h-4 text-white" />
              </div>
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="hidden"
            />
            {displayImageUrl && (
              <button
                type="button"
                onClick={handleRemoveImage}
                disabled={isSavingSettings}
                className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
              >
                Remove image
              </button>
            )}
          </div>

          {/* Title field at bottom */}
          <div>
            <label htmlFor="title" className="text-sm font-medium font-ibm-plex-mono text-gray-700 block mb-1.5">
              Title
            </label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Network title" />
          </div>
          {!index.isPersonal && (
            <div>
              <label className="block text-sm font-medium font-ibm-plex-mono text-gray-700 mb-1.5">Prompt</label>
              <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What people can share in this network..." className="min-h-[100px]" rows={4} />
              <p className="text-xs text-gray-400 mt-1.5">Guides what kind of intents people can share.</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setTitle(originalTitle); setPrompt(originalPrompt); setImageUrl(originalImageUrl); setImageFile(null); setImagePreview(null); setRemoveImageRequested(false); if (imageInputRef.current) imageInputRef.current.value = ''; }} disabled={isSavingSettings || !hasSettingsChanged}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveSettings} disabled={isSavingSettings || !hasSettingsChanged || !title.trim()}>
              {isSavingSettings ? 'Saving...' : 'Save'}
            </Button>
          </div>

          {!index.isPersonal && (
            <div className="pt-6 border-t border-gray-100">
              <button
                onClick={() => setIsDangerZoneExpanded(!isDangerZoneExpanded)}
                className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors"
              >
                {isDangerZoneExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Danger Zone
              </button>
              {isDangerZoneExpanded && (
                <div className="mt-3 flex items-center justify-between p-3 border border-red-100 rounded-sm bg-red-50">
                  <div>
                    <p className="text-sm font-medium text-red-800">Delete this network</p>
                    <p className="text-xs text-red-500 mt-0.5">This action cannot be undone.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirmation(true)} className="border-red-200 text-red-600 hover:bg-red-100">
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'access' && (
        <div className="space-y-8">

          {/* Who can join */}
          {!index.isPersonal && (
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

          {/* Share link */}
          {!index.isPersonal && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">
                {anyoneCanJoin ? 'Network Link' : 'Invitation Link'}
              </p>
              <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-sm bg-gray-50">
                <code className="flex-1 text-xs text-gray-500 truncate">
                  {anyoneCanJoin
                    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/network/${index.id}`
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
            {!index.isPersonal && (
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">
                Members <span className="normal-case font-normal">({members.length})</span>
              </p>
            )}

            {/* Smart search input — at top */}
            <div ref={searchContainerRef} className="relative mb-3">
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
                      onClick={() => handleAddContact(memberSearchQuery)}
                      disabled={isAddingContact}
                    >
                      <div className="h-6 w-6 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <Plus className="h-3.5 w-3.5 text-gray-500" />
                      </div>
                      <span className="text-sm text-black flex-1 truncate">Add "{memberSearchQuery}"</span>
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
                    <span className="text-xs px-1.5 py-0.5 rounded-sm font-medium bg-gray-900 text-white flex-shrink-0">
                      Owner
                    </span>
                  )}
                  {!member.permissions.includes('owner') && (
                    <>
                      <span className="group-hover:hidden text-xs px-1.5 py-0.5 rounded-sm font-medium flex-shrink-0 bg-gray-200 text-gray-700">
                        {member.permissions.includes('member') ? 'Member' : 'Contact'}
                      </span>
                      <button onClick={() => handleRemoveMember(member.id)} className="hidden group-hover:block p-1 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
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
      )}

      {activeTab === 'integrations' && (
        <div className="space-y-4">

          <div className="space-y-2">
            {AVAILABLE_TOOLKITS.map((toolkit) => {
              const conn = connections.find((c) => c.toolkit === toolkit);
              const isConnected = !!conn;
              const isPending = pendingToolkit === toolkit;
              return (
                <div key={toolkit} className="flex items-center gap-3 p-3 border border-gray-200 rounded-sm hover:border-gray-300 transition-colors">
                  <img src={`/integrations/${toolkit}.png`} width={24} height={24} alt={toolkit} className="flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-black capitalize">{toolkit}</div>
                    <div className="text-xs text-gray-500">
                      {!connectionsLoaded ? 'Loading...' : isConnected ? 'Connected' : 'Not connected'}
                    </div>
                  </div>
                  {!connectionsLoaded ? (
                    <div className="w-11 h-6 bg-gray-100 rounded-full animate-pulse" />
                  ) : (
                    <button
                      onClick={() => isConnected ? handleUnlink(toolkit) : handleConnect(toolkit)}
                      disabled={isPending}
                      className={`relative h-6 w-11 rounded-full transition-colors ${isConnected ? 'bg-[#006D4B]' : 'bg-gray-300'} ${isPending ? 'opacity-70' : ''}`}
                    >
                      <span className={`absolute top-[1px] left-[1px] h-[22px] w-[22px] rounded-full bg-white transition-transform shadow-sm ${isConnected ? 'translate-x-5' : ''}`} />
                      {isPending && (
                        <span className="absolute inset-0 grid place-items-center">
                          <span className="h-3 w-3 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                        </span>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AlertDialog.Root open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">Delete &apos;{currentIndex.title}&apos;</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">This action cannot be undone. Type the network name to confirm.</AlertDialog.Description>
            <Input value={deleteConfirmationText} onChange={(e) => setDeleteConfirmationText(e.target.value)} placeholder={currentIndex.title} className="mb-4" />
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild><Button variant="outline">Cancel</Button></AlertDialog.Cancel>
              <Button onClick={handleDeleteIndex} disabled={isDeletingIndex || !isDeleteConfirmationValid} className="bg-red-600 hover:bg-red-700 text-white">
                {isDeletingIndex ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
