"use client";

import React, { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { User, AvatarUploadResponse, APIResponse } from "@/lib/types";
import { useAuthenticatedAPI } from "@/lib/api";
import { getAvatarUrl } from "@/lib/file-utils";
import { useNotifications } from "@/contexts/NotificationContext";
import ClientLayout from "@/components/ClientLayout";

type OnboardingStep = 'profile' | 'connections' | 'library' | 'indexes';

interface IntegrationState {
  id: 'notion' | 'slack' | 'discord' | 'calendar' | 'gmail';
  name: string;
  connected: boolean;
}

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('profile');
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const api = useAuthenticatedAPI();
  const { success, error } = useNotifications();

  // Profile step states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Connections step states
  const [integrations, setIntegrations] = useState<IntegrationState[]>([
    { id: 'notion', name: 'Notion', connected: false },
    { id: 'slack', name: 'Slack', connected: false },
    { id: 'discord', name: 'Discord', connected: false },
    { id: 'calendar', name: 'Google Calendar', connected: false },
    { id: 'gmail', name: 'Gmail', connected: false },
  ]);
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

  // Load integrations status
  const loadIntegrations = React.useCallback(async () => {
    try {
      const response = await api.get<{ integrations: Array<{ id: string; name: string; connected: boolean }> }>('/integrations');
      const integrationsFromAPI = response.integrations || [];
      
      // Default integrations with proper names
      const defaultIntegrations: IntegrationState[] = [
        { id: 'notion', name: 'Notion', connected: false },
        { id: 'slack', name: 'Slack', connected: false },
        { id: 'discord', name: 'Discord', connected: false },
        { id: 'calendar', name: 'Calendar', connected: false },
        { id: 'gmail', name: 'Gmail', connected: false },
      ];
      
      // Map API response to our local state format
      const updatedIntegrations = defaultIntegrations.map(integration => {
        const apiIntegration = integrationsFromAPI.find(i => i.id === integration.id);
        return {
          ...integration,
          connected: apiIntegration?.connected || false
        };
      });
      
      setIntegrations(updatedIntegrations);
    } catch (error) {
      console.error('Failed to fetch integrations:', error);
      // Keep default state if API fails
    }
  }, [api]);

  React.useEffect(() => {
    // Fetch user data on load
    const fetchUser = async () => {
      try {
        const response = await api.get<APIResponse<User>>('/auth/me');
        if (response.user) {
          setUser(response.user);
          setName(response.user.name || '');
          setEmail(response.user.email || '');
        }
      } catch (error) {
        console.error('Failed to fetch user:', error);
      }
    };

    const loadData = async () => {
      await Promise.all([
        fetchUser(),
        loadIntegrations()
      ]);
    };

    loadData();
  }, [api, loadIntegrations]);

  const uploadAvatar = async (file: File): Promise<string> => {
    const result = await api.uploadFile<AvatarUploadResponse>('/upload/avatar', file, undefined, 'avatar');
    return result.avatarFilename;
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onload = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
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
        avatar: avatarFilename || undefined,
      });
      
      if (response.user) {
        setUser(response.user);
        setCurrentStep('connections');
      }
    } catch (err) {
      console.error('Error updating profile:', err);
      error('Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleIntegration = useCallback(async (id: string) => {
    const item = integrations.find(i => i.id === id);
    if (!item) return;
    
    try {
      setPendingIntegration(id);
      if (item.connected) {
        await api.delete(`/integrations/${id}`);
        // Refresh integrations from API to get real status
        await loadIntegrations();
        success(`${item.name} disconnected`);
      } else {
        const popup = typeof window !== 'undefined' ? window.open('', `oauth_${id}`, 'width=560,height=720') : null;
        const res = await api.post<{ redirectUrl?: string; connectionRequestId?: string }>(`/integrations/connect/${id}`);
        const redirect = res.redirectUrl;
        const reqId = res.connectionRequestId;
        
        if (popup && redirect) {
          popup.location.href = redirect;
        } else if (redirect) {
          window.location.href = redirect;
          return;
        }
        
        if (reqId) {
          const started = Date.now();
          const poll = setInterval(async () => {
            if (popup && popup.closed) {
              clearInterval(poll);
              return;
            }
            try {
              const s = await api.get<{ status: 'pending' | 'connected'; connectedAt?: string }>(`/integrations/status/${reqId}`);
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
              }
            } catch {
              clearInterval(poll);
              if (popup && !popup.closed) popup.close();
              error(`Failed to complete ${item.name} connection`);
            }
          }, 1500);
        }
      }
    } catch {
      // ignore
    } finally {
      setPendingIntegration(null);
    }
  }, [api, integrations, success, error, loadIntegrations]);

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

  const handleCompleteOnboarding = async () => {
    try {
      setIsLoading(true);
      // Mark onboarding as completed
      localStorage.setItem('onboarding_completed', Date.now().toString());
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
          <div className="max-w-md mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[#333] mb-2 font-ibm-plex-mono">Tell us who you are.</h1>
            </div>

            <div className="space-y-6">
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
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
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
                <label className="block text-sm font-medium text-[#333] mb-2 font-ibm-plex-mono">Name Surname</label>
                <Input
                  type="text"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#333] mb-2 font-ibm-plex-mono">Email</label>
                <Input
                  type="email"
                  placeholder={user?.email || "seren@index.network"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full"
                  disabled
                />
              </div>

              <Button
                onClick={handleProfileSubmit}
                disabled={!name.trim() || isLoading}
                className="w-full bg-[#000] text-white hover:bg-[#333] font-ibm-plex-mono"
              >
                {isLoading ? 'Saving...' : 'Next'}
              </Button>
            </div>
          </div>
        );

      case 'connections':
        return (
          <div className="max-w-2xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[#333] mb-4 font-ibm-plex-mono">Connect your accounts.</h1>
              <p className="text-black text-[14px] font-ibm-plex-mono">
                Link the places you already work and share. Nobody gets notified, and it's only used to understand what you're looking for.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {integrations.map((integration) => (
                <div key={integration.id} className="border border-b-2 border-[#000] p-4 bg-white">
                  <div className="flex items-center justify-between mb-0">
                    <div className="flex items-center gap-3">
                      <Image 
                        src={`/integrations/${integration.id === 'calendar' ? 'google-calendar' : integration.id}.png`} 
                        width={24} 
                        height={24} 
                        alt={integration.name}
                      />
                      <span className="font-small text-[#333] font-ibm-plex-mono text-[14px]">{integration.name}</span>
                    </div>
                    <button
                      onClick={() => toggleIntegration(integration.id)}
                      disabled={pendingIntegration === integration.id}
                      className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${
                        integration.connected ? 'bg-[#006D4B]' : 'bg-[#D9D9D9]'
                      } ${pendingIntegration === integration.id ? 'opacity-70' : ''}`}
                    >
                      <span
                        className={`absolute top-[1px] left-[1px] h-[22px] w-[22px] rounded-full bg-white transition-transform duration-200 shadow-sm ${
                          integration.connected ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                      {pendingIntegration === integration.id && (
                        <span className="absolute inset-0 grid place-items-center">
                          <span className="h-3 w-3 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-8">
              <h2 className="text-lg font-bold text-[#333] mb-4 font-ibm-plex-mono">Add context files & links</h2>
              <p className="text-[#666] font-ibm-plex-mono mb-6">
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
                      className="w-full h-10 px-3 py-2 text-sm font-ibm-plex-mono bg-white text-[#333] hover:bg-[#F0F0F0] transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0 rounded-lg flex items-center justify-center gap-1.5"
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
                      <span className="text-sm text-[#333] font-ibm-plex-mono">{file.name}</span>
                    </div>
                  ))}
                  {links.map((link) => (
                    <div key={link.id} className="flex items-center gap-2 p-2 bg-[#F8F9FA] rounded-lg">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#666]">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                      </svg>
                      <span className="text-sm text-[#333] font-ibm-plex-mono truncate">{link.url}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setCurrentStep('profile')}
                className="flex-1 border-[#E0E0E0] text-[#333] hover:bg-[#F0F0F0] font-ibm-plex-mono"
              >
                Back
              </Button>
              <Button
                onClick={() => setCurrentStep('library')}
                className="flex-1 bg-[#000] text-white hover:bg-[#333] font-ibm-plex-mono"
              >
                Next
              </Button>
              <Button
                variant="outline"
                onClick={() => setCurrentStep('library')}
                className="px-6 border-[#E0E0E0] text-[#666] hover:bg-[#F0F0F0] font-ibm-plex-mono"
              >
                I'll do later
              </Button>
            </div>
          </div>
        );

      case 'library':
        return (
          <div className="max-w-2xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[#333] mb-4 font-ibm-plex-mono">Help Index guide your discovery</h1>
              <p className="text-[#666] font-ibm-plex-mono mb-6">
                Write what you're curious about. Index will use your context files and connections to guide better matches.
              </p>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[#333] mb-3 font-ibm-plex-mono">What do you want to discover?</label>
                <textarea
                  placeholder="eg. Looking to connect with early-stage investors"
                  className="w-full h-32 px-3 py-2 border border-[#E0E0E0] rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#006D4B] focus:border-transparent font-ibm-plex-mono text-sm text-black"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <Button
                variant="outline"
                onClick={() => setCurrentStep('connections')}
                className="flex-1 border-[#E0E0E0] text-[#333] hover:bg-[#F0F0F0] font-ibm-plex-mono"
              >
                Back
              </Button>
              <Button
                onClick={() => setCurrentStep('indexes')}
                className="flex-1 bg-[#000] text-white hover:bg-[#333] font-ibm-plex-mono"
              >
                Next
              </Button>
              <Button
                variant="outline"
                onClick={() => setCurrentStep('indexes')}
                className="px-6 border-[#E0E0E0] text-[#666] hover:bg-[#F0F0F0] font-ibm-plex-mono"
              >
                Skip
              </Button>
            </div>
          </div>
        );

      case 'indexes':
        return (
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-[#333] mb-2 font-ibm-plex-mono">Step into the right indexes.</h1>
              <p className="text-[#666] font-ibm-plex-mono">
                Based on your profile, here are networks where people are already sharing opportunities and ideas.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {mockIndexes.map((index) => (
                <div key={index.id} className="border border-[#E0E0E0] rounded-lg p-6 bg-white">
                  <div className="text-center">
                    <h3 className="text-lg font-bold text-[#333] mb-2 font-ibm-plex-mono">{index.name}</h3>
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
                          : 'border-[#E0E0E0] text-[#333] hover:bg-[#F0F0F0]'
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
                onClick={() => setCurrentStep('library')}
                className="flex-1 border-[#E0E0E0] text-[#333] hover:bg-[#F0F0F0] font-ibm-plex-mono"
              >
                Back
              </Button>
              <Button
                onClick={handleCompleteOnboarding}
                disabled={isLoading}
                className="flex-1 bg-[#000] text-white hover:bg-[#333] font-ibm-plex-mono"
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
    </ClientLayout>
  );
}
