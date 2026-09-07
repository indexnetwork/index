import { createContext, useContext, useMemo, ReactNode } from 'react';
import { useAuthenticatedAPI } from '@/lib/api';
import { createNetworksService } from '@/services/networks';
import { createNetworkRequestsService } from '@/services/networkRequests';
import { createIntentsService } from '@/services/intents';
import { createConnectionsService } from '@/services/connections';
import { createSynthesisService } from '@/services/synthesis';
import { createDiscoverService } from '@/services/discover';
import { createAuthService } from '@/services/auth';
import { createUsersService } from '@/services/users';
import { createOpportunitiesService } from '@/services/opportunities';
import { createConversationService } from '@/services/conversation';
import { createAgentsService } from '@/services/agents';
import { createNegotiationService } from '@/services/negotiations';

export interface APIContextType {
  networksService: ReturnType<typeof createNetworksService>;
  networkRequestsService: ReturnType<typeof createNetworkRequestsService>;
  intentsService: ReturnType<typeof createIntentsService>;
  connectionsService: ReturnType<typeof createConnectionsService>;
  synthesisService: ReturnType<typeof createSynthesisService>;
  discoverService: ReturnType<typeof createDiscoverService>;
  authService: ReturnType<typeof createAuthService>;
  usersService: ReturnType<typeof createUsersService>;
  opportunitiesService: ReturnType<typeof createOpportunitiesService>;
  conversationService: ReturnType<typeof createConversationService>;
  agentsService: ReturnType<typeof createAgentsService>;
  negotiationService: ReturnType<typeof createNegotiationService>;
}

const APIContext = createContext<APIContextType | undefined>(undefined);

export function APIProvider({ children }: { children: ReactNode }) {
  const api = useAuthenticatedAPI();

  const services = useMemo(() => ({
    networksService: createNetworksService(api),
    networkRequestsService: createNetworkRequestsService(api),
    intentsService: createIntentsService(api),
    connectionsService: createConnectionsService(api),
    synthesisService: createSynthesisService(api),
    discoverService: createDiscoverService(api),
    authService: createAuthService(api),
    usersService: createUsersService(api),
    opportunitiesService: createOpportunitiesService(api),
    conversationService: createConversationService(api),
    agentsService: createAgentsService(api),
    negotiationService: createNegotiationService(api),
  }), [api]);

  return (
    <APIContext.Provider value={services}>
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

export function useNetworks() {
  const { networksService } = useAPI();
  return networksService;
}

export function useNetworkRequests() {
  const { networkRequestsService } = useAPI();
  return networkRequestsService;
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

export function useAuth() {
  const { authService } = useAPI();
  return authService;
}

export function useUsers() {
  const { usersService } = useAPI();
  return usersService;
}

export function useOpportunities() {
  const { opportunitiesService } = useAPI();
  return opportunitiesService;
}

export function useConversations() {
  const { conversationService } = useAPI();
  return conversationService;
}

export function useAgents() {
  const { agentsService } = useAPI();
  return agentsService;
}

export function useNegotiations() {
  const { negotiationService } = useAPI();
  return negotiationService;
}
