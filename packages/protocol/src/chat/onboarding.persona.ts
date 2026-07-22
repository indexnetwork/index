import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createChatTools, type ChatTools, type ResolvedToolContext, type ToolContext } from "../shared/agent/tool.factory.js";
import { resolveChatContext } from "../shared/agent/tool.helpers.js";
import { deriveAllowedNetworkIds, scopeFromNetworkId } from "../shared/agent/tool.scope.js";
import type { ChatPersonaConfig } from "./chat.persona.js";
import { narrowSignalTools } from "./signal.persona.js";
import { buildOnboardingSystemContent } from "./onboarding.prompt.js";

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
  "record_onboarding_privacy_consent",
  "read_user_contexts",
  "preview_user_context",
  "confirm_user_context",
  "ask_user_question",
  "create_intent",
  "complete_onboarding",
] as const;

const ONBOARDING_TOOL_ALLOWLIST: ReadonlySet<string> = new Set(ONBOARDING_TOOL_NAMES);

/** Filters the shared registry through Onboarding Agent's exact allowlist. */
export function filterOnboardingTools<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((candidate) => ONBOARDING_TOOL_ALLOWLIST.has(candidate.name));
}

/**
 * Narrows shared onboarding tools whose generic schemas exceed the web flow.
 * Consent is public-lookup-only with server-fixed provenance, and chat-side
 * completion requires an exact intent ID (the direct REST tool remains the
 * browser's normal completion path).
 */
export function narrowOnboardingTools(allowed: ChatTools): ChatTools {
  return allowed.map((sharedTool) => {
    if (sharedTool.name === "record_onboarding_privacy_consent") {
      return tool(
        async (query: { publicProfileLookupGranted: boolean }) => sharedTool.invoke({
          publicProfileLookupGranted: query.publicProfileLookupGranted,
          source: "web_onboarding",
        }) as Promise<string>,
        {
          name: "record_onboarding_privacy_consent",
          description: "Record the authenticated user's explicit public-profile lookup choice for web onboarding. Ask first; this does not perform lookup.",
          schema: z.object({ publicProfileLookupGranted: z.boolean() }).strict(),
        },
      );
    }

    if (sharedTool.name === "complete_onboarding") {
      return tool(
        async (query: { intentId: string }) => sharedTool.invoke({ intentId: query.intentId }) as Promise<string>,
        {
          name: "complete_onboarding",
          description: "Validate completion only for the exact active first-signal ID returned after user confirmation.",
          schema: z.object({ intentId: z.string().uuid() }).strict(),
        },
      );
    }

    return sharedTool;
  }) as ChatTools;
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
    contactsEnabled: deps.contactsEnabled,
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

  // Reuse Signal's reviewed create_intent/self-read narrowing, then clamp the
  // onboarding-specific generic schemas to the exact web flow.
  return narrowOnboardingTools(
    narrowSignalTools(allowed, { context: resolvedContext, userDb, systemDb }),
  );
}

/** Restricted web onboarding persona on the persona-neutral chat runtime. */
export const ONBOARDING_PERSONA: ChatPersonaConfig = {
  id: ONBOARDING_PERSONA_ID,
  buildSystemContent: (ctx, iterCtx) => buildOnboardingSystemContent(ctx, iterCtx),
  createTools: (deps, preResolvedContext) => createOnboardingTools(deps, preResolvedContext),
  loopBehaviors: {
    createIntentCallback: false,
    hallucinationRecovery: true,
  },
};
