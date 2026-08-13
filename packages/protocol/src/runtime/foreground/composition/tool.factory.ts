import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { HydeGraphDatabase } from "../../../shared/interfaces/database.interface.js";
import { IntentGraphFactory } from "../../../signals/application/intent.graph.js";
import { EnrichmentGraphFactory } from "../../../enrichment/enrichment.graph.js";
import { OpportunityGraphFactory } from "../../../capabilities/opportunities.facade.js";
import { HydeGraphFactory } from "../../../shared/hyde/hyde.graph.js";
import { HydeGenerator } from "../../../shared/hyde/hyde.generator.js";
import { LensInferrer } from "../../../shared/hyde/lens.inferrer.js";
import { NetworkGraphFactory, NetworkMembershipGraphFactory, IntentNetworkGraphFactory } from "../../../capabilities/communities.facade.js";
import { IntentIndexer } from "../../../signals/application/intent.indexer.js";
import { NegotiationGraphFactory } from "../../../capabilities/negotiation.facade.js";
import { PremiseGraphFactory } from "../../../premise/premise.graph.js";
import { protocolLogger } from "../../../shared/observability/protocol.logger.js";

import type { QuestionerEnqueueFn } from "../../../capabilities/questions.facade.js";

import { type ToolContext, type ResolvedToolContext, type ToolDeps, resolveChatContext, error, redactSensitiveFields } from "../../../shared/agent/tool.helpers.js";
import { deriveAllowedNetworkIds, focusedIntentId, scopeFromNetworkId } from "../../../shared/agent/tool.scope.js";
import { invokeToolRuntime, toolRuntimeErrorToResult } from "../../../shared/agent/tool.runtime.js";
import { createEnrichmentTools } from "../../../enrichment/enrichment.tools.js";
import { createIntentTools } from "../signals/intent.tools.js";
import { createNetworkTools } from "../../../capabilities/communities.facade.js";
import { createOpportunityTools } from "../../../capabilities/opportunities.facade.js";
import { createUtilityTools } from "../../../shared/agent/utility.tools.js";
import { createIntegrationTools } from "../../../capabilities/integrations.facade.js";
import { createContactTools } from "../../../capabilities/contacts.facade.js";
import { createAgentTools } from "../../../capabilities/participant-agents.tools.facade.js";
import { createNegotiationTools } from "../../../capabilities/negotiation.facade.js";
import { createPremiseTools } from "../../../premise/premise.tools.js";
import { createQuestionerTools, createAskUserQuestionTools } from "../../../capabilities/questions.facade.js";
import type { OpportunityOwnerApprovalDeps } from "../../../opportunity/ports/opportunity.tools.port.js";
import { bindOwnerApprovalProvenance } from "../../../opportunity/application/opportunity.owner-provenance.js";

// Re-export types for consumers
export type { ToolContext, ResolvedToolContext, ProtocolDeps } from "../../../shared/agent/tool.helpers.js";
export type { ToolDeps } from "../../../shared/agent/tool.helpers.js";

const logger = protocolLogger("ChatTools");

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates all chat tools bound to a specific user context.
 * Resolves user/network identity from DB at init time.
 * Tools are created fresh for each user session to ensure proper isolation.
 *
 * All external dependencies (cache, integration, queue, etc.) are provided
 * via the `deps` parameter — the protocol lib never imports concrete adapters.
 */
export async function createChatTools(
  deps: ToolContext & OpportunityOwnerApprovalDeps,
  preResolvedContext?: ResolvedToolContext
) {
  const { database, embedder, scraper } = deps;

  const explicitScope = deps.scopeType && deps.scopeId
    ? { scopeType: deps.scopeType, scopeId: deps.scopeId }
    : scopeFromNetworkId(deps.networkId);

  // ─── Resolve context from DB ───────────────────────────────────────────────
  // resolveChatContext still accepts a networkId because it loads scoped index
  // presentation metadata; the canonical request scope is explicitScope.
  const resolvedContext =
    preResolvedContext ??
    (await resolveChatContext({
      database,
      userId: deps.userId,
      networkId: explicitScope.scopeType === 'network' ? explicitScope.scopeId : deps.networkId,
      sessionId: deps.sessionId,
      contactsEnabled: deps.contactsEnabled,
      actionToolsEnabled: deps.actionToolsEnabled,
    }));

  if (!preResolvedContext && explicitScope.scopeType && explicitScope.scopeId) {
    resolvedContext.scopeType = explicitScope.scopeType;
    resolvedContext.scopeId = explicitScope.scopeId;
  }

  // This factory is an orchestrated chat surface, never a direct owner request.
  // Bind that fact at composition time rather than inferring it from a session
  // id or a caller-controlled tool argument inside the opportunity handler.
  bindOwnerApprovalProvenance(resolvedContext, {
    surface: 'chat',
    sessionAuthenticated: false,
  });

  const allowedNetworkIds = deriveAllowedNetworkIds({
    memberships: resolvedContext.userNetworks,
    ...(resolvedContext.scopeType && resolvedContext.scopeId
      ? { scopeType: resolvedContext.scopeType, scopeId: resolvedContext.scopeId }
      : {}),
  });

  // ─── Tool wrapper ──────────────────────────────────────────────────────────
  /**
   * Standardized tool factory. Auto-injects resolved context and
   * provides uniform logging / error handling for every tool.
   */
  function defineTool<T extends z.ZodType>(opts: {
    name: string;
    description: string;
    querySchema: T;
    handler: (input: { context: ResolvedToolContext; query: z.infer<T> }) => Promise<string>;
  }) {
    return tool(
      async (query: z.infer<T>) => {
        logger.info('Tool invoked', {
          toolName: opts.name,
          context: { userId: resolvedContext.userId, scopeType: resolvedContext.scopeType, scopeId: resolvedContext.scopeId },
          query: redactSensitiveFields(query),
        });
        try {
          return await invokeToolRuntime({
            toolName: opts.name,
            tool: { handler: async ({ context, query }) => opts.handler({ context, query: query as z.infer<T> }) },
            context: resolvedContext,
            query,
          });
        } catch (err) {
          logger.error('Tool failed', {
            toolName: opts.name,
            error: err instanceof Error ? err.message : String(err),
          });
          const runtimeResult = toolRuntimeErrorToResult(err);
          if (runtimeResult) return runtimeResult;
          const reason = err instanceof Error ? err.message : String(err);
          return error(`Failed to execute ${opts.name}: ${reason}`);
        }
      },
      { name: opts.name, description: opts.description, schema: opts.querySchema }
    );
  }

  // ─── Compile subgraphs ─────────────────────────────────────────────────────

  // Wrap questionerEnqueue to include scoped/session context when available.
  const sessionAwareEnqueue: QuestionerEnqueueFn | undefined = deps.questionerEnqueue
    ? (input) => deps.questionerEnqueue!({
        ...input,
        ...(resolvedContext.scopeType && resolvedContext.scopeId && !input.scopeId
          ? { scopeType: resolvedContext.scopeType, scopeId: resolvedContext.scopeId }
          : {}),
        ...(resolvedContext.sessionId && !input.conversationId ? { conversationId: resolvedContext.sessionId } : {}),
      })
    : undefined;

  const intentGraph = new IntentGraphFactory(database, embedder, deps.intentQueue, sessionAwareEnqueue).createGraph();
  const premiseGraph = new PremiseGraphFactory(database, embedder).createGraph();
  const profileGraph = new EnrichmentGraphFactory(database, scraper, deps.enricher, premiseGraph).createGraph();
  const hydeCache = deps.hydeCache;
  const lensInferrer = new LensInferrer();
  const hydeGenerator = new HydeGenerator();
  const compiledHydeGraph = new HydeGraphFactory(
    database as unknown as HydeGraphDatabase,
    embedder,
    hydeCache,
    lensInferrer,
    hydeGenerator
  ).createGraph();
  const negotiationGraph = deps.agentDispatcher
    ? new NegotiationGraphFactory(
        deps.negotiationDatabase,
        deps.agentDispatcher,
        deps.negotiationTimeoutQueue,
        sessionAwareEnqueue,
      ).createGraph()
    : undefined;
  const opportunityGraph = new OpportunityGraphFactory(
    database,
    embedder,
    compiledHydeGraph,
    undefined, // evaluator (default)
    undefined, // queueNotification
    negotiationGraph,
    deps.agentDispatcher,
    deps.queueNegotiateExisting,
    deps.stampNewbornOpportunities,
  ).createGraph();
  const networkGraph = new NetworkGraphFactory(database).createGraph();
  const networkMembershipGraph = new NetworkMembershipGraphFactory(database).createGraph();
  const intentNetworkGraph = new IntentNetworkGraphFactory(database, new IntentIndexer()).createGraph();

  // ─── Create context-bound databases ────────────────────────────────────────
  // Use injected instances when provided (e.g. tests). Otherwise create from the same
  // database used for graphs so that scope checks (e.g. ensureScopedMembership, opportunity
  // update) use the same adapter as the rest of the tool pipeline.
  //
  // The systemDb's DB-level clamp derives concrete allowed network IDs from the
  // focused scope envelope plus memberships, rather than consuming a transported
  // legacy indexScope array.
  const userDb = deps.userDb ?? deps.createUserDatabase(database, resolvedContext.userId);
  const systemDb = deps.systemDb ?? deps.createSystemDatabase(database, resolvedContext.userId, allowedNetworkIds, embedder);

  // ─── Assemble dependencies ─────────────────────────────────────────────────
  const cache = deps.cache;
  const integration = deps.integration;
  const toolDeps: ToolDeps & OpportunityOwnerApprovalDeps = {
    database,
    userDb,
    systemDb,
    scraper,
    embedder,
    cache,
    integration,
    contactService: deps.contactService,
    contactsEnabled: deps.contactsEnabled,
    integrationImporter: deps.integrationImporter,
    enricher: deps.enricher,
    negotiationDatabase: deps.negotiationDatabase,
    negotiationTimeoutQueue: deps.negotiationTimeoutQueue,
    agentDatabase: deps.agentDatabase,
    grantDefaultSystemPermissions: deps.grantDefaultSystemPermissions,
    agentDispatcher: deps.agentDispatcher,
    stampNewbornOpportunities: deps.stampNewbornOpportunities,
    deliveryLedger: deps.deliveryLedger,
    ...(deps.opportunityOwnerApproval && { opportunityOwnerApproval: deps.opportunityOwnerApproval }),
    enrichmentRuns: deps.enrichmentRuns,
    enrichmentRunQueue: deps.enrichmentRunQueue,
    frontendUrl: deps.frontendUrl,
    apiBaseUrl: deps.apiBaseUrl,
    ...(deps.chatSummary && { chatSummary: deps.chatSummary }),
    ...(sessionAwareEnqueue && { questionerEnqueue: sessionAwareEnqueue }),
    ...(deps.findPendingQuestions && { findPendingQuestions: deps.findPendingQuestions }),
    ...(deps.answerPendingQuestion && { answerPendingQuestion: deps.answerPendingQuestion }),
    ...(deps.negotiationSummary && { negotiationSummary: deps.negotiationSummary }),
    ...(deps.chatQuestions && { chatQuestions: deps.chatQuestions }),
    ...(deps.chatSession && { chatSession: deps.chatSession }),
    ...(deps.getUserContextText && { getUserContextText: deps.getUserContextText }),
    ...(deps.intentProposalStore && { intentProposalStore: deps.intentProposalStore }),
    graphs: {
      profile: profileGraph,
      intent: intentGraph,
      index: networkGraph,
      networkMembership: networkMembershipGraph,
      intentIndex: intentNetworkGraph,
      opportunity: opportunityGraph,
      premise: premiseGraph,
    },
  };

  // ─── Create domain tools ──────────────────────────────────────────────────
  const profileTools = createEnrichmentTools(defineTool, toolDeps);
  const intentTools = createIntentTools(defineTool, toolDeps);
  // An intent-scoped conversation exists to refine its selected signal. Keep
  // creation out of the model-visible registry; the update handler separately
  // clamps writes to the exact scoped intent as a runtime backstop.
  const intentToolsForChat = focusedIntentId(resolvedContext)
    ? intentTools.filter((candidate) => (candidate as { name: string }).name !== "create_intent")
    : intentTools;
  const networkTools = createNetworkTools(defineTool, toolDeps);
  const opportunityTools = createOpportunityTools(defineTool, toolDeps);
  const utilityTools = createUtilityTools(defineTool, toolDeps);
  const contactTools = createContactTools(defineTool, toolDeps);
  const agentTools = createAgentTools(defineTool, toolDeps);
  const integrationTools = createIntegrationTools(defineTool, toolDeps);
  const negotiationTools = deps.agentDispatcher
    ? createNegotiationTools(defineTool, toolDeps)
    : [];
  const premiseTools = createPremiseTools(defineTool, toolDeps);
  const questionerTools = createQuestionerTools(defineTool, toolDeps);
  // Blocking mid-conversation questions — chat-only (never in the MCP registry),
  // and only when the host provides the ChatQuestionsHost bridge.
  const askUserQuestionTools = deps.chatQuestions
    ? createAskUserQuestionTools(defineTool, toolDeps)
    : [];

  // confirm_opportunity_delivery is an OpenClaw-delivery ledger write and must not be
  // callable from regular chat sessions.
  const chatOpportunityToolExclusions = new Set([
    "confirm_opportunity_delivery",
  ]);
  const opportunityToolsForChat = opportunityTools.filter(
    (t) => !chatOpportunityToolExclusions.has((t as { name: string }).name)
  );

  return [
    ...profileTools,
    ...intentToolsForChat,
    ...networkTools,
    ...opportunityToolsForChat,
    ...utilityTools,
    ...integrationTools,
    ...contactTools,
    ...agentTools,
    ...negotiationTools,
    ...premiseTools,
    ...questionerTools,
    ...askUserQuestionTools,
  ];
}

/**
 * Type for the tools array returned by createChatTools.
 */
export type ChatTools = Awaited<ReturnType<typeof createChatTools>>;
