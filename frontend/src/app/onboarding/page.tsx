"use client";

import React, {
  useState,
  useEffect,
} from "react";
import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";
import { Index } from "@/lib/types";
import { useNotifications } from "@/contexts/NotificationContext";
import { useAuthContext } from "@/contexts/AuthContext";
import ClientLayout from "@/components/ClientLayout";
import { useIndexService } from "@/services/indexes";
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
import ProfileStep from "./ProfileStep";
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
  const { currentFlow, setCurrentFlow, flowConfig, currentStep, setCurrentStep, getPreviousStep } = useOnboardingContext();

  // Public indexes for join_indexes step
  const [publicIndexes, setPublicIndexes] = useState<Array<Index & { isMember?: boolean }>>([]);
  const [publicIndexesLoaded, setPublicIndexesLoaded] = useState(false);
  const [isJoiningIndex, setIsJoiningIndex] = useState<string | null>(null);

  const [selectedIndexes, setSelectedIndexes] = useState<Set<string>>(new Set());

  // Detect flow from query string, user onboarding state, or default
  useEffect(() => {
    const f = searchParams.get("f");
    console.log("flowParam", f);

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
      setCurrentFlow(OnboardingFlow.Personal);
    }
  }, [searchParams, user?.onboarding?.flow, user, authService, refetchUser, setCurrentFlow]);


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

  // Load public indexes when on join_indexes step
  useEffect(() => {
    console.log("loadPublicIndexes", "test");
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
          <ProfileStep
            isLoading={isLoading}
            setIsLoading={setIsLoading}
          />
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
