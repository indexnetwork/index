(function installProtocolAtlasContent(root) {
  "use strict";

  function steps(records) {
    return records.map((record, index) => ({
      ...record,
      previous: index === 0 ? null : records[index - 1].id,
      next: index === records.length - 1 ? null : records[index + 1].id,
    }));
  }

  const trustedContextSteps = steps([
    {
      id: "approved-material",
      title: "Begin with approved material",
      summary: "Only participant-approved, minimized material may become durable protocol context; contact-data minimization excludes unnecessary imported contact detail.",
      conceptIds: ["participant", "premise", "context"],
      nodeIds: ["component.enrichment-graph-factory", "component.premise-graph-factory"],
      invariantIds: ["participant-consent", "no-fabrication"],
      sourcePaths: ["packages/protocol/src/enrichment/enrichment.graph.ts", "packages/protocol/src/premises/premise.graph.ts"],
      notes: {
        protocol: "Approval is the trust boundary: supplied or inferred material is not durable context until the participant accepts it, and contact-data minimization keeps unrelated imported details out.",
        implementation: "The enrichment and premise graphs expose the package-level review and premise-processing behavior.",
      },
    },
    {
      id: "atomic-premises",
      title: "Represent claims as atomic premises",
      summary: "Approved material is split into small, attributable claims that can be revised or withdrawn independently.",
      conceptIds: ["participant", "premise"],
      nodeIds: ["component.premise-graph-factory", "component.premise-tools"],
      invariantIds: ["action-attribution", "no-fabrication"],
      sourcePaths: ["packages/protocol/src/premises/premise.graph.ts", "packages/protocol/src/premises/premise.tools.ts"],
      notes: {
        protocol: "A premise carries provenance and remains distinct from a synthesized context description.",
        implementation: "Premise graph and tool surfaces manipulate premise records without defining any host persistence architecture.",
      },
    },
    {
      id: "assign-and-embed",
      title: "Assign scope and request representations",
      summary: "Each premise is assigned to admitted communities and passed through the protocol's embedding port.",
      conceptIds: ["premise", "community", "membership", "effective-scope"],
      nodeIds: ["component.intent-network-graph-factory", "host-requirement.embedder"],
      invariantIds: ["scope-intersection", "host-boundary"],
      sourcePaths: ["packages/protocol/src/networks/application/indexer.graph.ts", "packages/protocol/src/shared/interfaces/embedder.interface.ts"],
      notes: {
        protocol: "Assignment is constrained by membership and permission; a representation does not broaden scope.",
        implementation: "The package declares the embedder operation and community indexer; vector infrastructure belongs to the host.",
      },
    },
    {
      id: "synthesize-context",
      title: "Synthesize participant context",
      summary: "Active premises are composed into a current participant context for a permitted scope.",
      conceptIds: ["participant", "premise", "context", "effective-scope"],
      nodeIds: ["component.user-context-generator", "host-requirement.user-database"],
      invariantIds: ["scope-intersection", "context-freshness", "no-fabrication", "host-boundary"],
      sourcePaths: ["packages/protocol/src/contexts/context.generator.ts", "packages/protocol/src/shared/interfaces/database.interface.ts"],
      notes: {
        protocol: "Synthesis may summarize approved premises but may not invent facts or combine material from outside effective scope.",
        implementation: "UserContextGenerator requests the package database port; storage details are deliberately not described here.",
      },
    },
    {
      id: "refresh-representations",
      title: "Refresh derived representations",
      summary: "When active premises change, derived context and retrieval representations must be refreshed before they are trusted.",
      conceptIds: ["premise", "context", "radar"],
      nodeIds: ["component.hyde-graph-factory", "component.maintenance-graph-factory", "host-requirement.hyde-cache"],
      invariantIds: ["context-freshness", "host-boundary"],
      sourcePaths: ["packages/protocol/src/discovery/hyde.graph.ts", "packages/protocol/src/maintenance/maintenance.graph.ts", "packages/protocol/src/shared/interfaces/cache.interface.ts"],
      notes: {
        protocol: "A stale derivative cannot be treated as current evidence about a participant.",
        implementation: "HyDE and maintenance graphs expose refresh behavior and cache requirements within the package.",
      },
    },
  ]);

  const expressSignalSteps = steps([
    {
      id: "participant-input",
      title: "Receive participant expression",
      summary: "A participant offers natural-language material that may express a desired future state.",
      conceptIds: ["participant", "signal"],
      nodeIds: ["component.chat-graph-factory", "component.intent-tools"],
      invariantIds: ["participant-consent", "action-attribution"],
      sourcePaths: ["packages/protocol/src/chat/chat.graph.ts", "packages/protocol/src/intents/application/intent.tools.ts"],
      notes: {
        protocol: "Input is evidence of an expression, not automatic permission to publish, match, or contact.",
        implementation: "Chat and signal tool surfaces receive the expression through protocol-owned capabilities.",
      },
    },
    {
      id: "infer-speech-act",
      title: "Infer the proposed speech act",
      summary: "The protocol proposes whether the expression is a Signal and extracts its intended direction and constraints.",
      conceptIds: ["signal", "premise", "context"],
      nodeIds: ["component.intent-graph-factory"],
      invariantIds: ["no-fabrication", "action-attribution"],
      sourcePaths: ["packages/protocol/src/intents/application/intent.graph.ts"],
      notes: {
        protocol: "Inference produces a proposal for participant review; uncertainty remains explicit.",
        implementation: "IntentGraphFactory composes the package's signal interpretation path.",
      },
    },
    {
      id: "verify-or-clarify",
      title: "Verify or ask for clarification",
      summary: "The proposed Signal is checked for semantic support; unsupported or ambiguous details require clarification.",
      conceptIds: ["participant", "signal", "premise"],
      nodeIds: ["component.semantic-verifier", "component.questioner-agent"],
      invariantIds: ["no-fabrication", "participant-consent"],
      sourcePaths: ["packages/protocol/src/intents/application/intent.verifier.ts", "packages/protocol/src/questions/application/question.agent.ts"],
      notes: {
        protocol: "Verification protects fidelity to the participant's words rather than optimizing for a match.",
        implementation: "The semantic verifier and questioner are structured package decisions, not normative primitives themselves.",
      },
    },
    {
      id: "reconcile",
      title: "Reconcile with active Signals",
      summary: "The verified proposal is compared with active Signals so it can be added, updated, or kept distinct without silently merging intent.",
      conceptIds: ["participant", "signal"],
      nodeIds: ["component.intent-graph-factory", "component.intent-tools"],
      invariantIds: ["participant-consent", "no-fabrication", "terminality"],
      sourcePaths: ["packages/protocol/src/intents/application/intent.graph.ts", "packages/protocol/src/intents/application/intent.tools.ts"],
      notes: {
        protocol: "Reconciliation preserves participant meaning and does not revive terminal lifecycle records by implication.",
        implementation: "The intent graph coordinates reconciliation through protocol signal operations.",
      },
    },
    {
      id: "assign-communities",
      title: "Assign admitted communities",
      summary: "The Signal is associated only with communities admitted by membership, permissions, and participant choice.",
      conceptIds: ["signal", "community", "membership", "effective-scope"],
      nodeIds: ["component.intent-indexer", "component.intent-network-graph-factory"],
      invariantIds: ["scope-intersection", "participant-consent"],
      sourcePaths: ["packages/protocol/src/intents/application/intent.indexer.ts", "packages/protocol/src/networks/application/indexer.graph.ts"],
      notes: {
        protocol: "Community assignment determines eligible discovery scope; it does not expose a Signal outside that scope.",
        implementation: "IntentIndexer and the community indexer implement package-level classification and assignment.",
      },
    },
    {
      id: "persist-and-enqueue",
      title: "Commit and enqueue background work",
      summary: "The approved Signal is committed and deferred for background discovery processing.",
      conceptIds: ["signal", "opportunity"],
      nodeIds: ["component.intent-graph-factory", "host-requirement.intent-graph-queue"],
      invariantIds: ["participant-consent", "action-attribution", "host-boundary"],
      sourcePaths: ["packages/protocol/src/intents/application/intent.graph.ts", "packages/protocol/src/shared/interfaces/queue.interface.ts"],
      notes: {
        protocol: "Current protocol behavior creates opportunities through background processing; synchronous examples are stale references, not an alternate normative path.",
        implementation: "The package declares a queue port; scheduling infrastructure is a host boundary.",
      },
    },
  ]);

  const discoverOpportunitySteps = steps([
    {
      id: "load-trigger",
      title: "Load the background trigger",
      summary: "Background processing starts from a committed Signal and its attributable participant context.",
      conceptIds: ["participant", "signal", "context"],
      nodeIds: ["component.opportunity-graph-factory"],
      invariantIds: ["action-attribution", "context-freshness"],
      sourcePaths: ["packages/protocol/src/opportunities/application/opportunity.graph.ts"],
      notes: {
        protocol: "A trigger identifies the Signal being served; it is not permission to search every community.",
        implementation: "Host-scheduled background work invokes the opportunity graph; the package owns no scheduler.",
      },
    },
    {
      id: "resolve-effective-scope",
      title: "Resolve effective scope",
      summary: "Eligible discovery scope is the intersection of Signal assignment, active membership, and agent permission.",
      conceptIds: ["signal", "community", "membership", "agent-permission", "effective-scope"],
      nodeIds: ["component.network-membership-graph-factory", "component.agent-tools"],
      invariantIds: ["scope-intersection", "participant-consent"],
      sourcePaths: ["packages/protocol/src/networks/application/membership.graph.ts", "packages/protocol/src/agents/application/agent.tools.ts"],
      notes: {
        protocol: "No single assignment or credential can enlarge scope beyond the other active constraints.",
        implementation: "Membership and participant-agent capabilities supply package-level checks.",
      },
    },
    {
      id: "retrieve-candidates",
      title: "Retrieve private candidates",
      summary: "The protocol retrieves possible counterparts inside effective scope while keeping candidate identity private.",
      conceptIds: ["effective-scope", "candidate", "radar"],
      nodeIds: ["component.radar-graph-factory", "host-requirement.embedder"],
      invariantIds: ["scope-intersection", "candidate-private", "host-boundary"],
      sourcePaths: ["packages/protocol/src/opportunities/radar/radar.graph.ts", "packages/protocol/src/shared/interfaces/embedder.interface.ts"],
      notes: {
        protocol: "A Candidate is internal evaluation material, not an Opportunity and not a disclosure to either participant.",
        implementation: "Radar and the embedder port are reference-implementation machinery for retrieval, not normative protocol primitives.",
      },
    },
    {
      id: "evaluate-fit",
      title: "Evaluate bilateral fit",
      summary: "Each private candidate is evaluated against both participants' approved, in-scope evidence.",
      conceptIds: ["participant", "signal", "context", "candidate"],
      nodeIds: ["component.opportunity-evaluator"],
      invariantIds: ["scope-intersection", "candidate-private", "no-fabrication"],
      sourcePaths: ["packages/protocol/src/opportunities/application/opportunity.evaluator.ts"],
      notes: {
        protocol: "Fit evaluation may reject a candidate, but a positive assessment still does not grant consent or create a Connection.",
        implementation: "OpportunityEvaluator performs the package's structured fit decision.",
      },
    },
    {
      id: "recheck-admission",
      title: "Recheck admission before use",
      summary: "Membership, permission, evidence freshness, and terminal records are rechecked before a candidate advances.",
      conceptIds: ["membership", "agent-permission", "effective-scope", "candidate"],
      nodeIds: ["component.opportunity-graph-factory", "component.network-membership-graph-factory"],
      invariantIds: ["scope-intersection", "context-freshness", "terminality", "candidate-private"],
      sourcePaths: ["packages/protocol/src/opportunities/application/opportunity.graph.ts", "packages/protocol/src/networks/application/membership.graph.ts"],
      notes: {
        protocol: "Admission is checked at the point of action because discovery inputs can change after retrieval.",
        implementation: "The opportunity and membership graphs expose these package-level checks.",
      },
    },
    {
      id: "negotiate-optional",
      title: "Negotiate fit when needed",
      summary: "A bounded agent dialogue may clarify fit or roles, but it cannot substitute for participant consent.",
      conceptIds: ["candidate", "negotiation", "provider-helper-role", "opportunity"],
      nodeIds: ["component.negotiation-graph-factory", "component.index-negotiator", "host-requirement.agent-dispatcher"],
      invariantIds: ["action-attribution", "no-fabrication", "negotiation-not-consent", "host-boundary"],
      sourcePaths: ["packages/protocol/src/negotiations/application/negotiation.graph.ts", "packages/protocol/src/negotiations/application/negotiation.agent.ts", "packages/protocol/src/shared/interfaces/agent-dispatcher.interface.ts"],
      notes: {
        protocol: "Normative negotiation is bounded and produces an assessment; even agreement between agents is not human consent to connect.",
        implementation: "The current graph uses maxTurns=0 when both participants have external agents, an uncapped exception recorded as a visible discrepancy below.",
      },
    },
    {
      id: "surface",
      title: "Surface a legible Opportunity",
      summary: "A qualified assessment becomes an Opportunity whose public explanation reveals only information safe for its recipient.",
      conceptIds: ["candidate", "opportunity", "participant"],
      nodeIds: ["component.opportunity-presenter", "component.opportunity-graph-factory"],
      invariantIds: ["candidate-private", "opportunity-legibility", "negotiation-not-consent"],
      sourcePaths: ["packages/protocol/src/opportunities/application/opportunity.presenter.ts", "packages/protocol/src/opportunities/application/opportunity.graph.ts"],
      notes: {
        protocol: "Presentation crosses from private Candidate evaluation to participant-visible Opportunity; it does not reveal the raw candidate record.",
        implementation: "OpportunityPresenter constructs safe package-level presentation after graph evaluation.",
      },
    },
  ]);

  const consentConnectSteps = steps([
    {
      id: "actionable-opportunity",
      title: "Present an actionable Opportunity",
      summary: "A participant receives a legible Opportunity with enough safe context to decide whether to act.",
      conceptIds: ["participant", "opportunity", "candidate"],
      nodeIds: ["component.opportunity-presenter", "component.opportunity-tools"],
      invariantIds: ["candidate-private", "opportunity-legibility", "participant-consent"],
      sourcePaths: ["packages/protocol/src/opportunities/application/opportunity.presenter.ts", "packages/protocol/src/opportunities/application/opportunity.tools.ts"],
      notes: {
        protocol: "The Opportunity is participant-facing; the Candidate remains private evaluation material behind it.",
        implementation: "Presenter and opportunity tools expose the safe presentation and available protocol actions.",
      },
    },
    {
      id: "first-participant-sends",
      title: "First participant chooses to send",
      summary: "The first participant explicitly sends the Opportunity to the counterparty.",
      conceptIds: ["participant", "opportunity"],
      nodeIds: ["component.opportunity-tools"],
      invariantIds: ["participant-consent", "action-attribution", "negotiation-not-consent"],
      sourcePaths: ["packages/protocol/src/opportunities/application/opportunity.tools.ts"],
      notes: {
        protocol: "Sending records one participant's choice; agent negotiation or a fit score cannot make this choice for them.",
        implementation: "The package opportunity tool surface records the action in its internal lifecycle vocabulary.",
      },
    },
    {
      id: "counterparty-reviews",
      title: "Counterparty reviews independently",
      summary: "The counterparty receives safe context and makes an independent decision without access to private candidate evidence.",
      conceptIds: ["participant", "opportunity", "candidate"],
      nodeIds: ["component.opportunity-presenter", "component.opportunity-tools"],
      invariantIds: ["candidate-private", "opportunity-legibility", "participant-consent"],
      sourcePaths: ["packages/protocol/src/opportunities/application/opportunity.presenter.ts", "packages/protocol/src/opportunities/application/opportunity.tools.ts"],
      notes: {
        protocol: "Consent is bilateral and sequential: the second participant is not committed by the first participant's send action.",
        implementation: "The package separates recipient-safe presentation from its private evaluation inputs.",
      },
    },
    {
      id: "accept-or-decline",
      title: "Accept or decline",
      summary: "The counterparty explicitly accepts or declines; either decision is attributable and terminal for that Opportunity path.",
      conceptIds: ["participant", "opportunity", "connection"],
      nodeIds: ["component.opportunity-tools"],
      invariantIds: ["participant-consent", "action-attribution", "terminality", "negotiation-not-consent"],
      sourcePaths: ["packages/protocol/src/opportunities/application/opportunity.tools.ts"],
      notes: {
        protocol: "Only explicit acceptance completes consent. Decline and expiry remain terminal; no merged lifecycle is invented to reconcile naming differences.",
        implementation: "Internal opportunity lifecycle states differ from the product Draft/Sent/Connected/Declined/Expired vocabulary; the discrepancy remains visible below.",
      },
    },
    {
      id: "open-human-conversation",
      title: "Open the human conversation",
      summary: "After bilateral consent, the protocol may establish a Connection where the participants converse directly.",
      conceptIds: ["participant", "connection", "opportunity"],
      nodeIds: ["component.chat-graph-factory", "component.chat-tools"],
      invariantIds: ["participant-consent", "action-attribution", "terminality"],
      sourcePaths: ["packages/protocol/src/chat/chat.graph.ts", "packages/protocol/src/chat/chat.tools.ts"],
      notes: {
        protocol: "Connection begins after consent; discovery and negotiation prepare an introduction but are not the human relationship itself.",
        implementation: "The chat graph and tools expose package-level conversation capabilities once the protocol state permits them.",
      },
    },
  ]);

  const externalAgentMcpSteps = steps([
    {
      id: "caller-credential",
      title: "Receive a caller credential",
      summary: "An external software agent presents a credential to the protocol's MCP shell.",
      conceptIds: ["software-agent", "participant", "agent-permission"],
      nodeIds: ["component.mcp-server", "runtime-shell.mcp"],
      invariantIds: ["action-attribution", "host-boundary"],
      sourcePaths: ["packages/protocol/src/mcp/mcp.server.ts"],
      notes: {
        protocol: "A credential is input to identity resolution; possession alone grants no protocol capability.",
        implementation: "The package MCP shell receives the request without specifying how an external host issues credentials.",
      },
    },
    {
      id: "auth-resolver-requirement",
      title: "Require authenticated identity resolution",
      summary: "The protocol requires the host to resolve the credential to an attributable principal.",
      conceptIds: ["software-agent", "participant", "agent-permission"],
      nodeIds: ["host-requirement.mcp-auth-resolver", "component.mcp-server"],
      invariantIds: ["action-attribution", "host-boundary"],
      sourcePaths: ["packages/protocol/src/shared/interfaces/auth.interface.ts", "packages/protocol/src/mcp/mcp.server.ts"],
      notes: {
        protocol: "Failure to resolve an authenticated principal stops the capability request.",
        implementation: "McpAuthResolver is a required package port; host authentication design and paths are outside this atlas.",
      },
    },
    {
      id: "protocol-capability-policy",
      title: "Apply protocol capability policy",
      summary: "The resolved principal is intersected with participant delegation, community scope, and the requested action.",
      conceptIds: ["software-agent", "agent-permission", "membership", "effective-scope"],
      nodeIds: ["component.agent-tools", "facade.agents"],
      invariantIds: ["scope-intersection", "participant-consent", "action-attribution"],
      sourcePaths: ["packages/protocol/src/agents/application/agent.tools.ts", "packages/protocol/src/capabilities/participant-agents.facade.ts"],
      notes: {
        protocol: "Effective permission is narrower than registry presence and is recalculated for each scoped action.",
        implementation: "Participant-agent capability surfaces expose policy-aware operations within the package.",
      },
    },
    {
      id: "authorized-tool-registry",
      title: "Build the authorized tool registry",
      summary: "Only tool families admitted by the effective policy are made available for the request.",
      conceptIds: ["software-agent", "agent-permission", "effective-scope"],
      nodeIds: ["component.tool-registry", "runtime-shell.composition"],
      invariantIds: ["scope-intersection", "action-attribution"],
      sourcePaths: ["packages/protocol/src/shared/agent/tool.registry.ts"],
      notes: {
        protocol: "Authorization filters capabilities before invocation rather than relying on an agent to avoid disallowed tools.",
        implementation: "The foreground composition registry assembles protocol-owned tool families.",
      },
    },
    {
      id: "invocation-runtime",
      title: "Invoke through the protocol runtime",
      summary: "The selected tool executes with attributable identity, validated arguments, and the admitted protocol dependencies.",
      conceptIds: ["software-agent", "agent-permission", "effective-scope"],
      nodeIds: ["component.invoke-tool-runtime", "component.tool-registry"],
      invariantIds: ["scope-intersection", "action-attribution", "host-boundary"],
      sourcePaths: ["packages/protocol/src/shared/agent/tool.runtime.ts", "packages/protocol/src/shared/agent/tool.registry.ts"],
      notes: {
        protocol: "Invocation does not widen the authorization determined for the caller and action.",
        implementation: "The shared tool runtime executes registered package tools; required callbacks remain declared ports.",
      },
    },
    {
      id: "scoped-capability",
      title: "Return only scoped capability results",
      summary: "The result is constrained to the caller's authorized participant, community, and action scope.",
      conceptIds: ["software-agent", "agent-permission", "effective-scope"],
      nodeIds: ["component.mcp-server", "component.invoke-tool-runtime"],
      invariantIds: ["scope-intersection", "action-attribution", "candidate-private"],
      sourcePaths: ["packages/protocol/src/mcp/mcp.server.ts", "packages/protocol/src/shared/agent/tool.runtime.ts"],
      notes: {
        protocol: "A successful call proves only that this scoped action was authorized; it grants no ambient access and discloses no private Candidate data.",
        implementation: "The MCP shell returns the protocol runtime result without defining the external host's transport architecture.",
      },
    },
  ]);

  const CONFIGURATION_DISCLAIMER = "This compares documented `packages/protocol` behavior against package fallbacks. It does not show any deployed environment and is not evidence that a capability is unused or removable.";

  const configurationSettings = Object.freeze({
    DISCOVERY_ALLOWED_TYPES: setting("DISCOVERY_ALLOWED_TYPES", [["packages/protocol/src/opportunities/discovery.env.ts", "discoveryAllowedTypes"]], "discoveryAllowedTypes", ["intent,profile", "intent", "profile"], "intent,profile"),
    DISCOVERY_PROFILE_SOURCE: setting("DISCOVERY_PROFILE_SOURCE", [["packages/protocol/src/opportunities/discovery.env.ts", "discoveryProfileSource"]], "discoveryProfileSource", ["premise", "user_context"], "premise"),
    DISCOVERY_CONTEXT_TO_INTENT: setting("DISCOVERY_CONTEXT_TO_INTENT", [["packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory"]], "OpportunityGraphFactory", ["0", "1"], "1"),
    DISCOVERY_SOURCE_PREMISE_LIMIT: setting("DISCOVERY_SOURCE_PREMISE_LIMIT", [["packages/protocol/src/opportunities/application/opportunity.graph.ts", "getSourcePremiseDiscoveryLimit"]], "getSourcePremiseDiscoveryLimit", ["0", "40", "100"], "40"),
    DISCOVERY_REJECTION_COOLDOWN_DAYS: setting("DISCOVERY_REJECTION_COOLDOWN_DAYS", [["packages/protocol/src/opportunities/application/opportunity.graph.ts", "getRejectionCooldownMs"]], "getRejectionCooldownMs", ["1", "7", "30"], "7"),
    RUN_OPPORTUNITY_EVAL_IN_PARALLEL: setting("RUN_OPPORTUNITY_EVAL_IN_PARALLEL", [["packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory"]], "OpportunityGraphFactory", ["false", "true"], "false"),
    HYDE_FRAME_CONSTRAINTS_ENABLED: setting("HYDE_FRAME_CONSTRAINTS_ENABLED", [["packages/protocol/src/discovery/hyde.env.ts", "getHydeGenerationMode"]], "getHydeGenerationMode", ["false", "true"], "false"),
    PREMISE_DEDUP_SIMILARITY: setting("PREMISE_DEDUP_SIMILARITY", [["packages/protocol/src/premises/premise.graph.ts", "DEDUP_SIMILARITY_THRESHOLD"]], "DEDUP_SIMILARITY_THRESHOLD", ["0.85", "0.93", "0.98"], "0.93", "module-load"),
    INTRODUCER_DISCOVERY_ENABLED: setting("INTRODUCER_DISCOVERY_ENABLED", [["packages/protocol/src/opportunities/application/opportunity.introducer-feature.ts", "isIntroducerDiscoveryEnabled"]], "isIntroducerDiscoveryEnabled", ["false", "true"], "false"),
    NEGOTIATION_INCLUDE_OTHER_INTENTS: setting("NEGOTIATION_INCLUDE_OTHER_INTENTS", [["packages/protocol/src/opportunities/application/opportunity.existing-negotiation.ts", "negotiationIncludesOtherIntents"]], "negotiationIncludesOtherIntents", ["false", "true"], "true"),
    NEGOTIATION_MAX_TURNS_CHAT: setting("NEGOTIATION_MAX_TURNS_CHAT", [["packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory"]], "OpportunityGraphFactory", ["2", "4", "8"], "4"),
    NEGOTIATION_MAX_TURNS_AMBIENT: setting("NEGOTIATION_MAX_TURNS_AMBIENT", [["packages/protocol/src/negotiations/application/negotiation.graph.ts", "NegotiationGraphFactory"], ["packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory"]], "NegotiationGraphFactory", ["3", "6", "12"], "6"),
    NEGOTIATION_PROTOCOL_VERSION: setting("NEGOTIATION_PROTOCOL_VERSION", [["packages/protocol/src/negotiations/domain/negotiation.protocol.ts", "configuredProtocolVersion"]], "configuredProtocolVersion", ["v1", "v2"], "v1"),
    NEGOTIATION_SCREEN_MODE: setting("NEGOTIATION_SCREEN_MODE", [["packages/protocol/src/negotiations/domain/negotiation.screen.contracts.ts", "configuredScreenMode"]], "configuredScreenMode", ["off", "shadow", "enforce"], "off"),
    NEGOTIATOR_STANCE: setting("NEGOTIATOR_STANCE", [["packages/protocol/src/negotiations/domain/negotiation.stance.contracts.ts", "configuredNegotiatorStance"]], "configuredNegotiatorStance", ["advocate", "evaluator", "skeptic"], "advocate"),
    NEGOTIATION_ASK_USER_ENABLED: setting("NEGOTIATION_ASK_USER_ENABLED", [["packages/protocol/src/negotiations/domain/negotiation.protocol.ts", "configuredAskUserEnabled"]], "configuredAskUserEnabled", ["false", "true"], "false"),
    NEGOTIATION_ASK_USER_WINDOW_MS: setting("NEGOTIATION_ASK_USER_WINDOW_MS", [["packages/protocol/src/negotiations/domain/negotiation.protocol.ts", "askUserAnswerWindowMs"]], "askUserAnswerWindowMs", ["60000", "86400000"], "86400000"),
    NEGOTIATION_CONSULTATION_POLICY_MODE: setting("NEGOTIATION_CONSULTATION_POLICY_MODE", [["packages/protocol/src/negotiations/domain/negotiation.consultation-policy.ts", "negotiationConsultationPolicyMode"]], "negotiationConsultationPolicyMode", ["off", "shadow", "on"], "off"),
    NEGOTIATION_DEADLOCK_SHIFT_ENABLED: setting("NEGOTIATION_DEADLOCK_SHIFT_ENABLED", [["packages/protocol/src/negotiations/domain/negotiation.deadlock.ts", "configuredDeadlockShiftEnabled"]], "configuredDeadlockShiftEnabled", ["false", "true"], "false"),
    NEGOTIATION_DEADLOCK_THRESHOLD: setting("NEGOTIATION_DEADLOCK_THRESHOLD", [["packages/protocol/src/negotiations/domain/negotiation.deadlock.ts", "configuredDeadlockThreshold"]], "configuredDeadlockThreshold", ["2", "4"], "4"),
    QUESTIONER_ENABLED: setting("QUESTIONER_ENABLED", [["packages/protocol/src/questions/application/question.env.ts", "isQuestionerEnabled"]], "isQuestionerEnabled", ["false", "true"], "false"),
    QUESTIONER_UPTAKE_ENABLED: setting("QUESTIONER_UPTAKE_ENABLED", [["packages/protocol/src/questions/application/question.env.ts", "isUptakeGuardEnabled"]], "isUptakeGuardEnabled", ["false", "true"], "false", "invocation", [["packages/protocol/src/questions/application/question.env.ts", "isQuestionerEnabled"]]),
    QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD: setting("QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD", [["packages/protocol/src/questions/application/question.env.ts", "uptakeAuthorityThreshold"]], "uptakeAuthorityThreshold", ["70", "90"], "70"),
    QUESTIONER_DISCOVERY_ENABLED: setting("QUESTIONER_DISCOVERY_ENABLED", [["packages/protocol/src/questions/application/question.env.ts", "isDiscoveryQuestionsEnabled"]], "isDiscoveryQuestionsEnabled", ["false", "true"], "false"),
    QUESTIONER_DISCOVERY_INPUT_MODE: setting("QUESTIONER_DISCOVERY_INPUT_MODE", [["packages/protocol/src/questions/application/question.env.ts", "discoveryQuestionsInputMode"]], "discoveryQuestionsInputMode", ["transcripts", "insights"], "transcripts"),
    POOL_QUESTIONS_MINING: setting("POOL_QUESTIONS_MINING", [["packages/protocol/src/opportunities/discriminator/discriminator.env.ts", "poolQuestionsMiningMode"]], "poolQuestionsMiningMode", ["off", "shadow"], "off"),
    POOL_QUESTIONS_MODE: setting("POOL_QUESTIONS_MODE", [["packages/protocol/src/opportunities/discriminator/discriminator.env.ts", "poolQuestionsMode"]], "poolQuestionsMode", ["off", "on"], "off"),
    POOL_QUESTIONS_PUSH: setting("POOL_QUESTIONS_PUSH", [["packages/protocol/src/opportunities/discriminator/discriminator.env.ts", "poolQuestionsPushMode"]], "poolQuestionsPushMode", ["off", "on"], "off"),
    POOL_QUESTIONS_VISIT_TRIGGER: setting("POOL_QUESTIONS_VISIT_TRIGGER", [["packages/protocol/src/opportunities/discriminator/discriminator.env.ts", "poolQuestionsVisitTrigger"]], "poolQuestionsVisitTrigger", ["off", "on"], "off"),
    POOL_QUESTIONS_STAMP_NEWBORN: setting("POOL_QUESTIONS_STAMP_NEWBORN", [["packages/protocol/src/opportunities/discriminator/discriminator.env.ts", "poolQuestionsStampNewborn"]], "poolQuestionsStampNewborn", ["off", "on"], "off"),
    POOL_QUESTIONS_RANKING: setting("POOL_QUESTIONS_RANKING", [["packages/protocol/src/opportunities/discriminator/discriminator.env.ts", "poolQuestionsRanking"]], "poolQuestionsRanking", ["off", "on"], "off"),
    NEGOTIATION_EVIDENCE_QUESTIONS_MODE: setting("NEGOTIATION_EVIDENCE_QUESTIONS_MODE", [["packages/protocol/src/opportunities/negotiation-evidence/negotiation-evidence.env.ts", "negotiationEvidenceQuestionsMode"]], "negotiationEvidenceQuestionsMode", ["off", "shadow", "on"], "off"),
    OUTCOME_QUESTIONS_MODE: setting("OUTCOME_QUESTIONS_MODE", [["packages/protocol/src/opportunities/outcome/outcome.env.ts", "outcomeQuestionsMode"]], "outcomeQuestionsMode", ["off", "shadow", "on"], "off", "invocation", [["packages/protocol/src/opportunities/outcome/outcome.env.ts", "isOutcomeQuestionsActivated"]]),
  });

  function setting(key, sites, entryAccessorSymbol, acceptedValues, fallback, readTiming = "invocation", accessorClosure = []) {
    return {
      key,
      readSites: sites.map(([path, symbol]) => ({ path, symbol })),
      entryAccessorSymbol,
      accessorClosure: accessorClosure.map(([path, symbol]) => ({ path, symbol })),
      acceptedValues,
      fallback,
      readTiming,
    };
  }

  const definitiveEvidence = Object.freeze({
    discovery: evidence("DISCOVERY_ALLOWED_TYPES", "component.opportunity-graph-factory", "packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory", "packages/protocol/src/opportunities/tests/opportunity.graph.spec.ts", "DISCOVERY_ALLOWED_TYPES=intent: premise and context strategies issue no searches", [
      ["packages/protocol/src/opportunities/discovery.env.ts", "discoveryAllowedTypes"],
      ["packages/protocol/src/opportunities/discovery.env.ts", "discoveryIntentMatchingEnabled"],
      ["packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory"],
    ]),
    profileSource: evidence("DISCOVERY_PROFILE_SOURCE", "component.opportunity-graph-factory", "packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory", "packages/protocol/src/opportunities/tests/opportunity.graph.spec.ts", "DISCOVERY_PROFILE_SOURCE=user_context: premise strategy off, premise HyDE results dropped", [
      ["packages/protocol/src/opportunities/discovery.env.ts", "discoveryProfileSource"],
      ["packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory"],
    ]),
    contextToIntent: evidence("DISCOVERY_CONTEXT_TO_INTENT", "component.opportunity-graph-factory", "packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory", "packages/protocol/src/opportunities/tests/opportunity.graph.spec.ts", "DISCOVERY_CONTEXT_TO_INTENT=1 with user_context and intent,profile invokes context-to-intent search and evidence", [
      ["packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory"],
    ]),
    sourcePremise: evidence("DISCOVERY_SOURCE_PREMISE_LIMIT", "component.opportunity-graph-factory", "packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory", "packages/protocol/src/opportunities/tests/opportunity.graph.spec.ts", "premise discovery uses scoped capped source premises and one batched DB search", [
      ["packages/protocol/src/opportunities/application/opportunity.graph.ts", "getSourcePremiseDiscoveryLimit"],
      ["packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory"],
    ]),
    cooldown: evidence("DISCOVERY_REJECTION_COOLDOWN_DAYS", "component.opportunity-graph-factory", "packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory", "packages/protocol/src/opportunities/tests/opportunity.graph.spec.ts", "applies the configured rejection cooldown and ranks penalized candidates behind unpenalized candidates", [
      ["packages/protocol/src/opportunities/application/opportunity.graph.ts", "getRejectionCooldownMs"],
      ["packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory"],
    ]),
    evaluation: evidence("RUN_OPPORTUNITY_EVAL_IN_PARALLEL", "component.opportunity-graph-factory", "packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory", "packages/protocol/src/opportunities/tests/opportunity.graph.spec.ts", "when evaluator returns 3 actors, splits into pairwise opportunities (viewer + each non-viewer)", [
      ["packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory"],
    ]),
    turnCaps: [
      evidence("NEGOTIATION_MAX_TURNS_CHAT", "component.opportunity-graph-factory", "packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory", "packages/protocol/src/negotiations/tests/negotiation.graph.spec.ts", "emits outcome='turn_cap' when maxTurns is reached without accept/reject", [
        ["packages/protocol/src/opportunities/application/opportunity.graph.ts", "OpportunityGraphFactory"],
      ]),
      evidence("NEGOTIATION_MAX_TURNS_AMBIENT", "component.negotiation-graph-factory", "packages/protocol/src/negotiations/application/negotiation.graph.ts", "NegotiationGraphFactory", "packages/protocol/src/negotiations/tests/negotiation.graph.spec.ts", "emits outcome='turn_cap' when maxTurns is reached without accept/reject", [
        ["packages/protocol/src/negotiations/application/negotiation.graph.ts", "NegotiationGraphFactory"],
      ]),
    ],
    hyde: evidence("HYDE_FRAME_CONSTRAINTS_ENABLED", "component.hyde-graph-factory", "packages/protocol/src/discovery/hyde.graph.ts", "HydeGraphFactory", "packages/protocol/src/discovery/tests/hyde.frame.spec.ts", "enables frame-v1 only for the strict literal true", [
      ["packages/protocol/src/discovery/hyde.env.ts", "getHydeGenerationMode"],
      ["packages/protocol/src/discovery/hyde.graph.ts", "HydeGraphFactory"],
    ]),
    premise: evidence("PREMISE_DEDUP_SIMILARITY", "component.premise-graph-factory", "packages/protocol/src/premises/premise.graph.ts", "PremiseGraphFactory", "packages/protocol/src/premises/tests/premise.graph.spec.ts", "skips persisting a near-duplicate premise on create", [
      ["packages/protocol/src/premises/premise.graph.ts", "DEDUP_SIMILARITY_THRESHOLD"],
      ["packages/protocol/src/premises/premise.graph.ts", "PremiseGraphFactory"],
    ]),
    introducer: evidence("INTRODUCER_DISCOVERY_ENABLED", "component.maintenance-graph-factory", "packages/protocol/src/maintenance/maintenance.graph.ts", "MaintenanceGraphFactory", "packages/protocol/src/opportunities/tests/opportunity.introducer-feature.spec.ts", "enables only for true", [
      ["packages/protocol/src/opportunities/application/opportunity.introducer-feature.ts", "isIntroducerDiscoveryEnabled"],
      ["packages/protocol/src/maintenance/maintenance.graph.ts", "MaintenanceGraphFactory"],
    ]),
    negotiationContext: evidence("NEGOTIATION_INCLUDE_OTHER_INTENTS", "component.opportunity-graph-factory", "packages/protocol/src/opportunities/application/opportunity.existing-negotiation.ts", "negotiateExistingOpportunity", "packages/protocol/src/opportunities/tests/opportunity.existing-negotiation.spec.ts", "false flag isolates both sides on an exact continuation and skips unrelated active-intent reads", [
      ["packages/protocol/src/opportunities/application/opportunity.existing-negotiation.ts", "negotiationIncludesOtherIntents"],
      ["packages/protocol/src/opportunities/application/opportunity.existing-negotiation.ts", "negotiateExistingOpportunity"],
    ]),
    protocol: evidence("NEGOTIATION_PROTOCOL_VERSION", "component.negotiation-graph-factory", "packages/protocol/src/negotiations/application/negotiation.graph.ts", "NegotiationGraphFactory", "packages/protocol/src/negotiations/tests/negotiation.protocol.spec.ts", "configuredProtocolVersion: env switch, defaults v1", [
      ["packages/protocol/src/negotiations/domain/negotiation.protocol.ts", "configuredProtocolVersion"],
      ["packages/protocol/src/negotiations/application/negotiation.graph.ts", "NegotiationGraphFactory"],
    ]),
    screen: evidence("NEGOTIATION_SCREEN_MODE", "component.negotiation-graph-factory", "packages/protocol/src/negotiations/application/negotiation.graph.ts", "NegotiationGraphFactory", "packages/protocol/src/negotiations/tests/negotiation.screen-routing.spec.ts", "enforce (P2.2): a `pass` blocks before the first turn — screened_out, zero messages, opportunity rejected", [
      ["packages/protocol/src/negotiations/domain/negotiation.screen.contracts.ts", "configuredScreenMode"],
      ["packages/protocol/src/negotiations/application/negotiation.graph.ts", "NegotiationGraphFactory"],
    ]),
    stance: evidence("NEGOTIATOR_STANCE", "component.index-negotiator", "packages/protocol/src/negotiations/application/negotiation.agent.ts", "IndexNegotiator", "packages/protocol/src/negotiations/tests/negotiation.stance.spec.ts", "resolves every declared stance verbatim", [
      ["packages/protocol/src/negotiations/domain/negotiation.stance.contracts.ts", "configuredNegotiatorStance"],
      ["packages/protocol/src/negotiations/application/negotiation.agent.ts", "IndexNegotiator"],
    ]),
    consultation: evidence("NEGOTIATION_CONSULTATION_POLICY_MODE", "component.negotiation-graph-factory", "packages/protocol/src/negotiations/application/negotiation.graph.ts", "NegotiationGraphFactory", "packages/protocol/src/negotiations/tests/negotiation.ask-user.spec.ts", "policy on excludes a pre-screened path before consultation effects", [
      ["packages/protocol/src/negotiations/domain/negotiation.consultation-policy.ts", "negotiationConsultationPolicyMode"],
      ["packages/protocol/src/negotiations/application/negotiation.graph.ts", "NegotiationGraphFactory"],
    ]),
    deadlock: evidence("NEGOTIATION_DEADLOCK_SHIFT_ENABLED", "component.negotiation-graph-factory", "packages/protocol/src/negotiations/application/negotiation.graph.ts", "NegotiationGraphFactory", "packages/protocol/src/negotiations/tests/negotiation.deadlock-shift.spec.ts", "flag ON: bargaining stance from the threshold turn, record persisted once, trace event once", [
      ["packages/protocol/src/negotiations/domain/negotiation.deadlock.ts", "configuredDeadlockShiftEnabled"],
      ["packages/protocol/src/negotiations/application/negotiation.graph.ts", "NegotiationGraphFactory"],
    ]),
    uptake: evidence("QUESTIONER_UPTAKE_ENABLED", "component.opportunity-tools", "packages/protocol/src/opportunities/application/opportunity.tools.ts", "createOpportunityTools", "packages/protocol/src/opportunities/tests/update-opportunity.spec.ts", "returns a structured advisory with public questions and no graph mutation", [
      ["packages/protocol/src/questions/application/question.env.ts", "isUptakeGuardEnabled"],
      ["packages/protocol/src/questions/index.ts", "isUptakeGuardEnabled"],
      ["packages/protocol/src/opportunities/application/opportunity.tools.ts", "createOpportunityTools"],
    ]),
    ranking: evidence("POOL_QUESTIONS_RANKING", "component.radar-graph-factory", "packages/protocol/src/opportunities/radar/radar.graph.ts", "RadarGraphFactory", "packages/protocol/src/opportunities/tests/radar.graph.status-filter.spec.ts", "lifecycle order is unchanged while ranking is off and adjusted when on", [
      ["packages/protocol/src/opportunities/discriminator/discriminator.env.ts", "poolQuestionsRanking"],
      ["packages/protocol/src/opportunities/radar/radar.graph.ts", "getPoolRankingProvenance"],
      ["packages/protocol/src/opportunities/radar/radar.graph.ts", "RadarGraphFactory"],
    ]),
  });

  function evidence(settingKey, targetId, consumerPath, consumerSymbol, testPath, testName, chain) {
    return {
      settingKey,
      targetId,
      consumerPath,
      consumerSymbol,
      testPath,
      testName,
      referenceChain: chain.map(([path, symbol]) => ({ path, symbol })),
    };
  }

  function experiment(id, title, capability, keys, fallbackModeId, modeSpecs, evidenceRecord, affectedStepIds, coverage = "definitive", unresolvedSettingKeys = keys) {
    const settings = keys.map((key) => configurationSettings[key]);
    return {
      id,
      title,
      summary: `${title} compares reviewed package fallback behavior with named non-secret assignments.`,
      capability,
      coverage,
      fallbackModeId,
      affectedChapterIds: [capability === "negotiation" ? "consent" : capability === "participant-context" ? "primitives" : "discovery", "explore"],
      affectedStepIds,
      settings,
      modes: modeSpecs.map((spec) => configurationMode(id, settings, spec, evidenceRecord, coverage, unresolvedSettingKeys)),
    };
  }

  function configurationMode(experimentId, settings, spec, evidenceRecord, coverage, unresolvedSettingKeys) {
    const assignments = settings.map((settingRecord) => ({
      key: settingRecord.key,
      value: Object.prototype.hasOwnProperty.call(spec.values, settingRecord.key) ? spec.values[settingRecord.key] : null,
    }));
    const resolvedValues = assignments.map(({ key, value }) => ({ key, value: value === null ? configurationSettings[key].fallback : value }));
    const selectedEvidence = spec.evidence || evidenceRecord;
    const evidenceRecords = Array.isArray(selectedEvidence) ? selectedEvidence : selectedEvidence ? [selectedEvidence] : [];
    const deltas = spec.fallback ? [] : coverage === "unresolved"
      ? [{ id: `${experimentId}.${spec.id}`, effect: "unresolved", targetKind: "node", targetId: spec.targetId || "component.opportunity-graph-factory", settingKeys: unresolvedSettingKeys, noDirectProtocolConsumer: true }]
      : evidenceRecords.map((record) => ({
        id: `${experimentId}.${spec.id}.${record.settingKey.toLowerCase().replaceAll("_", "-")}`,
        effect: spec.effect || "changed",
        targetKind: "node",
        targetId: record.targetId,
        settingKeys: [record.settingKey],
        consumerPath: record.consumerPath,
        consumerSymbol: record.consumerSymbol,
        referenceChain: record.referenceChain,
        behaviorTest: { path: record.testPath, testName: record.testName },
      }));
    for (const key of spec.additionalUnresolvedSettingKeys || []) {
      deltas.push({
        id: `${experimentId}.${spec.id}.${key.toLowerCase().replaceAll("_", "-")}`,
        effect: "unresolved",
        targetKind: spec.unresolvedTargetKind || "step",
        targetId: spec.unresolvedTargetId || "accept-or-decline",
        settingKeys: [key],
        noDirectProtocolConsumer: true,
      });
    }
    return {
      id: spec.id,
      assignments,
      resolvedValues,
      prerequisites: spec.prerequisites || [],
      deltas,
      explanation: spec.explanation,
      caveats: spec.caveats || [],
    };
  }

  const configurationExperiments = [
    experiment("discovery-corpus", "Discovery corpus and source selection", "opportunities", ["DISCOVERY_ALLOWED_TYPES", "DISCOVERY_PROFILE_SOURCE", "DISCOVERY_CONTEXT_TO_INTENT"], "fallback", [
      mode("fallback", {}, "Intent and premise-profile retrieval are eligible from package fallbacks.", true),
      mode("intent-only", { DISCOVERY_ALLOWED_TYPES: "intent" }, "Profile retrieval is bypassed; intent retrieval remains eligible.", false, "bypassed"),
      mode("premise-profile", { DISCOVERY_ALLOWED_TYPES: "profile", DISCOVERY_PROFILE_SOURCE: "premise" }, "Only premise-backed profile retrieval is eligible."),
      mode("context-profile", { DISCOVERY_ALLOWED_TYPES: "profile", DISCOVERY_PROFILE_SOURCE: "user_context" }, "Only participant-context profile retrieval is eligible.", false, "changed", [], [], { evidence: definitiveEvidence.profileSource }),
      mode("context-cross-match", { DISCOVERY_ALLOWED_TYPES: "intent,profile", DISCOVERY_PROFILE_SOURCE: "user_context", DISCOVERY_CONTEXT_TO_INTENT: "1" }, "Context-to-intent cross matching becomes eligible.", false, "activated", [], [], { evidence: definitiveEvidence.contextToIntent }),
    ], definitiveEvidence.discovery, ["retrieve-candidates"]),
    experiment("discovery-premise-limit", "Discovery premise fan-out", "opportunities", ["DISCOVERY_SOURCE_PREMISE_LIMIT"], "fallback-40", [
      mode("fallback-40", {}, "At most 40 source premises are loaded.", true),
      mode("disabled-0", { DISCOVERY_SOURCE_PREMISE_LIMIT: "0" }, "Premise-to-premise discovery is bypassed.", false, "bypassed"),
      mode("expanded-100", { DISCOVERY_SOURCE_PREMISE_LIMIT: "100" }, "The source-premise fan-out cap increases to 100."),
    ], definitiveEvidence.sourcePremise, ["retrieve-candidates"]),
    experiment("discovery-rejection-cooldown", "Discovery rejection cooldown", "opportunities", ["DISCOVERY_REJECTION_COOLDOWN_DAYS"], "fallback-7d", [
      mode("fallback-7d", {}, "Recent rejection penalties use seven days.", true),
      mode("short-1d", { DISCOVERY_REJECTION_COOLDOWN_DAYS: "1" }, "The rejection penalty window shortens to one day."),
      mode("long-30d", { DISCOVERY_REJECTION_COOLDOWN_DAYS: "30" }, "The rejection penalty window extends to thirty days."),
    ], definitiveEvidence.cooldown, ["evaluate-fit"]),
    experiment("discovery-evaluation-topology", "Discovery evaluation topology", "opportunities", ["RUN_OPPORTUNITY_EVAL_IN_PARALLEL"], "bundled", [
      mode("bundled", {}, "Fallback evaluation uses bundled actor normalization.", true),
      mode("pairwise", { RUN_OPPORTUNITY_EVAL_IN_PARALLEL: "true" }, "Evaluation executes per pair with independent failure isolation.", false, "changed"),
    ], definitiveEvidence.evaluation, ["evaluate-fit"]),
    experiment("hyde-frame-constraints", "HyDE frame constraints", "participant-context", ["HYDE_FRAME_CONSTRAINTS_ENABLED"], "legacy", [
      mode("legacy", {}, "HyDE generation uses the legacy representation.", true),
      mode("frame-v1", { HYDE_FRAME_CONSTRAINTS_ENABLED: "true" }, "HyDE generation applies frame-v1 constraints.", false, "changed"),
    ], definitiveEvidence.hyde, ["refresh-representations", "retrieve-candidates"]),
    experiment("premise-deduplication", "Premise deduplication threshold", "participant-context", ["PREMISE_DEDUP_SIMILARITY"], "fallback-0.93", [
      mode("fallback-0.93", {}, "Near-duplicate premises collapse at 0.93 similarity.", true),
      mode("broad-0.85", { PREMISE_DEDUP_SIMILARITY: "0.85" }, "More paraphrases are treated as duplicates."),
      mode("strict-0.98", { PREMISE_DEDUP_SIMILARITY: "0.98" }, "Only very close paraphrases are treated as duplicates."),
    ], definitiveEvidence.premise, ["atomic-premises"]),
    experiment("introducer-discovery", "Introducer discovery", "opportunities", ["INTRODUCER_DISCOVERY_ENABLED"], "off", [
      mode("off", {}, "Introducer discovery is ineligible.", true),
      mode("on", { INTRODUCER_DISCOVERY_ENABLED: "true" }, "Introducer discovery becomes eligible when its required protocol boundary is supplied.", false, "activated"),
    ], definitiveEvidence.introducer, ["retrieve-candidates"]),
    experiment("negotiation-context", "Negotiation context breadth", "negotiation", ["NEGOTIATION_INCLUDE_OTHER_INTENTS"], "include-active", [
      mode("include-active", {}, "Negotiation context may include bounded active Signals.", true),
      mode("exact-only", { NEGOTIATION_INCLUDE_OTHER_INTENTS: "false" }, "Negotiation context is limited to the triggering Signal.", false, "bypassed"),
    ], definitiveEvidence.negotiationContext, ["negotiate-optional"]),
    experiment("negotiation-turn-caps", "Negotiation turn caps", "negotiation", ["NEGOTIATION_MAX_TURNS_CHAT", "NEGOTIATION_MAX_TURNS_AMBIENT"], "fallback-4-6", [
      mode("fallback-4-6", {}, "Chat and ambient negotiation use four and six turns.", true),
      mode("short-2-3", { NEGOTIATION_MAX_TURNS_CHAT: "2", NEGOTIATION_MAX_TURNS_AMBIENT: "3" }, "Negotiations reach their turn cap sooner."),
      mode("extended-8-12", { NEGOTIATION_MAX_TURNS_CHAT: "8", NEGOTIATION_MAX_TURNS_AMBIENT: "12" }, "Negotiations allow more turns before a cap outcome."),
    ], definitiveEvidence.turnCaps, ["negotiate-optional"]),
    experiment("negotiation-protocol", "Negotiation protocol version", "negotiation", ["NEGOTIATION_PROTOCOL_VERSION"], "v1", [
      mode("v1", {}, "Fresh negotiations use the v1 action contract.", true),
      mode("v2", { NEGOTIATION_PROTOCOL_VERSION: "v2" }, "Fresh negotiations stamp the v2 seat-aware action contract.", false, "changed", [], ["In-flight tasks remain pinned to their stored protocol version."]),
    ], definitiveEvidence.protocol, ["negotiate-optional"]),
    experiment("negotiation-screen", "Negotiation outreach screen", "negotiation", ["NEGOTIATION_SCREEN_MODE"], "off", [
      mode("off", {}, "The outreach screen is bypassed.", true),
      mode("shadow", { NEGOTIATION_SCREEN_MODE: "shadow" }, "Screen decisions are recorded without blocking outreach."),
      mode("enforce", { NEGOTIATION_SCREEN_MODE: "enforce" }, "A pass decision is required before outreach.", false, "activated"),
    ], definitiveEvidence.screen, ["negotiate-optional"]),
    experiment("negotiation-stance", "Negotiator stance", "negotiation", ["NEGOTIATOR_STANCE"], "advocate", [
      mode("advocate", {}, "The negotiator advocates for query fit.", true),
      mode("evaluator", { NEGOTIATOR_STANCE: "evaluator" }, "The negotiator emphasizes bilateral value evaluation."),
      mode("skeptic", { NEGOTIATOR_STANCE: "skeptic" }, "The negotiator requires stronger evidence and recognizes stalemate."),
    ], definitiveEvidence.stance, ["negotiate-optional"]),
    experiment("negotiation-consultation", "Negotiation participant consultation", "negotiation", ["NEGOTIATION_PROTOCOL_VERSION", "NEGOTIATION_ASK_USER_ENABLED", "NEGOTIATION_ASK_USER_WINDOW_MS", "NEGOTIATION_CONSULTATION_POLICY_MODE"], "off", [
      mode("off", {}, "Participant consultation is bypassed.", true),
      mode("shadow", { NEGOTIATION_CONSULTATION_POLICY_MODE: "shadow" }, "Consultation eligibility is observed without pausing negotiation."),
      mode("v2-on", { NEGOTIATION_PROTOCOL_VERSION: "v2", NEGOTIATION_ASK_USER_ENABLED: "true", NEGOTIATION_CONSULTATION_POLICY_MODE: "on" }, "Eligible v2 negotiations may pause for participant input.", false, "activated", [{ kind: "setting", key: "NEGOTIATION_PROTOCOL_VERSION", value: "v2" }]),
      mode("v2-short-window", { NEGOTIATION_PROTOCOL_VERSION: "v2", NEGOTIATION_ASK_USER_ENABLED: "true", NEGOTIATION_ASK_USER_WINDOW_MS: "60000", NEGOTIATION_CONSULTATION_POLICY_MODE: "on" }, "The consultation pause expires after one minute.", false, "changed", [{ kind: "setting", key: "NEGOTIATION_PROTOCOL_VERSION", value: "v2" }]),
    ], definitiveEvidence.consultation, ["negotiate-optional"]),
    experiment("negotiation-deadlock", "Negotiation deadlock shift", "negotiation", ["NEGOTIATION_PROTOCOL_VERSION", "NEGOTIATION_DEADLOCK_SHIFT_ENABLED", "NEGOTIATION_DEADLOCK_THRESHOLD", "NEGOTIATOR_STANCE"], "off", [
      mode("off", {}, "Deadlock bargaining shifts are bypassed.", true),
      mode("v2-threshold-4", { NEGOTIATION_PROTOCOL_VERSION: "v2", NEGOTIATION_DEADLOCK_SHIFT_ENABLED: "true", NEGOTIATION_DEADLOCK_THRESHOLD: "4" }, "A v2 bargaining shift becomes eligible after four stagnant turns.", false, "activated"),
      mode("v2-fast-2", { NEGOTIATION_PROTOCOL_VERSION: "v2", NEGOTIATION_DEADLOCK_SHIFT_ENABLED: "true", NEGOTIATION_DEADLOCK_THRESHOLD: "2" }, "A v2 bargaining shift becomes eligible after two stagnant turns."),
      mode("v2-skeptic", { NEGOTIATION_PROTOCOL_VERSION: "v2", NEGOTIATION_DEADLOCK_SHIFT_ENABLED: "true", NEGOTIATION_DEADLOCK_THRESHOLD: "4", NEGOTIATOR_STANCE: "skeptic" }, "Skeptic stance can resolve persistent deadlock as stalemate."),
    ], definitiveEvidence.deadlock, ["negotiate-optional"]),
    experiment("questioner-uptake", "Questioner uptake guard", "questions", ["QUESTIONER_ENABLED", "QUESTIONER_UPTAKE_ENABLED", "QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD"], "off", [
      mode("off", {}, "The advisory uptake interlock is bypassed.", true),
      mode("on-threshold-70", { QUESTIONER_ENABLED: "true", QUESTIONER_UPTAKE_ENABLED: "true", QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD: "70" }, "Pending uptake questions can interlock low-authority acceptance.", false, "activated"),
      mode("on-threshold-90", { QUESTIONER_ENABLED: "true", QUESTIONER_UPTAKE_ENABLED: "true", QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD: "90" }, "The uptake guard is active; the configured authority threshold is declared but has no direct protocol consumer.", false, "changed", [], [], { additionalUnresolvedSettingKeys: ["QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD"] }),
    ], definitiveEvidence.uptake, ["accept-or-decline"]),
    experiment("pool-question-contract", "Pool question activation contract", "opportunities", ["POOL_QUESTIONS_MINING", "POOL_QUESTIONS_MODE", "POOL_QUESTIONS_PUSH", "POOL_QUESTIONS_VISIT_TRIGGER", "POOL_QUESTIONS_STAMP_NEWBORN"], "off", [
      mode("off", {}, "Pool-question activation contracts resolve off.", true),
      mode("shadow-mining", { POOL_QUESTIONS_MINING: "shadow" }, "Shadow mining is declared; direct package activation remains unresolved."),
      mode("on-pull", { POOL_QUESTIONS_MODE: "on" }, "Pull-mode question activation is declared; direct package activation remains unresolved."),
      mode("on-push", { POOL_QUESTIONS_MODE: "on", POOL_QUESTIONS_PUSH: "on" }, "Push activation is declared; direct package activation remains unresolved."),
      mode("on-visit", { POOL_QUESTIONS_MODE: "on", POOL_QUESTIONS_VISIT_TRIGGER: "on" }, "Visit-trigger activation is declared; direct package activation remains unresolved."),
      mode("on-newborn", { POOL_QUESTIONS_MODE: "on", POOL_QUESTIONS_STAMP_NEWBORN: "on" }, "Newborn stamping is declared; direct package activation remains unresolved."),
    ], null, ["evaluate-fit"], "unresolved"),
    experiment("pool-ranking", "Pool-question Radar ranking", "opportunities", ["POOL_QUESTIONS_RANKING"], "off", [
      mode("off", {}, "Radar confidence is not adjusted by answered discriminators.", true),
      mode("on", { POOL_QUESTIONS_RANKING: "on" }, "Answered pool discriminators adjust Radar confidence.", false, "changed"),
    ], definitiveEvidence.ranking, ["retrieve-candidates"]),
    experiment("negotiation-evidence-contract", "Negotiation-evidence questions contract", "opportunities", ["NEGOTIATION_EVIDENCE_QUESTIONS_MODE"], "off", [
      mode("off", {}, "Negotiation-evidence question mode resolves off.", true),
      mode("shadow", { NEGOTIATION_EVIDENCE_QUESTIONS_MODE: "shadow" }, "Shadow mode resolves, but no direct package activation consumer is established."),
      mode("on-alias", { NEGOTIATION_EVIDENCE_QUESTIONS_MODE: "on" }, "Current package handling treats on as the same shadow-pipeline activation contract."),
    ], null, ["evaluate-fit"], "unresolved"),
    experiment("outcome-questions-contract", "Outcome questions contract", "opportunities", ["OUTCOME_QUESTIONS_MODE"], "off", [
      mode("off", {}, "Outcome-question mode resolves off.", true),
      mode("shadow", { OUTCOME_QUESTIONS_MODE: "shadow" }, "The protocol accessor activates shadow capture; its invoking path remains unresolved here."),
      mode("on-alias", { OUTCOME_QUESTIONS_MODE: "on" }, "Current package activation treats on as shadow-equivalent for capture and mining."),
    ], null, ["evaluate-fit"], "unresolved"),
  ];

  function mode(id, values, explanation, fallback = false, effect = "changed", prerequisites = [], caveats = [], options = {}) {
    return { id, values, explanation, fallback, effect, prerequisites, caveats, ...options };
  }

  root.ProtocolAtlasContent = Object.freeze({
    schemaVersion: 1,
    configurationDisclaimer: CONFIGURATION_DISCLAIMER,
    configurationExperiments,
    chapters: [
      {
        id: "orientation",
        title: "Orientation",
        summary: "Read normative protocol meaning first, then inspect the current package implementation without confusing product or historical vocabulary for universal rules.",
        stepIds: [],
        sections: [
          { id: "protocol-layers", title: "Protocol and Implementation layers", summary: "The Protocol layer explains storage-independent concepts and invariants; the Implementation layer cites the current packages/protocol reference implementation.", items: ["Protocol: normative concepts, trust boundaries, and invariants", "Implementation: current package facades, graphs, tools, agents, ports, and host requirements"] },
          { id: "vocabulary-layers", title: "Three vocabulary layers", summary: "Terms remain visibly translated instead of silently merged.", items: ["Normative protocol vocabulary", "Current product vocabulary", "Historical/internal implementation vocabulary"] },
        ],
      },
      {
        id: "primitives",
        title: "Primitives",
        summary: "Meet the protocol concepts before following how approved material becomes attributable, scoped context.",
        stepIds: trustedContextSteps.map(({ id }) => id),
        sections: [
          { id: "protocol-primitives", title: "Protocol primitives", summary: "The stable conceptual vocabulary used throughout the atlas.", items: ["Participant", "Software Agent", "Signal", "Premise", "Context", "Community", "Membership", "Agent Permission", "Effective Scope", "Candidate", "Opportunity", "Negotiation", "Connection", "Provider/helper role"] },
          { id: "agent-role-distinction", title: "Agent is not a valency role", summary: "A Software Agent is an attributable software actor. Provider/helper role is a negotiated relationship role that historical implementation vocabulary calls valency role agent.", items: ["Software Agent: registered actor", "Provider/helper role: relationship role, not software"] },
        ],
      },
      {
        id: "trust-scope",
        title: "Trust + Scope",
        summary: "Understand how verified Signals remain bounded by intersected authority, privacy, and participant consent.",
        stepIds: expressSignalSteps.map(({ id }) => id),
        sections: [
          { id: "effective-scope-intersection", title: "Effective scope is an intersection", summary: "Effective scope = request scope ∩ active memberships ∩ agent permissions ∩ applicable Community policy.", items: ["No single assignment, credential, or request widens another constraint", "Every delegated action remains attributable"] },
          { id: "privacy-and-consent", title: "Privacy, minimization, and consent", summary: "Data minimization keeps only necessary approved evidence; incognito behavior prevents identity or context from being surfaced beyond its permitted scope; agent negotiation never substitutes for participant consent.", items: ["Attribution", "Privacy and data minimization", "Incognito behavior", "Participant consent boundary"] },
        ],
      },
      {
        id: "discovery",
        title: "Discovery",
        summary: "Follow background processing as it evaluates private Candidates and surfaces safe, legible Opportunities.",
        stepIds: discoverOpportunitySteps.map(({ id }) => id),
      },
      {
        id: "consent",
        title: "Consent",
        summary: "See how separate explicit participant decisions—not agent negotiation—allow an Opportunity to become a Connection.",
        stepIds: consentConnectSteps.map(({ id }) => id),
      },
      {
        id: "runtime",
        title: "Runtime",
        summary: "Drill down through package-owned composition and stop at every injected host boundary.",
        stepIds: externalAgentMcpSteps.map(({ id }) => id),
        sections: [
          { id: "runtime-drilldown", title: "Reference runtime drill-down", summary: "Follow the implementation hierarchy without crossing into a concrete host.", items: ["Protocol entry surface", "Runtime shell", "Capability facade", "Tool or graph factory", "Graph node or structured agent", "Domain state and schema", "Injected port", "Required host capability"] },
          { id: "host-boundary-stop", title: "Stop at the host boundary", summary: "The protocol declares the injected port or callback and the required host capability. Concrete adapters, routes, queues, persistence, and deployment remain outside this atlas.", items: ["Describe the requirement", "Do not depict concrete host implementation"] },
        ],
      },
      {
        id: "explore",
        title: "Explore",
        summary: "Inspect generated package nodes and edges while keeping host fulfillment outside the atlas boundary.",
        stepIds: [],
      },
    ],
    flows: [
      {
        id: "trusted-context",
        chapterId: "primitives",
        title: "Build trusted participant context",
        summary: "Turn approved material into scoped, refreshable context without fabricating participant facts.",
        steps: trustedContextSteps,
      },
      {
        id: "express-signal",
        chapterId: "trust-scope",
        title: "Express and admit a Signal",
        summary: "Interpret, verify, reconcile, scope, and defer a participant's desired-future-state expression.",
        steps: expressSignalSteps,
      },
      {
        id: "discover-opportunity",
        chapterId: "discovery",
        title: "Discover an Opportunity",
        summary: "Resolve scope, evaluate private candidates, optionally negotiate fit, and surface safe context.",
        steps: discoverOpportunitySteps,
      },
      {
        id: "consent-connect",
        chapterId: "consent",
        title: "Consent before connection",
        summary: "Require separate participant actions before opening a direct human conversation.",
        steps: consentConnectSteps,
      },
      {
        id: "external-agent-mcp",
        chapterId: "runtime",
        title: "Authorize an external agent through MCP",
        summary: "Resolve identity and enforce effective capability scope before invoking a protocol tool.",
        steps: externalAgentMcpSteps,
      },
    ],
    concepts: [
      { id: "participant", title: "Participant", definition: "A human whose approved material, Signals, permissions, and consent the protocol serves.", normative: true },
      { id: "software-agent", title: "Software Agent", definition: "A registered software actor that may act only through attributable, participant-granted capabilities.", normative: true },
      { id: "signal", title: "Signal", definition: "A participant-approved expression of a desired future state; called an intent in current package implementation names.", normative: true },
      { id: "premise", title: "Premise", definition: "An atomic, attributable claim approved for use in participant context.", normative: true },
      { id: "context", title: "Context", definition: "A scoped, current synthesis of active premises used to interpret and evaluate protocol actions.", normative: true },
      { id: "community", title: "Community", definition: "A trust and discovery scope in which admitted participants and Signals may be evaluated; product language says Network.", normative: true },
      { id: "membership", title: "Membership", definition: "A participant's current admission and role within a Community.", normative: true },
      { id: "agent-permission", title: "Agent Permission", definition: "A participant-granted authorization for a Software Agent to perform named actions in bounded scope.", normative: true },
      { id: "effective-scope", title: "Effective Scope", definition: "The intersection of request scope, active Community memberships, agent permissions, and applicable Community policy.", normative: true },
      { id: "candidate", title: "Candidate", definition: "A private possible counterpart under evaluation; it is not participant-visible and carries no implication of consent.", normative: true },
      { id: "opportunity", title: "Opportunity", definition: "A participant-visible, safely presented prospect that passed admission and fit checks but is not yet a Connection.", normative: true },
      { id: "negotiation", title: "Negotiation", definition: "A bounded, attributable agent exchange that may clarify fit and roles but cannot give participant consent.", normative: true },
      { id: "connection", title: "Connection", definition: "A direct human conversation opened only after the required participants explicitly consent.", normative: true },
      { id: "provider-helper-role", title: "Provider/helper role", definition: "A negotiated relationship role; the implementation currently calls the corresponding valency role agent.", normative: true },
      { id: "radar", title: "Radar", definition: "Reference-implementation retrieval machinery used to find private Candidates; it is not a normative primitive.", normative: false, classification: "product/reference-implementation" },
    ],
    invariants: [
      { id: "scope-intersection", title: "Scope is intersected", text: "Effective scope is the intersection of request scope, active Community memberships, agent permissions, and applicable Community policy; no input widens another." },
      { id: "participant-consent", title: "Participants decide", text: "Material use, sending, acceptance, and connection require the participant decisions specified for each action." },
      { id: "action-attribution", title: "Actions are attributable", text: "Every participant or Software Agent action must remain attributable to an authenticated actor and, for delegated action, its participant authority." },
      { id: "candidate-private", title: "Candidates remain private", text: "Candidate identity and private evaluation evidence are not disclosed merely because discovery retrieved or evaluated a possible counterpart." },
      { id: "no-fabrication", title: "No fabricated participant facts", text: "Inference and synthesis may organize approved evidence but must not invent participant claims, preferences, or consent." },
      { id: "context-freshness", title: "Derived context stays fresh", text: "A derived context or retrieval representation must be refreshed or rejected when its active premises or scope have changed." },
      { id: "opportunity-legibility", title: "Opportunities are legible", text: "A surfaced Opportunity must provide enough recipient-safe explanation for an informed action without exposing private Candidate evidence." },
      { id: "terminality", title: "Terminal decisions stay terminal", text: "Declined, expired, withdrawn, or otherwise terminal records are not silently revived or merged into a new lifecycle." },
      { id: "host-boundary", title: "Hosts fulfill declared boundaries", text: "The protocol declares required ports and callbacks; how a host fulfills them is outside this atlas." },
      { id: "negotiation-not-consent", title: "Negotiation is not consent", text: "Agent negotiation may assess fit or roles, but only the required explicit participant actions authorize sending and Connection." },
    ],
    vocabulary: [
      { id: "signal-intent", protocolTerm: "Signal", productTerm: "Signal", implementationTerm: "intent", note: "Implementation symbols retain intent naming while protocol prose uses Signal." },
      { id: "community-network", protocolTerm: "Community", productTerm: "Network", implementationTerm: "network/index", note: "Community is the normative trust scope; Network and index remain visible product and implementation terms." },
      { id: "participant-person", protocolTerm: "Participant", productTerm: "Person", implementationTerm: "user", note: "User identifiers and database-facing types implement the human Participant concept." },
      { id: "opportunity-lifecycle", protocolTerm: "Draft/Sent/Connected/Declined/Expired", productTerm: "Draft/Sent/Connected/Declined/Expired", implementationTerm: "internal lifecycle states", note: "The product vocabulary is explanatory and is not falsely merged with current internal state names." },
      { id: "software-agent-registry", protocolTerm: "Software Agent", productTerm: "Software Agent", implementationTerm: "agent registry actor", note: "Registry presence identifies an actor but does not itself grant effective scope." },
      { id: "provider-helper-valency", protocolTerm: "provider/helper role", productTerm: "provider/helper role", implementationTerm: "internal valency role \"agent\"", note: "The internal role label is mapped, not promoted to a normative primitive." },
    ],
    relationships: [
      { id: "participant-approves-premise", kind: "conceptual", sourceConceptId: "participant", targetConceptId: "premise", label: "approves" },
      { id: "premise-builds-context", kind: "conceptual", sourceConceptId: "premise", targetConceptId: "context", label: "supports" },
      { id: "signal-admitted-to-community", kind: "conceptual", sourceConceptId: "signal", targetConceptId: "community", label: "is admitted to" },
      { id: "scope-guards-candidate", kind: "conceptual", sourceConceptId: "effective-scope", targetConceptId: "candidate", label: "bounds retrieval of" },
      { id: "candidate-may-become-opportunity", kind: "conceptual", sourceConceptId: "candidate", targetConceptId: "opportunity", label: "may be safely presented as" },
      { id: "opportunity-may-become-connection", kind: "conceptual", sourceConceptId: "opportunity", targetConceptId: "connection", label: "may become after bilateral consent" },
      { id: "gap-bounded-negotiation", kind: "discrepancy", title: "Bounded negotiation versus external-agent exception", summary: "Normative negotiation is bounded. The current package graph treats maxTurns=0 as uncapped when both participants have external agents; this is an implementation discrepancy, not a new rule.", sourcePaths: ["packages/protocol/src/negotiations/application/negotiation.graph.ts"] },
      { id: "gap-lifecycle-vocabulary", kind: "discrepancy", title: "Product and internal lifecycle vocabularies", summary: "Draft/Sent/Connected/Declined/Expired are product states, while the package uses internal lifecycle states. The atlas maps both and does not invent a merged lifecycle.", sourcePaths: ["packages/protocol/src/opportunities/application/opportunity.tools.ts"] },
      { id: "gap-community-network", kind: "discrepancy", title: "Community versus Network/index", summary: "Community is the normative protocol concept; Network is product language and network/index is current implementation vocabulary.", sourcePaths: ["packages/protocol/src/networks/application/network.graph.ts", "packages/protocol/src/networks/application/indexer.graph.ts"] },
      { id: "gap-background-discovery", kind: "discrepancy", title: "Background discovery versus stale synchronous examples", summary: "Current opportunity creation is background-only. Synchronous examples are stale explanatory material and do not define an alternate protocol flow.", sourcePaths: ["packages/protocol/src/opportunities/application/opportunity.graph.ts"] },
      { id: "gap-candidate-presentation", kind: "discrepancy", title: "Private Candidate versus surfaced Opportunity", summary: "Candidate identity and evaluation stay private; only a recipient-safe Opportunity presentation is surfaced. The two are not interchangeable records.", sourcePaths: ["packages/protocol/src/opportunities/application/opportunity.presenter.ts"] },
      { id: "reference-radar", kind: "reference-concept", title: "Radar", summary: "Product/reference-implementation retrieval concept; not a normative primitive." },
      { id: "reference-semantic-entropy", kind: "reference-concept", title: "Semantic entropy", summary: "Product/reference-implementation uncertainty technique; not a normative primitive." },
      { id: "reference-felicity-conditions", kind: "reference-concept", title: "Felicity conditions", summary: "Product/reference-implementation speech-act framing; not a normative primitive." },
      { id: "reference-referential-anchors", kind: "reference-concept", title: "Referential anchors", summary: "Product/reference-implementation grounding technique; not a normative primitive." },
      { id: "reference-hyde", kind: "reference-concept", title: "HyDE", summary: "Reference-implementation retrieval representation; not a normative primitive.", nodeId: "component.hyde-graph-factory" },
      { id: "reference-valency", kind: "reference-concept", title: "Valency", summary: "Product/reference-implementation role model; not a normative primitive." },
      { id: "reference-gricean-presentation", kind: "reference-concept", title: "Gricean presentation", summary: "Product/reference-implementation presentation guidance; not a normative primitive." },
    ],
  });
}(globalThis));
