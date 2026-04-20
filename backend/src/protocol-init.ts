/**
 * Composition root: wires concrete adapters/services into ProtocolDeps.
 *
 * This file lives OUTSIDE the protocol library (`src/lib/protocol/`) and is
 * the only place that bridges between concrete implementations and the
 * protocol layer's interface-based dependencies.
 *
 * Usage:
 *   const deps = createDefaultProtocolDeps();
 *   new ChatGraphFactory(db, embedder, scraper, chatSession, deps);
 */

import { RedisCacheAdapter } from "./adapters/cache.adapter";
import { agentDatabaseAdapter } from './adapters/agent.database.adapter';
import { ComposioIntegrationAdapter } from "./adapters/integration.adapter";
import {
  chatDatabaseAdapter,
  conversationDatabaseAdapter,
  ChatDatabaseAdapter,
  createUserDatabase,
  createSystemDatabase,
} from "./adapters/database.adapter";
import { EmbedderAdapter } from "./adapters/embedder.adapter";
import { ScraperAdapter } from "./adapters/scraper.adapter";
import { intentQueue } from "./queues/intent.queue";
import { opportunityQueue } from "./queues/opportunity.queue";
import { chatSessionService } from "./services/chat.service";
import { agentService } from "./services/agent.service";
import { AgentDispatcherImpl } from './services/agent-dispatcher.service';
import { contactService } from "./services/contact.service";
import { IntegrationService } from "./services/integration.service";
import { OpportunityDeliveryService } from "./services/opportunity-delivery.service";
import { enrichUserProfile } from "./lib/parallel/parallel";
import { negotiationTimeoutQueue } from "./queues/negotiation-timeout.queue";
import type { ProtocolDeps } from '@indexnetwork/protocol';

/**
 * Create the default ProtocolDeps wired to concrete adapters/services.
 *
 * @returns All protocol-level dependencies using the application's concrete implementations.
 */
export function createDefaultProtocolDeps(): ProtocolDeps {
  const integration = new ComposioIntegrationAdapter();
  const integrationService = new IntegrationService(integration, contactService);
  const agentDispatcher = new AgentDispatcherImpl(agentService, negotiationTimeoutQueue);
  const embedder = new EmbedderAdapter();
  const scraper = new ScraperAdapter();
  const opportunityDeliveryService = new OpportunityDeliveryService();

  return {
    database: chatDatabaseAdapter,
    embedder,
    scraper,
    cache: new RedisCacheAdapter(),
    hydeCache: new RedisCacheAdapter(),
    integration,
    intentQueue,
    contactService,
    chatSession: {
      getSessionMessages: async (sessionId, limit) => {
        const rows = await chatSessionService.getSessionMessages(sessionId, limit);
        return rows.map((m) => ({ role: m.role, content: m.content }));
      },
      listSessions: (userId, limit) =>
        conversationDatabaseAdapter.listChatSessionSummaries(userId, limit),
      getSession: (userId, sessionId, messageLimit) =>
        conversationDatabaseAdapter.getChatSessionDetail(userId, sessionId, messageLimit),
    },
    enricher: { enrichUserProfile },
    negotiationDatabase: conversationDatabaseAdapter as unknown as ProtocolDeps['negotiationDatabase'],
    integrationImporter: integrationService,
    createUserDatabase: (db, userId) =>
      createUserDatabase(db as unknown as ChatDatabaseAdapter, userId),
    createSystemDatabase: (db, userId, scope, emb) =>
      createSystemDatabase(db as unknown as ChatDatabaseAdapter, userId, scope, emb),
    agentDatabase: agentDatabaseAdapter as unknown as ProtocolDeps['agentDatabase'],
    grantDefaultSystemPermissions: (userId: string) =>
      agentService.grantDefaultSystemPermissions(userId),
    agentDispatcher,
    deliveryLedger: {
      confirmOpportunityDelivery: ({ opportunityId, userId, agentId }) =>
        opportunityDeliveryService.commitDelivery(opportunityId, userId, agentId),
    },
    negotiationTimeoutQueue,
    queueNegotiateExisting: (opportunityId, userId) =>
      opportunityQueue.addNegotiateJob({ opportunityId, userId }),
  };
}
