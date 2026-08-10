globalThis.ProtocolAtlasGenerated = Object.freeze({
  "schemaVersion": 2,
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
      "id": "static.component.intent-graph-factory.component.semantic-verifier",
      "sourceId": "component.intent-graph-factory",
      "targetId": "component.semantic-verifier",
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
  ],
  "configurationExperiments": [
    {
      "id": "discovery-corpus",
      "title": "Discovery corpus and source selection",
      "summary": "Discovery corpus and source selection compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "opportunities",
      "coverage": "definitive",
      "fallbackModeId": "fallback",
      "affectedChapterIds": [
        "discovery",
        "explore"
      ],
      "affectedStepIds": [
        "retrieve-candidates"
      ],
      "settings": [
        {
          "key": "DISCOVERY_ALLOWED_TYPES",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/discovery.env.ts",
              "symbol": "discoveryAllowedTypes"
            }
          ],
          "entryAccessorSymbol": "discoveryAllowedTypes",
          "accessorClosure": [],
          "acceptedValues": [
            "intent",
            "intent,profile",
            "profile"
          ],
          "fallback": "intent,profile",
          "readTiming": "invocation"
        },
        {
          "key": "DISCOVERY_CONTEXT_TO_INTENT",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "symbol": "OpportunityGraphFactory"
            }
          ],
          "entryAccessorSymbol": "OpportunityGraphFactory",
          "accessorClosure": [],
          "acceptedValues": [
            "0",
            "1"
          ],
          "fallback": "1",
          "readTiming": "invocation"
        },
        {
          "key": "DISCOVERY_PROFILE_SOURCE",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/discovery.env.ts",
              "symbol": "discoveryProfileSource"
            }
          ],
          "entryAccessorSymbol": "discoveryProfileSource",
          "accessorClosure": [],
          "acceptedValues": [
            "premise",
            "user_context"
          ],
          "fallback": "premise",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "context-cross-match",
          "assignments": [
            {
              "key": "DISCOVERY_ALLOWED_TYPES",
              "value": "intent,profile"
            },
            {
              "key": "DISCOVERY_CONTEXT_TO_INTENT",
              "value": "1"
            },
            {
              "key": "DISCOVERY_PROFILE_SOURCE",
              "value": "user_context"
            }
          ],
          "resolvedValues": [
            {
              "key": "DISCOVERY_ALLOWED_TYPES",
              "value": "intent,profile"
            },
            {
              "key": "DISCOVERY_CONTEXT_TO_INTENT",
              "value": "1"
            },
            {
              "key": "DISCOVERY_PROFILE_SOURCE",
              "value": "user_context"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "discovery-corpus.context-cross-match.discovery-context-to-intent",
              "effect": "activated",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "DISCOVERY_CONTEXT_TO_INTENT"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "consumerSymbol": "OpportunityGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "OpportunityGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts",
                "testName": "DISCOVERY_CONTEXT_TO_INTENT=1 with user_context and intent,profile invokes context-to-intent search and evidence"
              }
            }
          ],
          "explanation": "Context-to-intent cross matching becomes eligible.",
          "caveats": []
        },
        {
          "id": "context-profile",
          "assignments": [
            {
              "key": "DISCOVERY_ALLOWED_TYPES",
              "value": "profile"
            },
            {
              "key": "DISCOVERY_CONTEXT_TO_INTENT",
              "value": null
            },
            {
              "key": "DISCOVERY_PROFILE_SOURCE",
              "value": "user_context"
            }
          ],
          "resolvedValues": [
            {
              "key": "DISCOVERY_ALLOWED_TYPES",
              "value": "profile"
            },
            {
              "key": "DISCOVERY_CONTEXT_TO_INTENT",
              "value": "1"
            },
            {
              "key": "DISCOVERY_PROFILE_SOURCE",
              "value": "user_context"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "discovery-corpus.context-profile.discovery-profile-source",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "DISCOVERY_PROFILE_SOURCE"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "consumerSymbol": "OpportunityGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/discovery.env.ts",
                  "symbol": "discoveryProfileSource"
                },
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "OpportunityGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts",
                "testName": "DISCOVERY_PROFILE_SOURCE=user_context: premise strategy off, premise HyDE results dropped"
              }
            }
          ],
          "explanation": "Only participant-context profile retrieval is eligible.",
          "caveats": []
        },
        {
          "id": "fallback",
          "assignments": [
            {
              "key": "DISCOVERY_ALLOWED_TYPES",
              "value": null
            },
            {
              "key": "DISCOVERY_CONTEXT_TO_INTENT",
              "value": null
            },
            {
              "key": "DISCOVERY_PROFILE_SOURCE",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "DISCOVERY_ALLOWED_TYPES",
              "value": "intent,profile"
            },
            {
              "key": "DISCOVERY_CONTEXT_TO_INTENT",
              "value": "1"
            },
            {
              "key": "DISCOVERY_PROFILE_SOURCE",
              "value": "premise"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Intent and premise-profile retrieval are eligible from package fallbacks.",
          "caveats": []
        },
        {
          "id": "intent-only",
          "assignments": [
            {
              "key": "DISCOVERY_ALLOWED_TYPES",
              "value": "intent"
            },
            {
              "key": "DISCOVERY_CONTEXT_TO_INTENT",
              "value": null
            },
            {
              "key": "DISCOVERY_PROFILE_SOURCE",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "DISCOVERY_ALLOWED_TYPES",
              "value": "intent"
            },
            {
              "key": "DISCOVERY_CONTEXT_TO_INTENT",
              "value": "1"
            },
            {
              "key": "DISCOVERY_PROFILE_SOURCE",
              "value": "premise"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "discovery-corpus.intent-only.discovery-allowed-types",
              "effect": "bypassed",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "DISCOVERY_ALLOWED_TYPES"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "consumerSymbol": "OpportunityGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/discovery.env.ts",
                  "symbol": "discoveryAllowedTypes"
                },
                {
                  "path": "packages/protocol/src/opportunity/discovery.env.ts",
                  "symbol": "discoveryIntentMatchingEnabled"
                },
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "OpportunityGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts",
                "testName": "DISCOVERY_ALLOWED_TYPES=intent: premise and context strategies issue no searches"
              }
            }
          ],
          "explanation": "Profile retrieval is bypassed; intent retrieval remains eligible.",
          "caveats": []
        },
        {
          "id": "premise-profile",
          "assignments": [
            {
              "key": "DISCOVERY_ALLOWED_TYPES",
              "value": "profile"
            },
            {
              "key": "DISCOVERY_CONTEXT_TO_INTENT",
              "value": null
            },
            {
              "key": "DISCOVERY_PROFILE_SOURCE",
              "value": "premise"
            }
          ],
          "resolvedValues": [
            {
              "key": "DISCOVERY_ALLOWED_TYPES",
              "value": "profile"
            },
            {
              "key": "DISCOVERY_CONTEXT_TO_INTENT",
              "value": "1"
            },
            {
              "key": "DISCOVERY_PROFILE_SOURCE",
              "value": "premise"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "discovery-corpus.premise-profile.discovery-allowed-types",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "DISCOVERY_ALLOWED_TYPES"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "consumerSymbol": "OpportunityGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/discovery.env.ts",
                  "symbol": "discoveryAllowedTypes"
                },
                {
                  "path": "packages/protocol/src/opportunity/discovery.env.ts",
                  "symbol": "discoveryIntentMatchingEnabled"
                },
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "OpportunityGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts",
                "testName": "DISCOVERY_ALLOWED_TYPES=intent: premise and context strategies issue no searches"
              }
            }
          ],
          "explanation": "Only premise-backed profile retrieval is eligible.",
          "caveats": []
        }
      ]
    },
    {
      "id": "discovery-evaluation-topology",
      "title": "Discovery evaluation topology",
      "summary": "Discovery evaluation topology compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "opportunities",
      "coverage": "definitive",
      "fallbackModeId": "bundled",
      "affectedChapterIds": [
        "discovery",
        "explore"
      ],
      "affectedStepIds": [
        "evaluate-fit"
      ],
      "settings": [
        {
          "key": "RUN_OPPORTUNITY_EVAL_IN_PARALLEL",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "symbol": "OpportunityGraphFactory"
            }
          ],
          "entryAccessorSymbol": "OpportunityGraphFactory",
          "accessorClosure": [],
          "acceptedValues": [
            "false",
            "true"
          ],
          "fallback": "false",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "bundled",
          "assignments": [
            {
              "key": "RUN_OPPORTUNITY_EVAL_IN_PARALLEL",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "RUN_OPPORTUNITY_EVAL_IN_PARALLEL",
              "value": "false"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Fallback evaluation uses bundled actor normalization.",
          "caveats": []
        },
        {
          "id": "pairwise",
          "assignments": [
            {
              "key": "RUN_OPPORTUNITY_EVAL_IN_PARALLEL",
              "value": "true"
            }
          ],
          "resolvedValues": [
            {
              "key": "RUN_OPPORTUNITY_EVAL_IN_PARALLEL",
              "value": "true"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "discovery-evaluation-topology.pairwise.run-opportunity-eval-in-parallel",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "RUN_OPPORTUNITY_EVAL_IN_PARALLEL"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "consumerSymbol": "OpportunityGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "OpportunityGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts",
                "testName": "when evaluator returns 3 actors, splits into pairwise opportunities (viewer + each non-viewer)"
              }
            }
          ],
          "explanation": "Evaluation executes per pair with independent failure isolation.",
          "caveats": []
        }
      ]
    },
    {
      "id": "discovery-premise-limit",
      "title": "Discovery premise fan-out",
      "summary": "Discovery premise fan-out compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "opportunities",
      "coverage": "definitive",
      "fallbackModeId": "fallback-40",
      "affectedChapterIds": [
        "discovery",
        "explore"
      ],
      "affectedStepIds": [
        "retrieve-candidates"
      ],
      "settings": [
        {
          "key": "DISCOVERY_SOURCE_PREMISE_LIMIT",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "symbol": "getSourcePremiseDiscoveryLimit"
            }
          ],
          "entryAccessorSymbol": "getSourcePremiseDiscoveryLimit",
          "accessorClosure": [],
          "acceptedValues": [
            "0",
            "100",
            "40"
          ],
          "fallback": "40",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "disabled-0",
          "assignments": [
            {
              "key": "DISCOVERY_SOURCE_PREMISE_LIMIT",
              "value": "0"
            }
          ],
          "resolvedValues": [
            {
              "key": "DISCOVERY_SOURCE_PREMISE_LIMIT",
              "value": "0"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "discovery-premise-limit.disabled-0.discovery-source-premise-limit",
              "effect": "bypassed",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "DISCOVERY_SOURCE_PREMISE_LIMIT"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "consumerSymbol": "OpportunityGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "getSourcePremiseDiscoveryLimit"
                },
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "OpportunityGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts",
                "testName": "premise discovery uses scoped capped source premises and one batched DB search"
              }
            }
          ],
          "explanation": "Premise-to-premise discovery is bypassed.",
          "caveats": []
        },
        {
          "id": "expanded-100",
          "assignments": [
            {
              "key": "DISCOVERY_SOURCE_PREMISE_LIMIT",
              "value": "100"
            }
          ],
          "resolvedValues": [
            {
              "key": "DISCOVERY_SOURCE_PREMISE_LIMIT",
              "value": "100"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "discovery-premise-limit.expanded-100.discovery-source-premise-limit",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "DISCOVERY_SOURCE_PREMISE_LIMIT"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "consumerSymbol": "OpportunityGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "getSourcePremiseDiscoveryLimit"
                },
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "OpportunityGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts",
                "testName": "premise discovery uses scoped capped source premises and one batched DB search"
              }
            }
          ],
          "explanation": "The source-premise fan-out cap increases to 100.",
          "caveats": []
        },
        {
          "id": "fallback-40",
          "assignments": [
            {
              "key": "DISCOVERY_SOURCE_PREMISE_LIMIT",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "DISCOVERY_SOURCE_PREMISE_LIMIT",
              "value": "40"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "At most 40 source premises are loaded.",
          "caveats": []
        }
      ]
    },
    {
      "id": "discovery-rejection-cooldown",
      "title": "Discovery rejection cooldown",
      "summary": "Discovery rejection cooldown compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "opportunities",
      "coverage": "definitive",
      "fallbackModeId": "fallback-7d",
      "affectedChapterIds": [
        "discovery",
        "explore"
      ],
      "affectedStepIds": [
        "evaluate-fit"
      ],
      "settings": [
        {
          "key": "DISCOVERY_REJECTION_COOLDOWN_DAYS",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "symbol": "getRejectionCooldownMs"
            }
          ],
          "entryAccessorSymbol": "getRejectionCooldownMs",
          "accessorClosure": [],
          "acceptedValues": [
            "1",
            "30",
            "7"
          ],
          "fallback": "7",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "fallback-7d",
          "assignments": [
            {
              "key": "DISCOVERY_REJECTION_COOLDOWN_DAYS",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "DISCOVERY_REJECTION_COOLDOWN_DAYS",
              "value": "7"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Recent rejection penalties use seven days.",
          "caveats": []
        },
        {
          "id": "long-30d",
          "assignments": [
            {
              "key": "DISCOVERY_REJECTION_COOLDOWN_DAYS",
              "value": "30"
            }
          ],
          "resolvedValues": [
            {
              "key": "DISCOVERY_REJECTION_COOLDOWN_DAYS",
              "value": "30"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "discovery-rejection-cooldown.long-30d.discovery-rejection-cooldown-days",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "DISCOVERY_REJECTION_COOLDOWN_DAYS"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "consumerSymbol": "OpportunityGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "getRejectionCooldownMs"
                },
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "OpportunityGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts",
                "testName": "applies the configured rejection cooldown and ranks penalized candidates behind unpenalized candidates"
              }
            }
          ],
          "explanation": "The rejection penalty window extends to thirty days.",
          "caveats": []
        },
        {
          "id": "short-1d",
          "assignments": [
            {
              "key": "DISCOVERY_REJECTION_COOLDOWN_DAYS",
              "value": "1"
            }
          ],
          "resolvedValues": [
            {
              "key": "DISCOVERY_REJECTION_COOLDOWN_DAYS",
              "value": "1"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "discovery-rejection-cooldown.short-1d.discovery-rejection-cooldown-days",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "DISCOVERY_REJECTION_COOLDOWN_DAYS"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "consumerSymbol": "OpportunityGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "getRejectionCooldownMs"
                },
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "OpportunityGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts",
                "testName": "applies the configured rejection cooldown and ranks penalized candidates behind unpenalized candidates"
              }
            }
          ],
          "explanation": "The rejection penalty window shortens to one day.",
          "caveats": []
        }
      ]
    },
    {
      "id": "hyde-frame-constraints",
      "title": "HyDE frame constraints",
      "summary": "HyDE frame constraints compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "participant-context",
      "coverage": "definitive",
      "fallbackModeId": "legacy",
      "affectedChapterIds": [
        "explore",
        "primitives"
      ],
      "affectedStepIds": [
        "refresh-representations",
        "retrieve-candidates"
      ],
      "settings": [
        {
          "key": "HYDE_FRAME_CONSTRAINTS_ENABLED",
          "readSites": [
            {
              "path": "packages/protocol/src/shared/hyde/hyde.env.ts",
              "symbol": "getHydeGenerationMode"
            }
          ],
          "entryAccessorSymbol": "getHydeGenerationMode",
          "accessorClosure": [],
          "acceptedValues": [
            "false",
            "true"
          ],
          "fallback": "false",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "frame-v1",
          "assignments": [
            {
              "key": "HYDE_FRAME_CONSTRAINTS_ENABLED",
              "value": "true"
            }
          ],
          "resolvedValues": [
            {
              "key": "HYDE_FRAME_CONSTRAINTS_ENABLED",
              "value": "true"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "hyde-frame-constraints.frame-v1.hyde-frame-constraints-enabled",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.hyde-graph-factory",
              "settingKeys": [
                "HYDE_FRAME_CONSTRAINTS_ENABLED"
              ],
              "consumerPath": "packages/protocol/src/shared/hyde/hyde.graph.ts",
              "consumerSymbol": "HydeGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/shared/hyde/hyde.env.ts",
                  "symbol": "getHydeGenerationMode"
                },
                {
                  "path": "packages/protocol/src/shared/hyde/hyde.graph.ts",
                  "symbol": "HydeGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/shared/hyde/tests/hyde.frame.spec.ts",
                "testName": "enables frame-v1 only for the strict literal true"
              }
            }
          ],
          "explanation": "HyDE generation applies frame-v1 constraints.",
          "caveats": []
        },
        {
          "id": "legacy",
          "assignments": [
            {
              "key": "HYDE_FRAME_CONSTRAINTS_ENABLED",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "HYDE_FRAME_CONSTRAINTS_ENABLED",
              "value": "false"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "HyDE generation uses the legacy representation.",
          "caveats": []
        }
      ]
    },
    {
      "id": "introducer-discovery",
      "title": "Introducer discovery",
      "summary": "Introducer discovery compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "opportunities",
      "coverage": "definitive",
      "fallbackModeId": "off",
      "affectedChapterIds": [
        "discovery",
        "explore"
      ],
      "affectedStepIds": [
        "retrieve-candidates"
      ],
      "settings": [
        {
          "key": "INTRODUCER_DISCOVERY_ENABLED",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/application/opportunity.introducer-feature.ts",
              "symbol": "isIntroducerDiscoveryEnabled"
            }
          ],
          "entryAccessorSymbol": "isIntroducerDiscoveryEnabled",
          "accessorClosure": [],
          "acceptedValues": [
            "false",
            "true"
          ],
          "fallback": "false",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "off",
          "assignments": [
            {
              "key": "INTRODUCER_DISCOVERY_ENABLED",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "INTRODUCER_DISCOVERY_ENABLED",
              "value": "false"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Introducer discovery is ineligible.",
          "caveats": []
        },
        {
          "id": "on",
          "assignments": [
            {
              "key": "INTRODUCER_DISCOVERY_ENABLED",
              "value": "true"
            }
          ],
          "resolvedValues": [
            {
              "key": "INTRODUCER_DISCOVERY_ENABLED",
              "value": "true"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "introducer-discovery.on.introducer-discovery-enabled",
              "effect": "activated",
              "targetKind": "node",
              "targetId": "component.maintenance-graph-factory",
              "settingKeys": [
                "INTRODUCER_DISCOVERY_ENABLED"
              ],
              "consumerPath": "packages/protocol/src/maintenance/maintenance.graph.ts",
              "consumerSymbol": "MaintenanceGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.introducer-feature.ts",
                  "symbol": "isIntroducerDiscoveryEnabled"
                },
                {
                  "path": "packages/protocol/src/maintenance/maintenance.graph.ts",
                  "symbol": "MaintenanceGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/opportunity.introducer-feature.spec.ts",
                "testName": "enables only for true"
              }
            }
          ],
          "explanation": "Introducer discovery becomes eligible when its required protocol boundary is supplied.",
          "caveats": []
        }
      ]
    },
    {
      "id": "negotiation-consultation",
      "title": "Negotiation participant consultation",
      "summary": "Negotiation participant consultation compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "negotiation",
      "coverage": "definitive",
      "fallbackModeId": "off",
      "affectedChapterIds": [
        "consent",
        "explore"
      ],
      "affectedStepIds": [
        "negotiate-optional"
      ],
      "settings": [
        {
          "key": "NEGOTIATION_ASK_USER_ENABLED",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/domain/negotiation.protocol.ts",
              "symbol": "configuredAskUserEnabled"
            }
          ],
          "entryAccessorSymbol": "configuredAskUserEnabled",
          "accessorClosure": [],
          "acceptedValues": [
            "false",
            "true"
          ],
          "fallback": "false",
          "readTiming": "invocation"
        },
        {
          "key": "NEGOTIATION_ASK_USER_WINDOW_MS",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/domain/negotiation.protocol.ts",
              "symbol": "askUserAnswerWindowMs"
            }
          ],
          "entryAccessorSymbol": "askUserAnswerWindowMs",
          "accessorClosure": [],
          "acceptedValues": [
            "60000",
            "86400000"
          ],
          "fallback": "86400000",
          "readTiming": "invocation"
        },
        {
          "key": "NEGOTIATION_CONSULTATION_POLICY_MODE",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/domain/negotiation.consultation-policy.ts",
              "symbol": "negotiationConsultationPolicyMode"
            }
          ],
          "entryAccessorSymbol": "negotiationConsultationPolicyMode",
          "accessorClosure": [],
          "acceptedValues": [
            "off",
            "on",
            "shadow"
          ],
          "fallback": "off",
          "readTiming": "invocation"
        },
        {
          "key": "NEGOTIATION_PROTOCOL_VERSION",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/domain/negotiation.protocol.ts",
              "symbol": "configuredProtocolVersion"
            }
          ],
          "entryAccessorSymbol": "configuredProtocolVersion",
          "accessorClosure": [],
          "acceptedValues": [
            "v1",
            "v2"
          ],
          "fallback": "v1",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "off",
          "assignments": [
            {
              "key": "NEGOTIATION_ASK_USER_ENABLED",
              "value": null
            },
            {
              "key": "NEGOTIATION_ASK_USER_WINDOW_MS",
              "value": null
            },
            {
              "key": "NEGOTIATION_CONSULTATION_POLICY_MODE",
              "value": null
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_ASK_USER_ENABLED",
              "value": "false"
            },
            {
              "key": "NEGOTIATION_ASK_USER_WINDOW_MS",
              "value": "86400000"
            },
            {
              "key": "NEGOTIATION_CONSULTATION_POLICY_MODE",
              "value": "off"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v1"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Participant consultation is bypassed.",
          "caveats": []
        },
        {
          "id": "shadow",
          "assignments": [
            {
              "key": "NEGOTIATION_ASK_USER_ENABLED",
              "value": null
            },
            {
              "key": "NEGOTIATION_ASK_USER_WINDOW_MS",
              "value": null
            },
            {
              "key": "NEGOTIATION_CONSULTATION_POLICY_MODE",
              "value": "shadow"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_ASK_USER_ENABLED",
              "value": "false"
            },
            {
              "key": "NEGOTIATION_ASK_USER_WINDOW_MS",
              "value": "86400000"
            },
            {
              "key": "NEGOTIATION_CONSULTATION_POLICY_MODE",
              "value": "shadow"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v1"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-consultation.shadow.negotiation-consultation-policy-mode",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.negotiation-graph-factory",
              "settingKeys": [
                "NEGOTIATION_CONSULTATION_POLICY_MODE"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "consumerSymbol": "NegotiationGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/domain/negotiation.consultation-policy.ts",
                  "symbol": "negotiationConsultationPolicyMode"
                },
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
                  "symbol": "NegotiationGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.ask-user.spec.ts",
                "testName": "policy on excludes a pre-screened path before consultation effects"
              }
            }
          ],
          "explanation": "Consultation eligibility is observed without pausing negotiation.",
          "caveats": []
        },
        {
          "id": "v2-on",
          "assignments": [
            {
              "key": "NEGOTIATION_ASK_USER_ENABLED",
              "value": "true"
            },
            {
              "key": "NEGOTIATION_ASK_USER_WINDOW_MS",
              "value": null
            },
            {
              "key": "NEGOTIATION_CONSULTATION_POLICY_MODE",
              "value": "on"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_ASK_USER_ENABLED",
              "value": "true"
            },
            {
              "key": "NEGOTIATION_ASK_USER_WINDOW_MS",
              "value": "86400000"
            },
            {
              "key": "NEGOTIATION_CONSULTATION_POLICY_MODE",
              "value": "on"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            }
          ],
          "prerequisites": [
            {
              "kind": "setting",
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            }
          ],
          "deltas": [
            {
              "id": "negotiation-consultation.v2-on.negotiation-consultation-policy-mode",
              "effect": "activated",
              "targetKind": "node",
              "targetId": "component.negotiation-graph-factory",
              "settingKeys": [
                "NEGOTIATION_CONSULTATION_POLICY_MODE"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "consumerSymbol": "NegotiationGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/domain/negotiation.consultation-policy.ts",
                  "symbol": "negotiationConsultationPolicyMode"
                },
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
                  "symbol": "NegotiationGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.ask-user.spec.ts",
                "testName": "policy on excludes a pre-screened path before consultation effects"
              }
            }
          ],
          "explanation": "Eligible v2 negotiations may pause for participant input.",
          "caveats": []
        },
        {
          "id": "v2-short-window",
          "assignments": [
            {
              "key": "NEGOTIATION_ASK_USER_ENABLED",
              "value": "true"
            },
            {
              "key": "NEGOTIATION_ASK_USER_WINDOW_MS",
              "value": "60000"
            },
            {
              "key": "NEGOTIATION_CONSULTATION_POLICY_MODE",
              "value": "on"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_ASK_USER_ENABLED",
              "value": "true"
            },
            {
              "key": "NEGOTIATION_ASK_USER_WINDOW_MS",
              "value": "60000"
            },
            {
              "key": "NEGOTIATION_CONSULTATION_POLICY_MODE",
              "value": "on"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            }
          ],
          "prerequisites": [
            {
              "kind": "setting",
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            }
          ],
          "deltas": [
            {
              "id": "negotiation-consultation.v2-short-window.negotiation-consultation-policy-mode",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.negotiation-graph-factory",
              "settingKeys": [
                "NEGOTIATION_CONSULTATION_POLICY_MODE"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "consumerSymbol": "NegotiationGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/domain/negotiation.consultation-policy.ts",
                  "symbol": "negotiationConsultationPolicyMode"
                },
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
                  "symbol": "NegotiationGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.ask-user.spec.ts",
                "testName": "policy on excludes a pre-screened path before consultation effects"
              }
            }
          ],
          "explanation": "The consultation pause expires after one minute.",
          "caveats": []
        }
      ]
    },
    {
      "id": "negotiation-context",
      "title": "Negotiation context breadth",
      "summary": "Negotiation context breadth compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "negotiation",
      "coverage": "definitive",
      "fallbackModeId": "include-active",
      "affectedChapterIds": [
        "consent",
        "explore"
      ],
      "affectedStepIds": [
        "negotiate-optional"
      ],
      "settings": [
        {
          "key": "NEGOTIATION_INCLUDE_OTHER_INTENTS",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/application/opportunity.existing-negotiation.ts",
              "symbol": "negotiationIncludesOtherIntents"
            }
          ],
          "entryAccessorSymbol": "negotiationIncludesOtherIntents",
          "accessorClosure": [],
          "acceptedValues": [
            "false",
            "true"
          ],
          "fallback": "true",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "exact-only",
          "assignments": [
            {
              "key": "NEGOTIATION_INCLUDE_OTHER_INTENTS",
              "value": "false"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_INCLUDE_OTHER_INTENTS",
              "value": "false"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-context.exact-only.negotiation-include-other-intents",
              "effect": "bypassed",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "NEGOTIATION_INCLUDE_OTHER_INTENTS"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.existing-negotiation.ts",
              "consumerSymbol": "negotiateExistingOpportunity",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.existing-negotiation.ts",
                  "symbol": "negotiationIncludesOtherIntents"
                },
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.existing-negotiation.ts",
                  "symbol": "negotiateExistingOpportunity"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/opportunity.existing-negotiation.spec.ts",
                "testName": "false flag isolates both sides on an exact continuation and skips unrelated active-intent reads"
              }
            }
          ],
          "explanation": "Negotiation context is limited to the triggering Signal.",
          "caveats": []
        },
        {
          "id": "include-active",
          "assignments": [
            {
              "key": "NEGOTIATION_INCLUDE_OTHER_INTENTS",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_INCLUDE_OTHER_INTENTS",
              "value": "true"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Negotiation context may include bounded active Signals.",
          "caveats": []
        }
      ]
    },
    {
      "id": "negotiation-deadlock",
      "title": "Negotiation deadlock shift",
      "summary": "Negotiation deadlock shift compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "negotiation",
      "coverage": "definitive",
      "fallbackModeId": "off",
      "affectedChapterIds": [
        "consent",
        "explore"
      ],
      "affectedStepIds": [
        "negotiate-optional"
      ],
      "settings": [
        {
          "key": "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/domain/negotiation.deadlock.ts",
              "symbol": "configuredDeadlockShiftEnabled"
            }
          ],
          "entryAccessorSymbol": "configuredDeadlockShiftEnabled",
          "accessorClosure": [],
          "acceptedValues": [
            "false",
            "true"
          ],
          "fallback": "false",
          "readTiming": "invocation"
        },
        {
          "key": "NEGOTIATION_DEADLOCK_THRESHOLD",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/domain/negotiation.deadlock.ts",
              "symbol": "configuredDeadlockThreshold"
            }
          ],
          "entryAccessorSymbol": "configuredDeadlockThreshold",
          "accessorClosure": [],
          "acceptedValues": [
            "2",
            "4"
          ],
          "fallback": "4",
          "readTiming": "invocation"
        },
        {
          "key": "NEGOTIATION_PROTOCOL_VERSION",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/domain/negotiation.protocol.ts",
              "symbol": "configuredProtocolVersion"
            }
          ],
          "entryAccessorSymbol": "configuredProtocolVersion",
          "accessorClosure": [],
          "acceptedValues": [
            "v1",
            "v2"
          ],
          "fallback": "v1",
          "readTiming": "invocation"
        },
        {
          "key": "NEGOTIATOR_STANCE",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/domain/negotiation.stance.contracts.ts",
              "symbol": "configuredNegotiatorStance"
            }
          ],
          "entryAccessorSymbol": "configuredNegotiatorStance",
          "accessorClosure": [],
          "acceptedValues": [
            "advocate",
            "evaluator",
            "skeptic"
          ],
          "fallback": "advocate",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "off",
          "assignments": [
            {
              "key": "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
              "value": null
            },
            {
              "key": "NEGOTIATION_DEADLOCK_THRESHOLD",
              "value": null
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": null
            },
            {
              "key": "NEGOTIATOR_STANCE",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
              "value": "false"
            },
            {
              "key": "NEGOTIATION_DEADLOCK_THRESHOLD",
              "value": "4"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v1"
            },
            {
              "key": "NEGOTIATOR_STANCE",
              "value": "advocate"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Deadlock bargaining shifts are bypassed.",
          "caveats": []
        },
        {
          "id": "v2-fast-2",
          "assignments": [
            {
              "key": "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
              "value": "true"
            },
            {
              "key": "NEGOTIATION_DEADLOCK_THRESHOLD",
              "value": "2"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            },
            {
              "key": "NEGOTIATOR_STANCE",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
              "value": "true"
            },
            {
              "key": "NEGOTIATION_DEADLOCK_THRESHOLD",
              "value": "2"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            },
            {
              "key": "NEGOTIATOR_STANCE",
              "value": "advocate"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-deadlock.v2-fast-2.negotiation-deadlock-shift-enabled",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.negotiation-graph-factory",
              "settingKeys": [
                "NEGOTIATION_DEADLOCK_SHIFT_ENABLED"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "consumerSymbol": "NegotiationGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/domain/negotiation.deadlock.ts",
                  "symbol": "configuredDeadlockShiftEnabled"
                },
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
                  "symbol": "NegotiationGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.deadlock-shift.spec.ts",
                "testName": "flag ON: bargaining stance from the threshold turn, record persisted once, trace event once"
              }
            }
          ],
          "explanation": "A v2 bargaining shift becomes eligible after two stagnant turns.",
          "caveats": []
        },
        {
          "id": "v2-skeptic",
          "assignments": [
            {
              "key": "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
              "value": "true"
            },
            {
              "key": "NEGOTIATION_DEADLOCK_THRESHOLD",
              "value": "4"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            },
            {
              "key": "NEGOTIATOR_STANCE",
              "value": "skeptic"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
              "value": "true"
            },
            {
              "key": "NEGOTIATION_DEADLOCK_THRESHOLD",
              "value": "4"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            },
            {
              "key": "NEGOTIATOR_STANCE",
              "value": "skeptic"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-deadlock.v2-skeptic.negotiation-deadlock-shift-enabled",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.negotiation-graph-factory",
              "settingKeys": [
                "NEGOTIATION_DEADLOCK_SHIFT_ENABLED"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "consumerSymbol": "NegotiationGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/domain/negotiation.deadlock.ts",
                  "symbol": "configuredDeadlockShiftEnabled"
                },
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
                  "symbol": "NegotiationGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.deadlock-shift.spec.ts",
                "testName": "flag ON: bargaining stance from the threshold turn, record persisted once, trace event once"
              }
            }
          ],
          "explanation": "Skeptic stance can resolve persistent deadlock as stalemate.",
          "caveats": []
        },
        {
          "id": "v2-threshold-4",
          "assignments": [
            {
              "key": "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
              "value": "true"
            },
            {
              "key": "NEGOTIATION_DEADLOCK_THRESHOLD",
              "value": "4"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            },
            {
              "key": "NEGOTIATOR_STANCE",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
              "value": "true"
            },
            {
              "key": "NEGOTIATION_DEADLOCK_THRESHOLD",
              "value": "4"
            },
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            },
            {
              "key": "NEGOTIATOR_STANCE",
              "value": "advocate"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-deadlock.v2-threshold-4.negotiation-deadlock-shift-enabled",
              "effect": "activated",
              "targetKind": "node",
              "targetId": "component.negotiation-graph-factory",
              "settingKeys": [
                "NEGOTIATION_DEADLOCK_SHIFT_ENABLED"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "consumerSymbol": "NegotiationGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/domain/negotiation.deadlock.ts",
                  "symbol": "configuredDeadlockShiftEnabled"
                },
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
                  "symbol": "NegotiationGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.deadlock-shift.spec.ts",
                "testName": "flag ON: bargaining stance from the threshold turn, record persisted once, trace event once"
              }
            }
          ],
          "explanation": "A v2 bargaining shift becomes eligible after four stagnant turns.",
          "caveats": []
        }
      ]
    },
    {
      "id": "negotiation-evidence-contract",
      "title": "Negotiation-evidence questions contract",
      "summary": "Negotiation-evidence questions contract compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "opportunities",
      "coverage": "unresolved",
      "fallbackModeId": "off",
      "affectedChapterIds": [
        "discovery",
        "explore"
      ],
      "affectedStepIds": [
        "evaluate-fit"
      ],
      "settings": [
        {
          "key": "NEGOTIATION_EVIDENCE_QUESTIONS_MODE",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/negotiation-evidence/negotiation-evidence.env.ts",
              "symbol": "negotiationEvidenceQuestionsMode"
            }
          ],
          "entryAccessorSymbol": "negotiationEvidenceQuestionsMode",
          "accessorClosure": [],
          "acceptedValues": [
            "off",
            "on",
            "shadow"
          ],
          "fallback": "off",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "off",
          "assignments": [
            {
              "key": "NEGOTIATION_EVIDENCE_QUESTIONS_MODE",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_EVIDENCE_QUESTIONS_MODE",
              "value": "off"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Negotiation-evidence question mode resolves off.",
          "caveats": []
        },
        {
          "id": "on-alias",
          "assignments": [
            {
              "key": "NEGOTIATION_EVIDENCE_QUESTIONS_MODE",
              "value": "on"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_EVIDENCE_QUESTIONS_MODE",
              "value": "on"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-evidence-contract.on-alias",
              "effect": "unresolved",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "NEGOTIATION_EVIDENCE_QUESTIONS_MODE"
              ],
              "noDirectProtocolConsumer": true
            }
          ],
          "explanation": "Current package handling treats on as the same shadow-pipeline activation contract.",
          "caveats": []
        },
        {
          "id": "shadow",
          "assignments": [
            {
              "key": "NEGOTIATION_EVIDENCE_QUESTIONS_MODE",
              "value": "shadow"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_EVIDENCE_QUESTIONS_MODE",
              "value": "shadow"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-evidence-contract.shadow",
              "effect": "unresolved",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "NEGOTIATION_EVIDENCE_QUESTIONS_MODE"
              ],
              "noDirectProtocolConsumer": true
            }
          ],
          "explanation": "Shadow mode resolves, but no direct package activation consumer is established.",
          "caveats": []
        }
      ]
    },
    {
      "id": "negotiation-protocol",
      "title": "Negotiation protocol version",
      "summary": "Negotiation protocol version compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "negotiation",
      "coverage": "definitive",
      "fallbackModeId": "v1",
      "affectedChapterIds": [
        "consent",
        "explore"
      ],
      "affectedStepIds": [
        "negotiate-optional"
      ],
      "settings": [
        {
          "key": "NEGOTIATION_PROTOCOL_VERSION",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/domain/negotiation.protocol.ts",
              "symbol": "configuredProtocolVersion"
            }
          ],
          "entryAccessorSymbol": "configuredProtocolVersion",
          "accessorClosure": [],
          "acceptedValues": [
            "v1",
            "v2"
          ],
          "fallback": "v1",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "v1",
          "assignments": [
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v1"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Fresh negotiations use the v1 action contract.",
          "caveats": []
        },
        {
          "id": "v2",
          "assignments": [
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_PROTOCOL_VERSION",
              "value": "v2"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-protocol.v2.negotiation-protocol-version",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.negotiation-graph-factory",
              "settingKeys": [
                "NEGOTIATION_PROTOCOL_VERSION"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "consumerSymbol": "NegotiationGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/domain/negotiation.protocol.ts",
                  "symbol": "configuredProtocolVersion"
                },
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
                  "symbol": "NegotiationGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.protocol.spec.ts",
                "testName": "configuredProtocolVersion: env switch, defaults v1"
              }
            }
          ],
          "explanation": "Fresh negotiations stamp the v2 seat-aware action contract.",
          "caveats": [
            "In-flight tasks remain pinned to their stored protocol version."
          ]
        }
      ]
    },
    {
      "id": "negotiation-screen",
      "title": "Negotiation outreach screen",
      "summary": "Negotiation outreach screen compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "negotiation",
      "coverage": "definitive",
      "fallbackModeId": "off",
      "affectedChapterIds": [
        "consent",
        "explore"
      ],
      "affectedStepIds": [
        "negotiate-optional"
      ],
      "settings": [
        {
          "key": "NEGOTIATION_SCREEN_MODE",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/domain/negotiation.screen.contracts.ts",
              "symbol": "configuredScreenMode"
            }
          ],
          "entryAccessorSymbol": "configuredScreenMode",
          "accessorClosure": [],
          "acceptedValues": [
            "enforce",
            "off",
            "shadow"
          ],
          "fallback": "off",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "enforce",
          "assignments": [
            {
              "key": "NEGOTIATION_SCREEN_MODE",
              "value": "enforce"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_SCREEN_MODE",
              "value": "enforce"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-screen.enforce.negotiation-screen-mode",
              "effect": "activated",
              "targetKind": "node",
              "targetId": "component.negotiation-graph-factory",
              "settingKeys": [
                "NEGOTIATION_SCREEN_MODE"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "consumerSymbol": "NegotiationGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/domain/negotiation.screen.contracts.ts",
                  "symbol": "configuredScreenMode"
                },
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
                  "symbol": "NegotiationGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.screen-routing.spec.ts",
                "testName": "enforce (P2.2): a `pass` blocks before the first turn — screened_out, zero messages, opportunity rejected"
              }
            }
          ],
          "explanation": "A pass decision is required before outreach.",
          "caveats": []
        },
        {
          "id": "off",
          "assignments": [
            {
              "key": "NEGOTIATION_SCREEN_MODE",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_SCREEN_MODE",
              "value": "off"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "The outreach screen is bypassed.",
          "caveats": []
        },
        {
          "id": "shadow",
          "assignments": [
            {
              "key": "NEGOTIATION_SCREEN_MODE",
              "value": "shadow"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_SCREEN_MODE",
              "value": "shadow"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-screen.shadow.negotiation-screen-mode",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.negotiation-graph-factory",
              "settingKeys": [
                "NEGOTIATION_SCREEN_MODE"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "consumerSymbol": "NegotiationGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/domain/negotiation.screen.contracts.ts",
                  "symbol": "configuredScreenMode"
                },
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
                  "symbol": "NegotiationGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.screen-routing.spec.ts",
                "testName": "enforce (P2.2): a `pass` blocks before the first turn — screened_out, zero messages, opportunity rejected"
              }
            }
          ],
          "explanation": "Screen decisions are recorded without blocking outreach.",
          "caveats": []
        }
      ]
    },
    {
      "id": "negotiation-stance",
      "title": "Negotiator stance",
      "summary": "Negotiator stance compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "negotiation",
      "coverage": "definitive",
      "fallbackModeId": "advocate",
      "affectedChapterIds": [
        "consent",
        "explore"
      ],
      "affectedStepIds": [
        "negotiate-optional"
      ],
      "settings": [
        {
          "key": "NEGOTIATOR_STANCE",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/domain/negotiation.stance.contracts.ts",
              "symbol": "configuredNegotiatorStance"
            }
          ],
          "entryAccessorSymbol": "configuredNegotiatorStance",
          "accessorClosure": [],
          "acceptedValues": [
            "advocate",
            "evaluator",
            "skeptic"
          ],
          "fallback": "advocate",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "advocate",
          "assignments": [
            {
              "key": "NEGOTIATOR_STANCE",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATOR_STANCE",
              "value": "advocate"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "The negotiator advocates for query fit.",
          "caveats": []
        },
        {
          "id": "evaluator",
          "assignments": [
            {
              "key": "NEGOTIATOR_STANCE",
              "value": "evaluator"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATOR_STANCE",
              "value": "evaluator"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-stance.evaluator.negotiator-stance",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.index-negotiator",
              "settingKeys": [
                "NEGOTIATOR_STANCE"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.agent.ts",
              "consumerSymbol": "IndexNegotiator",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/domain/negotiation.stance.contracts.ts",
                  "symbol": "configuredNegotiatorStance"
                },
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.agent.ts",
                  "symbol": "IndexNegotiator"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.stance.spec.ts",
                "testName": "resolves every declared stance verbatim"
              }
            }
          ],
          "explanation": "The negotiator emphasizes bilateral value evaluation.",
          "caveats": []
        },
        {
          "id": "skeptic",
          "assignments": [
            {
              "key": "NEGOTIATOR_STANCE",
              "value": "skeptic"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATOR_STANCE",
              "value": "skeptic"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-stance.skeptic.negotiator-stance",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.index-negotiator",
              "settingKeys": [
                "NEGOTIATOR_STANCE"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.agent.ts",
              "consumerSymbol": "IndexNegotiator",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/domain/negotiation.stance.contracts.ts",
                  "symbol": "configuredNegotiatorStance"
                },
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.agent.ts",
                  "symbol": "IndexNegotiator"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.stance.spec.ts",
                "testName": "resolves every declared stance verbatim"
              }
            }
          ],
          "explanation": "The negotiator requires stronger evidence and recognizes stalemate.",
          "caveats": []
        }
      ]
    },
    {
      "id": "negotiation-turn-caps",
      "title": "Negotiation turn caps",
      "summary": "Negotiation turn caps compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "negotiation",
      "coverage": "definitive",
      "fallbackModeId": "fallback-4-6",
      "affectedChapterIds": [
        "consent",
        "explore"
      ],
      "affectedStepIds": [
        "negotiate-optional"
      ],
      "settings": [
        {
          "key": "NEGOTIATION_MAX_TURNS_AMBIENT",
          "readSites": [
            {
              "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "symbol": "NegotiationGraphFactory"
            },
            {
              "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "symbol": "OpportunityGraphFactory"
            }
          ],
          "entryAccessorSymbol": "NegotiationGraphFactory",
          "accessorClosure": [],
          "acceptedValues": [
            "12",
            "3",
            "6"
          ],
          "fallback": "6",
          "readTiming": "invocation"
        },
        {
          "key": "NEGOTIATION_MAX_TURNS_CHAT",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "symbol": "OpportunityGraphFactory"
            }
          ],
          "entryAccessorSymbol": "OpportunityGraphFactory",
          "accessorClosure": [],
          "acceptedValues": [
            "2",
            "4",
            "8"
          ],
          "fallback": "4",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "extended-8-12",
          "assignments": [
            {
              "key": "NEGOTIATION_MAX_TURNS_AMBIENT",
              "value": "12"
            },
            {
              "key": "NEGOTIATION_MAX_TURNS_CHAT",
              "value": "8"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_MAX_TURNS_AMBIENT",
              "value": "12"
            },
            {
              "key": "NEGOTIATION_MAX_TURNS_CHAT",
              "value": "8"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-turn-caps.extended-8-12.negotiation-max-turns-ambient",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.negotiation-graph-factory",
              "settingKeys": [
                "NEGOTIATION_MAX_TURNS_AMBIENT"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "consumerSymbol": "NegotiationGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
                  "symbol": "NegotiationGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts",
                "testName": "emits outcome='turn_cap' when maxTurns is reached without accept/reject"
              }
            },
            {
              "id": "negotiation-turn-caps.extended-8-12.negotiation-max-turns-chat",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "NEGOTIATION_MAX_TURNS_CHAT"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "consumerSymbol": "OpportunityGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "OpportunityGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts",
                "testName": "emits outcome='turn_cap' when maxTurns is reached without accept/reject"
              }
            }
          ],
          "explanation": "Negotiations allow more turns before a cap outcome.",
          "caveats": []
        },
        {
          "id": "fallback-4-6",
          "assignments": [
            {
              "key": "NEGOTIATION_MAX_TURNS_AMBIENT",
              "value": null
            },
            {
              "key": "NEGOTIATION_MAX_TURNS_CHAT",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_MAX_TURNS_AMBIENT",
              "value": "6"
            },
            {
              "key": "NEGOTIATION_MAX_TURNS_CHAT",
              "value": "4"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Chat and ambient negotiation use four and six turns.",
          "caveats": []
        },
        {
          "id": "short-2-3",
          "assignments": [
            {
              "key": "NEGOTIATION_MAX_TURNS_AMBIENT",
              "value": "3"
            },
            {
              "key": "NEGOTIATION_MAX_TURNS_CHAT",
              "value": "2"
            }
          ],
          "resolvedValues": [
            {
              "key": "NEGOTIATION_MAX_TURNS_AMBIENT",
              "value": "3"
            },
            {
              "key": "NEGOTIATION_MAX_TURNS_CHAT",
              "value": "2"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "negotiation-turn-caps.short-2-3.negotiation-max-turns-ambient",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.negotiation-graph-factory",
              "settingKeys": [
                "NEGOTIATION_MAX_TURNS_AMBIENT"
              ],
              "consumerPath": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
              "consumerSymbol": "NegotiationGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/negotiation/application/negotiation.graph.ts",
                  "symbol": "NegotiationGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts",
                "testName": "emits outcome='turn_cap' when maxTurns is reached without accept/reject"
              }
            },
            {
              "id": "negotiation-turn-caps.short-2-3.negotiation-max-turns-chat",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "NEGOTIATION_MAX_TURNS_CHAT"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
              "consumerSymbol": "OpportunityGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.graph.ts",
                  "symbol": "OpportunityGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/negotiation/tests/negotiation.graph.spec.ts",
                "testName": "emits outcome='turn_cap' when maxTurns is reached without accept/reject"
              }
            }
          ],
          "explanation": "Negotiations reach their turn cap sooner.",
          "caveats": []
        }
      ]
    },
    {
      "id": "outcome-questions-contract",
      "title": "Outcome questions contract",
      "summary": "Outcome questions contract compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "opportunities",
      "coverage": "unresolved",
      "fallbackModeId": "off",
      "affectedChapterIds": [
        "discovery",
        "explore"
      ],
      "affectedStepIds": [
        "evaluate-fit"
      ],
      "settings": [
        {
          "key": "OUTCOME_QUESTIONS_MODE",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/outcome/outcome.env.ts",
              "symbol": "outcomeQuestionsMode"
            }
          ],
          "entryAccessorSymbol": "outcomeQuestionsMode",
          "accessorClosure": [
            {
              "path": "packages/protocol/src/opportunity/outcome/outcome.env.ts",
              "symbol": "isOutcomeQuestionsActivated"
            }
          ],
          "acceptedValues": [
            "off",
            "on",
            "shadow"
          ],
          "fallback": "off",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "off",
          "assignments": [
            {
              "key": "OUTCOME_QUESTIONS_MODE",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "OUTCOME_QUESTIONS_MODE",
              "value": "off"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Outcome-question mode resolves off.",
          "caveats": []
        },
        {
          "id": "on-alias",
          "assignments": [
            {
              "key": "OUTCOME_QUESTIONS_MODE",
              "value": "on"
            }
          ],
          "resolvedValues": [
            {
              "key": "OUTCOME_QUESTIONS_MODE",
              "value": "on"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "outcome-questions-contract.on-alias",
              "effect": "unresolved",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "OUTCOME_QUESTIONS_MODE"
              ],
              "noDirectProtocolConsumer": true
            }
          ],
          "explanation": "Current package activation treats on as shadow-equivalent for capture and mining.",
          "caveats": []
        },
        {
          "id": "shadow",
          "assignments": [
            {
              "key": "OUTCOME_QUESTIONS_MODE",
              "value": "shadow"
            }
          ],
          "resolvedValues": [
            {
              "key": "OUTCOME_QUESTIONS_MODE",
              "value": "shadow"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "outcome-questions-contract.shadow",
              "effect": "unresolved",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "OUTCOME_QUESTIONS_MODE"
              ],
              "noDirectProtocolConsumer": true
            }
          ],
          "explanation": "The protocol accessor activates shadow capture; its invoking path remains unresolved here.",
          "caveats": []
        }
      ]
    },
    {
      "id": "pool-question-contract",
      "title": "Pool question activation contract",
      "summary": "Pool question activation contract compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "opportunities",
      "coverage": "unresolved",
      "fallbackModeId": "off",
      "affectedChapterIds": [
        "discovery",
        "explore"
      ],
      "affectedStepIds": [
        "evaluate-fit"
      ],
      "settings": [
        {
          "key": "POOL_QUESTIONS_MINING",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/discriminator/discriminator.env.ts",
              "symbol": "poolQuestionsMiningMode"
            }
          ],
          "entryAccessorSymbol": "poolQuestionsMiningMode",
          "accessorClosure": [],
          "acceptedValues": [
            "off",
            "shadow"
          ],
          "fallback": "off",
          "readTiming": "invocation"
        },
        {
          "key": "POOL_QUESTIONS_MODE",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/discriminator/discriminator.env.ts",
              "symbol": "poolQuestionsMode"
            }
          ],
          "entryAccessorSymbol": "poolQuestionsMode",
          "accessorClosure": [],
          "acceptedValues": [
            "off",
            "on"
          ],
          "fallback": "off",
          "readTiming": "invocation"
        },
        {
          "key": "POOL_QUESTIONS_PUSH",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/discriminator/discriminator.env.ts",
              "symbol": "poolQuestionsPushMode"
            }
          ],
          "entryAccessorSymbol": "poolQuestionsPushMode",
          "accessorClosure": [],
          "acceptedValues": [
            "off",
            "on"
          ],
          "fallback": "off",
          "readTiming": "invocation"
        },
        {
          "key": "POOL_QUESTIONS_STAMP_NEWBORN",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/discriminator/discriminator.env.ts",
              "symbol": "poolQuestionsStampNewborn"
            }
          ],
          "entryAccessorSymbol": "poolQuestionsStampNewborn",
          "accessorClosure": [],
          "acceptedValues": [
            "off",
            "on"
          ],
          "fallback": "off",
          "readTiming": "invocation"
        },
        {
          "key": "POOL_QUESTIONS_VISIT_TRIGGER",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/discriminator/discriminator.env.ts",
              "symbol": "poolQuestionsVisitTrigger"
            }
          ],
          "entryAccessorSymbol": "poolQuestionsVisitTrigger",
          "accessorClosure": [],
          "acceptedValues": [
            "off",
            "on"
          ],
          "fallback": "off",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "off",
          "assignments": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": "off"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Pool-question activation contracts resolve off.",
          "caveats": []
        },
        {
          "id": "on-newborn",
          "assignments": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": "off"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "pool-question-contract.on-newborn",
              "effect": "unresolved",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "POOL_QUESTIONS_MINING",
                "POOL_QUESTIONS_MODE",
                "POOL_QUESTIONS_PUSH",
                "POOL_QUESTIONS_STAMP_NEWBORN",
                "POOL_QUESTIONS_VISIT_TRIGGER"
              ],
              "noDirectProtocolConsumer": true
            }
          ],
          "explanation": "Newborn stamping is declared; direct package activation remains unresolved.",
          "caveats": []
        },
        {
          "id": "on-pull",
          "assignments": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": "off"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "pool-question-contract.on-pull",
              "effect": "unresolved",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "POOL_QUESTIONS_MINING",
                "POOL_QUESTIONS_MODE",
                "POOL_QUESTIONS_PUSH",
                "POOL_QUESTIONS_STAMP_NEWBORN",
                "POOL_QUESTIONS_VISIT_TRIGGER"
              ],
              "noDirectProtocolConsumer": true
            }
          ],
          "explanation": "Pull-mode question activation is declared; direct package activation remains unresolved.",
          "caveats": []
        },
        {
          "id": "on-push",
          "assignments": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": "off"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "pool-question-contract.on-push",
              "effect": "unresolved",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "POOL_QUESTIONS_MINING",
                "POOL_QUESTIONS_MODE",
                "POOL_QUESTIONS_PUSH",
                "POOL_QUESTIONS_STAMP_NEWBORN",
                "POOL_QUESTIONS_VISIT_TRIGGER"
              ],
              "noDirectProtocolConsumer": true
            }
          ],
          "explanation": "Push activation is declared; direct package activation remains unresolved.",
          "caveats": []
        },
        {
          "id": "on-visit",
          "assignments": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": "on"
            }
          ],
          "resolvedValues": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": "on"
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": "on"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "pool-question-contract.on-visit",
              "effect": "unresolved",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "POOL_QUESTIONS_MINING",
                "POOL_QUESTIONS_MODE",
                "POOL_QUESTIONS_PUSH",
                "POOL_QUESTIONS_STAMP_NEWBORN",
                "POOL_QUESTIONS_VISIT_TRIGGER"
              ],
              "noDirectProtocolConsumer": true
            }
          ],
          "explanation": "Visit-trigger activation is declared; direct package activation remains unresolved.",
          "caveats": []
        },
        {
          "id": "shadow-mining",
          "assignments": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": "shadow"
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": null
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "POOL_QUESTIONS_MINING",
              "value": "shadow"
            },
            {
              "key": "POOL_QUESTIONS_MODE",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_PUSH",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_STAMP_NEWBORN",
              "value": "off"
            },
            {
              "key": "POOL_QUESTIONS_VISIT_TRIGGER",
              "value": "off"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "pool-question-contract.shadow-mining",
              "effect": "unresolved",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "POOL_QUESTIONS_MINING",
                "POOL_QUESTIONS_MODE",
                "POOL_QUESTIONS_PUSH",
                "POOL_QUESTIONS_STAMP_NEWBORN",
                "POOL_QUESTIONS_VISIT_TRIGGER"
              ],
              "noDirectProtocolConsumer": true
            }
          ],
          "explanation": "Shadow mining is declared; direct package activation remains unresolved.",
          "caveats": []
        }
      ]
    },
    {
      "id": "pool-ranking",
      "title": "Pool-question Radar ranking",
      "summary": "Pool-question Radar ranking compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "opportunities",
      "coverage": "definitive",
      "fallbackModeId": "off",
      "affectedChapterIds": [
        "discovery",
        "explore"
      ],
      "affectedStepIds": [
        "retrieve-candidates"
      ],
      "settings": [
        {
          "key": "POOL_QUESTIONS_RANKING",
          "readSites": [
            {
              "path": "packages/protocol/src/opportunity/discriminator/discriminator.env.ts",
              "symbol": "poolQuestionsRanking"
            }
          ],
          "entryAccessorSymbol": "poolQuestionsRanking",
          "accessorClosure": [],
          "acceptedValues": [
            "off",
            "on"
          ],
          "fallback": "off",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "off",
          "assignments": [
            {
              "key": "POOL_QUESTIONS_RANKING",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "POOL_QUESTIONS_RANKING",
              "value": "off"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Radar confidence is not adjusted by answered discriminators.",
          "caveats": []
        },
        {
          "id": "on",
          "assignments": [
            {
              "key": "POOL_QUESTIONS_RANKING",
              "value": "on"
            }
          ],
          "resolvedValues": [
            {
              "key": "POOL_QUESTIONS_RANKING",
              "value": "on"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "pool-ranking.on.pool-questions-ranking",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.radar-graph-factory",
              "settingKeys": [
                "POOL_QUESTIONS_RANKING"
              ],
              "consumerPath": "packages/protocol/src/opportunity/radar/radar.graph.ts",
              "consumerSymbol": "RadarGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/opportunity/discriminator/discriminator.env.ts",
                  "symbol": "poolQuestionsRanking"
                },
                {
                  "path": "packages/protocol/src/opportunity/radar/radar.graph.ts",
                  "symbol": "getPoolRankingProvenance"
                },
                {
                  "path": "packages/protocol/src/opportunity/radar/radar.graph.ts",
                  "symbol": "RadarGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/radar.graph.status-filter.spec.ts",
                "testName": "lifecycle order is unchanged while ranking is off and adjusted when on"
              }
            }
          ],
          "explanation": "Answered pool discriminators adjust Radar confidence.",
          "caveats": []
        }
      ]
    },
    {
      "id": "premise-deduplication",
      "title": "Premise deduplication threshold",
      "summary": "Premise deduplication threshold compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "participant-context",
      "coverage": "definitive",
      "fallbackModeId": "fallback-0.93",
      "affectedChapterIds": [
        "explore",
        "primitives"
      ],
      "affectedStepIds": [
        "atomic-premises"
      ],
      "settings": [
        {
          "key": "PREMISE_DEDUP_SIMILARITY",
          "readSites": [
            {
              "path": "packages/protocol/src/premise/premise.graph.ts",
              "symbol": "DEDUP_SIMILARITY_THRESHOLD"
            }
          ],
          "entryAccessorSymbol": "DEDUP_SIMILARITY_THRESHOLD",
          "accessorClosure": [],
          "acceptedValues": [
            "0.85",
            "0.93",
            "0.98"
          ],
          "fallback": "0.93",
          "readTiming": "module-load"
        }
      ],
      "modes": [
        {
          "id": "broad-0.85",
          "assignments": [
            {
              "key": "PREMISE_DEDUP_SIMILARITY",
              "value": "0.85"
            }
          ],
          "resolvedValues": [
            {
              "key": "PREMISE_DEDUP_SIMILARITY",
              "value": "0.85"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "premise-deduplication.broad-0.85.premise-dedup-similarity",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.premise-graph-factory",
              "settingKeys": [
                "PREMISE_DEDUP_SIMILARITY"
              ],
              "consumerPath": "packages/protocol/src/premise/premise.graph.ts",
              "consumerSymbol": "PremiseGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/premise/premise.graph.ts",
                  "symbol": "DEDUP_SIMILARITY_THRESHOLD"
                },
                {
                  "path": "packages/protocol/src/premise/premise.graph.ts",
                  "symbol": "PremiseGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/premise/tests/premise.graph.spec.ts",
                "testName": "skips persisting a near-duplicate premise on create"
              }
            }
          ],
          "explanation": "More paraphrases are treated as duplicates.",
          "caveats": []
        },
        {
          "id": "fallback-0.93",
          "assignments": [
            {
              "key": "PREMISE_DEDUP_SIMILARITY",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "PREMISE_DEDUP_SIMILARITY",
              "value": "0.93"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "Near-duplicate premises collapse at 0.93 similarity.",
          "caveats": []
        },
        {
          "id": "strict-0.98",
          "assignments": [
            {
              "key": "PREMISE_DEDUP_SIMILARITY",
              "value": "0.98"
            }
          ],
          "resolvedValues": [
            {
              "key": "PREMISE_DEDUP_SIMILARITY",
              "value": "0.98"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "premise-deduplication.strict-0.98.premise-dedup-similarity",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.premise-graph-factory",
              "settingKeys": [
                "PREMISE_DEDUP_SIMILARITY"
              ],
              "consumerPath": "packages/protocol/src/premise/premise.graph.ts",
              "consumerSymbol": "PremiseGraphFactory",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/premise/premise.graph.ts",
                  "symbol": "DEDUP_SIMILARITY_THRESHOLD"
                },
                {
                  "path": "packages/protocol/src/premise/premise.graph.ts",
                  "symbol": "PremiseGraphFactory"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/premise/tests/premise.graph.spec.ts",
                "testName": "skips persisting a near-duplicate premise on create"
              }
            }
          ],
          "explanation": "Only very close paraphrases are treated as duplicates.",
          "caveats": []
        }
      ]
    },
    {
      "id": "questioner-discovery-contract",
      "title": "Questioner discovery contract",
      "summary": "Questioner discovery contract compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "questions",
      "coverage": "unresolved",
      "fallbackModeId": "off",
      "affectedChapterIds": [
        "discovery",
        "explore"
      ],
      "affectedStepIds": [
        "evaluate-fit"
      ],
      "settings": [
        {
          "key": "QUESTIONER_DISCOVERY_ENABLED",
          "readSites": [
            {
              "path": "packages/protocol/src/questions/application/question.env.ts",
              "symbol": "isDiscoveryQuestionsEnabled"
            }
          ],
          "entryAccessorSymbol": "isDiscoveryQuestionsEnabled",
          "accessorClosure": [],
          "acceptedValues": [
            "false",
            "true"
          ],
          "fallback": "false",
          "readTiming": "invocation"
        },
        {
          "key": "QUESTIONER_DISCOVERY_INPUT_MODE",
          "readSites": [
            {
              "path": "packages/protocol/src/questions/application/question.env.ts",
              "symbol": "discoveryQuestionsInputMode"
            }
          ],
          "entryAccessorSymbol": "discoveryQuestionsInputMode",
          "accessorClosure": [],
          "acceptedValues": [
            "insights",
            "transcripts"
          ],
          "fallback": "transcripts",
          "readTiming": "invocation"
        },
        {
          "key": "QUESTIONER_ENABLED",
          "readSites": [
            {
              "path": "packages/protocol/src/questions/application/question.env.ts",
              "symbol": "isQuestionerEnabled"
            }
          ],
          "entryAccessorSymbol": "isQuestionerEnabled",
          "accessorClosure": [],
          "acceptedValues": [
            "false",
            "true"
          ],
          "fallback": "false",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "insights-unresolved",
          "assignments": [
            {
              "key": "QUESTIONER_DISCOVERY_ENABLED",
              "value": "true"
            },
            {
              "key": "QUESTIONER_DISCOVERY_INPUT_MODE",
              "value": "insights"
            },
            {
              "key": "QUESTIONER_ENABLED",
              "value": "true"
            }
          ],
          "resolvedValues": [
            {
              "key": "QUESTIONER_DISCOVERY_ENABLED",
              "value": "true"
            },
            {
              "key": "QUESTIONER_DISCOVERY_INPUT_MODE",
              "value": "insights"
            },
            {
              "key": "QUESTIONER_ENABLED",
              "value": "true"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "questioner-discovery-contract.insights-unresolved",
              "effect": "unresolved",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "QUESTIONER_DISCOVERY_ENABLED",
                "QUESTIONER_DISCOVERY_INPUT_MODE"
              ],
              "noDirectProtocolConsumer": true
            }
          ],
          "explanation": "The accessor resolves insight input, but no direct package behavior consumer is established.",
          "caveats": []
        },
        {
          "id": "off",
          "assignments": [
            {
              "key": "QUESTIONER_DISCOVERY_ENABLED",
              "value": null
            },
            {
              "key": "QUESTIONER_DISCOVERY_INPUT_MODE",
              "value": null
            },
            {
              "key": "QUESTIONER_ENABLED",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "QUESTIONER_DISCOVERY_ENABLED",
              "value": "false"
            },
            {
              "key": "QUESTIONER_DISCOVERY_INPUT_MODE",
              "value": "transcripts"
            },
            {
              "key": "QUESTIONER_ENABLED",
              "value": "false"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "The discovery-question contract is inactive.",
          "caveats": []
        },
        {
          "id": "transcripts-unresolved",
          "assignments": [
            {
              "key": "QUESTIONER_DISCOVERY_ENABLED",
              "value": "true"
            },
            {
              "key": "QUESTIONER_DISCOVERY_INPUT_MODE",
              "value": "transcripts"
            },
            {
              "key": "QUESTIONER_ENABLED",
              "value": "true"
            }
          ],
          "resolvedValues": [
            {
              "key": "QUESTIONER_DISCOVERY_ENABLED",
              "value": "true"
            },
            {
              "key": "QUESTIONER_DISCOVERY_INPUT_MODE",
              "value": "transcripts"
            },
            {
              "key": "QUESTIONER_ENABLED",
              "value": "true"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "questioner-discovery-contract.transcripts-unresolved",
              "effect": "unresolved",
              "targetKind": "node",
              "targetId": "component.opportunity-graph-factory",
              "settingKeys": [
                "QUESTIONER_DISCOVERY_ENABLED",
                "QUESTIONER_DISCOVERY_INPUT_MODE"
              ],
              "noDirectProtocolConsumer": true
            }
          ],
          "explanation": "The accessor resolves transcript input, but no direct package behavior consumer is established.",
          "caveats": []
        }
      ]
    },
    {
      "id": "questioner-uptake",
      "title": "Questioner uptake guard",
      "summary": "Questioner uptake guard compares reviewed package fallback behavior with named non-secret assignments.",
      "capability": "questions",
      "coverage": "definitive",
      "fallbackModeId": "off",
      "affectedChapterIds": [
        "discovery",
        "explore"
      ],
      "affectedStepIds": [
        "accept-or-decline"
      ],
      "settings": [
        {
          "key": "QUESTIONER_ENABLED",
          "readSites": [
            {
              "path": "packages/protocol/src/questions/application/question.env.ts",
              "symbol": "isQuestionerEnabled"
            }
          ],
          "entryAccessorSymbol": "isQuestionerEnabled",
          "accessorClosure": [],
          "acceptedValues": [
            "false",
            "true"
          ],
          "fallback": "false",
          "readTiming": "invocation"
        },
        {
          "key": "QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD",
          "readSites": [
            {
              "path": "packages/protocol/src/questions/application/question.env.ts",
              "symbol": "uptakeAuthorityThreshold"
            }
          ],
          "entryAccessorSymbol": "uptakeAuthorityThreshold",
          "accessorClosure": [],
          "acceptedValues": [
            "70",
            "90"
          ],
          "fallback": "70",
          "readTiming": "invocation"
        },
        {
          "key": "QUESTIONER_UPTAKE_ENABLED",
          "readSites": [
            {
              "path": "packages/protocol/src/questions/application/question.env.ts",
              "symbol": "isUptakeGuardEnabled"
            }
          ],
          "entryAccessorSymbol": "isUptakeGuardEnabled",
          "accessorClosure": [
            {
              "path": "packages/protocol/src/questions/application/question.env.ts",
              "symbol": "isQuestionerEnabled"
            }
          ],
          "acceptedValues": [
            "false",
            "true"
          ],
          "fallback": "false",
          "readTiming": "invocation"
        }
      ],
      "modes": [
        {
          "id": "off",
          "assignments": [
            {
              "key": "QUESTIONER_ENABLED",
              "value": null
            },
            {
              "key": "QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD",
              "value": null
            },
            {
              "key": "QUESTIONER_UPTAKE_ENABLED",
              "value": null
            }
          ],
          "resolvedValues": [
            {
              "key": "QUESTIONER_ENABLED",
              "value": "false"
            },
            {
              "key": "QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD",
              "value": "70"
            },
            {
              "key": "QUESTIONER_UPTAKE_ENABLED",
              "value": "false"
            }
          ],
          "prerequisites": [],
          "deltas": [],
          "explanation": "The advisory uptake interlock is bypassed.",
          "caveats": []
        },
        {
          "id": "on-threshold-70",
          "assignments": [
            {
              "key": "QUESTIONER_ENABLED",
              "value": "true"
            },
            {
              "key": "QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD",
              "value": "70"
            },
            {
              "key": "QUESTIONER_UPTAKE_ENABLED",
              "value": "true"
            }
          ],
          "resolvedValues": [
            {
              "key": "QUESTIONER_ENABLED",
              "value": "true"
            },
            {
              "key": "QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD",
              "value": "70"
            },
            {
              "key": "QUESTIONER_UPTAKE_ENABLED",
              "value": "true"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "questioner-uptake.on-threshold-70.questioner-uptake-enabled",
              "effect": "activated",
              "targetKind": "node",
              "targetId": "component.opportunity-tools",
              "settingKeys": [
                "QUESTIONER_UPTAKE_ENABLED"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.tools.ts",
              "consumerSymbol": "createOpportunityTools",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/questions/application/question.env.ts",
                  "symbol": "isUptakeGuardEnabled"
                },
                {
                  "path": "packages/protocol/src/capabilities/questions.runtime.facade.ts",
                  "symbol": "isUptakeGuardEnabled"
                },
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.tools.ts",
                  "symbol": "createOpportunityTools"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/update-opportunity.spec.ts",
                "testName": "returns a structured advisory with public questions and no graph mutation"
              }
            }
          ],
          "explanation": "Pending uptake questions can interlock low-authority acceptance.",
          "caveats": []
        },
        {
          "id": "on-threshold-90",
          "assignments": [
            {
              "key": "QUESTIONER_ENABLED",
              "value": "true"
            },
            {
              "key": "QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD",
              "value": "90"
            },
            {
              "key": "QUESTIONER_UPTAKE_ENABLED",
              "value": "true"
            }
          ],
          "resolvedValues": [
            {
              "key": "QUESTIONER_ENABLED",
              "value": "true"
            },
            {
              "key": "QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD",
              "value": "90"
            },
            {
              "key": "QUESTIONER_UPTAKE_ENABLED",
              "value": "true"
            }
          ],
          "prerequisites": [],
          "deltas": [
            {
              "id": "questioner-uptake.on-threshold-90.questioner-uptake-authority-threshold",
              "effect": "unresolved",
              "targetKind": "step",
              "targetId": "accept-or-decline",
              "settingKeys": [
                "QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD"
              ],
              "noDirectProtocolConsumer": true
            },
            {
              "id": "questioner-uptake.on-threshold-90.questioner-uptake-enabled",
              "effect": "changed",
              "targetKind": "node",
              "targetId": "component.opportunity-tools",
              "settingKeys": [
                "QUESTIONER_UPTAKE_ENABLED"
              ],
              "consumerPath": "packages/protocol/src/opportunity/application/opportunity.tools.ts",
              "consumerSymbol": "createOpportunityTools",
              "referenceChain": [
                {
                  "path": "packages/protocol/src/questions/application/question.env.ts",
                  "symbol": "isUptakeGuardEnabled"
                },
                {
                  "path": "packages/protocol/src/capabilities/questions.runtime.facade.ts",
                  "symbol": "isUptakeGuardEnabled"
                },
                {
                  "path": "packages/protocol/src/opportunity/application/opportunity.tools.ts",
                  "symbol": "createOpportunityTools"
                }
              ],
              "behaviorTest": {
                "path": "packages/protocol/src/opportunity/tests/update-opportunity.spec.ts",
                "testName": "returns a structured advisory with public questions and no graph mutation"
              }
            }
          ],
          "explanation": "The uptake guard is active; the configured authority threshold is declared but has no direct protocol consumer.",
          "caveats": []
        }
      ]
    }
  ]
});
