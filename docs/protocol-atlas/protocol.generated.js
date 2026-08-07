globalThis.ProtocolAtlasGenerated = Object.freeze({
  "schemaVersion": 1,
  "nodes": [
    {
      "id": "component.agent-tools",
      "label": "Agent Tools",
      "kind": "tool-family",
      "capability": "participant-agents",
      "sourcePath": "packages/protocol/src/participant-agents/application/agent.tools.ts",
      "symbol": "createAgentTools",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Agent Tools exposes a capability tool family.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.chat-graph-factory",
      "label": "Chat Graph Factory",
      "kind": "graph-factory",
      "capability": "participant-agents",
      "sourcePath": "packages/protocol/src/chat/chat.graph.ts",
      "symbol": "ChatGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Chat Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.chat-tools",
      "label": "Chat Tools",
      "kind": "tool-family",
      "capability": "participant-agents",
      "sourcePath": "packages/protocol/src/chat/chat.tools.ts",
      "symbol": "createChatTools",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Chat Tools exposes a capability tool family.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.enrichment-graph-factory",
      "label": "Enrichment Graph Factory",
      "kind": "graph-factory",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/enrichment/enrichment.graph.ts",
      "symbol": "EnrichmentGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Enrichment Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.enrichment-tools",
      "label": "Enrichment Tools",
      "kind": "tool-family",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/enrichment/enrichment.tools.ts",
      "symbol": "createEnrichmentTools",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Enrichment Tools exposes a capability tool family.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.hyde-graph-factory",
      "label": "Hyde Graph Factory",
      "kind": "graph-factory",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/shared/hyde/hyde.graph.ts",
      "symbol": "HydeGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Hyde Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.index-negotiator",
      "label": "Index Negotiator",
      "kind": "agent",
      "capability": "negotiation",
      "sourcePath": "packages/protocol/src/negotiation/application/negotiation.agent.ts",
      "symbol": "IndexNegotiator",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Index Negotiator performs a structured protocol decision.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.intent-graph-factory",
      "label": "Intent Graph Factory",
      "kind": "graph-factory",
      "capability": "signals",
      "sourcePath": "packages/protocol/src/signals/application/intent.graph.ts",
      "symbol": "IntentGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Intent Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.intent-indexer",
      "label": "Intent Indexer",
      "kind": "agent",
      "capability": "signals",
      "sourcePath": "packages/protocol/src/signals/application/intent.indexer.ts",
      "symbol": "IntentIndexer",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Intent Indexer performs a structured protocol decision.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.intent-network-graph-factory",
      "label": "Intent Network Graph Factory",
      "kind": "graph-factory",
      "capability": "communities",
      "sourcePath": "packages/protocol/src/communities/application/indexer.graph.ts",
      "symbol": "IntentNetworkGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Intent Network Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.intent-tools",
      "label": "Intent Tools",
      "kind": "tool-family",
      "capability": "signals",
      "sourcePath": "packages/protocol/src/signals/application/intent.tools.ts",
      "symbol": "createIntentTools",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Intent Tools exposes a capability tool family.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.invoke-tool-runtime",
      "label": "Invoke Tool Runtime",
      "kind": "public-symbol",
      "capability": "interaction-composition",
      "sourcePath": "packages/protocol/src/shared/agent/tool.runtime.ts",
      "symbol": "invokeToolRuntime",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Invoke Tool Runtime is a selected protocol runtime surface.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.lens-inferrer",
      "label": "Lens Inferrer",
      "kind": "agent",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/shared/hyde/lens.inferrer.ts",
      "symbol": "LensInferrer",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Lens Inferrer performs a structured protocol decision.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.maintenance-graph-factory",
      "label": "Maintenance Graph Factory",
      "kind": "graph-factory",
      "capability": "interaction-composition",
      "sourcePath": "packages/protocol/src/maintenance/maintenance.graph.ts",
      "symbol": "MaintenanceGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Maintenance Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.mcp-server",
      "label": "MCP Server",
      "kind": "public-symbol",
      "capability": "participant-agents",
      "sourcePath": "packages/protocol/src/mcp/mcp.server.ts",
      "symbol": "createMcpServer",
      "chapterIds": [],
      "flowIds": [],
      "summary": "MCP Server is a selected protocol runtime surface.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.negotiation-graph-factory",
      "label": "Negotiation Graph Factory",
      "kind": "graph-factory",
      "capability": "negotiation",
      "sourcePath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
      "symbol": "NegotiationGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Negotiation Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.negotiation-tools",
      "label": "Negotiation Tools",
      "kind": "tool-family",
      "capability": "negotiation",
      "sourcePath": "packages/protocol/src/negotiation/application/negotiation.tools.ts",
      "symbol": "createNegotiationTools",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Negotiation Tools exposes a capability tool family.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.network-graph-factory",
      "label": "Network Graph Factory",
      "kind": "graph-factory",
      "capability": "communities",
      "sourcePath": "packages/protocol/src/communities/application/network.graph.ts",
      "symbol": "NetworkGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Network Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.network-membership-graph-factory",
      "label": "Network Membership Graph Factory",
      "kind": "graph-factory",
      "capability": "communities",
      "sourcePath": "packages/protocol/src/communities/application/membership.graph.ts",
      "symbol": "NetworkMembershipGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Network Membership Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.network-tools",
      "label": "Network Tools",
      "kind": "tool-family",
      "capability": "communities",
      "sourcePath": "packages/protocol/src/communities/application/network.tools.ts",
      "symbol": "createNetworkTools",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Network Tools exposes a capability tool family.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.opportunity-evaluator",
      "label": "Opportunity Evaluator",
      "kind": "agent",
      "capability": "opportunities",
      "sourcePath": "packages/protocol/src/opportunity/application/opportunity.evaluator.ts",
      "symbol": "OpportunityEvaluator",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Opportunity Evaluator performs a structured protocol decision.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.opportunity-graph-factory",
      "label": "Opportunity Graph Factory",
      "kind": "graph-factory",
      "capability": "opportunities",
      "sourcePath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
      "symbol": "OpportunityGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Opportunity Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.opportunity-presenter",
      "label": "Opportunity Presenter",
      "kind": "agent",
      "capability": "opportunities",
      "sourcePath": "packages/protocol/src/opportunity/application/opportunity.presenter.ts",
      "symbol": "OpportunityPresenter",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Opportunity Presenter performs a structured protocol decision.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.opportunity-tools",
      "label": "Opportunity Tools",
      "kind": "tool-family",
      "capability": "opportunities",
      "sourcePath": "packages/protocol/src/opportunity/application/opportunity.tools.ts",
      "symbol": "createOpportunityTools",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Opportunity Tools exposes a capability tool family.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.premise-graph-factory",
      "label": "Premise Graph Factory",
      "kind": "graph-factory",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/premise/premise.graph.ts",
      "symbol": "PremiseGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Premise Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.premise-tools",
      "label": "Premise Tools",
      "kind": "tool-family",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/premise/premise.tools.ts",
      "symbol": "createPremiseTools",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Premise Tools exposes a capability tool family.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.questioner-agent",
      "label": "Questioner Agent",
      "kind": "agent",
      "capability": "questions",
      "sourcePath": "packages/protocol/src/questions/application/question.agent.ts",
      "symbol": "QuestionerAgent",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Questioner Agent performs a structured protocol decision.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.questioner-tools",
      "label": "Questioner Tools",
      "kind": "tool-family",
      "capability": "questions",
      "sourcePath": "packages/protocol/src/questions/application/question.tools.ts",
      "symbol": "createQuestionerTools",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Questioner Tools exposes a capability tool family.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.radar-graph-factory",
      "label": "Radar Graph Factory",
      "kind": "graph-factory",
      "capability": "opportunities",
      "sourcePath": "packages/protocol/src/opportunity/radar/radar.graph.ts",
      "symbol": "RadarGraphFactory",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Radar Graph Factory composes its protocol graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.semantic-verifier",
      "label": "Semantic Verifier",
      "kind": "agent",
      "capability": "signals",
      "sourcePath": "packages/protocol/src/signals/application/intent.verifier.ts",
      "symbol": "SemanticVerifier",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Semantic Verifier performs a structured protocol decision.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.tool-registry",
      "label": "Tool Registry",
      "kind": "public-symbol",
      "capability": "interaction-composition",
      "sourcePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts",
      "symbol": "createToolRegistry",
      "chapterIds": [],
      "flowIds": [],
      "summary": "Tool Registry is a selected protocol runtime surface.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "component.user-context-generator",
      "label": "User Context Generator",
      "kind": "agent",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/context/context.generator.ts",
      "symbol": "UserContextGenerator",
      "chapterIds": [],
      "flowIds": [],
      "summary": "User Context Generator performs a structured protocol decision.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "facade.communities",
      "label": "Communities facade",
      "kind": "facade",
      "capability": "communities",
      "sourcePath": "packages/protocol/src/capabilities/communities.facade.ts",
      "chapterIds": [],
      "flowIds": [],
      "summary": "The reviewed public boundary for the communities capability.",
      "layer": "implementation"
    },
    {
      "id": "facade.contacts",
      "label": "Contacts facade",
      "kind": "facade",
      "capability": "contacts",
      "sourcePath": "packages/protocol/src/capabilities/contacts.facade.ts",
      "chapterIds": [],
      "flowIds": [],
      "summary": "The reviewed public boundary for the contacts capability.",
      "layer": "implementation"
    },
    {
      "id": "facade.integrations",
      "label": "Integrations facade",
      "kind": "facade",
      "capability": "integrations",
      "sourcePath": "packages/protocol/src/capabilities/integrations.facade.ts",
      "chapterIds": [],
      "flowIds": [],
      "summary": "The reviewed public boundary for the integrations capability.",
      "layer": "implementation"
    },
    {
      "id": "facade.interaction-composition",
      "label": "Interaction Composition facade",
      "kind": "facade",
      "capability": "interaction-composition",
      "sourcePath": "packages/protocol/src/capabilities/interaction-composition.facade.ts",
      "chapterIds": [],
      "flowIds": [],
      "summary": "The reviewed public boundary for the interaction-composition capability.",
      "layer": "implementation"
    },
    {
      "id": "facade.negotiation",
      "label": "Negotiation facade",
      "kind": "facade",
      "capability": "negotiation",
      "sourcePath": "packages/protocol/src/capabilities/negotiation.facade.ts",
      "chapterIds": [],
      "flowIds": [],
      "summary": "The reviewed public boundary for the negotiation capability.",
      "layer": "implementation"
    },
    {
      "id": "facade.opportunities",
      "label": "Opportunities facade",
      "kind": "facade",
      "capability": "opportunities",
      "sourcePath": "packages/protocol/src/capabilities/opportunities.facade.ts",
      "chapterIds": [],
      "flowIds": [],
      "summary": "The reviewed public boundary for the opportunities capability.",
      "layer": "implementation"
    },
    {
      "id": "facade.participant-agents",
      "label": "Participant Agents facade",
      "kind": "facade",
      "capability": "participant-agents",
      "sourcePath": "packages/protocol/src/capabilities/participant-agents.facade.ts",
      "chapterIds": [],
      "flowIds": [],
      "summary": "The reviewed public boundary for the participant-agents capability.",
      "layer": "implementation"
    },
    {
      "id": "facade.participant-context",
      "label": "Participant Context facade",
      "kind": "facade",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/capabilities/participant-context.facade.ts",
      "chapterIds": [],
      "flowIds": [],
      "summary": "The reviewed public boundary for the participant-context capability.",
      "layer": "implementation"
    },
    {
      "id": "facade.questions",
      "label": "Questions facade",
      "kind": "facade",
      "capability": "questions",
      "sourcePath": "packages/protocol/src/capabilities/questions.facade.ts",
      "chapterIds": [],
      "flowIds": [],
      "summary": "The reviewed public boundary for the questions capability.",
      "layer": "implementation"
    },
    {
      "id": "facade.signals",
      "label": "Signals facade",
      "kind": "facade",
      "capability": "signals",
      "sourcePath": "packages/protocol/src/capabilities/signals.facade.ts",
      "chapterIds": [],
      "flowIds": [],
      "summary": "The reviewed public boundary for the signals capability.",
      "layer": "implementation"
    },
    {
      "id": "host-requirement.agent-dispatcher",
      "label": "Dispatch participant agents",
      "kind": "host-requirement",
      "capability": "participant-agents",
      "sourcePath": "packages/protocol/src/shared/interfaces/agent-dispatcher.interface.ts",
      "symbol": "AgentDispatcher",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must resolve and dispatch participant-owned agents.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "host-requirement.cache",
      "label": "Cache protocol data",
      "kind": "host-requirement",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/shared/interfaces/cache.interface.ts",
      "symbol": "Cache",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must provide the general protocol cache contract.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "host-requirement.chat-graph-composite-database",
      "label": "Persist chat graph state",
      "kind": "host-requirement",
      "capability": "participant-agents",
      "sourcePath": "packages/protocol/src/shared/interfaces/database.interface.ts",
      "symbol": "ChatGraphCompositeDatabase",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must provide the persistence contract used by the chat graph.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "host-requirement.embedder",
      "label": "Embed and search vectors",
      "kind": "host-requirement",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/shared/interfaces/embedder.interface.ts",
      "symbol": "Embedder",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must provide embedding and vector-search capabilities.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "host-requirement.hyde-cache",
      "label": "Cache HyDE documents",
      "kind": "host-requirement",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/shared/interfaces/cache.interface.ts",
      "symbol": "HydeCache",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must provide the cache subset used by HyDE generation.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "host-requirement.intent-graph-queue",
      "label": "Queue signal processing",
      "kind": "host-requirement",
      "capability": "signals",
      "sourcePath": "packages/protocol/src/shared/interfaces/queue.interface.ts",
      "symbol": "IntentGraphQueue",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must schedule deferred signal graph work.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "host-requirement.mcp-auth-resolver",
      "label": "Resolve authenticated principal",
      "kind": "host-requirement",
      "capability": "participant-agents",
      "sourcePath": "packages/protocol/src/shared/interfaces/auth.interface.ts",
      "symbol": "McpAuthResolver",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must resolve protocol identity; host authentication implementation is outside this atlas.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "host-requirement.negotiation-graph-database",
      "label": "Persist negotiations",
      "kind": "host-requirement",
      "capability": "negotiation",
      "sourcePath": "packages/protocol/src/shared/interfaces/database.interface.ts",
      "symbol": "NegotiationGraphDatabase",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must provide the protocol negotiation persistence contract.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "host-requirement.negotiation-timeout-queue",
      "label": "Schedule negotiation timeouts",
      "kind": "host-requirement",
      "capability": "negotiation",
      "sourcePath": "packages/protocol/src/shared/interfaces/negotiation-events.interface.ts",
      "symbol": "NegotiationTimeoutQueue",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must schedule negotiation timeout work.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "host-requirement.opportunity-graph-database",
      "label": "Persist opportunities",
      "kind": "host-requirement",
      "capability": "opportunities",
      "sourcePath": "packages/protocol/src/shared/interfaces/database.interface.ts",
      "symbol": "OpportunityGraphDatabase",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must provide the protocol opportunity persistence contract.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "host-requirement.system-database",
      "label": "Persist system state",
      "kind": "host-requirement",
      "capability": "interaction-composition",
      "sourcePath": "packages/protocol/src/shared/interfaces/database.interface.ts",
      "symbol": "SystemDatabase",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must provide system-level persistence operations.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "host-requirement.user-database",
      "label": "Persist participant context",
      "kind": "host-requirement",
      "capability": "participant-context",
      "sourcePath": "packages/protocol/src/shared/interfaces/database.interface.ts",
      "symbol": "UserDatabase",
      "chapterIds": [],
      "flowIds": [],
      "summary": "A host must provide participant persistence operations.",
      "layer": "implementation",
      "stability": "stable"
    },
    {
      "id": "runtime-shell.background",
      "label": "Background runtime",
      "capability": "ambient-background",
      "sourcePath": "packages/protocol/src/runtime/background/index.ts",
      "summary": "Exposes ambient background protocol behavior.",
      "kind": "runtime-shell",
      "chapterIds": [],
      "flowIds": [],
      "layer": "implementation"
    },
    {
      "id": "runtime-shell.foreground",
      "label": "Foreground runtime",
      "capability": "interaction-composition",
      "sourcePath": "packages/protocol/src/runtime/foreground/index.ts",
      "summary": "Composes request-driven protocol behavior.",
      "kind": "runtime-shell",
      "chapterIds": [],
      "flowIds": [],
      "layer": "implementation"
    },
    {
      "id": "runtime-shell.mcp",
      "label": "MCP server shell",
      "capability": "participant-agents",
      "sourcePath": "packages/protocol/src/mcp/mcp.server.ts",
      "summary": "Adapts MCP requests to protocol-owned tools.",
      "kind": "runtime-shell",
      "chapterIds": [],
      "flowIds": [],
      "layer": "implementation"
    },
    {
      "id": "runtime-shell.platform",
      "label": "Neutral platform shell",
      "capability": "neutral-platform",
      "sourcePath": "packages/protocol/src/platform/index.ts",
      "summary": "Exposes platform-neutral protocol contracts.",
      "kind": "runtime-shell",
      "chapterIds": [],
      "flowIds": [],
      "layer": "implementation"
    },
    {
      "id": "runtime-shell.public",
      "label": "Public compatibility shell",
      "capability": "public-compatibility",
      "sourcePath": "packages/protocol/src/public/index.ts",
      "summary": "Preserves the public compatibility surface.",
      "kind": "runtime-shell",
      "chapterIds": [],
      "flowIds": [],
      "layer": "implementation"
    },
    {
      "id": "runtime-shell.root",
      "label": "Protocol root",
      "capability": "public-compatibility",
      "sourcePath": "packages/protocol/src/index.ts",
      "summary": "The supported protocol package entry point.",
      "kind": "runtime-shell",
      "chapterIds": [],
      "flowIds": [],
      "layer": "implementation"
    }
  ],
  "edges": [
    {
      "id": "injected.intent-graph-factory.intent-graph-queue",
      "sourceId": "component.intent-graph-factory",
      "targetId": "host-requirement.intent-graph-queue",
      "kind": "injected",
      "label": "accepts deferred graph scheduling",
      "evidencePath": "packages/protocol/src/signals/application/intent.graph.ts",
      "evidenceSymbol": "IntentGraphFactory"
    },
    {
      "id": "injected.mcp-server.mcp-auth-resolver",
      "sourceId": "component.mcp-server",
      "targetId": "host-requirement.mcp-auth-resolver",
      "kind": "injected",
      "label": "requires authenticated identity",
      "evidencePath": "packages/protocol/src/mcp/mcp.server.ts",
      "evidenceSymbol": "createMcpServer"
    },
    {
      "id": "injected.negotiation-graph-factory.agent-dispatcher",
      "sourceId": "component.negotiation-graph-factory",
      "targetId": "host-requirement.agent-dispatcher",
      "kind": "injected",
      "label": "requires participant dispatch",
      "evidencePath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
      "evidenceSymbol": "NegotiationGraphFactory"
    },
    {
      "id": "injected.negotiation-graph-factory.negotiation-timeout-queue",
      "sourceId": "component.negotiation-graph-factory",
      "targetId": "host-requirement.negotiation-timeout-queue",
      "kind": "injected",
      "label": "requires timeout scheduling",
      "evidencePath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
      "evidenceSymbol": "NegotiationGraphFactory"
    },
    {
      "id": "injected.opportunity-graph-factory.opportunity-graph-database",
      "sourceId": "component.opportunity-graph-factory",
      "targetId": "host-requirement.opportunity-graph-database",
      "kind": "injected",
      "label": "requires opportunity persistence",
      "evidencePath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
      "evidenceSymbol": "OpportunityGraphFactory"
    },
    {
      "id": "runtime.chat-graph-factory.chat-tools",
      "sourceId": "component.chat-graph-factory",
      "targetId": "component.chat-tools",
      "kind": "runtime",
      "label": "exposes chat tools",
      "evidencePath": "packages/protocol/src/chat/chat.graph.ts",
      "evidenceSymbol": "ChatGraphFactory"
    },
    {
      "id": "runtime.intent-graph-factory.semantic-verifier",
      "sourceId": "component.intent-graph-factory",
      "targetId": "component.semantic-verifier",
      "kind": "runtime",
      "label": "runs semantic verification",
      "evidencePath": "packages/protocol/src/signals/application/intent.graph.ts",
      "evidenceSymbol": "IntentGraphFactory"
    },
    {
      "id": "runtime.mcp-server.tool-registry",
      "sourceId": "component.mcp-server",
      "targetId": "component.tool-registry",
      "kind": "runtime",
      "label": "builds the tool registry",
      "evidencePath": "packages/protocol/src/mcp/mcp.server.ts",
      "evidenceSymbol": "createMcpServer"
    },
    {
      "id": "runtime.negotiation-graph-factory.index-negotiator",
      "sourceId": "component.negotiation-graph-factory",
      "targetId": "component.index-negotiator",
      "kind": "runtime",
      "label": "runs negotiation turns",
      "evidencePath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
      "evidenceSymbol": "NegotiationGraphFactory"
    },
    {
      "id": "runtime.opportunity-graph-factory.hyde-graph-factory",
      "sourceId": "component.opportunity-graph-factory",
      "targetId": "component.hyde-graph-factory",
      "kind": "runtime",
      "label": "uses generated participant context",
      "evidencePath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
      "evidenceSymbol": "OpportunityGraphFactory"
    },
    {
      "id": "runtime.opportunity-graph-factory.negotiation-graph-factory",
      "sourceId": "component.opportunity-graph-factory",
      "targetId": "component.negotiation-graph-factory",
      "kind": "runtime",
      "label": "starts negotiation",
      "evidencePath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
      "evidenceSymbol": "OpportunityGraphFactory"
    },
    {
      "id": "runtime.opportunity-graph-factory.opportunity-evaluator",
      "sourceId": "component.opportunity-graph-factory",
      "targetId": "component.opportunity-evaluator",
      "kind": "runtime",
      "label": "evaluates candidates",
      "evidencePath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
      "evidenceSymbol": "OpportunityGraphFactory"
    },
    {
      "id": "runtime.tool-registry.agent-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.agent-tools",
      "kind": "runtime",
      "label": "registers capability tools",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts",
      "evidenceSymbol": "createToolRegistry"
    },
    {
      "id": "runtime.tool-registry.chat-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.chat-tools",
      "kind": "runtime",
      "label": "registers capability tools",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts",
      "evidenceSymbol": "createToolRegistry"
    },
    {
      "id": "runtime.tool-registry.enrichment-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.enrichment-tools",
      "kind": "runtime",
      "label": "registers capability tools",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts",
      "evidenceSymbol": "createToolRegistry"
    },
    {
      "id": "runtime.tool-registry.intent-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.intent-tools",
      "kind": "runtime",
      "label": "registers capability tools",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts",
      "evidenceSymbol": "createToolRegistry"
    },
    {
      "id": "runtime.tool-registry.negotiation-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.negotiation-tools",
      "kind": "runtime",
      "label": "registers capability tools",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts",
      "evidenceSymbol": "createToolRegistry"
    },
    {
      "id": "runtime.tool-registry.network-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.network-tools",
      "kind": "runtime",
      "label": "registers capability tools",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts",
      "evidenceSymbol": "createToolRegistry"
    },
    {
      "id": "runtime.tool-registry.opportunity-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.opportunity-tools",
      "kind": "runtime",
      "label": "registers capability tools",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts",
      "evidenceSymbol": "createToolRegistry"
    },
    {
      "id": "runtime.tool-registry.premise-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.premise-tools",
      "kind": "runtime",
      "label": "registers capability tools",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts",
      "evidenceSymbol": "createToolRegistry"
    },
    {
      "id": "runtime.tool-registry.questioner-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.questioner-tools",
      "kind": "runtime",
      "label": "registers capability tools",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts",
      "evidenceSymbol": "createToolRegistry"
    },
    {
      "id": "static.component.enrichment-graph-factory.host-requirement.chat-graph-composite-database",
      "sourceId": "component.enrichment-graph-factory",
      "targetId": "host-requirement.chat-graph-composite-database",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/enrichment/enrichment.graph.ts"
    },
    {
      "id": "static.component.enrichment-graph-factory.host-requirement.negotiation-graph-database",
      "sourceId": "component.enrichment-graph-factory",
      "targetId": "host-requirement.negotiation-graph-database",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/enrichment/enrichment.graph.ts"
    },
    {
      "id": "static.component.enrichment-graph-factory.host-requirement.opportunity-graph-database",
      "sourceId": "component.enrichment-graph-factory",
      "targetId": "host-requirement.opportunity-graph-database",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/enrichment/enrichment.graph.ts"
    },
    {
      "id": "static.component.enrichment-graph-factory.host-requirement.system-database",
      "sourceId": "component.enrichment-graph-factory",
      "targetId": "host-requirement.system-database",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/enrichment/enrichment.graph.ts"
    },
    {
      "id": "static.component.enrichment-graph-factory.host-requirement.user-database",
      "sourceId": "component.enrichment-graph-factory",
      "targetId": "host-requirement.user-database",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/enrichment/enrichment.graph.ts"
    },
    {
      "id": "static.component.intent-graph-factory.component.semantic-verifier",
      "sourceId": "component.intent-graph-factory",
      "targetId": "component.semantic-verifier",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/signals/application/intent.graph.ts"
    },
    {
      "id": "static.component.intent-graph-factory.host-requirement.chat-graph-composite-database",
      "sourceId": "component.intent-graph-factory",
      "targetId": "host-requirement.chat-graph-composite-database",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/signals/application/intent.graph.ts"
    },
    {
      "id": "static.component.intent-graph-factory.host-requirement.negotiation-graph-database",
      "sourceId": "component.intent-graph-factory",
      "targetId": "host-requirement.negotiation-graph-database",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/signals/application/intent.graph.ts"
    },
    {
      "id": "static.component.intent-graph-factory.host-requirement.opportunity-graph-database",
      "sourceId": "component.intent-graph-factory",
      "targetId": "host-requirement.opportunity-graph-database",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/signals/application/intent.graph.ts"
    },
    {
      "id": "static.component.intent-graph-factory.host-requirement.system-database",
      "sourceId": "component.intent-graph-factory",
      "targetId": "host-requirement.system-database",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/signals/application/intent.graph.ts"
    },
    {
      "id": "static.component.intent-graph-factory.host-requirement.user-database",
      "sourceId": "component.intent-graph-factory",
      "targetId": "host-requirement.user-database",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/signals/application/intent.graph.ts"
    },
    {
      "id": "static.component.mcp-server.component.invoke-tool-runtime",
      "sourceId": "component.mcp-server",
      "targetId": "component.invoke-tool-runtime",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/mcp/mcp.server.ts"
    },
    {
      "id": "static.component.mcp-server.component.tool-registry",
      "sourceId": "component.mcp-server",
      "targetId": "component.tool-registry",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/mcp/mcp.server.ts"
    },
    {
      "id": "static.component.negotiation-graph-factory.component.index-negotiator",
      "sourceId": "component.negotiation-graph-factory",
      "targetId": "component.index-negotiator",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/negotiation/application/negotiation.graph.ts"
    },
    {
      "id": "static.component.negotiation-tools.component.index-negotiator",
      "sourceId": "component.negotiation-tools",
      "targetId": "component.index-negotiator",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/negotiation/application/negotiation.tools.ts"
    },
    {
      "id": "static.component.opportunity-graph-factory.component.opportunity-evaluator",
      "sourceId": "component.opportunity-graph-factory",
      "targetId": "component.opportunity-evaluator",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/opportunity/application/opportunity.graph.ts"
    },
    {
      "id": "static.component.opportunity-tools.component.opportunity-presenter",
      "sourceId": "component.opportunity-tools",
      "targetId": "component.opportunity-presenter",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/opportunity/application/opportunity.tools.ts"
    },
    {
      "id": "static.component.tool-registry.component.chat-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.chat-tools",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts"
    },
    {
      "id": "static.component.tool-registry.component.enrichment-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.enrichment-tools",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts"
    },
    {
      "id": "static.component.tool-registry.component.premise-tools",
      "sourceId": "component.tool-registry",
      "targetId": "component.premise-tools",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts"
    },
    {
      "id": "static.component.tool-registry.facade.communities",
      "sourceId": "component.tool-registry",
      "targetId": "facade.communities",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts"
    },
    {
      "id": "static.component.tool-registry.facade.contacts",
      "sourceId": "component.tool-registry",
      "targetId": "facade.contacts",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts"
    },
    {
      "id": "static.component.tool-registry.facade.integrations",
      "sourceId": "component.tool-registry",
      "targetId": "facade.integrations",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts"
    },
    {
      "id": "static.component.tool-registry.facade.negotiation",
      "sourceId": "component.tool-registry",
      "targetId": "facade.negotiation",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts"
    },
    {
      "id": "static.component.tool-registry.facade.opportunities",
      "sourceId": "component.tool-registry",
      "targetId": "facade.opportunities",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts"
    },
    {
      "id": "static.component.tool-registry.facade.questions",
      "sourceId": "component.tool-registry",
      "targetId": "facade.questions",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/runtime/foreground/composition/tool.registry.ts"
    },
    {
      "id": "static.facade.interaction-composition.component.maintenance-graph-factory",
      "sourceId": "facade.interaction-composition",
      "targetId": "component.maintenance-graph-factory",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/interaction-composition.facade.ts"
    },
    {
      "id": "static.facade.opportunities.component.opportunity-evaluator",
      "sourceId": "facade.opportunities",
      "targetId": "component.opportunity-evaluator",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/opportunities.facade.ts"
    },
    {
      "id": "static.facade.opportunities.component.opportunity-graph-factory",
      "sourceId": "facade.opportunities",
      "targetId": "component.opportunity-graph-factory",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/opportunities.facade.ts"
    },
    {
      "id": "static.facade.opportunities.component.opportunity-presenter",
      "sourceId": "facade.opportunities",
      "targetId": "component.opportunity-presenter",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/opportunities.facade.ts"
    },
    {
      "id": "static.facade.opportunities.component.opportunity-tools",
      "sourceId": "facade.opportunities",
      "targetId": "component.opportunity-tools",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/opportunities.facade.ts"
    },
    {
      "id": "static.facade.opportunities.component.radar-graph-factory",
      "sourceId": "facade.opportunities",
      "targetId": "component.radar-graph-factory",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/opportunities.facade.ts"
    },
    {
      "id": "static.facade.participant-agents.component.chat-graph-factory",
      "sourceId": "facade.participant-agents",
      "targetId": "component.chat-graph-factory",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/participant-agents.facade.ts"
    },
    {
      "id": "static.facade.participant-agents.component.chat-tools",
      "sourceId": "facade.participant-agents",
      "targetId": "component.chat-tools",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/participant-agents.facade.ts"
    },
    {
      "id": "static.facade.signals.component.intent-graph-factory",
      "sourceId": "facade.signals",
      "targetId": "component.intent-graph-factory",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/signals.facade.ts"
    },
    {
      "id": "static.facade.signals.component.intent-indexer",
      "sourceId": "facade.signals",
      "targetId": "component.intent-indexer",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/signals.facade.ts"
    },
    {
      "id": "static.facade.signals.component.intent-tools",
      "sourceId": "facade.signals",
      "targetId": "component.intent-tools",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/signals.facade.ts"
    },
    {
      "id": "static.facade.signals.component.semantic-verifier",
      "sourceId": "facade.signals",
      "targetId": "component.semantic-verifier",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/capabilities/signals.facade.ts"
    },
    {
      "id": "static.runtime-shell.foreground.component.tool-registry",
      "sourceId": "runtime-shell.foreground",
      "targetId": "component.tool-registry",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/runtime/foreground/index.ts"
    },
    {
      "id": "static.runtime-shell.mcp.component.invoke-tool-runtime",
      "sourceId": "runtime-shell.mcp",
      "targetId": "component.invoke-tool-runtime",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/mcp/mcp.server.ts"
    },
    {
      "id": "static.runtime-shell.mcp.component.tool-registry",
      "sourceId": "runtime-shell.mcp",
      "targetId": "component.tool-registry",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/mcp/mcp.server.ts"
    },
    {
      "id": "static.runtime-shell.platform.component.invoke-tool-runtime",
      "sourceId": "runtime-shell.platform",
      "targetId": "component.invoke-tool-runtime",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/platform/index.ts"
    },
    {
      "id": "static.runtime-shell.root.component.invoke-tool-runtime",
      "sourceId": "runtime-shell.root",
      "targetId": "component.invoke-tool-runtime",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.component.mcp-server",
      "sourceId": "runtime-shell.root",
      "targetId": "component.mcp-server",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.facade.communities",
      "sourceId": "runtime-shell.root",
      "targetId": "facade.communities",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.facade.contacts",
      "sourceId": "runtime-shell.root",
      "targetId": "facade.contacts",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.facade.integrations",
      "sourceId": "runtime-shell.root",
      "targetId": "facade.integrations",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.facade.interaction-composition",
      "sourceId": "runtime-shell.root",
      "targetId": "facade.interaction-composition",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.facade.negotiation",
      "sourceId": "runtime-shell.root",
      "targetId": "facade.negotiation",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.facade.opportunities",
      "sourceId": "runtime-shell.root",
      "targetId": "facade.opportunities",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.facade.participant-agents",
      "sourceId": "runtime-shell.root",
      "targetId": "facade.participant-agents",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.facade.participant-context",
      "sourceId": "runtime-shell.root",
      "targetId": "facade.participant-context",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.facade.questions",
      "sourceId": "runtime-shell.root",
      "targetId": "facade.questions",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.facade.signals",
      "sourceId": "runtime-shell.root",
      "targetId": "facade.signals",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    },
    {
      "id": "static.runtime-shell.root.runtime-shell.mcp",
      "sourceId": "runtime-shell.root",
      "targetId": "runtime-shell.mcp",
      "kind": "static",
      "label": "imports at runtime",
      "evidencePath": "packages/protocol/src/index.ts"
    }
  ]
});
