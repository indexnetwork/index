import { z } from 'zod';

import type { DefineTool, ResolvedToolContext, ToolDeps, RawToolDefinition, ToolRegistry } from './tool.helpers.js';
import { error, redactSensitiveFields } from './tool.helpers.js';
import { createEnrichmentTools } from '../../enrichment/enrichment.tools.js';
import { Intents } from '../../../capabilities/intents.js';
import { Networks } from '../../../capabilities/networks.js';import { createOpportunityTools } from "../../opportunities/opportunity.tools.js";
import { createUtilityTools } from './utility.tools.js';
import { createAgentTools } from '../../agents/agent.tools.js';
import { isToolAllowedInScope, type ToolScopeEnvelope } from './tool.scope.js';
import { protocolLogger } from '../observability/protocol.logger.js';
import { requestContext } from '../observability/request-context.js';

const logger = protocolLogger('ToolRegistry');

export interface CreateToolRegistryOptions {
  /**
   * The caller's focused scope. Tools a scope makes impossible are left out of
   * the registry entirely, so they are neither listed nor callable. Omit for an
   * unscoped caller.
   */
  scope?: ToolScopeEnvelope;
}

/**
 * Creates a tool registry containing all tool handlers indexed by name.
 * Handlers are raw async functions (not LangChain tool() wrappers) that
 * accept { context, query } and return a JSON string.
 *
 * @param deps - Shared tool dependencies (graphs, database, embedder, etc.)
 * @param options - Optional caller scope used to select callable tools.
 * @returns Map of tool name to raw tool definition.
 */
export function createToolRegistry(deps: ToolDeps, options: CreateToolRegistryOptions = {}): ToolRegistry {
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
  Intents.createTools(dt, deps);
  Networks.createTools(dt, deps);
  createOpportunityTools(dt, deps);
  createUtilityTools(dt, deps);
  createAgentTools(dt, deps);

  // Scope exclusions are applied after composition so every domain is covered
  // by one rule rather than each createTools() call remembering it. The
  // handlers still refuse independently at runtime — those refusals document
  // the invariant and cover callers that build a registry without a scope.
  if (options.scope) {
    for (const toolName of [...registry.keys()]) {
      if (!isToolAllowedInScope(toolName, options.scope)) {
        registry.delete(toolName);
      }
    }
  }

  logger.verbose('Tool registry created', { toolCount: registry.size });
  return registry;
}
