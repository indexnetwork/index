"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type DiscoveryIntent = {
  id: string;
  payload: string;
  summary?: string;
  createdAt: string;
};

type DiscoveryFilterContextType = {
  discoveryIntents: DiscoveryIntent[] | undefined;
  setDiscoveryIntents: (intents: DiscoveryIntent[] | undefined) => void;
};

const DiscoveryFilterContext = createContext<DiscoveryFilterContextType | undefined>(undefined);

export function DiscoveryFilterProvider({ children }: { children: ReactNode }) {
  const [discoveryIntents, setDiscoveryIntents] = useState<DiscoveryIntent[] | undefined>(undefined);

  return (
    <DiscoveryFilterContext.Provider value={{ discoveryIntents, setDiscoveryIntents }}>
      {children}
    </DiscoveryFilterContext.Provider>
  );
}

export function useDiscoveryFilter() {
  const context = useContext(DiscoveryFilterContext);
  if (!context) {
    throw new Error("useDiscoveryFilter must be used within DiscoveryFilterProvider");
  }
  return context;
}

