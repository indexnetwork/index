import { createContext, useContext, useMemo, ReactNode } from 'react';
import { useAuthenticatedAPI } from '@/lib/api';
import { createIndexesService } from '@/services/networks';
import { createIntentsService } from '@/services/intents';
import { createConnectionsService } from '@/services/connections';
import { createSynthesisService } from '@/services/synthesis';
import { createDiscoverService } from '@/services/discover';
import { createFilesService } from '@/services/files';
import { createLinksService } from '@/services/links';
import { createAuthService } from '@/services/auth';
import { createIntegrationsService } from '@/services/integrations';
import { createAdminService } from '@/services/admin';
import { createUsersService } from '@/services/users';
import { createOpportunitiesService } from '@/services/opportunities';
import { createConversationService } from '@/services/conversation';
import { createApiKeysService } from '@/services/api-keys';
import { createAgentsService } from '@/services/agents';
import { createQuestionsService } from '@/services/questions';

export interface APIContextType {
  indexesService: ReturnType<typeof createIndexesService>;
  intentsService: ReturnType<typeof createIntentsService>;
  connectionsService: ReturnType<typeof createConnectionsService>;
  synthesisService: ReturnType<typeof createSynthesisService>;
  discoverService: ReturnType<typeof createDiscoverService>;
  filesService: ReturnType<typeof createFilesService>;
  linksService: ReturnType<typeof createLinksService>;
  authService: ReturnType<typeof createAuthService>;
  integrationsService: ReturnType<typeof createIntegrationsService>;
  adminService: ReturnType<typeof createAdminService>;
  usersService: ReturnType<typeof createUsersService>;
  opportunitiesService: ReturnType<typeof createOpportunitiesService>;
  conversationService: ReturnType<typeof createConversationService>;
  apiKeysService: ReturnType<typeof createApiKeysService>;
  agentsService: ReturnType<typeof createAgentsService>;
  questionsService: ReturnType<typeof createQuestionsService>;
}

const APIContext = createContext<APIContextType | undefined>(undefined);

export function APIProvider({ children }: { children: ReactNode }) {
  const api = useAuthenticatedAPI();

  const services = useMemo(() => ({
    indexesService: createIndexesService(api),
    intentsService: createIntentsService(api),
    connectionsService: createConnectionsService(api),
    synthesisService: createSynthesisService(api),
    discoverService: createDiscoverService(api),
    filesService: createFilesService(api),
    linksService: createLinksService(api),
    authService: createAuthService(api),
    integrationsService: createIntegrationsService(api),
    adminService: createAdminService(api),
    usersService: createUsersService(api),
    opportunitiesService: createOpportunitiesService(api),
    conversationService: createConversationService(api),
    apiKeysService: createApiKeysService(api),
    agentsService: createAgentsService(api),
    questionsService: createQuestionsService(api),
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

export function useFiles() {
  const { filesService } = useAPI();
  return filesService;
}

export function useLinks() {
  const { linksService } = useAPI();
  return linksService;
}

export function useAuth() {
  const { authService } = useAPI();
  return authService;
}

export function useAdmin() {
  const { adminService } = useAPI();
  return adminService;
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

export function useApiKeys() {
  const { apiKeysService } = useAPI();
  return apiKeysService;
}

export function useAgents() {
  const { agentsService } = useAPI();
  return agentsService;
}

export function useQuestionsService() {
  const { questionsService } = useAPI();
  return questionsService;
}