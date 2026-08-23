import { createChatTools, type ChatTools, type ResolvedToolContext, type ToolContext } from "../shared/agent/tool.factory.js";
import { resolveChatContext } from "../shared/agent/tool.helpers.js";
import { deriveAllowedNetworkIds, scopeFromNetworkId } from "../shared/agent/tool.scope.js";
import type { ChatPersonaConfig } from "./chat.persona.js";
import { narrowSignalTools } from "./signal.persona.js";
import { buildOnboardingSystemContent, type OnboardingPromptOptions } from "./onboarding.prompt.js";

/** Public kickoff marker used by the restricted web profile phase. */
export { ONBOARDING_PROFILE_KICKOFF } from "./onboarding.prompt.js";

/** Stable persona id persisted for restricted web onboarding conversations. */
export const ONBOARDING_PERSONA_ID = "onboarding";

/**
 * Exact positive allowlist for Onboarding Agent.
 *
 * Profile confirmation performs the approved premise decomposition internally,
 * so this persona does not need arbitrary premise writes. New shared tools stay
 * unavailable until explicitly reviewed here.
 */
export const ONBOARDING_TOOL_NAMES = [
  "research_profile",
  "create_intent",
] as const;

const ONBOARDING_TOOL_ALLOWLIST: ReadonlySet<string> = new Set(ONBOARDING_TOOL_NAMES);

/** Filters the shared registry through Onboarding Agent's exact allowlist. */
export function filterOnboardingTools<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((candidate) => ONBOARDING_TOOL_ALLOWLIST.has(candidate.name));
}

/** Creates the context-bound, allowlisted, proposal-only onboarding toolset. */
export async function createOnboardingTools(
  deps: ToolContext,
  preResolvedContext?: ResolvedToolContext,
): Promise<ChatTools> {
  const explicitScope = deps.scopeType && deps.scopeId
    ? { scopeType: deps.scopeType, scopeId: deps.scopeId }
    : scopeFromNetworkId(deps.networkId);
  const resolvedContext = preResolvedContext ?? await resolveChatContext({
    database: deps.database,
    userId: deps.userId,
    networkId: explicitScope.scopeType === "network" ? explicitScope.scopeId : deps.networkId,
    sessionId: deps.sessionId,
  });
  if (explicitScope.scopeType && explicitScope.scopeId) {
    resolvedContext.scopeType = explicitScope.scopeType;
    resolvedContext.scopeId = explicitScope.scopeId;
  }

  const userDb = deps.userDb ?? deps.createUserDatabase(deps.database, resolvedContext.userId);
  const memberships = await userDb.getNetworkMemberships();
  const allowedNetworkIds = deriveAllowedNetworkIds({
    memberships,
    ...(resolvedContext.scopeType && resolvedContext.scopeId
      ? { scopeType: resolvedContext.scopeType, scopeId: resolvedContext.scopeId }
      : {}),
  });
  const systemDb = deps.systemDb
    ?? deps.createSystemDatabase(deps.database, resolvedContext.userId, allowedNetworkIds, deps.embedder);
  const allowed = filterOnboardingTools(
    await createChatTools(deps, resolvedContext),
  ) as ChatTools;

  // Reuse Signal's reviewed create_intent/self-read narrowing.
  return narrowSignalTools(allowed, { context: resolvedContext, userDb, systemDb });
}

/** Identity this persona introduces itself with. */
export type OnboardingPersonaOptions = OnboardingPromptOptions;

/**
 * Creates the restricted web onboarding persona on the persona-neutral chat
 * runtime. A factory, not a singleton, because the persona introduces itself
 * as the user's own agent — named from their `type='personal'` agent row,
 * which `ensureNegotiatorAgent` writes at auth, before onboarding ever runs.
 *
 * @param opts - Identity from the user's `type='personal'` agent row
 */
export function createOnboardingPersona(opts: OnboardingPersonaOptions = {}): ChatPersonaConfig {
  return {
    id: ONBOARDING_PERSONA_ID,
    buildSystemContent: (ctx, iterCtx) => buildOnboardingSystemContent(ctx, opts, iterCtx),
    createTools: (deps, preResolvedContext) => createOnboardingTools(deps, preResolvedContext),
    loopBehaviors: {
      hallucinationRecovery: true,
    },
  };
}
