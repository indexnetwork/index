"use client";

import React, {
  useState,
  useRef,
  useEffect,
  ChangeEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Index } from "@/lib/types";
import { getAvatarUrl } from "@/lib/file-utils";
import { useNotifications } from "@/contexts/NotificationContext";
import { useAuthContext } from "@/contexts/AuthContext";
import ClientLayout from "@/components/ClientLayout";
import { useIndexService } from "@/services/indexes";
import { getSupportedFileExtensions, validateFiles } from "@/lib/file-validation";
import { useIndexesState } from "@/contexts/IndexesContext";
import { useAuth as useAuthService } from "@/contexts/APIContext";
import {
  OnboardingFlow,
  OnboardingStep,
} from "@/types/onboarding";
import { MOCK_INDEXES } from "./config";
import CreateIndexStep from "./CreateIndexStep";
import InviteMembersStep from "./InviteMembersStep";
import ConnectionsStep from "./ConnectionsStep";
import { OnboardingProvider, useOnboardingContext } from "@/contexts/OnboardingContext";

function OnboardingPageContent() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const indexService = useIndexService();
  const authService = useAuthService();
  const { success, error } = useNotifications();
  const { user, refetchUser } = useAuthContext();
  const { refreshIndexes } = useIndexesState();
  const { currentFlow, setCurrentFlow, flowConfig, currentStep, setCurrentStep, getNextStep, getPreviousStep } = useOnboardingContext();

  // Profile step states
  const [name, setName] = useState('');
  const [intro, setIntro] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [profileInitialized, setProfileInitialized] = useState(false);
  const lastSyncedUserRef = useRef<{
    id: string | null;
    name: string;
    intro: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Public indexes for join_indexes step
  const [publicIndexes, setPublicIndexes] = useState<Array<Index & { isMember?: boolean }>>([]);
  const [publicIndexesLoaded, setPublicIndexesLoaded] = useState(false);
  const [isJoiningIndex, setIsJoiningIndex] = useState<string | null>(null);

  const [selectedIndexes, setSelectedIndexes] = useState<Set<string>>(new Set());

  // Detect flow from query string, user onboarding state, or default
  useEffect(() => {
    const f = searchParams.get("f");

    // Only f=2 is allowed to override flow
    if (f === OnboardingFlow.Community.toString()) {
      setCurrentFlow(OnboardingFlow.Community);
      // Reset onboarding to flow 2 if user's current flow is different
      if (user && user.onboarding?.flow !== OnboardingFlow.Community) {
        authService
          .updateOnboardingState({
            flow: OnboardingFlow.Community,
            currentStep: OnboardingStep.Profile,
            indexId: null, // Clear any previous index
            completedAt: null, // Mark as not completed
          })
          .then(() => {
            refetchUser();
          })
          .catch((err) => {
            console.error("Failed to reset onboarding to flow 2:", err);
          });
      }
    } else if (user?.onboarding?.flow) {
      setCurrentFlow(user.onboarding.flow);
    } else {
      setCurrentFlow(1);
    }
  }, [searchParams, user?.onboarding?.flow, user, authService, refetchUser, setCurrentFlow]);

  // Initialize form fields when user data is available and determine starting step
  useEffect(() => {
    if (!user) {
      setName("");
      setIntro("");
      lastSyncedUserRef.current = null;
      setProfileInitialized(false);
      return;
    }

    const normalizedName = user.name ?? "";
    const normalizedIntro = user.intro ?? "";
    const snapshot = lastSyncedUserRef.current;
    const normalizedId = user.id ?? null;

    const shouldSyncProfile =
      !profileInitialized ||
      !snapshot ||
      snapshot.id !== normalizedId ||
      snapshot.name !== normalizedName ||
      snapshot.intro !== normalizedIntro;

    if (shouldSyncProfile) {
      setName(normalizedName);
      setIntro(normalizedIntro);
      lastSyncedUserRef.current = {
        id: normalizedId,
        name: normalizedName,
        intro: normalizedIntro,
      };
      setProfileInitialized(true);
    }
  }, [user, profileInitialized]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const f = searchParams.get("f");

    // If onboarding is already completed, redirect to inbox UNLESS f=2 is present
    if (user.onboarding?.completedAt && !f) {
      router.push("/inbox");
      return;
    }

    // If user has a saved step in onboarding state, resume from there
    if (
      user.onboarding?.currentStep &&
      flowConfig.steps.includes(user.onboarding.currentStep)
    ) {
      setCurrentStep(user.onboarding.currentStep);
      return;
    }

    // Start with profile if intro not filled
    if (!user.intro) {
      setCurrentStep(OnboardingStep.Profile);
      return;
    }

    // For flows requiring index creation, check if index exists
    if (flowConfig.steps.includes(OnboardingStep.CreateIndex) && !user.onboarding?.indexId) {
      setCurrentStep(OnboardingStep.CreateIndex);
      return;
    }

    // Otherwise, go to connections (next step after profile/create_index)
    const profileIndex = flowConfig.steps.indexOf(OnboardingStep.Profile);
    const nextAfterProfile = flowConfig.steps[profileIndex + 1];

    // For community flow with index already created, skip to connections
    if (flowConfig.steps.includes(OnboardingStep.CreateIndex) && user.onboarding?.indexId) {
      const createIndexIdx = flowConfig.steps.indexOf(OnboardingStep.CreateIndex);
      setCurrentStep(flowConfig.steps[createIndexIdx + 1] || nextAfterProfile);
    } else {
      setCurrentStep(nextAfterProfile);
    }
  }, [user, currentFlow, router, searchParams, flowConfig.steps, setCurrentStep]);

  // Load integrations when appropriate


  // Load public indexes when on join_indexes step
  useEffect(() => {
    const loadPublicIndexes = async () => {
      if (currentStep === OnboardingStep.JoinIndexes && !publicIndexesLoaded) {
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
  // This is now handled by the InviteMembersStep component using the OnboardingContext

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


  const handleProfileSubmit = async () => {
    if (!user || !name.trim()) return;

    setIsLoading(true);
    try {
      let avatarFilename = user.avatar;

      if (avatarFile) {
        avatarFilename = await uploadAvatar(avatarFile);
      }

      const updatedUser = await authService.updateProfile({
        name: name.trim(),
        intro: intro.trim(),
        avatar: avatarFilename || undefined,
      });
      
      if (updatedUser) {
        // Save onboarding state: flow and next step
        const nextStep = getNextStep(OnboardingStep.Profile);
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
      case OnboardingStep.Profile:
        return (
          <div className="max-w-3xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-black mb-2 font-ibm-plex-mono">Introduce yourself</h1>
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
                    accept={getSupportedFileExtensions('avatar')}
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-3 font-ibm-plex-mono">Name</label>
                <Input
                  type="text"
                  placeholder="John Doe"
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

      case OnboardingStep.Connections:
        return (
          <ConnectionsStep
            handleCompleteOnboarding={handleCompleteOnboarding}
          />
        );

      case OnboardingStep.CreateIndex:
        return (
          <CreateIndexStep
            setIsLoading={setIsLoading}
            isLoading={isLoading}
          />
        );

      case OnboardingStep.InviteMembers:
        return (
          <InviteMembersStep
            handleCompleteOnboarding={handleCompleteOnboarding}
          />
        );

      case OnboardingStep.JoinIndexes:
        const indexesToShow =
          publicIndexes.length > 0
            ? publicIndexes
            : MOCK_INDEXES.map((m) => ({
                id: m.id,
                title: m.name,
                prompt: m.description,
                permissions: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                user: { id: "", name: "", email: null, avatar: null },
                _count: { members: m.members, files: 0 },
                isMember: false,
              }));

        const handleToggleJoin = async (
          index: (typeof indexesToShow)[number]
        ) => {
          // Skip if this is mock data
          if (
            !publicIndexes.length &&
            MOCK_INDEXES.find((m) => m.id === index.id)
          ) {
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
              <div className="flex justify-center py-12">
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
                onClick={() => setCurrentStep(getPreviousStep(OnboardingStep.JoinIndexes))}
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
    <div className="bg-[#FAFAFA]">
      {/* Main content */}
      <div className="px-6 py-12">{renderStepContent()}</div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <ClientLayout>
      <OnboardingProvider>
        <OnboardingPageContent />
      </OnboardingProvider>
    </ClientLayout>
  );
}
