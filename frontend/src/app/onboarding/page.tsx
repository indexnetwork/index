"use client";

import { useState, useCallback, useRef, useEffect, ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Index } from "@/lib/types";
import { useAuthenticatedAPI } from "@/lib/api";
import { getAvatarUrl } from "@/lib/file-utils";
import { useNotifications } from "@/contexts/NotificationContext";
import { useAuthContext } from "@/contexts/AuthContext";
import ClientLayout from "@/components/ClientLayout";
import { useIndexService } from "@/services/indexes";
import { useIntegrationsService } from "@/services/integrations";
import { IntegrationName, getIntegrationsList } from "@/config/integrations";
import LibraryModal from "@/components/modals/LibraryModal";
import { validateFiles, getSupportedFileExtensions, formatFileSize, getFileCategoryBadge } from "@/lib/file-validation";
import { formatDate } from "@/lib/utils";
import { useIndexesState } from "@/contexts/IndexesContext";
import { useAuth as useAuthService, useFiles, useLinks } from "@/contexts/APIContext";
import { QueueStatus } from "@/services/queue";

type OnboardingStep = 'profile' | 'connections' | 'create_index' | 'invite_members' | 'join_indexes';
type OnboardingFlow = 1 | 2 | 3;

interface IntegrationState {
  id: string | null;           // The actual integration UUID
  type: IntegrationName;       // The integration type (slack, discord, etc.)
  name: string;
  connected: boolean;
  indexId?: string | null;
}

// Flow configuration
interface FlowConfig {
  steps: OnboardingStep[];
  features: {
    showSlackDiscord: boolean;
    enableUserAttribution: boolean;
    requireIndexId: boolean;
  };
  descriptions: {
    connections: string;
  };
}

const FLOW_CONFIGS: Record<OnboardingFlow, FlowConfig> = {
  1: { // Personal flow
    steps: ['profile', 'connections', 'join_indexes'],
    features: {
      showSlackDiscord: false,
      enableUserAttribution: false,
      requireIndexId: false,
    },
    descriptions: {
      connections: "Link the places you already work and share. Nobody gets notified, and it's only used to understand what you're looking for.",
    },
  },
  2: { // Community flow
    steps: ['profile', 'create_index', 'connections', 'invite_members'],
    features: {
      showSlackDiscord: true,
      enableUserAttribution: true,
      requireIndexId: true,
    },
    descriptions: {
      connections: "Link the platforms where your people already works and shares. Nobody gets notified for now. We recommend connecting every account you use regularly so Index has a full picture of your ecosystem.",
    },
  },
  3: { // Invitation flow
    steps: ['profile', 'connections'],
    features: {
      showSlackDiscord: false,
      enableUserAttribution: false,
      requireIndexId: false,
    },
    descriptions: {
      connections: "Link the places you already work and share. Nobody gets notified, and it's only used to understand what you're looking for.",
    },
  },
};

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('profile');
  const [isLoading, setIsLoading] = useState(false);
  const [currentFlow, setCurrentFlow] = useState<OnboardingFlow>(1);
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = useAuthenticatedAPI();
  const indexService = useIndexService();
  const integrationsService = useIntegrationsService();
  const filesService = useFiles();
  const linksService = useLinks();
  const authService = useAuthService();
  const { success, error } = useNotifications();
  const { user, refetchUser } = useAuthContext();
  const { refreshIndexes } = useIndexesState();

  // Profile step states
  const [name, setName] = useState('');
  const [intro, setIntro] = useState('');
  const [location, setLocation] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Social links state
  const [socialX, setSocialX] = useState('');
  const [socialLinkedin, setSocialLinkedin] = useState('');
  const [socialGithub, setSocialGithub] = useState('');
  const [websites, setWebsites] = useState<Array<{ label: string; url: string }>>([]);

  // Connections step states
  const [integrations, setIntegrations] = useState<IntegrationState[]>([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [integrationsIndexId, setIntegrationsIndexId] = useState<string | undefined>(undefined);
  const [pendingIntegration, setPendingIntegration] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);

  // Library step states
  const [linkUrl, setLinkUrl] = useState("");
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<Array<{ id: string; name: string; size: string; type: string; createdAt?: string }>>([]);
  const [links, setLinks] = useState<Array<{ id: string; url: string; createdAt?: string }>>([]);

  // Public indexes for join_indexes step
  const [publicIndexes, setPublicIndexes] = useState<Array<Index & { isMember?: boolean }>>([]);
  const [publicIndexesLoaded, setPublicIndexesLoaded] = useState(false);
  const [isJoiningIndex, setIsJoiningIndex] = useState<string | null>(null);

  // Mock indexes for the final step (fallback if no public indexes)
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
      const config = FLOW_CONFIGS[currentFlow];
      
      // Determine if we should filter by indexId based on flow config
      let queryIndexId: string | undefined;
      if (config.features.requireIndexId) {
        queryIndexId = user?.onboarding?.indexId || createdIndex?.id || undefined;
      }
      
      const response = await integrationsService.getIntegrations(queryIndexId);
      
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
      setIntegrationsIndexId(queryIndexId);
    } catch (error) {
      console.error('Failed to fetch integrations:', error);
      // Fallback to default integrations if API fails
      setIntegrations(getIntegrationsList());
      setIntegrationsLoaded(true);
      setIntegrationsIndexId(undefined);
    }
  }, [integrationsService, currentFlow, createdIndex?.id, user?.onboarding?.indexId]);

  // Load index summary for invite members step
  const loadIndexSummary = useCallback(async () => {
    try {
      const wasLoaded = summaryLoaded;
      if (!wasLoaded) {
        setSummaryLoaded(false);
      }
      
      // Get indexId from user onboarding state or createdIndex state
      const indexId = user?.onboarding?.indexId || createdIndex?.id;
      
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
  }, [api, createdIndex?.id, summaryLoaded, displayIntents, displayMembers, displayTotalIntents, user?.onboarding?.indexId]);

  // Detect flow from query string, user onboarding state, or default
  useEffect(() => {
    const f = searchParams.get('f');
    
    // Only f=2 is allowed to override flow
    if (f === '2') {
      setCurrentFlow(2);
      // Reset onboarding to flow 2 if user's current flow is different
      if (user && user.onboarding?.flow !== 2) {
        authService.updateOnboardingState({
          flow: 2,
          currentStep: 'profile',
          indexId: null, // Clear any previous index
          completedAt: null // Mark as not completed
        }).then(() => {
          refetchUser();
        }).catch((err) => {
          console.error('Failed to reset onboarding to flow 2:', err);
        });
      }
    } else if (user?.onboarding?.flow) {
      setCurrentFlow(user.onboarding.flow);
    } else {
      setCurrentFlow(1);
    }
  }, [searchParams, user?.onboarding?.flow, user, authService, refetchUser]);

  // Initialize form fields when user data is available and determine starting step
  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setIntro(user.intro || '');
      setLocation(user.location || '');
      
      // Pre-fill socials if they exist
      if (user.socials) {
        setSocialX(user.socials.x || '');
        setSocialLinkedin(user.socials.linkedin || '');
        setSocialGithub(user.socials.github || '');
        if (user.socials.websites && user.socials.websites.length > 0) {
          setWebsites(user.socials.websites.map(w => ({ label: w.label || '', url: w.url })));
        }
      }
      
      const config = FLOW_CONFIGS[currentFlow];
      const f = searchParams.get('f');
      
      // If onboarding is already completed, redirect to inbox UNLESS f=2 is present
      if (user.onboarding?.completedAt && f !== '2') {
        router.push('/inbox');
        return;
      }
      
      
      // If user has a saved step in onboarding state, resume from there
      if (user.onboarding?.currentStep && config.steps.includes(user.onboarding.currentStep)) {
        setCurrentStep(user.onboarding.currentStep);
        return;
      }
      
      // Start with profile if intro not filled
      if (!user.intro) {
        setCurrentStep('profile');
        return;
      }
      
      // For flows requiring index creation, check if index exists
      if (config.steps.includes('create_index') && !user.onboarding?.indexId) {
        setCurrentStep('create_index');
        return;
      }
      
      // Otherwise, go to connections (next step after profile/create_index)
      const profileIndex = config.steps.indexOf('profile');
      const nextAfterProfile = config.steps[profileIndex + 1];
      
      // For community flow with index already created, skip to connections
      if (config.steps.includes('create_index') && user.onboarding?.indexId) {
        const createIndexIdx = config.steps.indexOf('create_index');
        setCurrentStep(config.steps[createIndexIdx + 1] || nextAfterProfile);
      } else {
        setCurrentStep(nextAfterProfile);
      }
    }
  }, [user, currentFlow, router, searchParams]);

  // Load integrations when appropriate
  useEffect(() => {
    if (currentStep === 'connections') {
      const config = FLOW_CONFIGS[currentFlow];
      
      // Determine current indexId
      let currentIndexId: string | undefined;
      if (config.features.requireIndexId) {
        currentIndexId = user?.onboarding?.indexId || createdIndex?.id || undefined;
      }
      
      // Load integrations if not loaded yet OR if the indexId has changed
      const indexIdChanged = currentIndexId !== integrationsIndexId;
      const shouldLoad = !integrationsLoaded || indexIdChanged;
      
      if (shouldLoad) {
        // If flow requires indexId, only load when we have one
        if (config.features.requireIndexId) {
          if (currentIndexId) {
            loadIntegrations();
          }
        } else {
          // No indexId required, load immediately
          loadIntegrations();
        }
      }
    } else {
      // Reset loaded state when leaving connections step
      if (integrationsLoaded) {
        setIntegrationsLoaded(false);
        setIntegrationsIndexId(undefined);
      }
    }
  }, [currentStep, currentFlow, createdIndex?.id, user?.onboarding?.indexId, integrationsLoaded, integrationsIndexId, loadIntegrations]);

  // Poll queue status when on connections step
  useEffect(() => {
    const fetchQueueStatus = async () => {
      try {
        const response = await api.get<{ jobCounts?: Record<string, { pending: number; active: number; completed: number }>; totalPending?: number }>('/queue/status');
        // Map the response from jobCounts to friendly property names
        if (response?.jobCounts) {
          const status: QueueStatus = {
            indexIntent: response.jobCounts['index_intent'] || { pending: 0, active: 0, completed: 0 },
            generateIntents: response.jobCounts['generate_intents'] || { pending: 0, active: 0, completed: 0 },
            semanticRelevancy: response.jobCounts['broker_semantic_relevancy'] || { pending: 0, active: 0, completed: 0 },
            totalPending: response.totalPending || 0
          };
          setQueueStatus(status);
        }
      } catch {
        // Silently fail - queue status is not critical
        setQueueStatus(null);
      }
    };

    if (currentStep === 'connections') {
      // Initial fetch
      fetchQueueStatus();
      
      // Poll every 3 seconds
      const interval = setInterval(() => {
        fetchQueueStatus();
      }, 1000);
      
      return () => clearInterval(interval);
    } else {
      // Reset when leaving connections step
      setQueueStatus(null);
    }
  }, [currentStep, api]);

  // Load public indexes when on join_indexes step
  useEffect(() => {
    const loadPublicIndexes = async () => {
      if (currentStep === 'join_indexes' && !publicIndexesLoaded) {
        try {
          const response = await indexService.discoverPublicIndexes(1, 20);
          setPublicIndexes(response.indexes || []);
          setPublicIndexesLoaded(true);
        } catch (error) {
          console.error('Failed to load public indexes:', error);
          // Keep mock data as fallback
          setPublicIndexesLoaded(true);
        }
      }
    };

    loadPublicIndexes();
  }, [currentStep, publicIndexesLoaded, indexService]);

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
    return await authService.uploadAvatar(file);
  };

  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate avatar file
      const validation = validateFiles([file], 'avatar');
      if (!validation.isValid) {
        error(validation.message || 'Invalid file');
        e.target.value = '';
        return;
      }
      
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onload = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  // Navigation helpers using flow configuration
  const flowConfig = FLOW_CONFIGS[currentFlow];
  
  const getNextStep = (currentStep: OnboardingStep): OnboardingStep => {
    const currentIndex = flowConfig.steps.indexOf(currentStep);
    if (currentIndex >= 0 && currentIndex < flowConfig.steps.length - 1) {
      return flowConfig.steps[currentIndex + 1];
    }
    return currentStep; // Stay on current step if it's the last one
  };

  const getPreviousStep = (currentStep: OnboardingStep): OnboardingStep => {
    const currentIndex = flowConfig.steps.indexOf(currentStep);
    if (currentIndex > 0) {
      return flowConfig.steps[currentIndex - 1];
    }
    return flowConfig.steps[0]; // Return to first step if already at the beginning
  };

  const handleProfileSubmit = async () => {
    if (!user || !name.trim()) return;
    
    setIsLoading(true);
    try {
      let avatarFilename = user.avatar;
      
      if (avatarFile) {
        avatarFilename = await uploadAvatar(avatarFile);
      }
      
      // Build socials object
      const socials = {
        ...(socialX && { x: socialX }),
        ...(socialLinkedin && { linkedin: socialLinkedin }),
        ...(socialGithub && { github: socialGithub }),
        ...(websites.length > 0 && { 
          websites: websites.filter(w => w.url).map(w => ({ label: '', url: w.url }))
        })
      };
      
      const updatedUser = await authService.updateProfile({
        name: name.trim(),
        intro: intro.trim(),
        location: location.trim() || undefined,
        avatar: avatarFilename || undefined,
        socials: Object.keys(socials).length > 0 ? socials : undefined,
      });
      
      if (updatedUser) {
        // Save onboarding state: flow and next step
        const nextStep = getNextStep('profile');
        await authService.updateOnboardingState({
          flow: currentFlow,
          currentStep: nextStep
        });
        
        // Refetch user data in AuthContext to keep it in sync
        await refetchUser();
        
        // Move to next step based on current flow
        setCurrentStep(nextStep);
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
        
        const config = FLOW_CONFIGS[currentFlow];
        
        // Build payload based on flow configuration
        const payload: { indexId?: string; enableUserAttribution: boolean } = {
          enableUserAttribution: config.features.enableUserAttribution
        };
        
        if (config.features.requireIndexId) {
          const indexId = user?.onboarding?.indexId || createdIndex?.id;
          if (!indexId) {
            error('Index ID is required to connect integrations');
            return;
          }
          payload.indexId = indexId;
        }
        
        const res = await integrationsService.connectIntegration(type, payload);
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
  }, [integrationsService, integrations, success, error, loadIntegrations, createdIndex?.id, currentFlow, user?.onboarding?.indexId]);

  const handleFilesSelected = useCallback(async (f: FileList | null) => {
    if (!f || f.length === 0) return;
    
    // Validate files before uploading
    const files = Array.from(f);
    const validation = validateFiles(files, 'general');
    if (!validation.isValid) {
      error(validation.message || 'Invalid file');
      return;
    }
    
    setIsUploading(true);
    try {
      const uploadedFiles = await Promise.all(files.map(async (file: File) => {
        return await filesService.uploadFile(file);
      }));
      setFiles(prev => [...prev, ...uploadedFiles.map(f => ({
        id: f.id,
        name: f.name,
        size: String(f.size),
        type: f.type,
        createdAt: f.createdAt || new Date().toISOString()
      }))]);
      success(`${uploadedFiles.length} file(s) uploaded`);
    } catch {
      error('Failed to upload files');
    } finally {
      setIsUploading(false);
    }
  }, [filesService, success, error]);

  const handleAddLink = useCallback(async () => {
    if (!linkUrl.trim()) return;
    
    let normalizedUrl = linkUrl.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    
    try {
      setIsAddingLink(true);
      const link = await linksService.createLink(normalizedUrl);
      setLinks(prev => [...prev, {
        id: link.id,
        url: link.url,
        createdAt: link.createdAt || new Date().toISOString()
      }]);
      setLinkUrl("");
      success('Link added successfully');
    } catch {
      error('Failed to add link');
    } finally {
      setIsAddingLink(false);
    }
  }, [linksService, linkUrl, success, error]);

  const handleDeleteFile = useCallback(async (fileId: string) => {
    try {
      await filesService.deleteFile(fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      success('File deleted');
    } catch {
      error('Failed to delete file');
    }
  }, [filesService, success, error]);

  const handleDeleteLink = useCallback(async (linkId: string) => {
    try {
      await linksService.deleteLink(linkId);
      setLinks(prev => prev.filter(l => l.id !== linkId));
      success('Link deleted');
    } catch {
      error('Failed to delete link');
    }
  }, [linksService, success, error]);

  const handleCreateIndex = async () => {
    if (!indexName.trim() || !user?.id) return;
    
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
      
      // Save index ID to onboarding state in database
      const nextStep = getNextStep('create_index');
      await authService.updateOnboardingState({
        indexId: indexData.id,
        currentStep: nextStep
      });
      
      // Refresh indexes context to include the newly created index
      await refreshIndexes();
      
      // Refetch user to get updated onboarding state
      await refetchUser();
      
      success('Index created successfully!');
      setCurrentStep(nextStep);
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
    if (!user?.id) return;
    
    try {
      setIsLoading(true);
      
      // NO LONGER NEEDED - invitation already accepted before onboarding started!
      // Just mark onboarding as completed
      await authService.updateOnboardingState({
        completedAt: new Date().toISOString()
      });
      
      // Refresh indexes to ensure sidebar shows newly joined indexes
      await refreshIndexes();
      
      // Refetch user to get updated onboarding state
      await refetchUser();
      
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
            <div className="mb-5">
              <h1 className="text-2xl font-bold text-black mb-2 font-ibm-plex-mono">Introduce yourself</h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
                Set up your profile to get started with Index Network.
              </p>
            </div>

            <div className="max-w-md space-y-4">
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
                    accept={getSupportedFileExtensions('avatar')}
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-2 font-ibm-plex-mono">Name</label>
                <Input
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-2 font-ibm-plex-mono">Intro</label>
                <Textarea
                  placeholder="Tell us about yourself in a few words"
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  className="w-full min-h-[60px]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-2 font-ibm-plex-mono">Location</label>
                <Input
                  type="text"
                  placeholder="Brooklyn, NY"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full"
                />
              </div>

              {/* Social Links Section */}
              <div className="space-y-2 pt-0">
                <h3 className="text-sm font-medium text-black font-ibm-plex-mono mb-2">Socials</h3>
                
                {/* X (Twitter) */}
                <div className="flex items-center border border-gray-300">
                  <div className="px-3 py-2 bg-gray-50 text-gray-600 font-ibm-plex-mono text-sm border-r border-gray-300 whitespace-nowrap">
                    x.com/
                  </div>
                  <Input
                    type="text"
                    value={socialX}
                    onChange={(e) => setSocialX(e.target.value)}
                    className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>

                {/* LinkedIn */}
                <div className="flex items-center border border-gray-300">
                  <div className="px-3 py-2 bg-gray-50 text-gray-600 font-ibm-plex-mono text-sm border-r border-gray-300 whitespace-nowrap">
                    linkedin.com/in/
                  </div>
                  <Input
                    type="text"
                    value={socialLinkedin}
                    onChange={(e) => setSocialLinkedin(e.target.value)}
                    className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>

                {/* GitHub */}
                <div className="flex items-center border border-gray-300">
                  <div className="px-3 py-2 bg-gray-50 text-gray-600 font-ibm-plex-mono text-sm border-r border-gray-300 whitespace-nowrap">
                    github.com/
                  </div>
                  <Input
                    type="text"
                    value={socialGithub}
                    onChange={(e) => setSocialGithub(e.target.value)}
                    className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>

                {/* Custom Websites */}
                {websites.map((website, index) => (
                  <div key={index} className="flex items-center border border-gray-300">
                    <Input
                      value={website.url}
                      onChange={(e) => {
                        const updated = [...websites];
                        updated[index].url = e.target.value;
                        setWebsites(updated);
                      }}
                      placeholder="https://example.com"
                      className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                    <button
                      type="button"
                      onClick={() => setWebsites(websites.filter((_, i) => i !== index))}
                      className="px-3 py-2 text-gray-500 hover:text-red-600 transition-colors border-l border-gray-300"
                    >
                      ×
                    </button>
                  </div>
                ))}

                {/* Add Website Button */}
                {websites.length < 3 && (
                  <button
                    type="button"
                    onClick={() => setWebsites([...websites, { label: '', url: '' }])}
                    className="w-full flex items-center justify-center px-3 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors font-ibm-plex-mono text-sm"
                  >
                    +
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-5 max-w-md">
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
            <div className="mb-4">
              <h1 className="text-2xl font-bold text-black mb-2 font-ibm-plex-mono">Connect your context</h1>
              <p className="text-black text-[14px] font-ibm-plex-mono mb-6">
                Help Index understand what you're working on and looking for by connecting your accounts and sharing relevant content.
              </p>
              
              {/* Queue Status */}
              {queueStatus?.generateIntents && ((queueStatus.generateIntents.pending ?? 0) > 0 || (queueStatus.generateIntents.active ?? 0) > 0) && (
                <div className="mb-3 text-[10px] font-ibm-plex-mono text-[#666] bg-[#F8F9FA] px-2 py-1.5 rounded-sm border border-[#E0E0E0]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1">
                      {(queueStatus.generateIntents.active ?? 0) > 0 && (
                        <span className="h-1.5 w-1.5 bg-[#0A8F5A] rounded-full animate-pulse"></span>
                      )}
                      Generating Intents
                    </span>
                    <span className="font-medium">
                      {(queueStatus.generateIntents.active ?? 0) > 0 && (
                        `${queueStatus.generateIntents.active} task${queueStatus.generateIntents.active === 1 ? '' : 's'} active`
                      )}
                      {(queueStatus.generateIntents.active ?? 0) > 0 && (queueStatus.generateIntents.pending ?? 0) > 0 && ' • '}
                      {(queueStatus.generateIntents.pending ?? 0) > 0 && (
                        `${queueStatus.generateIntents.pending} task${queueStatus.generateIntents.pending === 1 ? '' : 's'} pending`
                      )}
                    </span>
                  </div>
                </div>
              )}
              
              <h2 className="text-lg font-bold text-black font-ibm-plex-mono">Connect accounts</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {integrations
                .filter((integration) => {
                  // Filter out Slack/Discord if not enabled for this flow
                  if (!flowConfig.features.showSlackDiscord && (integration.type === 'slack' || integration.type === 'discord')) {
                    return false;
                  }
                  return true;
                })
                .map((integration) => {
                  return (
                    <div 
                      key={integration.type} 
                      className="border border-b-2 border-[#000] p-4 bg-white"
                    >
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
                  );
                })}
            </div>

            <div className="mb-2">
              <h2 className="text-lg font-bold text-black mb-2 font-ibm-plex-mono">
                Add from files & web
              </h2>
              
              <p className="text-black text-[14px] font-ibm-plex-mono mb-6">
                Upload documents or add links to content that represents your work and interests—like research notes, articles, proposals, or blog posts.
              </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
                  {/* File upload */}
                  <div className="border border-[#E0E0E0] rounded-sm">
                    <div className="relative w-full">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        id="onboarding-file-upload"
                        accept={getSupportedFileExtensions('general')}
                        onChange={(e) => handleFilesSelected(e.target.files)}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="w-full h-10 px-3 py-2 text-sm font-ibm-plex-mono bg-white text-[#333] hover:bg-[#F0F0F0] transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0 rounded-sm flex items-center justify-center gap-1.5"
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

                  {/* Link input */}
                  <div className="border border-[#E0E0E0] rounded-sm">
                    <div className="relative w-full">
                      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-sm pointer-events-none">
                        🔗
                      </span>
                      <Input
                        placeholder="Paste URL here"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAddLink(); }}
                        className="text-sm bg-white rounded-sm font-ibm-plex-mono w-full pl-10 pr-10 focus:ring-2 focus:ring-[rgba(0,0,0,0.1)] border-0"
                      />
                      {isAddingLink ? (
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2 w-6 h-6 border-2 border-[#DDDDDD] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <button
                          onClick={handleAddLink}
                          disabled={!linkUrl}
                          className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-[#F0F0F0] rounded-sm cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
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
                  <div className="space-y-2 pt-3 max-h-[300px] overflow-y-auto">
                    {files.map((file) => (
                      <div
                        key={file.id}
                        className="group w-full border rounded-sm px-2.5 py-2 transition-colors md:px-3 border-[#E0E0E0] bg-white hover:border-[#CCCCCC]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="text-[10px] px-1.5 py-0.5 border border-[#E0E0E0] rounded-sm font-ibm-plex-mono text-[#333] bg-[#F5F5F5]">
                              {getFileCategoryBadge(file.name, file.type)}
                            </span>
                            <span className="text-sm text-[#333] truncate font-medium">{file.name}</span>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            <button
                              className="group p-1 hover:bg-[#F0F0F0] rounded-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                              onClick={() => handleDeleteFile(file.id)}
                              aria-label="Delete file"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666] group-hover:text-[#333] transition-colors duration-150 ease-in-out">
                                <polyline points="3,6 5,6 21,6"></polyline>
                                <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                              </svg>
                            </button>
                          </div>
                        </div>
                        <div className="text-xs text-[#666] mt-1 truncate font-ibm-plex-mono">
                          {formatFileSize(typeof file.size === 'bigint' ? Number(file.size) : (typeof file.size === 'string' ? parseInt(file.size) : file.size))} • {file.createdAt ? formatDate(file.createdAt).split(',')[0] : 'Recently added'}
                        </div>
                      </div>
                    ))}
                    {links.map((link) => (
                      <div
                        key={link.id}
                        className="group w-full border rounded-sm px-2.5 py-2 transition-colors md:px-3 border-[#E0E0E0] bg-white hover:border-[#CCCCCC]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="flex-shrink-0">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#666]">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                              </svg>
                            </div>
                            <span className="text-sm text-[#333] truncate font-medium">{link.url}</span>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            <button
                              className="group p-1 hover:bg-[#F0F0F0] rounded-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                              onClick={() => handleDeleteLink(link.id)}
                              aria-label="Delete link"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666] group-hover:text-[#333] transition-colors duration-150 ease-in-out">
                                <polyline points="3,6 5,6 21,6"></polyline>
                                <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                              </svg>
                            </button>
                          </div>
                        </div>
                        <div className="text-xs text-[#666] mt-1 truncate font-ibm-plex-mono">
                          {link.createdAt ? formatDate(link.createdAt) : 'Recently added'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(getPreviousStep('connections'))}
                className="flex-1 border-[#E0E0E0] text-black hover:bg-[#F0F0F0] font-ibm-plex-mono"
              >
                Back
              </Button>
              <Button
                onClick={() => {
                  const nextStep = getNextStep('connections');
                  // If this is the last step, complete onboarding
                  if (nextStep === 'connections') {
                    handleCompleteOnboarding();
                  } else {
                    setCurrentStep(nextStep);
                  }
                }}
                className="flex-1 bg-[#000] text-white hover:bg-black font-ibm-plex-mono"
              >
                {getNextStep('connections') === 'connections' ? 'Complete Onboarding' : 'Next'}
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
                  placeholder="John"
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
                  <div className="mt-4 flex flex-col items-center justify-center pb-8">
                    <p className="text-black text-[14px] font-ibm-plex-mono mt-4">
                      We're still processing your connected sources to generate your intents and find potential members. This usually takes a few minutes. Check back later to see your results.
                    </p>
                    <Image 
                      className="h-auto"
                      src={'/loading2.gif'} 
                      alt="Loading..." 
                      width={300} 
                      height={200} 
                      style={{
                        mixBlendMode: 'multiply',
                        imageRendering: 'auto',
                      }}
                    />
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
        const indexesToShow = publicIndexes.length > 0 ? publicIndexes : mockIndexes.map(m => ({
          id: m.id,
          title: m.name,
          prompt: m.description,
          permissions: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          user: { id: '', name: '', email: null, avatar: null },
          _count: { members: m.members, files: 0 },
          isMember: false
        }));

        const handleToggleJoin = async (index: typeof indexesToShow[number]) => {
          // Skip if this is mock data
          if (!publicIndexes.length && mockIndexes.find(m => m.id === index.id)) {
            // Just toggle for mock data
            setSelectedIndexes(prev => {
              const next = new Set(prev);
              if (next.has(index.id)) {
                next.delete(index.id);
              } else {
                next.add(index.id);
              }
              return next;
            });
            return;
          }

          if (index.isMember || selectedIndexes.has(index.id)) {
            // Already joined, don't do anything
            return;
          }

          try {
            setIsJoiningIndex(index.id);
            await indexService.joinIndex(index.id);
            setSelectedIndexes(prev => new Set(prev).add(index.id));
            success(`Joined ${index.title}!`);
            // Update the index in the list
            setPublicIndexes(prev => prev.map(idx => 
              idx.id === index.id ? { ...idx, isMember: true } : idx
            ));
            // Refresh indexes context
            await refreshIndexes();
          } catch (err) {
            console.error('Failed to join index:', err);
            error('Failed to join index');
          } finally {
            setIsJoiningIndex(null);
          }
        };

        return (
          <div className="max-w-4xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-black mb-4 font-ibm-plex-mono">Step into the right indexes</h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
              Based on your profile, here are networks where people are already sharing opportunities and ideas.
              </p>
            </div>

            {!publicIndexesLoaded ? (
              <div className="flex justify-center pb-12">
                <div className="h-8 w-8 border-2 border-gray-300 border-t-black rounded-full animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                {indexesToShow.map((index) => {
                  const isJoined = index.isMember || selectedIndexes.has(index.id);
                  const isJoining = isJoiningIndex === index.id;
                  
                  return (
                    <div key={index.id} className="border border-[#E0E0E0] rounded-lg p-6 bg-white">
                      <div className="text-center">
                        <h3 className="text-lg font-bold text-black mb-2 font-ibm-plex-mono">{index.title}</h3>
                        <p className="text-xs text-[#888] mb-4 font-ibm-plex-mono">
                          {index._count.members.toLocaleString()} members
                        </p>
                        <Button
                          variant={isJoined ? "default" : "outline"}
                          onClick={() => handleToggleJoin(index)}
                          disabled={isJoined || isJoining}
                          className={`w-full font-ibm-plex-mono ${
                            isJoined
                              ? 'bg-[#006D4B] text-white hover:bg-[#005A3E]'
                              : 'border-[#E0E0E0] text-black hover:bg-[#F0F0F0]'
                          }`}
                        >
                          {isJoining ? (
                            <>
                              <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2 inline-block" />
                              Joining...
                            </>
                          ) : isJoined ? (
                            'Joined'
                          ) : (
                            'Join'
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

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
                {isLoading ? 'Finishing...' : `See who's in here`}
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
        <div className="px-6 pb-12">
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
