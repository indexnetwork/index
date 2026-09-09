/**
 * Tool Service — owns graph compilation, tool deps assembly, and context resolution.
 * Provides direct HTTP invocation of protocol tools without LangChain wrapping.
 */

import { z } from 'zod';
import { toJsonSchema } from '@langchain/core/utils/json_schema';

import { chatDatabaseAdapter, createUserDatabase, createSystemDatabase } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { deriveAllowedNetworkIds, Intents, OpportunityGraphFactory, HydeGraphFactory, Networks, HydeGenerator, LensInferrer, resolveChatContext, createToolRegistry, invokeToolRuntime, toolRuntimeErrorToResult } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, ToolDeps } from '@indexnetwork/protocol';
import { intentIndexing } from '../lib/intent/indexing';
import { enrichUserProfile } from '../lib/parallel/parallel';

import { log } from '../lib/log';

const logger = log.service.from('ToolService');


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
  ): ToolDeps {
    return {
      database,
      userDb,
      systemDb,
      scraper: this.scraper,
      embedder: this.embedder,
      cache: this.cache,
      enricher: { enrichUserProfile },
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
   * @param signal - HTTP request cancellation signal
   * @returns Parsed tool result
   * @throws ChatContextAccessError if user/network context is invalid
   * @throws Error if tool not found or validation fails
   */
  async invokeTool(
    userId: string,
    toolName: string,
    query: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    logger.verbose('Invoking tool', { userId, toolName });

    const database = chatDatabaseAdapter;

    // Resolve user context
    const context = await resolveChatContext({ database, userId });

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
    // the shared timeout and requestContext cancellation plumbing.
    let rawResult: string;
    try {
      rawResult = await invokeToolRuntime({
        toolName,
        tool,
        context,
        query: parseResult.data,
        signal,
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
      schema: toJsonSchema(t.schema as z.ZodType) as Record<string, unknown>,
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
      followUp: intentIndexing,
    });
    const intentGraph = intents.createGraph();
    const hydeCache = new RedisCacheAdapter();
    const compiledHydeGraph = new HydeGraphFactory(
      database as unknown as HydeGraphDatabase,
      this.embedder,
      hydeCache,
      new LensInferrer(),
      new HydeGenerator(),
    ).createGraph();
    const opportunityGraph = new OpportunityGraphFactory(
      database,
      this.embedder,
      compiledHydeGraph,
    ).createGraph();
    const networks = new Networks({ database });
    const networkGraph = networks.createGraph();
    const networkMembershipGraph = networks.createMembershipGraph();
    const intentNetworkGraph = networks.createAssignmentGraph();

    this.compiledGraphs = {
      intent: intentGraph,
      network: networkGraph,
      networkMembership: networkMembershipGraph,
      intentNetwork: intentNetworkGraph,
      opportunity: opportunityGraph,
    };

    return this.compiledGraphs;
  }
}
