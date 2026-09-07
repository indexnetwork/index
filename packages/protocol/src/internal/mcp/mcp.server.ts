/**
 * MCP Server Factory — creates an McpServer instance with all protocol tools
 * registered from the existing tool registry. Each tool invocation resolves
 * auth from the HTTP request, builds a ResolvedToolContext, and delegates
 * to the raw tool handler.
 */

import { z } from 'zod';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { ServerContext, JsonSchemaType, Tool } from '@modelcontextprotocol/server';

import type { McpAuthResolver } from '../../platform/auth/ports.js';
import type { McpAuthInput, McpResolvedIdentity } from '../../platform/auth/mcp.js';
import { McpResolvedIdentitySchema } from '../../platform/auth/mcp.js';
import { CANONICAL_GUIDANCE_SUMMARY } from '../shared/agent/canonical-guidance.js';
import type { ToolDeps, ResolvedToolContext, RawToolDefinition } from '../shared/agent/tool.helpers.js';
import { resolveChatContext } from '../shared/agent/tool.helpers.js';
import { deriveAllowedNetworkIds, isToolAllowedInScope } from '../shared/agent/tool.scope.js';
import { createToolRegistry } from '../shared/agent/tool.registry.js';
import { ToolRuntimeError, invokeToolRuntime, toolRuntimeErrorToResult } from '../shared/agent/tool.runtime.js';
import type { TraceEmitter } from '../shared/observability/request-context.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('McpServer');

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC TOOL METADATA CACHE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Static registration metadata for one MCP tool — schema conversion artifacts
 * that depend only on registry-shaping feature flags, not on per-request
 * database scope.
 */
type McpToolRegistrationMetadata = Pick<RawToolDefinition, 'name' | 'description' | 'schema'> & {
  jsonSchema: JsonSchemaType;
  inputSchema: ReturnType<typeof fromJsonSchema>;
};

const mcpToolMetadataCache = new Map<string, McpToolRegistrationMetadata[]>();

/**
 * Builds a cache key from registry-shaping dependency booleans.
 * When a feature flag changes the tool set, the cache key changes so
 * the cached metadata set is automatically invalidated.
 */
export function getMcpToolMetadataCacheKey(deps: Pick<ToolDeps,
  'agentDatabase'
>): string {
  // Contact tools are omitted from the MCP surface entirely (IND-596), so no
  // Request-scoped input can change the MCP tool set.
  return [
    `agent:${deps.agentDatabase ? '1' : '0'}`,
  ].join('|');
}

/**
 * Clears the metadata cache. Used in tests to ensure fresh state between cases.
 */
export function clearMcpToolMetadataCacheForTests(): void {
  mcpToolMetadataCache.clear();
}

/**
 * Returns cached (or builds and caches) static MCP tool registration metadata.
 * The first call per cache key runs the full registry creation + schema
 * conversion; subsequent calls return the cached metadata array for the same
 * registry-shaping dependency profile.
 *
 * Does NOT store tool handlers — those remain request-scoped because they
 * capture per-request userDb/systemDb.
 */
export function getCachedMcpToolMetadata(deps: ToolDeps): readonly McpToolRegistrationMetadata[] {
  const cacheKey = getMcpToolMetadataCacheKey(deps);
  const cached = mcpToolMetadataCache.get(cacheKey);
  if (cached) return cached;

  const registry = createToolRegistry(deps, { surface: 'mcp' });
  const metadata = Array.from(registry.values()).map((toolDef): McpToolRegistrationMetadata => {
    const jsonSchema = zodToJsonSchema(toolDef.schema) as JsonSchemaType;
    return {
      name: toolDef.name,
      description: toolDef.description,
      schema: toolDef.schema,
      jsonSchema,
      inputSchema: fromJsonSchema(jsonSchema),
    };
  });

  mcpToolMetadataCache.set(cacheKey, metadata);
  logger.verbose('MCP tool metadata cached', { toolCount: metadata.length, cacheKey });
  return metadata;
}

function isExpectedMcpAuthError(message: string): boolean {
  return message.includes('Authentication required') ||
    message.includes('Invalid API key') ||
    message.includes('Invalid or expired access token') ||
    message.includes('JWT payload missing user ID');
}

/**
 * Runtime/auth failures are converted into structured MCP `isError` tool
 * results for the caller. Reporting them as application exceptions produces
 * Sentry noise for expected client failures and policy-enforced timeouts.
 */
export function shouldReportMcpToolError(err: unknown): boolean {
  if (err instanceof ToolRuntimeError) return false;
  const message = err instanceof Error ? err.message : String(err);
  return !isExpectedMcpAuthError(message);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZOD 3 → JSON SCHEMA CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Minimal Zod-to-JSON-Schema conversion for MCP tool registration.
 * Converts Zod 3.x schemas to plain JSON Schema objects that can be
 * wrapped with `fromJsonSchema()` for MCP SDK compatibility.
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
  if (schema instanceof z.ZodString) {
    const result: Record<string, unknown> = { type: 'string' };
    // Detect .url(), .email(), .uuid() etc. via Zod's internal checks array
    const checks = (schema as z.ZodString & { _def: { checks: Array<{ kind: string }> } })._def?.checks;
    if (checks) {
      for (const check of checks) {
        if (check.kind === 'url') result.format = 'uri';
        else if (check.kind === 'email') result.format = 'email';
        else if (check.kind === 'uuid') result.format = 'uuid';
        else if (check.kind === 'datetime') result.format = 'date-time';
      }
    }
    return result;
  }
  if (schema instanceof z.ZodNumber) {
    const checks = (schema as z.ZodNumber & { _def: { checks: Array<{ kind: string; value?: number }> } })._def?.checks;
    const result: Record<string, unknown> = { type: 'number' };
    if (checks) {
      for (const check of checks) {
        if (check.kind === 'int') result.type = 'integer';
        else if (check.kind === 'min') result.minimum = check.value;
        else if (check.kind === 'max') result.maximum = check.value;
      }
    }
    return result;
  }
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
  if (schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema((schema as z.ZodNullable<z.ZodType>).unwrap());
    return { ...inner, nullable: true };
  }
  if (schema instanceof z.ZodRecord) {
    return { type: 'object', additionalProperties: true };
  }
  return { type: 'object' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESULT POST-PROCESSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Strips internal `_`-prefixed keys from `data` and promotes `isError`
 * from the inner `success: false` signal to the MCP envelope level.
 * Fail-open: if JSON parsing throws, returns the original text with isError: false.
 */
export function sanitizeMcpResult(text: string): { text: string; isError: boolean } {
  try {
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.data &&
      typeof parsed.data === 'object' &&
      !Array.isArray(parsed.data)
    ) {
      for (const key of Object.keys(parsed.data)) {
        if (key.startsWith('_') || key === 'debugSteps') {
          delete parsed.data[key];
        }
      }
    }
    const isError = parsed?.success === false;
    return { text: JSON.stringify(parsed), isError };
  } catch {
    return { text, isError: false };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP SERVER FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Factory for creating per-request scoped database instances.
 * Injected from the controller/handler layer to keep the protocol layer
 * free of direct adapter imports.
 */
export interface ScopedDepsFactory {
  /** Creates scoped userDb and systemDb for the given user and allowed network IDs. */
  create(userId: string, allowedNetworkIds: string[]): Pick<ToolDeps, 'userDb' | 'systemDb'>;
}

/** Tools visible on the REST Tool API while web/CLI onboarding is incomplete. MCP does not use this allowlist. */
export const ONBOARDING_ALLOWED: ReadonlySet<string> = new Set([
  'read_docs',
  'research_profile',
  'read_networks',
  'create_network_membership',
  'create_intent',
]);

/**
 * Builds the onboarding gate message for REST Tool API callers. Condensed
 * from the chat onboarding flow into a 6-step tool-error guide. MCP does
 * not use this gate.
 */
export function buildMcpOnboardingMessage(ctx: ResolvedToolContext): string {
  const nameStep = ctx.hasName
    ? `1. Greet the user and confirm their name ("You're ${ctx.userName}, right?").`
    : `1. Ask the user for their name and a short self-description.`;

  const communityStep = ctx.networkId
    ? `3. (Skipped — user is already in "${ctx.networkName ?? 'their community'}".)`
    : `3. Call read_networks() and let the user pick communities to join via create_network_membership(networkId=...).`;

  const allowedList = Array.from(ONBOARDING_ALLOWED).join(', ');

  return (
    `This user has not completed onboarding. You must guide them through setup before they can use other tools. ` +
    `Only the following tools are available until onboarding is complete: ` +
    `${allowedList}.\n\n` +
    `Onboarding flow:\n` +
    `${nameStep}\n` +
    `2. Call research_profile(...) with any identity hints the user gives (name, LinkedIn, GitHub, X, Telegram, website). Present the suggested profile and confirm it with the user in conversation.\n` +
    `${communityStep}\n` +
    `4. Ask what the user is looking for and call create_intent(description="...", networkIds=[...]) so the first signal is persisted. Discovery is optional after that, never mandatory.`
  );
}

/**
 * Creates an MCP server with all protocol tools registered.
 * Tools resolve auth per-request via the HTTP request available in ServerContext.
 *
 * @param deps - Shared tool dependencies (graphs, database, embedder, etc.)
 * @param authResolver - Resolves authenticated identity from the HTTP request
 * @param scopedDepsFactory - Factory for creating per-request scoped databases
 * @returns A configured McpServer ready to be connected to a transport
 */
function createMcpTraceEmitter(toolName: string, ctx: ServerContext): TraceEmitter | undefined {
  const token = ctx.mcpReq._meta?.progressToken;
  if (typeof token !== 'string' && typeof token !== 'number') return undefined;

  let progress = 0;
  return (event) => {
    progress += 1;
    const message = (() => {
      if (event.type === 'graph_start') return `${toolName}: ${event.name} started`;
      if (event.type === 'graph_end') return `${toolName}: ${event.name} finished${event.durationMs != null ? ` in ${event.durationMs}ms` : ''}`;
      if (event.type === 'agent_start') return `${toolName}: ${event.name} agent started`;
      if (event.type === 'agent_end') return `${toolName}: ${event.name} agent finished${event.durationMs != null ? ` in ${event.durationMs}ms` : ''}`;
      return `${toolName}: progress`;
    })();

    const notification: Parameters<ServerContext['mcpReq']['notify']>[0] = {
      method: 'notifications/progress',
      params: { progressToken: token, progress, message },
    };
    void ctx.mcpReq.notify(notification).catch((err) => {
      logger.debug('Failed to send MCP progress notification', {
        toolName,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };
}

export const MCP_INSTRUCTIONS = `
${CANONICAL_GUIDANCE_SUMMARY}

# Voice & Output Rules
Calm, analytical, concise. Say "signal" not "intent", "community" not "index". Never use "search" — use "discover" or "find". Banned: leverage, optimize, unlock, scale, disrupt, AI-powered, act fast.

NEVER dump raw JSON or expose IDs (except actionable ones like conversationId). Synthesize in natural language; surface top 1–3 points unless asked for full list. Fabricate nothing.

# Authentication & Opportunity Lifecycle
API key in \`x-api-key\` header. Opportunities: draft → pending → accepted/rejected. Agent acceptance ≠ owner approval. Only call update_opportunity with accepted after explicit user confirmation.

# Tool Guidance
Read each tool's description for usage rules (when, prerequisites, follow-ups). Tools contain workflow patterns.

`.trim();

/**
 * Extracts a Bearer token from an HTTP Authorization header.
 */
export function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return undefined;
  const [scheme, token] = authHeader.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() === 'bearer' && token) return token;
  return undefined;
}

export function createMcpServer(
  deps: ToolDeps,
  authResolver: McpAuthResolver,
  scopedDepsFactory: ScopedDepsFactory,
): McpServer {
  const server = new McpServer(
    { name: 'index-network', version: '1.0.0' },
    { instructions: MCP_INSTRUCTIONS },
  );

  const toolMetadata = getCachedMcpToolMetadata(deps);

  type AuthenticatedMcpRequest = {
    identity: McpResolvedIdentity;
  };

  type ResolvedMcpRequest = AuthenticatedMcpRequest & {
    context: ResolvedToolContext;
  };

  // Both snapshots are scoped to this MCP server/connection, and are never
  // shared with the static tool metadata cache.
  let authenticatedRequest: Promise<AuthenticatedMcpRequest> | undefined;
  let resolvedRequest: Promise<ResolvedMcpRequest> | undefined;

  const extractAuthInput = (httpReq: Request): McpAuthInput => ({
    bearerToken: extractBearerToken(httpReq),
    apiKey: httpReq.headers.get('x-api-key') ?? undefined,
  });

  const getAuthenticatedRequest = (httpReq: Request): Promise<AuthenticatedMcpRequest> => {
    if (authenticatedRequest) return authenticatedRequest;

    authenticatedRequest = (async (): Promise<AuthenticatedMcpRequest> => {
      const identity = McpResolvedIdentitySchema.parse(
        await authResolver.resolveIdentity(extractAuthInput(httpReq)),
      );

      return { identity };
    })();
    return authenticatedRequest;
  };

  const getResolvedRequest = (httpReq: Request): Promise<ResolvedMcpRequest> => {
    if (resolvedRequest) return resolvedRequest;

    resolvedRequest = (async (): Promise<ResolvedMcpRequest> => {
      const authenticated = await getAuthenticatedRequest(httpReq);
      const context = await resolveChatContext({
        database: deps.database,
        userId: authenticated.identity.userId,
          });
      context.isMcp = true;
      context.isSessionAuth = authenticated.identity.isSessionAuth === true;

      return { ...authenticated, context };
    })();
    return resolvedRequest;
  };

  for (const toolDef of toolMetadata) {
    const toolName = toolDef.name;

    server.registerTool(
      toolName,
      {
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
      },
      async (args: unknown, ctx: ServerContext) => {
        let reportDeps = deps;
        let reportUserId: string | undefined;
        let reportContext: ResolvedToolContext | undefined;

        try {
          // Extract the original HTTP request from the MCP server context
          const httpReq = ctx.http?.req;
          if (!httpReq) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No HTTP request available in MCP context' }) }],
              isError: true,
            };
          }

          const { identity, context } = await getResolvedRequest(httpReq);
          const { userId } = identity;
          reportUserId = userId;

          reportContext = context;

          // Build per-request scoped databases via injected factory.
          // Network-scoped agents are clamped to their bound network, even when the
          // user belongs to other networks.
          const allowedNetworkIds = deriveAllowedNetworkIds({
            memberships: context.userNetworks,
            ...(context.scopeType && context.scopeId
              ? { scopeType: context.scopeType, scopeId: context.scopeId }
              : {}),
          });
          const scopedDbs = scopedDepsFactory.create(userId, allowedNetworkIds);

          // Override deps with per-request scoped databases
          const requestDeps: ToolDeps = { ...deps, ...scopedDbs };
          reportDeps = requestDeps;

          // Re-create registry with per-request deps for scoped database access.
          // Do not use cached registration metadata handlers here: tool handlers
          // close over userDb/systemDb when the registry is created. The MCP
          // surface profile keeps the tools/call lookup identical to tools/list.
          const requestRegistry = createToolRegistry(requestDeps, {
            surface: 'mcp',
            // Same scope exclusion tools/list applies, from the same rule: a
            // tool this scope makes impossible is absent, not merely refused.
            scope: context,
          });
          const requestTool = requestRegistry.get(toolName);

          if (!requestTool) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: `Tool "${toolName}" not found` }) }],
              isError: true,
            };
          }

          // Validate input against the original Zod schema
          const parseResult = (toolDef.schema as z.ZodType).safeParse(args);
          if (!parseResult.success) {
            const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: `Invalid input: ${issues}` }) }],
              isError: true,
            };
          }
          const validatedArgs = parseResult.data;

          // Execute the tool handler through the shared runtime so MCP calls have
          // consistent timeout, cancellation, progress, and requestContext plumbing.
          const result = await invokeToolRuntime({
            toolName,
            tool: requestTool,
            context,
            query: validatedArgs,
            signal: ctx.mcpReq.signal,
            traceEmitter: createMcpTraceEmitter(toolName, ctx),
          });

          const { text: sanitizedText, isError: toolIsError } = sanitizeMcpResult(result);

          return {
            content: [{ type: 'text' as const, text: sanitizedText }],
            ...(toolIsError ? { isError: true } : {}),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error('MCP tool failed', { toolName, error: message });
          if (shouldReportMcpToolError(err)) {
            reportDeps.reportToolError?.(err, {
              subsystem: 'mcp',
              operation: 'mcp.tool',
              toolName,
              userId: reportUserId,
              tags: {
                transport: 'mcp',
                toolName,
              },
              context: {
                scopeType: reportContext?.scopeType,
                scopeId: reportContext?.scopeId,
              },
            });
          }
          const runtimeResult = toolRuntimeErrorToResult(err);
          return {
            content: [{ type: 'text' as const, text: runtimeResult ?? JSON.stringify({ error: message }) }],
            isError: true,
          };
        }
      },
    );
  }

  // McpServer's default tools/list handler exposes every registered tool.
  // Replace it with a scope-aware inventory built from the same static
  // metadata the tools/call lookup uses.
  server.server.setRequestHandler('tools/list', async (_request, ctx) => {
    const httpReq = ctx.http?.req;
    if (!httpReq) {
      throw new Error('No HTTP request available in MCP context');
    }

    const resolved = await getResolvedRequest(httpReq);

    return {
      // The static metadata is scope-free (it is cached across principals), so
      // the focused scope is applied here — an intent-scoped session must not
      // advertise a tool it cannot call.
      tools: toolMetadata
        .filter((tool) => isToolAllowedInScope(tool.name, resolved.context))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          // `jsonSchema` is the zod-derived JSON Schema for the tool's object
          // input, so it always has `type: 'object'`. The SDK describes the same
          // value with two different types — `JsonSchemaType` (json-schema-typed,
          // used by `fromJsonSchema`) and the wire-level `Tool['inputSchema']` —
          // which are structurally incompatible, so bridge them at this boundary.
          inputSchema: tool.jsonSchema as Tool['inputSchema'],
        })),
    };
  });

  logger.verbose('MCP server created', { toolCount: toolMetadata.length });
  return server;
}
