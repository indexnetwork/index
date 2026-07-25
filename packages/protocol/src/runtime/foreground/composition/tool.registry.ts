import { z } from 'zod';

import type { DefineTool, ResolvedToolContext, ToolDeps, RawToolDefinition, ToolRegistry } from '../../../shared/agent/tool.helpers.js';
import { error, redactSensitiveFields } from '../../../shared/agent/tool.helpers.js';
import { createEnrichmentTools } from '../../../enrichment/enrichment.tools.js';
import { createIntentTools } from '../signals/intent.tools.js';
import { createNetworkTools } from '../../../capabilities/communities.facade.js';
import { createOpportunityTools } from '../../../capabilities/opportunities.facade.js';
import { createUtilityTools } from '../../../shared/agent/utility.tools.js';
import type { ToolSurface } from '../../../shared/agent/utility.tools.js';
import { createIntegrationTools } from '../../../capabilities/integrations.facade.js';
import { createContactTools } from '../../../capabilities/contacts.facade.js';
import { createAgentTools } from '../../../capabilities/participant-agents.tools.facade.js';
import { createNegotiationTools } from '../../../capabilities/negotiation.facade.js';
import { createChatTools } from '../../../chat/chat.tools.js';
import { createPremiseTools } from '../../../premise/premise.tools.js';
import { createQuestionerTools } from '../../../capabilities/questions.facade.js';
import { protocolLogger } from '../../../shared/observability/protocol.logger.js';
import { requestContext } from '../../../shared/observability/request-context.js';

const logger = protocolLogger('ToolRegistry');

export interface CreateToolRegistryOptions {
  /**
   * Tool-surface profile. The default `'rest'` profile (direct HTTP Tool API)
   * exposes the full tool set — contact/Gmail tools, `scrape_url`, and the
   * deprecated profile/profile-run compatibility aliases. The restricted
   * `'mcp'` profile omits exactly those surfaces (IND-596/597/598); their
   * non-MCP implementations remain intact for REST and chat.
   */
  surface?: ToolSurface;
}

/**
 * Creates a tool registry containing all tool handlers indexed by name.
 * Handlers are raw async functions (not LangChain tool() wrappers) that
 * accept { context, query } and return a JSON string.
 *
 * @param deps - Shared tool dependencies (graphs, database, embedder, etc.)
 * @param options - Surface profile selecting the MCP-restricted or full REST set.
 * @returns Map of tool name to raw tool definition.
 */
export function createToolRegistry(deps: ToolDeps, options: CreateToolRegistryOptions = {}): ToolRegistry {
  const registry: ToolRegistry = new Map();
  const isMcpSurface = options.surface === 'mcp';

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
        logger.verbose('Tool invoked', {
          toolName: opts.name,
          context: { userId: input.context.userId, scopeType: input.context.scopeType, scopeId: input.context.scopeId },
          query: redactSensitiveFields(input.query),
        });
        try {
          return await opts.handler({ context: input.context, query: input.query as z.infer<T> });
        } catch (err) {
          const abortSignal = requestContext.getStore()?.abortSignal;
          if (abortSignal?.aborted) {
            throw err;
          }
          logger.error('Tool failed', {
            toolName: opts.name,
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
  // Utility tools always register read_docs + read_activity_summary; on the
  // MCP surface scrape_url is omitted and read_docs guidance is sanitized
  // (IND-597). The retired report_agent_activity name retains no alias on
  // either surface (IND-605).
  createUtilityTools(dt, deps, { surface: isMcpSurface ? 'mcp' : 'rest' });
  // Contact/Gmail import tools are omitted from the MCP surface (IND-596). Their
  // implementations remain available to the REST Tool API and chat agent.
  if (!isMcpSurface) {
    createIntegrationTools(dt, deps);
    createContactTools(dt, deps);
  }
  createAgentTools(dt, deps);
  createNegotiationTools(dt, deps);
  createPremiseTools(dt, deps);
  createQuestionerTools(dt, deps);
  if (deps.chatSession) {
    createChatTools(dt, deps);
  }

  // Deprecated tool-name aliases (IND-371). The canonical implementations are
  // registered under their *_user_context / *_enrichment_run names; the legacy
  // *_user_profile / *_profile_run names are retained as thin aliases that
  // delegate to the exact same handler + schema so existing direct HTTP Tool
  // API clients keep working. These aliases are NOT exposed on the MCP surface
  // (IND-598) — MCP callers must use the canonical names.
  if (!isMcpSurface) {
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
        logger.warn('Cannot register deprecated alias: canonical tool not found', { alias: oldName, canonicalName });
        continue;
      }
      registry.set(oldName, {
        ...canonical,
        name: oldName,
        description: `[DEPRECATED — use \`${canonicalName}\` instead; this alias is retained for backward compatibility and will be removed.] ${canonical.description}`,
      });
    }
  }

  logger.verbose('Tool registry created', { toolCount: registry.size, surface: options.surface ?? 'rest' });
  return registry;
}
