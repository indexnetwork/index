'use client';

import { createContext, useContext, useRef, ReactNode } from 'react';
import { useAuthenticatedAPI } from '@/lib/api';
import { createIndexesService } from '@/services/indexes';
import { createIntentsService } from '@/services/intents';
import { createConnectionsService } from '@/services/connections';
import { createSynthesisService } from '@/services/synthesis';
import { createIntegrationsService } from '@/services/integrations';
import { createDiscoverService } from '@/services/discover';

interface APIContextType {
  indexesService: ReturnType<typeof createIndexesService>;
  intentsService: ReturnType<typeof createIntentsService>;
  connectionsService: ReturnType<typeof createConnectionsService>;
  synthesisService: ReturnType<typeof createSynthesisService>;
  integrationsService: ReturnType<typeof createIntegrationsService>;
  discoverService: ReturnType<typeof createDiscoverService>;
}

const APIContext = createContext<APIContextType | undefined>(undefined);

export function APIProvider({ children }: { children: ReactNode }) {
  const api = useAuthenticatedAPI();
  
  // Recreate services when api changes to ensure they use the current authenticated API
  const servicesRef = useRef<APIContextType | null>(null);
  const apiRef = useRef(api);
  
  // Check if api has changed
  if (!servicesRef.current || apiRef.current !== api) {
    servicesRef.current = {
      indexesService: createIndexesService(api),
      intentsService: createIntentsService(api),
      connectionsService: createConnectionsService(api),
      synthesisService: createSynthesisService(api),
      integrationsService: createIntegrationsService(api),
      discoverService: createDiscoverService(api)
    };
    apiRef.current = api;
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

export function useConnections() {
  const { connectionsService } = useAPI();
  return connectionsService;
}

export function useSynthesis() {
  const { synthesisService } = useAPI();
  return synthesisService;
}

export function useDiscover() {
  const { discoverService } = useAPI();
  return discoverService;
} 