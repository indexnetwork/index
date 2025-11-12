"use client";

import { createContext, useContext, ReactNode, useState } from "react";
import { OnboardingFlow, OnboardingStep, FlowConfigBase } from "@/lib/onboardingTypes";
import { FLOW_CONFIGS } from "@/app/onboarding/config";

interface OnboardingContextType {
  createdIndex: { id: string; name: string; inviteCode?: string } | null;
  setCreatedIndex: (
    index: { id: string; name: string; inviteCode?: string } | null
  ) => void;
  currentFlow: OnboardingFlow;
  setCurrentFlow: (flow: OnboardingFlow) => void;
  flowConfig: FlowConfigBase;
  currentStep: OnboardingStep;
  setCurrentStep: (step: OnboardingStep) => void;
  getNextStep: (currentStep: OnboardingStep) => OnboardingStep;
  getPreviousStep: (currentStep: OnboardingStep) => OnboardingStep;
}

interface CreatedIndex {
  id: string;
  name: string;
  inviteCode?: string;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(
  undefined
);

interface OnboardingProviderProps {
  children: ReactNode;
  initialFlow?: OnboardingFlow;
  initialStep?: OnboardingStep;
}

export function OnboardingProvider({
  children,
  initialFlow = OnboardingFlow.Personal,
  initialStep = OnboardingStep.Profile,
}: OnboardingProviderProps) {
  const [createdIndex, setCreatedIndex] = useState<CreatedIndex | null>(null);
  const [currentFlow, setCurrentFlow] = useState<OnboardingFlow>(initialFlow);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(initialStep);
  const flowConfig = FLOW_CONFIGS[currentFlow] as FlowConfigBase;

  const getNextStep = (step: OnboardingStep): OnboardingStep => {
    const currentIndex = flowConfig.steps.indexOf(step);
    if (currentIndex >= 0 && currentIndex < flowConfig.steps.length - 1) {
      return flowConfig.steps[currentIndex + 1];
    }
    return step; // Stay on current step if it's the last one
  };

  const getPreviousStep = (step: OnboardingStep): OnboardingStep => {
    const currentIndex = flowConfig.steps.indexOf(step);
    if (currentIndex > 0) {
      return flowConfig.steps[currentIndex - 1];
    }
    return flowConfig.steps[0]; // Return to first step if already at the beginning
  };

  return (
    <OnboardingContext.Provider
      value={{
        createdIndex,
        setCreatedIndex,
        currentFlow,
        setCurrentFlow,
        flowConfig,
        currentStep,
        setCurrentStep,
        getNextStep,
        getPreviousStep,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboardingContext() {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error(
      "useOnboardingContext must be used within an OnboardingProvider"
    );
  }
  return context;
}
