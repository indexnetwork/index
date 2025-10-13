"use client";

import { useState, useCallback, useRef, useEffect, ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { User, AvatarUploadResponse, APIResponse } from "@/lib/types";
import { useAuthenticatedAPI } from "@/lib/api";
import { getAvatarUrl } from "@/lib/file-utils";
import { useNotifications } from "@/contexts/NotificationContext";
import { useAuthContext } from "@/contexts/AuthContext";
import ClientLayout from "@/components/ClientLayout";
import { useIndexService } from "@/services/indexes";
import { useIntegrationsService } from "@/services/integrations";
import { IntegrationName, getIntegrationsList } from "@/config/integrations";
import LibraryModal from "@/components/modals/LibraryModal";

type OnboardingStep = 'profile' | 'connections' | 'create_index' | 'invite_members' | 'indexes' | 'join_indexes';
type OnboardingFlow = 'flow_1' | 'flow_2';

interface IntegrationState {
  id: string | null;           // The actual integration UUID
  type: IntegrationName;       // The integration type (slack, discord, etc.)
  name: string;
  connected: boolean;
  indexId?: string | null;
}

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('profile');
  const [isLoading, setIsLoading] = useState(false);
  const [currentFlow, setCurrentFlow] = useState<OnboardingFlow>('flow_1');
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = useAuthenticatedAPI();
  const indexService = useIndexService();
  const integrationsService = useIntegrationsService();
  const { success, error } = useNotifications();
  const { user, refetchUser } = useAuthContext();

  // Profile step states
  const [name, setName] = useState('');
  const [intro, setIntro] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Connections step states
  const [integrations, setIntegrations] = useState<IntegrationState[]>([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [pendingIntegration, setPendingIntegration] = useState<string | null>(null);

  // Library step states
  const [linkUrl, setLinkUrl] = useState("");
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<Array<{ id: string; name: string; size: string; type: string }>>([]);
  const [links, setLinks] = useState<Array<{ id: string; url: string }>>([]);

  // Mock indexes for the final step
  const mockIndexes = [
    { id: 'index-early', name: 'Index Early', description: 'AI, Web3, Decentralization', members: 1250 },
    { id: 'techstars', name: 'Techstars Universe', description: 'AI, Web3, Decentralization', members: 890 },
    { id: 'base', name: 'Base', description: 'AI, Web3, Decentralization', members: 2100 },
    { id: 'consensys', name: 'Consensys', description: 'AI, Web3, Decentralization', members: 750 },
    { id: 'protocol-labs', name: 'Protocol Labs', description: 'AI, Web3, Decentralization', members: 1400 },
    { id: 'kernel', name: 'Kernel', description: 'AI, Web3, Decentralization', members: 680 },
  ];
  const [selectedIndexes, setSelectedIndexes] = useState<Set<string>>(new Set());

  // Create index step states
  const [indexName, setIndexName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [createdIndex, setCreatedIndex] = useState<{ id: string; name: string; inviteCode?: string } | null>(null);

  // Invite members step states
  const [inviteMethod, setInviteMethod] = useState<'automatic' | 'link' | null>(null);

  const [, setMemberCount] = useState(0);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  
  // Memoized display values to prevent glitching during reloads
  const [displayIntents, setDisplayIntents] = useState<Array<{ id: string; payload: string; summary?: string; isIncognito: boolean; createdAt: string; updatedAt: string }>>([]);
  const [displayMembers, setDisplayMembers] = useState<Array<{ id: string; name: string; avatar: string | null }>>([]);
  const [displayTotalIntents, setDisplayTotalIntents] = useState(0);
  const [showLibraryModal, setShowLibraryModal] = useState(false);

  // Load integrations status
  const loadIntegrations = useCallback(async () => {
    try {
      // Determine if we should filter by indexId
      let url = '/integrations';
      
      if (currentFlow === 'flow_2') {
        // In flow_2, we need to filter by indexId
        const indexId = localStorage.getItem('onboarding_created_index_id') || createdIndex?.id;
        if (indexId) {
          url = `/integrations?indexId=${indexId}`;
        }
      }
      // In flow_1, we don't filter by indexId (show all integrations)
      
      const response = await api.get<{ 
        integrations: Array<{ 
          id: string; // integrationId (UUID)
          type: string; // integration type (slack, discord, etc.)
          name: string; 
          connected: boolean; 
          indexId?: string | null;
        }>;
        availableTypes: Array<{
          type: string;
          name: string;
          toolkit: string;
        }>;
      }>(url);
      
      const connectedIntegrations = response.integrations || [];
      const availableTypes = response.availableTypes || [];
      
      // Create integration state combining connected and available types
      const updatedIntegrations = availableTypes.map(availableType => {
        const connectedIntegration = connectedIntegrations.find(i => i.type === availableType.type);
        return {
          id: connectedIntegration?.id || null, // The actual UUID
          type: availableType.type as IntegrationName, // The integration type
          name: availableType.name,
          connected: !!connectedIntegration,
          indexId: connectedIntegration?.indexId || null
        };
      });
      
      setIntegrations(updatedIntegrations);
      setIntegrationsLoaded(true);
    } catch (error) {
      console.error('Failed to fetch integrations:', error);
      // Fallback to default integrations if API fails
      setIntegrations(getIntegrationsList());
      setIntegrationsLoaded(true);
    }
  }, [api, currentFlow, createdIndex?.id]);

  // Load index summary for invite members step
  const loadIndexSummary = useCallback(async () => {
    try {
      const wasLoaded = summaryLoaded;
      if (!wasLoaded) {
        setSummaryLoaded(false);
      }
      
      // Get indexId from localStorage or createdIndex state
      const indexId = localStorage.getItem('onboarding_created_index_id') || createdIndex?.id;
      
      if (!indexId) {
        setCurrentStep('create_index');
        return;
      }

      const response = await api.get<{
        exampleIntents: Array<{ id: string; payload: string; summary?: string; isIncognito: boolean; createdAt: string; updatedAt: string }>;
        totalIntents: number;
        members: Array<{ id: string; name: string; avatar: string | null }>;
      }>(`/indexes/${indexId}/summary`);
      
      const newIntents = response.exampleIntents || [];
      const newMembers = response.members || [];
      const newTotalIntents = response.totalIntents || 0;
      
      // Update member count
      setMemberCount(newMembers.length);
      
      // Only update display values if there are meaningful changes or first load
      if (!wasLoaded || 
          JSON.stringify(newIntents) !== JSON.stringify(displayIntents) ||
          JSON.stringify(newMembers) !== JSON.stringify(displayMembers) ||
          newTotalIntents !== displayTotalIntents) {
        setDisplayIntents(newIntents);
        setDisplayMembers(newMembers);
        setDisplayTotalIntents(newTotalIntents);
      }
      
      if (!wasLoaded) {
        setSummaryLoaded(true);
      }
    } catch (error) {
      console.error('Failed to fetch index summary:', error);
      // Fallback to mock data only on first load
      if (!summaryLoaded) {
        const fallbackIntents: Array<{ id: string; payload: string; summary?: string; isIncognito: boolean; createdAt: string; updatedAt: string }> = [];
        const fallbackMembers: Array<{ id: string; name: string; avatar: string | null }> = [];
        
        setMemberCount(0);
        
        setDisplayIntents(fallbackIntents);
        setDisplayMembers(fallbackMembers);
        setDisplayTotalIntents(0);
        
        setSummaryLoaded(true);
      }
    }
  }, [api, createdIndex?.id, summaryLoaded, displayIntents, displayMembers, displayTotalIntents]);

  // Detect flow from query string
  useEffect(() => {
    const flow = searchParams.get('flow');
    if (flow === 'flow_2') {
      setCurrentFlow('flow_2');
    } else {
      setCurrentFlow('flow_1');
    }
  }, [searchParams]);

  // Initialize form fields when user data is available and determine starting step
  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setIntro(user.intro || '');
      
      // Check if we should skip steps based on user state and localStorage
      // Order: intro first, index second, integrations third
      const storedIndexId = localStorage.getItem('onboarding_created_index_id');
      
      if (currentFlow === 'flow_2') {
        // In flow_2: profile -> create_index -> connections -> invite_members
        if (!user.intro) {
          // Start with profile step if intro not filled
          setCurrentStep('profile');
        } else if (!storedIndexId) {
          // Intro filled but no index created yet - go to create_index
          setCurrentStep('create_index');
        } else {
          // Both intro filled and index created - go to connections (integrations)
          setCurrentStep('connections');
        }
        
        // If storedIndexId exists, we know an index was created (but don't restore full state)
        // The actual index data will be fetched from API if needed
      } else {
        // In flow_1: profile -> connections -> join_indexes
        if (!user.intro) {
          // Start with profile step if intro not filled
          setCurrentStep('profile');
        } else {
          // Intro filled - go to connections
          setCurrentStep('connections');
        }
      }
    }
  }, [user, currentFlow]);

  // Load integrations when appropriate
  useEffect(() => {
    // Only load integrations when on connections step
    if (currentStep === 'connections') {
      // For flow_1, always load (no indexId needed)
      // For flow_2, only load if we have an indexId
      if (currentFlow === 'flow_1') {
        loadIntegrations();
      } else if (currentFlow === 'flow_2') {
        const indexId = localStorage.getItem('onboarding_created_index_id') || createdIndex?.id;
        if (indexId) {
          loadIntegrations();
        }
      }
    }
  }, [currentStep, currentFlow, loadIntegrations, createdIndex?.id]);

  // Load index summary when reaching invite_members step and reload every second
  useEffect(() => {
    if (currentStep === 'invite_members') {
      // Load immediately
      loadIndexSummary();
      
      // Set up interval to reload every second
      const interval = setInterval(() => {
        loadIndexSummary();
      }, 1000);
      
      // Cleanup interval when leaving the step or component unmounts
      return () => clearInterval(interval);
    }
  }, [currentStep, loadIndexSummary]);

  const uploadAvatar = async (file: File): Promise<string> => {
    const result = await api.uploadFile<AvatarUploadResponse>('/upload/avatar', file, undefined, 'avatar');
    return result.avatarFilename;
  };

  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onload = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  // Navigation helpers based on flow
  const getNextStep = (currentStep: OnboardingStep): OnboardingStep => {
    if (currentFlow === 'flow_1') {
      switch (currentStep) {
        case 'profile': return 'connections';
        case 'connections': return 'join_indexes';
        default: return 'join_indexes';
      }
    } else { // flow_2
      switch (currentStep) {
        case 'profile': return 'create_index';
        case 'create_index': return 'connections';
        case 'connections': return 'invite_members';
        default: return 'invite_members';
      }
    }
  };

  const getPreviousStep = (currentStep: OnboardingStep): OnboardingStep => {
    if (currentFlow === 'flow_1') {
      switch (currentStep) {
        case 'connections': return 'profile';
        case 'join_indexes': return 'connections';
        default: return 'profile';
      }
    } else { // flow_2
      switch (currentStep) {
        case 'create_index': return 'profile';
        case 'connections': return 'create_index';
        case 'invite_members': return 'connections';
        default: return 'profile';
      }
    }
  };

  const handleProfileSubmit = async () => {
    if (!user || !name.trim()) return;
    
    setIsLoading(true);
    try {
      let avatarFilename = user.avatar;
      
      if (avatarFile) {
        avatarFilename = await uploadAvatar(avatarFile);
      }
      
      const response = await api.patch<APIResponse<User>>('/auth/profile', {
        name: name.trim(),
        intro: intro.trim(),
        avatar: avatarFilename || undefined,
      });
      
      if (response.user) {
        // Refetch user data in AuthContext to keep it in sync
        await refetchUser();
        setCurrentStep(getNextStep('profile'));
      }
    } catch (err) {
      console.error('Error updating profile:', err);
      error('Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleIntegration = useCallback(async (type: string) => {
    const item = integrations.find(i => i.type === type);
    if (!item) return;
    
    try {
      setPendingIntegration(type);
      if (item.connected && item.id) {
        // Disconnect using integration UUID
        await integrationsService.disconnectIntegration(item.id);
        // Refresh integrations from API to get real status
        await loadIntegrations();
        success(`${item.name} disconnected`);
      } else {
        const popup = typeof window !== 'undefined' ? window.open('', `oauth_${type}`, 'width=560,height=720') : null;
        
        // Get indexId from localStorage or createdIndex state
        const indexId = localStorage.getItem('onboarding_created_index_id') || createdIndex?.id;
        
        // indexId is required by the backend API
        if (!indexId) {
          error('Index ID is required to connect integrations');
          return;
        }
        
        const res = await integrationsService.connectIntegration(type, { indexId });
        const redirect = res.redirectUrl;
        const integrationId = res.integrationId;
        
        if (popup && redirect) {
          popup.location.href = redirect;
        } else if (redirect) {
          window.location.href = redirect;
          return;
        }
        
        if (integrationId) {
          const started = Date.now();
          
          const poll = setInterval(async () => {
            if (popup && popup.closed) {
              clearInterval(poll);
              return;
            }
            
            try {
              // Use the new status endpoint with integrationId
              const s = await integrationsService.getIntegrationStatus(integrationId);
              
              if (s.status === 'connected') {
                clearInterval(poll);
                if (popup && !popup.closed) popup.close();
                // Refresh integrations from API to get real status
                await loadIntegrations();
                success(`${item.name} connected`);
              }
              if (Date.now() - started > 90000) {
                clearInterval(poll);
                if (popup && !popup.closed) popup.close();
                error('Connection timeout - please try again');
              }
            } catch (err) {
              console.error('Error checking connection status:', err);
            }
          }, 1500);
        }
      }
    } catch {
      // ignore
    } finally {
      setPendingIntegration(null);
    }
  }, [integrationsService, integrations, success, error, loadIntegrations, createdIndex?.id]);

  const handleFilesSelected = useCallback(async (f: FileList | null) => {
    if (!f || f.length === 0) return;
    setIsUploading(true);
    try {
      const uploadedFiles = await Promise.all(Array.from(f).map(async file => {
        const res = await api.uploadFile<{ file: { id: string; name: string; size: string; type: string } }>(`/files`, file);
        return res.file;
      }));
      setFiles(prev => [...prev, ...uploadedFiles]);
      success(`${uploadedFiles.length} file(s) uploaded`);
    } catch {
      error('Failed to upload files');
    } finally {
      setIsUploading(false);
    }
  }, [api, success, error]);

  const handleAddLink = useCallback(async () => {
    if (!linkUrl.trim()) return;
    
    let normalizedUrl = linkUrl.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    
    try {
      setIsAddingLink(true);
      const res = await api.post<{ link: { id: string; url: string } }>(`/links`, { url: normalizedUrl });
      setLinks(prev => [...prev, res.link]);
      setLinkUrl("");
      success('Link added successfully');
    } catch {
      error('Failed to add link');
    } finally {
      setIsAddingLink(false);
    }
  }, [api, linkUrl, success, error]);

  const handleCreateIndex = async () => {
    if (!indexName.trim()) return;
    
    setIsLoading(true);
    try {
      const createRequest = {
        title: indexName.trim(),
        joinPolicy: isPrivate ? 'invite_only' as const : 'anyone' as const,
      };
      
      const response = await indexService.createIndex(createRequest);
      
      const indexData = {
        id: response.id,
        name: response.title,
        inviteCode: response.permissions?.invitationLink?.code
      };
      
      setCreatedIndex(indexData);
      
      // Store only indexId in localStorage for future onboarding sessions
      localStorage.setItem('onboarding_created_index_id', indexData.id);
      
      success('Index created successfully!');
      setCurrentStep(getNextStep('create_index'));
    } catch (err) {
      console.error('Error creating index:', err);
      error('Failed to create index');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInviteMembers = async () => {
    if (inviteMethod === 'automatic') {
      // In a real implementation, this would send invites
      success('Invitations will be sent!');
    } else if (inviteMethod === 'link') {
      success('Invite link copied to clipboard!');
      if (createdIndex?.inviteCode) {
        const inviteLink = `${window.location.origin}/l/${createdIndex.inviteCode}`;
        await navigator.clipboard.writeText(inviteLink);
      }
    }
  };

  const handleCompleteOnboarding = async () => {
    try {
      setIsLoading(true);
      // Mark onboarding as completed and clean up temporary data
      localStorage.setItem('onboarding_completed', Date.now().toString());
      
      // Clean up onboarding-specific localStorage items
      localStorage.removeItem('onboarding_created_index_id');
      
      router.push('/inbox');
    } catch (error) {
      console.error('Error completing onboarding:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'profile':
        return (
          <div className="max-w-3xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">Tell us who you are.</h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
                Set up your profile to get started with Index Network.
              </p>
            </div>

            <div className="max-w-md space-y-6">
              <div className="flex">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full overflow-hidden bg-[#F5F5F5] flex items-center justify-center">
                    {avatarPreview ? (
                      <Image src={avatarPreview} alt="Avatar preview" width={80} height={80} className="w-full h-full object-cover" />
                    ) : user?.avatar ? (
                      <Image 
                        src={getAvatarUrl(user)} 
                        alt="Avatar" 
                        width={80} 
                        height={80} 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#888]">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#006D4B] text-white rounded-full flex items-center justify-center hover:bg-[#005A3E] transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2-2z"></path>
                      <circle cx="12" cy="13" r="4"></circle>
                    </svg>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-3 font-ibm-plex-mono">Name Surname</label>
                <Input
                  type="text"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-3 font-ibm-plex-mono">Intro</label>
                <Textarea
                  placeholder="Tell us about yourself in a few words"
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  className="w-full min-h-[100px]"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-8 max-w-md">
              <Button
                onClick={handleProfileSubmit}
                disabled={!name.trim() || isLoading}
                className="flex-1 bg-[#000] text-white hover:bg-black font-ibm-plex-mono"
              >
                {isLoading ? 'Saving...' : 'Next'}
              </Button>
            </div>
          </div>
        );

      case 'connections':
        return (
          <div className="max-w-3xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">Connect your accounts</h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
                {currentFlow === 'flow_1'
                  ? "Link the places you already work and share. Nobody gets notified, and it's only used to understand what you're looking for."
                  : "Link the platforms where your people already works and shares. Nobody gets notified for now. We recommend connecting every account you use regularly so Index has a full picture of your ecosystem."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {integrations.map((integration) => (
                <div key={integration.type} className="border border-b-2 border-[#000] p-4 bg-white">
                  <div className="flex items-center justify-between mb-0">
                    <div className="flex items-center gap-3">
                      <Image 
                        src={`/integrations/${integration.type}.png?3`} 
                        width={24} 
                        height={24} 
                        alt={integration.name}
                      />
                      <span className="font-small text-black font-ibm-plex-mono text-[14px]">{integration.name}</span>
                    </div>
                    {!integrationsLoaded ? (
                      // Show loading placeholder for toggle only
                      <div className="w-11 h-6 bg-[#F5F5F5] rounded-full animate-pulse" />
                    ) : (
                      <button
                        onClick={() => toggleIntegration(integration.type)}
                        disabled={pendingIntegration === integration.type}
                        className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${
                          integration.connected ? 'bg-[#006D4B]' : 'bg-[#D9D9D9]'
                        } ${pendingIntegration === integration.type ? 'opacity-70' : ''}`}
                      >
                        <span
                          className={`absolute top-[1px] left-[1px] h-[22px] w-[22px] rounded-full bg-white transition-transform duration-200 shadow-sm ${
                            integration.connected ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                        {pendingIntegration === integration.type && (
                          <span className="absolute inset-0 grid place-items-center">
                          <span
                            className={`h-3 w-3 border-2 border-white/70 border-t-transparent rounded-full animate-spin`}
                            style={{
                              marginLeft: integration.connected ? "-20px" : "20px"
                            }}
                          />
                        </span>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {currentFlow === 'flow_1' && (
              <div className="mb-8">
                <h2 className="text-lg font-bold text-black mb-4 font-ibm-plex-mono">
                  Add context files & links
                  </h2>
                
                <p className="text-black text-[14px] font-ibm-plex-mono mb-6">
                  Add text-based context – for example, a <strong>research note</strong>, a <strong>draft proposal</strong>, or a <strong>blogpost</strong> you wrote or found inspiring.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3 mb-4">
                  <div className="border border-[#E0E0E0] rounded-lg">
                    <div className="relative w-full">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => handleFilesSelected(e.target.files)}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="w-full h-10 px-3 py-2 text-sm font-ibm-plex-mono bg-white text-black hover:bg-[#F0F0F0] transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0 rounded-lg flex items-center justify-center gap-1.5"
                      >
                        {isUploading ? (
                          <>
                            <span className="h-4 w-4 border-2 border-[#DDDDDD] border-t-transparent rounded-full animate-spin" />
                            Uploading…
                          </>
                        ) : (
                          <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-[#666]">
                              <path d="M12 5v14"></path>
                              <path d="M5 12h14"></path>
                            </svg>
                            Upload files
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="border border-[#E0E0E0] rounded-lg">
                    <div className="relative w-full">
                      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-sm pointer-events-none">
                        🔗
                      </span>
                      <Input
                        placeholder="Paste URL here"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAddLink(); }}
                        className="text-sm bg-white rounded-lg font-ibm-plex-mono w-full pl-10 pr-10 focus:ring-2 focus:ring-[rgba(0,0,0,0.1)] border-0"
                      />
                      {isAddingLink ? (
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2 w-6 h-6 border-2 border-[#DDDDDD] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <button
                          onClick={handleAddLink}
                          disabled={!linkUrl}
                          className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-[#F0F0F0] rounded-lg cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                          aria-label="Add URL"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666]">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {(files.length > 0 || links.length > 0) && (
                  <div className="space-y-2">
                    {files.map((file) => (
                      <div key={file.id} className="flex items-center gap-2 p-2 bg-[#F8F9FA] rounded-lg">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#666]">
                          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
                          <polyline points="14,2 14,8 20,8"></polyline>
                        </svg>
                        <span className="text-sm text-black font-ibm-plex-mono">{file.name}</span>
                      </div>
                    ))}
                    {links.map((link) => (
                      <div key={link.id} className="flex items-center gap-2 p-2 bg-[#F8F9FA] rounded-lg">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#666]">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                        </svg>
                        <span className="text-sm text-black font-ibm-plex-mono truncate">{link.url}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(getPreviousStep('connections'))}
                className="flex-1 border-[#E0E0E0] text-black hover:bg-[#F0F0F0] font-ibm-plex-mono"
              >
                Back
              </Button>
              <Button
                onClick={() => setCurrentStep(getNextStep('connections'))}
                className="flex-1 bg-[#000] text-white hover:bg-black font-ibm-plex-mono"
              >
                Next
              </Button>

            </div>
          </div>
        );

      case 'create_index':
        return (
          <div className="max-w-2xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">Create your index.</h1>
              <p className="text-black text-[14px] font-ibm-plex-mono mb-6">
                Create a space for your network to discover and share opportunities.
              </p>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-black mb-3 font-ibm-plex-mono">Index Name</label>
                <Input
                  type="text"
                  placeholder="Enter your name"
                  value={indexName}
                  onChange={(e) => setIndexName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && indexName.trim() && !isLoading) {
                      handleCreateIndex();
                    }
                  }}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-black mb-2 font-ibm-plex-mono">Choose who can discover</label>
                

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <button
                    type="button"
                    onClick={() => setIsPrivate(false)}
                    className={`border-2 p-4 rounded-md text-left transition-all ${
                      !isPrivate 
                        ? 'border-[#007EFF] bg-white' 
                        : 'border-[#E0E0E0] bg-[#F8F9FA] hover:border-[#007EFF]'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={!isPrivate ? "text-[#007EFF]" : "text-black"}>
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 6v6l4 2"></path>
                      </svg>
                      <h3 className={`font-bold font-ibm-plex-mono ${!isPrivate ? "text-black" : "text-[#666]"}`}>Anyone can join</h3>
                    </div>
                    <p className="text-sm text-black font-ibm-plex-mono">
                      People can discover and join your network freely.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsPrivate(true)}
                    className={`border-2 p-4 rounded-md text-left transition-all ${
                      isPrivate 
                        ? 'border-[#007EFF] bg-white' 
                        : 'border-[#E0E0E0] bg-[#F8F9FA] hover:border-[#007EFF]'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={isPrivate ? "text-[#007EFF]" : "text-black"}>
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <circle cx="12" cy="16" r="1"></circle>
                        <path d="m7 11 0-4a5 5 0 0 1 10 0v4"></path>
                      </svg>
                      <h3 className={`font-bold font-ibm-plex-mono ${isPrivate ? "text-black" : "text-[#666]"}`}>Private</h3>
                    </div>
                    <p className="text-sm text-[#666] font-ibm-plex-mono">
                      Only people you invited or people with the invitation link can join.
                    </p>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(getPreviousStep('create_index'))}
                className="flex-1 border-[#E0E0E0] text-black hover:bg-[#F0F0F0] font-ibm-plex-mono"
              >
                Back
              </Button>
              <Button
                onClick={handleCreateIndex}
                disabled={!indexName.trim() || isLoading}
                className="flex-1 bg-[#000] text-white hover:bg-black font-ibm-plex-mono"
              >
                {isLoading ? 'Creating...' : 'Next'}
              </Button>
              
            </div>
          </div>
        );

      case 'invite_members':
        return (
          <div className="max-w-3xl mx-auto" >
            <div className="mb-2">
              <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">You're all set—here's a quick snapshot.</h1>
              {summaryLoaded && displayIntents.length > 0 ? (
                <p className="text-black text-[14px] font-ibm-plex-mono mb-2">
                  Here are <strong>your intents</strong> from your connected sources. You can{' '}
                  <button
                    type="button"
                    onClick={() => loadIndexSummary()}
                    className="inline p-0 m-0 align-baseline text-black italic underline hover:opacity-80 font-ibm-plex-mono text-[14px] bg-transparent border-0 cursor-pointer"
                    style={{ display: 'inline', background: 'none' }}
                  >
                    edit or add more
                  </button>{' '}
                  anytime.
                </p>
              ) : summaryLoaded ? (
                null
              ) : (
                <p className="text-black text-[14px] font-ibm-plex-mono mb-2">
                  Loading your intents from connected sources...
                </p>
              )}
            </div>

            {/* Intent tags - only show if there are intents or still loading */}
            {(!summaryLoaded || displayIntents.length > 0) && (
              <div className="space-y-1.5 mb-4">
                {summaryLoaded ? (
                  displayIntents.map((intent) => (
                    <span
                      key={intent.id}
                      className="inline-block text-left px-2 py-1 bg-[#E3F2FD] hover:bg-[#BBDEFB] transition-colors rounded-sm"
                    >
                      <span className="text-[#1976D2] text-[13px] font-ibm-plex-mono">
                        {intent.summary || intent.payload}
                      </span>
                    </span>
                  ))
                ) : (
                  // Loading placeholders
                  Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="px-2 py-2.5  bg-[#F5F5F5] rounded-sm animate-pulse mb-1.5">
                      <div className="h-[13px] bg-[#E0E0E0] rounded" style={{ width: `${Math.random() * 200 + 200}px` }}></div>
                    </div>
                  ))
                )}
              </div>
            )}

            

            {/* Member invitation section */}
            <div className="mt-6 mb-12">
            {summaryLoaded ? (
                (displayMembers.length > 1 ) ? (
                  <div className="mt-4">
                    {/* Show member info when there are multiple members and intents */}
                    <div>
                      <span className="text-black text-[14px] font-ibm-plex-mono">
                        We found {displayMembers.slice(0, 3).map((member, index) => (
                          <span key={member.id}>
                            <strong>{member.name}</strong>
                            {index < Math.min(3, displayMembers.length) - 1 && index < 2 ? ', ' : ''}
                          </span>
                        ))}
                        {displayMembers.length > 3 && (
                          <span> and <strong>{displayMembers.length - 3} more members</strong></span>
                        )}  sharing <strong>{displayTotalIntents.toLocaleString()}</strong> intents.
                      </span>
                    </div>
                    <p className="text-black text-[14px] font-ibm-plex-mono mb-4 mt-4">
                      Now, invite them to add their intents! The more intents people share, the easier it becomes to discover each other and connect at the right moment.
                    </p>
                    
                    <div className="flex gap-3">
                      <Button
                        onClick={() => {
                          setInviteMethod('automatic');
                          handleInviteMembers();
                        }}
                        className="bg-[#1976D2] text-white hover:bg-[#1565C0] font-ibm-plex-mono"
                      >
                        Invite Automatically
                      </Button>
                      <Button
                        onClick={() => {
                          setInviteMethod('link');
                          handleInviteMembers();
                        }}
                        variant="outline" className="font-ibm-plex-mono"
                      >
                        Copy invite link
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    {/* Show single pending text for both intents and members */}
                    <p className="text-black text-[14px] font-ibm-plex-mono">
                      We're still processing your connected sources to generate your intents and find potential members. This usually takes a few minutes. Check back later to see your results.
                    </p>
                  </div>
                )
              ) : (
                <div className="mt-4 mb-4">
                  {/* Loading state */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-5 bg-[#F5F5F5] rounded animate-pulse w-64"></div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(getPreviousStep('invite_members'))}
                className="flex-1 border-[#E0E0E0] text-black hover:bg-[#F0F0F0] font-ibm-plex-mono"
              >
                Back
              </Button>
              <Button
                onClick={handleCompleteOnboarding}
                className="flex-1 bg-[#000] text-white hover:bg-black font-ibm-plex-mono"
              >
                Complete setup
              </Button>
            </div>
          </div>
        );

      case 'join_indexes':
        return (
          <div className="max-w-4xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">Step into the right indexes.</h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
              Based on your profile, here are networks where people are already sharing opportunities and ideas.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {mockIndexes.map((index) => (
                <div key={index.id} className="border border-[#E0E0E0] rounded-lg p-6 bg-white">
                  <div className="text-center">
                    <h3 className="text-lg font-bold text-black mb-2 font-ibm-plex-mono">{index.name}</h3>
                    <p className="text-sm text-[#666] mb-4 font-ibm-plex-mono">{index.description}</p>
                    <p className="text-xs text-[#888] mb-4 font-ibm-plex-mono">{index.members.toLocaleString()} members</p>
                    <Button
                      variant={selectedIndexes.has(index.id) ? "default" : "outline"}
                      onClick={() => {
                        setSelectedIndexes(prev => {
                          const next = new Set(prev);
                          if (next.has(index.id)) {
                            next.delete(index.id);
                          } else {
                            next.add(index.id);
                          }
                          return next;
                        });
                      }}
                      className={`w-full font-ibm-plex-mono ${
                        selectedIndexes.has(index.id)
                          ? 'bg-[#006D4B] text-white hover:bg-[#005A3E]'
                          : 'border-[#E0E0E0] text-black hover:bg-[#F0F0F0]'
                      }`}
                    >
                      {selectedIndexes.has(index.id) ? 'Joined' : 'Join'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(getPreviousStep('join_indexes'))}
                className="flex-1 border-[#E0E0E0] text-black hover:bg-[#F0F0F0] font-ibm-plex-mono"
              >
                Back
              </Button>
              <Button
                onClick={handleCompleteOnboarding}
                disabled={isLoading}
                className="flex-1 bg-[#000] text-white hover:bg-black font-ibm-plex-mono"
              >
                {isLoading ? 'Finishing...' : 'Next'}
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <ClientLayout>
      <div className="bg-[#FAFAFA]">
        {/* Main content */}
        <div className="px-6 py-12">
          {renderStepContent()}
        </div>
      </div>
      
      {/* Library Modal */}
      <LibraryModal
        open={showLibraryModal}
        onOpenChange={setShowLibraryModal}
        onChanged={() => {
          // Optionally refresh index summary when library changes
          if (currentStep === 'invite_members') {
            loadIndexSummary(); 
          }
        }}  
      />
    </ClientLayout>
  );
}
