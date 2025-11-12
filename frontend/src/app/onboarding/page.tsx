"use client";

import React, {
  useState,
  useEffect,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthContext } from "@/contexts/AuthContext";
import ClientLayout from "@/components/ClientLayout";
import { useIndexesState } from "@/contexts/IndexesContext";
import { useAuth as useAuthService } from "@/contexts/APIContext";
import {
  OnboardingFlow,
  OnboardingStep,
} from "@/types/onboarding";
import CreateIndexStep from "./CreateIndexStep";
import InviteMembersStep from "./InviteMembersStep";
import ConnectionsStep from "./ConnectionsStep";
import ProfileStep from "./ProfileStep";
import JoinIndexesStep from "./JoinIndexesStep";
import { OnboardingProvider, useOnboardingContext } from "@/contexts/OnboardingContext";

function OnboardingPageContent() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const authService = useAuthService();
  const { user, refetchUser } = useAuthContext();
  const { refreshIndexes } = useIndexesState();
  const { currentFlow, setCurrentFlow, flowConfig, currentStep, setCurrentStep } = useOnboardingContext();
  
  // Detect flow from query string, user onboarding state, or default
  // f used for dev testing
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
        return (
          <JoinIndexesStep
            handleCompleteOnboarding={handleCompleteOnboarding}
          />
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
