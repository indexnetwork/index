'use client';

import { createContext, useContext, useRef, ReactNode } from 'react';
import { useAuthenticatedAPI } from '@/lib/api';
import { createIndexesService } from '@/services/indexes';
import { createIntentsService } from '@/services/intents';

interface APIContextType {
  indexesService: ReturnType<typeof createIndexesService>;
  intentsService: ReturnType<typeof createIntentsService>;
}

const APIContext = createContext<APIContextType | undefined>(undefined);

export function APIProvider({ children }: { children: ReactNode }) {
  const api = useAuthenticatedAPI();
  
  // Use refs to create truly stable singleton instances
  const servicesRef = useRef<APIContextType | null>(null);
  
  if (!servicesRef.current) {
    servicesRef.current = {
      indexesService: createIndexesService(api),
      intentsService: createIntentsService(api)
    };
  }

  return (
    <APIContext.Provider value={servicesRef.current}>
      {children}
    </APIContext.Provider>
  );
}

export function useAPI() {
  const context = useContext(APIContext);
  if (context === undefined) {
    throw new Error('useAPI must be used within an APIProvider');
  }
  return context;
}

// Convenience hooks for direct service access
export function useIndexes() {
  const { indexesService } = useAPI();
  return indexesService;
}

export function useIntents() {
  const { intentsService } = useAPI();
  return intentsService;
} 