import { z } from 'zod';

import type { DefineTool, ResolvedToolContext, ToolDeps, RawToolDefinition, ToolRegistry } from './tool.helpers.js';
import { error, redactSensitiveFields } from './tool.helpers.js';
import { createEnrichmentTools } from '../../enrichment/enrichment.tools.js';
import { Intents } from '../../intents/intent.module.js';
import { Networks } from '../../networks/network.module.js';
import { createOpportunityTools } from '../../opportunities/index.js';
import { createUtilityTools } from './utility.tools.js';
import type { ToolSurface } from './utility.tools.js';
import { createContactTools } from '../../contacts/index.js';
import { createAgentTools } from '../../agents/index.js';
import { createNegotiationTools } from '../../negotiations/index.js';
import { createChatTools } from '../../chat/chat.tools.js';
import { createPremiseTools } from '../../premises/premise.tools.js';
import { createQuestionerTools } from '../../questions/index.js';
import type { OpportunityOwnerApprovalDeps } from '../../opportunities/ports/opportunity.tools.port.js';
import { protocolLogger } from '../observability/protocol.logger.js';
import { requestContext } from '../observability/request-context.js';

const logger = protocolLogger('ToolRegistry');

export interface CreateToolRegistryOptions {
  /**
   * Tool-surface profile. The default `'rest'` profile (direct HTTP Tool API)
   * exposes contact/Gmail tools, `scrape_url`, and `complete_onboarding`. The
   * restricted `'mcp'` profile omits those surfaces (IND-596/597). Retired
   * profile/profile-run compatibility aliases are absent from both profiles
   * (IND-373/598).
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
/** Complete registry composition with the opportunity-local owner-proof port. */
export type ToolRegistryDeps = ToolDeps & OpportunityOwnerApprovalDeps;

export function createToolRegistry(deps: ToolRegistryDeps, options: CreateToolRegistryOptions = {}): ToolRegistry {
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
  createEnrichmentTools(dt, deps, { surface: isMcpSurface ? 'mcp' : 'rest' });
  Intents.createTools(dt, deps);
  Networks.createTools(dt, deps);
  createOpportunityTools(dt, deps);
  // Utility tools always register read_docs + read_activity_summary; on the
  // MCP surface scrape_url is omitted and read_docs guidance is sanitized
  // (IND-597). The retired report_agent_activity name retains no alias on
  // either surface (IND-605).
  createUtilityTools(dt, deps, { surface: isMcpSurface ? 'mcp' : 'rest' });
  // Contact tools are omitted from the MCP surface (IND-596). Their
  // implementations remain available to the REST Tool API and chat agent.
  if (!isMcpSurface) {
    createContactTools(dt, deps);
  }
  createAgentTools(dt, deps);
  createNegotiationTools(dt, deps);
  createPremiseTools(dt, deps);
  createQuestionerTools(dt, deps);
  if (deps.chatSession) {
    createChatTools(dt, deps);
  }


  logger.verbose('Tool registry created', { toolCount: registry.size, surface: options.surface ?? 'rest' });
  return registry;
}
