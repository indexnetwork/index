/**
 * Tool Service — owns graph compilation, tool deps assembly, and context resolution.
 * Provides direct HTTP invocation of chat tools without LangChain wrapping.
 */

import { z } from 'zod';

import { matchesReady } from '../lib/negotiation/negotiation-graph';
import { chatDatabaseAdapter, createUserDatabase, createSystemDatabase, conversationDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { deriveAllowedNetworkIds, Intents, EnrichmentGraphFactory, OpportunityGraphFactory, HydeGraphFactory, Networks, PremiseGraphFactory, HydeGenerator, LensInferrer, resolveChatContext, createToolRegistry, invokeToolRuntime, toolRuntimeErrorToResult, ONBOARDING_ALLOWED, buildMcpOnboardingMessage, bindOwnerApprovalProvenance } from '@indexnetwork/protocol';
import type { AgentDispatcher } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, PremiseGraphDatabase, ToolDeps, OpportunityOwnerApprovalAuthority } from '@indexnetwork/protocol';
import { intentQueue } from '../queues/intent.queue';
import { getDirectOpportunityOwnerApprovalAuthority } from '../lib/mcp/owner-approval';
import { enrichUserProfile } from '../lib/parallel/parallel';
import { intentProposalDatabaseAdapter } from '../adapters/intent-proposal.database.adapter';
import db from '../lib/drizzle/drizzle';

import { log } from '../lib/log';

const logger = log.service.from('ToolService');

type ToolServiceDeps = ToolDeps & {
  opportunityOwnerApproval?: OpportunityOwnerApprovalAuthority;
};


/**
 * Manages direct HTTP invocation of chat tools.
 * Resolves user context, compiles graphs, builds tool deps, and executes tool handlers.
 */
export class ToolService {
  private embedder = new EmbedderAdapter();
  private scraper = new ScraperAdapter();
  private cache = new RedisCacheAdapter();
  private compiledGraphs: ToolDeps['graphs'] | null = null;
  private cachedToolList: Array<{ name: string; description: string; schema: Record<string, unknown> }> | null = null;

  constructor(options: { graphs?: ToolDeps['graphs'] } = {}) {
    this.compiledGraphs = options.graphs ?? null;
  }

  /**
   * Assemble the shared ToolDeps for a registry, given the context-scoped
   * databases. All non-scoped fields (adapters, events, graphs, queries) are
   * identical across invoke() and listTools(); only userDb/systemDb differ.
   */
  private buildToolDeps(
    database: typeof chatDatabaseAdapter,
    userDb: ToolDeps['userDb'],
    systemDb: ToolDeps['systemDb'],
    graphs: ToolDeps['graphs'],
  ): ToolServiceDeps {
    return {
      database,
      userDb,
      systemDb,
      intentProposalStore: intentProposalDatabaseAdapter,
      scraper: this.scraper,
      embedder: this.embedder,
      cache: this.cache,
      enricher: { enrichUserProfile },
      negotiationDatabase: conversationDatabaseAdapter as unknown as ToolDeps['negotiationDatabase'],
      // Discovery run from a tool must wake the signal's agent exactly as the
      // background queue does. Without it the tool-built opportunity graph's
      // matches_ready edge ends at END: matches persist and nobody is woken.
      matchesReady,
      // IND-593: direct authenticated-owner tool calls (REST tool controller /
      // CLI) traverse the owner-approval boundary via host attestation. Own
      // authority instance over the store shared with the MCP composition.
      opportunityOwnerApproval: getDirectOpportunityOwnerApprovalAuthority(),
      graphs,
    };
  }

  /**
   * Invoke a single tool by name for the given user.
   * Resolves context, builds deps, looks up the tool, validates input, and executes.
   *
   * @param userId - Authenticated user ID
   * @param toolName - Name of the tool to invoke (e.g. "read_intents")
   * @param query - Tool input object (validated against tool schema)
   * @param options - Trusted, server-derived request provenance from the
   *   controller seam. `sessionAuthenticated` must reflect the authenticated
   *   request's auth kind (AuthGuard session vs API key) — never caller input.
   * @returns Parsed tool result
   * @throws ChatContextAccessError if user/index context is invalid
   * @throws Error if tool not found or validation fails
   */
  async invokeTool(
    userId: string,
    toolName: string,
    query: Record<string, unknown> = {},
    options: { sessionAuthenticated?: boolean } = {},
  ): Promise<unknown> {
    logger.verbose('Invoking tool', { userId, toolName });

    const database = chatDatabaseAdapter;

    // Resolve user context
    const context = await resolveChatContext({ database, userId });
    // IND-593 trusted provenance seam: mark this context as a direct
    // authenticated owner session ONLY from the controller-derived auth kind.
    // API-key (CLI/agent) callers stay unmarked and cannot attest owner
    // authority at the opportunity owner-approval boundary.
    bindOwnerApprovalProvenance(context, {
      surface: 'rest',
      sessionAuthenticated: options.sessionAuthenticated === true,
    });

    if (context.isOnboarding && !ONBOARDING_ALLOWED.has(toolName)) {
      return {
        success: false,
        error: 'Onboarding required',
        message: buildMcpOnboardingMessage(context),
      };
    }

    // Get or compile graphs (cached across requests — graphs are stateless)
    const graphs = this.getOrCompileGraphs(database);

    // Create per-request context-bound databases.
    const allowedNetworkIds = deriveAllowedNetworkIds({
      memberships: context.userNetworks,
      ...(context.scopeType && context.scopeId
        ? { scopeType: context.scopeType, scopeId: context.scopeId }
        : {}),
    });
    const userDb = createUserDatabase(database, userId);
    const systemDb = createSystemDatabase(database, userId, allowedNetworkIds, this.embedder);

    const toolDeps = this.buildToolDeps(database, userDb, systemDb, graphs);

    // Build registry and look up tool. The resolved context carries the
    // caller's focused scope, so tools that scope makes impossible are absent
    // from the registry rather than refused after the model calls them.
    const registry = createToolRegistry(toolDeps, { scope: context });
    const tool = registry.get(toolName);
    if (!tool) {
      const available = Array.from(registry.keys()).sort();
      throw new Error(`Tool "${toolName}" not found. Available tools: ${available.join(', ')}`);
    }

    // Validate query against tool schema
    const parseResult = (tool.schema as z.ZodType).safeParse(query);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid query for tool "${toolName}": ${issues}`);
    }

    // Execute handler through the shared runtime so direct REST tool calls use
    // the same timeout and requestContext cancellation plumbing as MCP.
    let rawResult: string;
    try {
      rawResult = await invokeToolRuntime({
        toolName,
        tool,
        context,
        query: parseResult.data,
      });
    } catch (err) {
      const runtimeResult = toolRuntimeErrorToResult(err);
      if (!runtimeResult) throw err;
      rawResult = runtimeResult;
    }

    // Parse JSON result
    try {
      return JSON.parse(rawResult);
    } catch {
      return rawResult;
    }
  }

  /**
   * List all available tools with their names, descriptions, and schemas.
   *
   * @returns Array of tool metadata
   */
  async listTools(): Promise<Array<{ name: string; description: string; schema: Record<string, unknown> }>> {
    if (this.cachedToolList) return this.cachedToolList;

    logger.verbose('Building tool list (first call, will be cached)');

    const database = chatDatabaseAdapter;
    const graphs = this.getOrCompileGraphs(database);

    // Dummy scoped databases — only used at handler execution time, not registration
    const userDb = createUserDatabase(database, 'system');
    const systemDb = createSystemDatabase(database, 'system', []);

    const toolDeps = this.buildToolDeps(database, userDb, systemDb, graphs);

    const registry = createToolRegistry(toolDeps);

    this.cachedToolList = Array.from(registry.values()).map((t) => ({
      name: t.name,
      description: t.description,
      schema: t.schema instanceof z.ZodType
        ? JSON.parse(JSON.stringify((t.schema as z.ZodObject<z.ZodRawShape>).shape ? zodToJsonSchema(t.schema) : {}))
        : {},
    }));

    return this.cachedToolList;
  }

  /**
   * Compile all protocol graphs once and cache them.
   * Graphs are stateless — user context is passed at invoke() time.
   */
  private getOrCompileGraphs(database: typeof chatDatabaseAdapter): ToolDeps['graphs'] {
    if (this.compiledGraphs) return this.compiledGraphs;

    logger.verbose('Compiling graphs (first call, will be cached)');

    const intents = new Intents({
      database,
      embedder: this.embedder,
      queue: intentQueue,
    });
    const intentGraph = intents.createGraph();
    const premiseGraph = new PremiseGraphFactory(database as unknown as PremiseGraphDatabase, this.embedder).createGraph();
    const profileGraph = new EnrichmentGraphFactory(database).createGraph();
    const hydeCache = new RedisCacheAdapter();
    const compiledHydeGraph = new HydeGraphFactory(
      database as unknown as HydeGraphDatabase,
      this.embedder,
      hydeCache,
      new LensInferrer(),
      new HydeGenerator(),
    ).createGraph();
    // No-op dispatcher: ToolService is used for non-chat tool invocations.
    // Only the opportunity graph below still needs one (hasExternalAgent,
    // the unlimited-maxTurns rule) — the negotiation graph no longer takes a
    // dispatcher at all (external-agent turn dispatch is offline, #1494
    // round-3 Option A).
    const noOpDispatcher: AgentDispatcher = {
      hasExternalAgent: async () => false,
    };
    const opportunityGraph = new OpportunityGraphFactory(
      database,
      this.embedder,
      compiledHydeGraph,
      undefined,
      undefined,
      matchesReady,
      noOpDispatcher,
      undefined,
    ).createGraph();
    const networks = new Networks({ database, indexer: intents });
    const indexGraph = networks.createGraph();
    const networkMembershipGraph = networks.createMembershipGraph();
    const intentIndexGraph = networks.createAssignmentGraph();

    this.compiledGraphs = {
      profile: profileGraph,
      intent: intentGraph,
      index: indexGraph,
      networkMembership: networkMembershipGraph,
      intentIndex: intentIndexGraph,
      opportunity: opportunityGraph,
      premise: premiseGraph,
    };

    return this.compiledGraphs;
  }
}

/**
 * Minimal Zod-to-JSON-Schema conversion for tool listing.
 * Extracts field names and types from a ZodObject for API documentation.
 */
function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const zodValue = value as z.ZodType;
      properties[key] = zodToJsonSchema(zodValue);
      if (!(zodValue instanceof z.ZodOptional) && !(zodValue instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}) };
  }
  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema((schema as z.ZodArray<z.ZodType>).element) };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema((schema as z.ZodOptional<z.ZodType>).unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return zodToJsonSchema((schema as z.ZodDefault<z.ZodType>).removeDefault());
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: (schema as z.ZodEnum<[string, ...string[]]>).options };
  }
  if (schema instanceof z.ZodRecord) {
    return { type: 'object', additionalProperties: true };
  }
  return { type: 'unknown' };
}
