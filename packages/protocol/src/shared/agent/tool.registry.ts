import { z } from 'zod';

import type { DefineTool, ResolvedToolContext, ToolDeps, RawToolDefinition, ToolRegistry } from './tool.helpers.js';
import { error, redactSensitiveFields } from './tool.helpers.js';
import { createEnrichmentTools } from '../../enrichment/enrichment.tools.js';
import { createIntentTools } from '../../intent/intent.tools.js';
import { createNetworkTools } from '../../network/network.tools.js';
import { createOpportunityTools } from '../../opportunity/opportunity.tools.js';
import { createUtilityTools } from './utility.tools.js';
import { createIntegrationTools } from '../../integration/integration.tools.js';
import { createContactTools } from '../../contact/contact.tools.js';
import { createAgentTools } from '../../agent/agent.tools.js';
import { createNegotiationTools } from '../../negotiation/negotiation.tools.js';
import { createChatTools } from '../../chat/chat.tools.js';
import { createPremiseTools } from '../../premise/premise.tools.js';
import { createQuestionerTools } from '../../questioner/questioner.tools.js';
import { protocolLogger } from '../observability/protocol.logger.js';
import { requestContext } from '../observability/request-context.js';

const logger = protocolLogger('ToolRegistry');

/**
 * Creates a tool registry containing all tool handlers indexed by name.
 * Handlers are raw async functions (not LangChain tool() wrappers) that
 * accept { context, query } and return a JSON string.
 *
 * @param deps - Shared tool dependencies (graphs, database, embedder, etc.)
 * @param context - Resolved user context for this request.
 * @returns Map of tool name to raw tool definition.
 */
export function createToolRegistry(deps: ToolDeps): ToolRegistry {
  const registry: ToolRegistry = new Map();

  // defineTool that captures raw handlers into the registry
  function defineTool<T extends z.ZodType>(opts: {
    name: string;
    description: string;
    querySchema: T;
    handler: (input: { context: ResolvedToolContext; query: z.infer<T> }) => Promise<string>;
  }) {
    const entry: RawToolDefinition = {
      name: opts.name,
      description: opts.description,
      schema: opts.querySchema,
      handler: async (input: { context: ResolvedToolContext; query: unknown }) => {
        logger.verbose(`Tool: ${opts.name}`, {
          context: { userId: input.context.userId, networkId: input.context.networkId },
          query: redactSensitiveFields(input.query),
        });
        try {
          return await opts.handler({ context: input.context, query: input.query as z.infer<T> });
        } catch (err) {
          const abortSignal = requestContext.getStore()?.abortSignal;
          if (abortSignal?.aborted) {
            throw err;
          }
          logger.error(`${opts.name} failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
          return error(`Failed to execute ${opts.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    };

    registry.set(opts.name, entry);

    // Return a dummy — create*Tools functions collect return values into arrays,
    // but for the registry path we only need the side-effect on the Map.
    return null as unknown;
  }

  // Create all tool domains -- each one calls defineTool() which populates the registry.
  // The local defineTool is compatible with DefineTool (which returns any).
  const dt = defineTool as DefineTool;
  createEnrichmentTools(dt, deps);
  createIntentTools(dt, deps);
  createNetworkTools(dt, deps);
  createOpportunityTools(dt, deps);
  createUtilityTools(dt, deps);
  createIntegrationTools(dt, deps);
  createContactTools(dt, deps);
  createAgentTools(dt, deps);
  createNegotiationTools(dt, deps);
  createPremiseTools(dt, deps);
  createQuestionerTools(dt, deps);
  if (deps.chatSession) {
    createChatTools(dt, deps);
  }

  // Deprecated tool-name aliases (IND-371). The canonical implementations are now
  // registered under their *_user_context / *_enrichment_run names; we expose the
  // legacy *_user_profile / *_profile_run names as thin aliases that delegate to the
  // exact same handler + schema, so existing MCP clients keep working while they
  // migrate. The old names are removed in IND-373.
  const DEPRECATED_TOOL_ALIASES: ReadonlyArray<readonly [oldName: string, canonicalName: string]> = [
    ["read_user_profiles", "read_user_contexts"],
    ["create_user_profile", "create_user_context"],
    ["update_user_profile", "update_user_context"],
    ["confirm_user_profile", "confirm_user_context"],
    ["preview_user_profile", "preview_user_context"],
    ["get_profile_run", "get_enrichment_run"],
    ["cancel_profile_run", "cancel_enrichment_run"],
  ];
  for (const [oldName, canonicalName] of DEPRECATED_TOOL_ALIASES) {
    const canonical = registry.get(canonicalName);
    if (!canonical) {
      logger.warn(`Cannot register deprecated alias ${oldName}: canonical ${canonicalName} not found`);
      continue;
    }
    registry.set(oldName, {
      ...canonical,
      name: oldName,
      description: `[DEPRECATED — use \`${canonicalName}\` instead; this alias is retained for backward compatibility and will be removed.] ${canonical.description}`,
    });
  }

  logger.verbose(`Tool registry created with ${registry.size} tools`);
  return registry;
}
