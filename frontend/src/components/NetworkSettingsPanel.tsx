import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, Globe, Lock, Trash2, Plus, Check, ChevronRight, ChevronDown, ChevronLeft, Camera, Upload, Download, X, RotateCw } from 'lucide-react';
import { Network } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip } from '@/components/ui/Tooltip';
import { useNetworks } from '@/contexts/APIContext';
import { useNetworksState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { useAuthContext } from '@/contexts/AuthContext';
import { createIntegrationsService, type ComposioConnection } from '@/services/integrations';
import { createUsersService } from '@/services/users';
import { Member } from '@/services/networks';
import { validateFiles, validateFile } from '@/lib/file-validation';
import { parseCsvText, type ImportRow, type ParsedCsvResult } from '@/lib/csv-import';
import CsvPreviewModal from '@/components/modals/CsvPreviewModal';
import MasterKeyDialog from '@/components/MasterKeyDialog';

/** Toolkits available for connection. Add entries here when enabling new Composio integrations. */
const AVAILABLE_TOOLKITS = ['gmail', 'slack'] as const;

const TOOLKIT_LABELS: Record<string, string> = { gmail: 'Gmail', slack: 'Slack' };
const toolkitLabel = (t: string) => TOOLKIT_LABELS[t] ?? t;
import NetworkAvatar, { resolveNetworkImageSrc } from '@/components/IndexAvatar';
import UserAvatar from '@/components/UserAvatar';
import GhostBadge from '@/components/GhostBadge';
import CopyableBox from '@/components/CopyableBox';
import { useNavigate } from 'react-router';

interface NetworkSettingsPanelProps {
  index: Network;
  onDeleted?: () => void;
  activeTab: 'settings' | 'access' | 'integrations';
}

export default function NetworkSettingsPanel({ index, onDeleted, activeTab }: NetworkSettingsPanelProps) {
  const indexesService = useNetworks();
  const navigate = useNavigate();
  const { indexes, updateIndex, removeIndex } = useNetworksState();
  const { success, error, info } = useNotifications();
  const api = useAuthenticatedAPI();
  const { user: currentUser } = useAuthContext();

  const currentIndex = indexes?.find(idx => idx.id === index.id) || index;

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
  const [resendTarget, setResendTarget] = useState<Member | null>(null);
  const [isResendInFlight, setIsResendInFlight] = useState(false);
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

  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvPreview, setCsvPreview] = useState<ParsedCsvResult | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);

  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [rotateConfirmationText, setRotateConfirmationText] = useState('');
  const [isRotating, setIsRotating] = useState(false);
  const [rotatedMasterKey, setRotatedMasterKey] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- syncs local form state from prop changes */
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
  /* eslint-enable react-hooks/set-state-in-effect */

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
  }, [error]);

  const handleRemoveImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    setRemoveImageRequested(true);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }, []);

  const loadMembers = useCallback(async () => {
    setIsMembersLoading(true);
    try {
      const response = await indexesService.getMembers(index.id, {});
      setMembers(response.members);
    } catch (err) {
      console.error('Error loading members:', err);
    } finally {
      setIsMembersLoading(false);
    }
  }, [indexesService, index.id]);

  useEffect(() => {
    if (activeTab === 'access') loadMembers(); // eslint-disable-line react-hooks/set-state-in-effect -- load on tab switch
  }, [activeTab, loadMembers]);

  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSuggestedUsers([]);
      setSearchHasQueried(false);
      return;
    }
    setSearchIsLoading(true);
    try {
      const users = await indexesService.searchUsers(query, index.id);
      setSuggestedUsers(users.map(u => ({ ...u, permissions: [] })));
      setSearchHasQueried(true);
    } catch (err) {
      console.error('Error searching users:', err);
      setSuggestedUsers([]);
    } finally {
      setSearchIsLoading(false);
    }
  }, [indexesService, index.id]);

  const [contactsPage, setContactsPage] = useState(1);

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
    if (activeTab === 'integrations') loadConnections(); // eslint-disable-line react-hooks/set-state-in-effect -- load on tab switch
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
        finalImageUrl = await indexesService.uploadIndexImage(imageFile);
      } else if (removeImageRequested) {
        finalImageUrl = null;
      }
      const updatedIndex = await indexesService.updateNetwork(index.id, {
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
      updateIndex(updatedIndex);
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
      await indexesService.deleteNetwork(index.id);
      removeIndex(index.id);
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
      await indexesService.updatePermissions(index.id, {
        joinPolicy: joinPolicy ? 'anyone' : 'invite_only',
      });
      const updatedIndex = await indexesService.getNetwork(index.id);
      updateIndex(updatedIndex);
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
      ? `${window.location.origin}/index/${index.id}`
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
    if (currentIndex.isExperiment) {
      // Experiment networks need scoped-agent + API-key + invite email even
      // when the invitee already exists in the inviter's contacts; route
      // through the invite endpoint, which is idempotent for existing users.
      await handleInviteMember(memberUser.email);
      return;
    }
    try {
      const newMember = await indexesService.addMember(index.id, memberUser.id, ['member']);
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
        await indexesService.removeMember(index.id, memberId);
      }
      setMembers(prev => prev.filter(m => m.id !== memberId));
    } catch (err) {
      console.error('Error removing member:', err);
    }
  };

  const handleConfirmResend = async () => {
    if (!resendTarget) return;
    setIsResendInFlight(true);
    try {
      const result = await indexesService.resendInvite(index.id, resendTarget.id);
      success(`Invitation resent to ${result.email}${result.rotated ? ' (key rotated)' : ''}`);
      setResendTarget(null);
    } catch (err) {
      console.error('Resend invite failed', err);
      error('Failed to resend invitation');
    } finally {
      setIsResendInFlight(false);
    }
  };

  const handleConfirmRotate = async () => {
    if (isRotating) return;
    if (rotateConfirmationText !== currentIndex.title) return;
    setIsRotating(true);
    try {
      const result = await indexesService.rotateMasterKey(index.id);
      setShowRotateConfirm(false);
      setRotateConfirmationText('');
      setRotatedMasterKey(result.masterKey);
      success('Master key rotated — old key is now invalid');
    } catch (err) {
      console.error('Master key rotation failed', err);
      error('Failed to rotate master key');
    } finally {
      setIsRotating(false);
    }
  };

  const [isAddingMember, setIsAddingMember] = useState(false);
  const CONTACTS_PAGE_SIZE = 10;

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
      const result = await indexesService.inviteMember(index.id, email);
      setMemberSearchQuery('');
      setSuggestedUsers([]);
      setShowSuggestions(false);
      setSearchHasQueried(false);
      await loadMembers();
      // agentProvisioned is the source-of-truth for whether an invite email
      // went out — true for both newly-created users and pre-existing users
      // who didn't yet have a scoped agent for this network.
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
      const result = await indexesService.importMembers(index.id, rows);
      setCsvPreview(null);
      const suffix = result.ownersNotified > 0
        ? ` · credentials emailed to ${result.ownersNotified} owner${result.ownersNotified !== 1 ? 's' : ''}`
        : '';
      success(`Imported ${result.imported} member${result.imported !== 1 ? 's' : ''}${result.skipped > 0 ? ` · ${result.skipped} skipped` : ''}${suffix}`);
      await loadMembers();
    } catch {
      error('Import failed');
    }
  }, [indexesService, index.id, loadMembers, success, error]);

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

          {/* Who can join — experiment networks are always private */}
          {!index.isPersonal && !currentIndex.isExperiment && (
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
          {!index.isPersonal && !currentIndex.isExperiment && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">
                {anyoneCanJoin ? 'Network Link' : 'Invitation Link'}
              </p>
              <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-sm bg-gray-50">
                <code className="flex-1 text-xs text-gray-500 truncate">
                  {anyoneCanJoin
                    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/index/${index.id}`
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
                {currentIndex.isExperiment && (
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
                      onClick={() => currentIndex.isExperiment ? handleInviteMember(memberSearchQuery) : handleAddContact(memberSearchQuery)}
                      disabled={isAddingMember}
                    >
                      <div className="h-6 w-6 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <Plus className="h-3.5 w-3.5 text-gray-500" />
                      </div>
                      <span className="text-sm text-black flex-1 truncate">
                        {currentIndex.isExperiment ? `Invite "${memberSearchQuery}"` : `Add "${memberSearchQuery}"`}
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
                  {currentIndex.isExperiment && (
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

          {/* OpenClaw plugin config — experiment networks only */}
          {currentIndex.isExperiment && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">
                OpenClaw plugin config
              </p>
              <p className="text-xs text-gray-500 mb-3">
                Hand to OpenClaw admins to merge into <code className="px-1 py-0.5 bg-gray-100 rounded text-[11px] font-ibm-plex-mono">openclaw.json</code> under <code className="px-1 py-0.5 bg-gray-100 rounded text-[11px] font-ibm-plex-mono">plugins.entries.indexnetwork-openclaw-plugin.config</code>.
              </p>
              <CopyableBox
                value={JSON.stringify(
                  {
                    url: typeof window !== 'undefined' ? window.location.origin : 'https://index.network',
                    digestEnabled: 'true',
                    digestTime: '08:00',
                    mainAgentToolUse: 'disabled',
                    nodeName: currentIndex.title ?? '',
                    nodeDescription: currentIndex.prompt ?? '',
                    nodeContext: '',
                  },
                  null,
                  2,
                )}
              />
            </div>
          )}

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

          {currentIndex.isExperiment && (
            <div className="pt-2">
              <div className="flex items-start gap-3 p-3 border border-gray-200 rounded-sm">
                <img
                  src="/integrations/edgeclaw.png"
                  width={24}
                  height={24}
                  alt="EdgeClaw"
                  className="flex-shrink-0 mt-0.5"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-black">EdgeClaw</div>
                      <div className="text-xs text-gray-500">Server-side signup for experiment attendees</div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setShowRotateConfirm(true)}
                      disabled={isRotating}
                    >
                      <RotateCw className="h-3.5 w-3.5 mr-1.5" />
                      Rotate key
                    </Button>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-1.5">Signup endpoint</div>
                    <CopyableBox value={typeof window !== 'undefined' ? `${window.location.origin}/api/networks/${currentIndex.id}/signup` : `/api/networks/${currentIndex.id}/signup`} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-1.5">Master key</div>
                    <CopyableBox value={'•••••••• (shown once at creation — rotate for a new one)'} />
                  </div>
                  <p className="text-xs text-gray-500">
                    Used server-side by InstaClaw and EdgeOS. Never expose in user-facing apps.
                  </p>
                </div>
              </div>
            </div>
          )}
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

      <AlertDialog.Root open={showRotateConfirm} onOpenChange={(open) => { if (!open) { setShowRotateConfirm(false); setRotateConfirmationText(''); } }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">Rotate master key</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">
              Rotating issues a new master key and immediately revokes the current one. Any backend using the old key (InstaClaw, EdgeOS) will stop working until you redeploy it with the new key. We will also email the new key to every owner of this network. Type the network name to confirm.
            </AlertDialog.Description>
            <Input
              value={rotateConfirmationText}
              onChange={(e) => setRotateConfirmationText(e.target.value)}
              placeholder={currentIndex.title}
              className="mb-4"
            />
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={isRotating}>Cancel</Button>
              </AlertDialog.Cancel>
              <Button
                onClick={handleConfirmRotate}
                disabled={isRotating || rotateConfirmationText !== currentIndex.title}
              >
                {isRotating ? 'Rotating...' : 'Rotate'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

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

      {rotatedMasterKey && (
        <MasterKeyDialog
          open={!!rotatedMasterKey}
          masterKey={rotatedMasterKey}
          onClose={() => setRotatedMasterKey(null)}
        />
      )}
    </>
  );
}
