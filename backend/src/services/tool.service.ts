/**
 * Tool Service — owns graph compilation, tool deps assembly, and context resolution.
 * Provides direct HTTP invocation of chat tools without LangChain wrapping.
 */

import { z } from 'zod';

import {
  chatDatabaseAdapter,
  createUserDatabase,
  createSystemDatabase,
  conversationDatabaseAdapter,
} from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { IntentGraphFactory, ProfileGraphFactory, OpportunityGraphFactory, HydeGraphFactory, NetworkGraphFactory, NetworkMembershipGraphFactory, IntentNetworkGraphFactory, NegotiationGraphFactory, HydeGenerator, LensInferrer, IntentIndexer, resolveChatContext, createToolRegistry } from '@indexnetwork/protocol';
import type { AgentDispatcher } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, ToolDeps, ContactServiceAdapter, IntegrationAdapter } from '@indexnetwork/protocol';
import { intentQueue } from '../queues/intent.queue';
import { enrichUserProfile } from '../lib/parallel/parallel';

import { log } from '../lib/log';

const logger = log.service.from('tool');

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

  constructor(
    private contactService: ContactServiceAdapter,
    private integrationImporter: ToolDeps['integrationImporter'],
    private integration: IntegrationAdapter,
  ) {}

  /**
   * Invoke a single tool by name for the given user.
   * Resolves context, builds deps, looks up the tool, validates input, and executes.
   *
   * @param userId - Authenticated user ID
   * @param toolName - Name of the tool to invoke (e.g. "read_intents")
   * @param query - Tool input object (validated against tool schema)
   * @returns Parsed tool result
   * @throws ChatContextAccessError if user/index context is invalid
   * @throws Error if tool not found or validation fails
   */
  async invokeTool(userId: string, toolName: string, query: Record<string, unknown> = {}): Promise<unknown> {
    logger.verbose('Invoking tool', { userId, toolName });

    const database = chatDatabaseAdapter;

    // Resolve user context
    const context = await resolveChatContext({ database, userId });

    // Get or compile graphs (cached across requests — graphs are stateless)
    const graphs = this.getOrCompileGraphs(database);

    // Create per-request context-bound databases
    const networkScope = context.userNetworks.map((m) => m.networkId);
    const userDb = createUserDatabase(database, userId);
    const systemDb = createSystemDatabase(database, userId, networkScope, this.embedder);

    const toolDeps: ToolDeps = {
      database,
      userDb,
      systemDb,
      scraper: this.scraper,
      embedder: this.embedder,
      cache: this.cache,
      integration: this.integration,
      contactService: this.contactService,
      integrationImporter: this.integrationImporter,
      enricher: { enrichUserProfile },
      negotiationDatabase: conversationDatabaseAdapter as unknown as ToolDeps['negotiationDatabase'],
      graphs,
    };

    // Build registry and look up tool
    const registry = createToolRegistry(toolDeps);
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

    // Execute handler
    const rawResult = await tool.handler({ context, query: parseResult.data });

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

    const toolDeps: ToolDeps = {
      database,
      userDb,
      systemDb,
      scraper: this.scraper,
      embedder: this.embedder,
      cache: this.cache,
      integration: this.integration,
      contactService: this.contactService,
      integrationImporter: this.integrationImporter,
      enricher: { enrichUserProfile },
      negotiationDatabase: conversationDatabaseAdapter as unknown as ToolDeps['negotiationDatabase'],
      graphs,
    };

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

    const intentGraph = new IntentGraphFactory(database, this.embedder, intentQueue).createGraph();
    const profileGraph = new ProfileGraphFactory(database, this.embedder, this.scraper).createGraph();
    const hydeCache = new RedisCacheAdapter();
    const compiledHydeGraph = new HydeGraphFactory(
      database as unknown as HydeGraphDatabase,
      this.embedder,
      hydeCache,
      new LensInferrer(),
      new HydeGenerator(),
    ).createGraph();
    // No-op dispatcher: ToolService is used for non-chat tool invocations.
    // External agent yield is handled via the ProtocolDeps flow in tool.factory.ts and mcp.controller.ts.
    const noOpDispatcher: AgentDispatcher = {
      dispatch: async () => ({ handled: false, reason: 'no_agent' as const }),
      hasPersonalAgent: async () => false,
    };
    const negotiationGraph = new NegotiationGraphFactory(
      conversationDatabaseAdapter as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0],
      noOpDispatcher,
    ).createGraph();
    const opportunityGraph = new OpportunityGraphFactory(
      database,
      this.embedder,
      compiledHydeGraph,
      undefined,
      undefined,
      negotiationGraph,
      noOpDispatcher,
    ).createGraph();
    const indexGraph = new NetworkGraphFactory(database).createGraph();
    const networkMembershipGraph = new NetworkMembershipGraphFactory(database).createGraph();
    const intentIndexGraph = new IntentNetworkGraphFactory(database, new IntentIndexer()).createGraph();

    this.compiledGraphs = {
      profile: profileGraph,
      intent: intentGraph,
      index: indexGraph,
      networkMembership: networkMembershipGraph,
      intentIndex: intentIndexGraph,
      opportunity: opportunityGraph,
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

