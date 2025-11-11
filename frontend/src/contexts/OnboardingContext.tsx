"use client";

import { createContext, useContext, ReactNode } from "react";

interface OnboardingContextType {
  createdIndex: { id: string; name: string; inviteCode?: string } | null;
  setCreatedIndex: (
    index: { id: string; name: string; inviteCode?: string } | null
  ) => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(
  undefined
);

interface OnboardingProviderProps {
  children: ReactNode;
  createdIndex?: { id: string; name: string; inviteCode?: string } | null;
  setCreatedIndex?: (
    index: { id: string; name: string; inviteCode?: string } | null
  ) => void;
}

export function OnboardingProvider({
  children,
  createdIndex,
  setCreatedIndex,
}: OnboardingProviderProps) {
  return (
    <OnboardingContext.Provider
      value={{
        createdIndex: createdIndex || null,
        setCreatedIndex: setCreatedIndex || (() => {}),
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
