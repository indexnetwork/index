/**
 * Participant-agents capability facade.
 *
 * Aggregates the full participant-agents capability surface:
 *
 * 1. **Agent registration and permission management** — sourced from the
 *    canonical participant-agents domain-first module (IND-548):
 *    - `createAgentTools` — registration, list, update, delete, grant/revoke tools
 *    - `AgentToolDeps` — narrow tool host port
 *
 * 2. **Runtime personas, chat graph, and tool-composition seams** — sourced
 *    from chat/ (runtime foreground; not owned by participant-agents module):
 *    - `ChatGraphFactory`, persona ids and factories, etc.
 *    - `ChatTitleGenerator`, `ChatInterruptClassifier`, `ChatSummarizer`, etc.
 *
 * Runtime personas, chat/MCP transport, authentication, and all-capability
 * tool composition remain in runtime foreground composition/adapters and must
 * not be pulled into the participant-agents domain module.
 *
 * IND-548: agent-registry portion now routes through participant-agents/public.
 */

// ── Agent registration and permission management ──────────────────────────────
export { createAgentTools, SYSTEM_AGENT_IDS } from "../participant-agents/public/index.js";
export type { AgentToolDeps } from "../participant-agents/public/index.js";

// ── Runtime chat graph ────────────────────────────────────────────────────────
export { ChatGraphFactory } from "../chat/chat.graph.js";
export type { ChatPersonaConfig } from "../chat/chat.persona.js";
export { NEGOTIATOR_PERSONA_ID, createNegotiatorPersona } from "../chat/negotiator.persona.js";
export { SIGNAL_PERSONA_ID, SIGNAL_PERSONA, SIGNAL_NEW_SIGNAL_KICKOFF, SIGNAL_TOOL_NAMES, createSignalTools, filterSignalTools, narrowSignalTools } from "../chat/signal.persona.js";
export { REPORTER_PERSONA_ID, REPORTER_PERSONA, REPORTER_BRIEFING_KICKOFF, REPORTER_TOOL_NAMES, createReporterTools, filterReporterTools, narrowReporterTools } from "../chat/reporter.persona.js";
export { ONBOARDING_PERSONA_ID, ONBOARDING_PERSONA, ONBOARDING_PROFILE_KICKOFF, ONBOARDING_TOOL_NAMES, createOnboardingTools, filterOnboardingTools, narrowOnboardingTools } from "../chat/onboarding.persona.js";
export { ChatTitleGenerator } from "../chat/chat.title.generator.js";
export { ChatInterruptClassifier } from "../chat/chat.interrupt.classifier.js";
export { ChatSummarizer } from "../chat/chat.summarizer.js";
export { SuggestionGenerator } from "../chat/chat.suggester.js";
export { createChatTools } from "../chat/chat.tools.js";
