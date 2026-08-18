/**
 * Tool Service — owns graph compilation, tool deps assembly, and context resolution.
 * Provides direct HTTP invocation of chat tools without LangChain wrapping.
 */

import { z } from 'zod';

import { chatDatabaseAdapter, createUserDatabase, createSystemDatabase, conversationDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { ensureGlobalUserContext } from '../lib/usercontext/global-context';
import { deriveAllowedNetworkIds, Intents, EnrichmentGraphFactory, OpportunityGraphFactory, HydeGraphFactory, Networks, NegotiationGraphFactory, PremiseGraphFactory, HydeGenerator, LensInferrer, resolveChatContext, createToolRegistry, invokeToolRuntime, toolRuntimeErrorToResult, ONBOARDING_ALLOWED, buildMcpOnboardingMessage, bindOwnerApprovalProvenance } from '@indexnetwork/protocol';
import type { AgentDispatcher } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, PremiseGraphDatabase, ToolDeps, ContactServiceAdapter, PendingQuestionSummary, OpportunityOwnerApprovalAuthority } from '@indexnetwork/protocol';
import { intentQueue } from '../queues/intent.queue';
import { getDirectOpportunityOwnerApprovalAuthority } from '../lib/mcp/owner-approval';
import { questionerEnqueueIfEnabled } from '../queues/questioner.queue';
import { reflectEnqueueIfEnabled } from '../queues/negotiations/reflect.queue';
import { negotiatorMemoryRetrieve } from '../adapters/negotiator-memory.retrieval.adapter';
import { enrichUserProfile } from '../lib/parallel/parallel';
import { QuestionerAdapter } from '../adapters/questioner.adapter';
import { intentProposalDatabaseAdapter } from '../adapters/intent-proposal.database.adapter';
import db from '../lib/drizzle/drizzle';

import { log } from '../lib/log';

const logger = log.service.from('ToolService');

type ToolServiceDeps = ToolDeps & {
  opportunityOwnerApproval?: OpportunityOwnerApprovalAuthority;
};

const questionerAdapter = new QuestionerAdapter(db);

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
    options: { graphs?: ToolDeps['graphs'] } = {},
  ) {
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
      contactService: this.contactService,
      enricher: { enrichUserProfile },
      getUserContextText: ensureGlobalUserContext,
      negotiationDatabase: conversationDatabaseAdapter as unknown as ToolDeps['negotiationDatabase'],
      // IND-593: direct authenticated-owner tool calls (REST tool controller /
      // CLI) traverse the owner-approval boundary via host attestation. Own
      // authority instance over the store shared with the MCP composition.
      opportunityOwnerApproval: getDirectOpportunityOwnerApprovalAuthority(),
      findPendingQuestions: async (
        userId: string,
        filters?: {
          sourceType?: string;
          sourceId?: string;
          purpose?: import('@indexnetwork/protocol').QuestionPurpose;
          networkId?: string;
          scopeType?: 'intent';
          scopeId?: string;
          modes?: Array<'intent' | 'negotiation' | 'negotiation_inflight' | 'chat' | 'pool_discovery'>;
          limit?: number;
        },
      ) => {
        const rows = await questionerAdapter.findPending(userId, filters?.scopeType === 'intent'
          ? filters
          : { ...filters, excludeModes: ['pool_discovery'] });
        return rows.map((row): PendingQuestionSummary => ({
          id: row.id,
          title: row.payload.title,
          prompt: row.payload.prompt,
          options: row.payload.options,
          multiSelect: row.payload.multiSelect,
          mode: row.detection.mode,
          ...(row.detection.purpose ? { purpose: row.detection.purpose } : {}),
          sourceType: row.detection.sourceType,
          sourceId: row.detection.sourceId,
          createdAt: row.createdAt,
          ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
          actors: row.actors.map((actor) => ({
            userId: actor.userId,
            ...(actor.networkId ? { networkId: actor.networkId } : {}),
          })),
        }));
      },
      // P4.3/IND-404: conversational answers from the negotiator chat ride the
      // exact pipeline the question cards use — atomic pending→answered flip in
      // the adapter, then QuestionEvents.onAnswered mode dispatch.
      answerPendingQuestion: async (
        userId: string,
        questionId: string,
        answer: { selectedOptions: string[]; freeText?: string },
      ) => questionerAdapter.answer(questionId, userId, {
        selectedOptions: answer.selectedOptions,
        ...(answer.freeText ? { freeText: answer.freeText } : {}),
        answeredBy: userId,
        answeredAt: new Date().toISOString(),
      }),
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
    const profileGraph = new EnrichmentGraphFactory(database, this.scraper).createGraph();
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
      hasExternalAgent: async () => false,
    };
    const negotiationGraph = new NegotiationGraphFactory(
      conversationDatabaseAdapter as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0],
      noOpDispatcher,
      undefined,
      // Stalled negotiations enqueue follow-up questions for the source user.
      questionerEnqueueIfEnabled(),
      // Finished negotiations enqueue memory distillation (P5.2, flag-gated).
      reflectEnqueueIfEnabled(),
      // P5.3 memory read path (gated on NEGOTIATOR_MEMORY_INJECT).
      negotiatorMemoryRetrieve(),
    ).createGraph();
    const opportunityGraph = new OpportunityGraphFactory(
      database,
      this.embedder,
      compiledHydeGraph,
      undefined,
      undefined,
      negotiationGraph,
      noOpDispatcher,
      undefined,
    ).createGraph();
    const networks = new Networks({ database, indexer: intents });
    const indexGraph = networks.createGraph();
    const networkMembershipGraph = networks.createMembershipGraph();
    const intentIndexGraph = networks.createAssignmentGraph();
    const premiseGraph = new PremiseGraphFactory(database as unknown as PremiseGraphDatabase, this.embedder).createGraph();

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
