/**
 * MCP Server Factory — creates an McpServer instance with all protocol tools
 * registered from the existing tool registry. Each tool invocation resolves
 * auth from the HTTP request, builds a ResolvedToolContext, and delegates
 * to the raw tool handler.
 */

import { z } from 'zod';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { ServerContext, JsonSchemaType } from '@modelcontextprotocol/server';

import type { McpAuthResolver } from '../shared/interfaces/auth.interface.js';
import type { ToolDeps, ResolvedToolContext } from '../shared/agent/tool.helpers.js';
import { resolveChatContext } from '../shared/agent/tool.helpers.js';
import type { Question } from '../shared/schemas/question.schema.js';
import { QuestionSchema } from '../shared/schemas/question.schema.js';
import { dispatchElicitations } from './elicitation.dispatcher.js';
import { createToolRegistry } from '../shared/agent/tool.registry.js';
import { ToolRuntimeError, invokeToolRuntime, toolRuntimeErrorToResult } from '../shared/agent/tool.runtime.js';
import type { TraceEmitter } from '../shared/observability/request-context.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('McpServer');

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

/** Spec cap on the number of decision questions surfaced per turn. */
const MAX_DECISION_QUESTIONS = 3;

/**
 * Extracts decision questions from a parsed tool-result text, if present.
 * Validates each entry against `QuestionSchema` and drops malformed items;
 * caps the array at `MAX_DECISION_QUESTIONS` (defense-in-depth — Slice 2's
 * generator already caps at 3, but we don't trust the cast here).
 *
 * Returns null when the text isn't JSON, has no `data.questions`, or
 * contains zero valid questions after validation.
 */
export function extractDecisionQuestions(text: string): Question[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const rawQs = (parsed as { data?: { questions?: unknown } } | null)?.data?.questions;
  if (!Array.isArray(rawQs) || rawQs.length === 0) return null;

  const valid: Question[] = [];
  for (const raw of rawQs) {
    const result = QuestionSchema.safeParse(raw);
    if (result.success) valid.push(result.data);
    if (valid.length === MAX_DECISION_QUESTIONS) break;
  }
  return valid.length > 0 ? valid : null;
}

/**
 * Renders the JSON-envelope text block appended to the tool result content
 * when decision questions are present. The leading sentinel string lets the
 * LLM client recognize and surface the questions in prose for clients
 * without elicitation support.
 */
export function renderQuestionsEnvelope(questions: Question[]): string {
  return `Decision questions (structured): ${JSON.stringify({ questions })}`;
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
  /** Creates scoped userDb and systemDb for the given user and index scope. */
  create(userId: string, indexScope: string[]): Pick<ToolDeps, 'userDb' | 'systemDb'>;
}

/**
 * Computes the index scope passed to the per-request scoped DB factory. When
 * `networkScopeId` is non-null, the agent is bound to a single network and
 * may only reach that network plus the user's personal index. Otherwise the
 * full set of the user's network memberships is returned.
 */
export const computeAgentIndexScope = (
  userNetworks: { networkId: string; isPersonal?: boolean | null }[],
  networkScopeId: string | null | undefined,
): string[] => {
  if (!networkScopeId) {
    return userNetworks.map((m) => m.networkId);
  }
  return userNetworks
    .filter((m) => m.networkId === networkScopeId || m.isPersonal === true)
    .map((m) => m.networkId);
};

/**
 * Promotes a network-scoped agent's bound network into the resolved tool
 * context as the implicit chat scope. Every tool that branches on
 * `context.networkId` (read_networks, read_intents, read_user_profiles,
 * opportunity tools, etc.) then enforces scope automatically — without this
 * step the DB-level `indexScope` clamp guards cross-user data but tools that
 * shape their response off `context.networkId` (notably `read_networks`'
 * `publicNetworks` branch) would still leak the global view.
 *
 * No-op when there is no scope, or when an explicit chat scope is already
 * set (a user-driven index-scoped chat must keep precedence over the agent
 * binding — which would be a strict subset anyway, since the API key cannot
 * reach beyond its bound network).
 */
export const applyNetworkScopeToContext = (
  context: ResolvedToolContext,
  networkScopeId: string | null | undefined,
): void => {
  if (!networkScopeId) return;
  if (context.networkId) return;

  context.networkId = networkScopeId;
  // Clamp indexScope to [boundNetwork, personalIndex] BEFORE the membership
  // check below. If the bound network is not in userNetworks (defensive case),
  // the filter still produces a safe scope (personal index only) rather than
  // leaving the unclamped scope set by resolveChatContext.
  context.indexScope = context.userNetworks
    .filter((m) => m.networkId === networkScopeId || m.isPersonal === true)
    .map((m) => m.networkId);

  const bound = context.userNetworks.find((m) => m.networkId === networkScopeId);
  if (!bound) return;

  context.indexName = bound.networkTitle;
  context.scopedIndex = {
    id: bound.networkId,
    title: bound.networkTitle,
    prompt: bound.indexPrompt ?? null,
  };
  const isOwner = bound.permissions?.includes('owner') ?? false;
  context.scopedMembershipRole = isOwner ? 'owner' : 'member';
  context.isOwner = isOwner;
};

/**
 * Tools allowed during onboarding — everything else is gated until
 * complete_onboarding is called.  Includes the agent-gate-exempt tools
 * (register_agent, read_docs, scrape_url) because they are informational /
 * registration primitives needed at every lifecycle stage.
 */
export const ONBOARDING_ALLOWED: ReadonlySet<string> = new Set([
  'register_agent',
  'read_docs',
  'scrape_url',
  'record_onboarding_privacy_consent',
  'preview_user_profile',
  'get_profile_run',
  'cancel_profile_run',
  'confirm_user_profile',
  'create_user_profile',
  'complete_onboarding',
  'import_gmail_contacts',
  'read_networks',
  'create_network_membership',
  'create_intent',
  'discover_opportunities',
  'read_user_profiles',
]);

/**
 * Builds the onboarding gate message for MCP callers.  Condensed from the
 * chat orchestrator's 8-step flow (chat.prompt.ts buildOnboarding) into a
 * 7-step tool-error guide suited for non-interactive MCP clients.
 */
export function buildMcpOnboardingMessage(ctx: ResolvedToolContext): string {
  const nameStep = ctx.hasName
    ? `1. Greet the user and confirm their name ("You're ${ctx.userName}, right?").`
    : `1. Ask the user for their name and a short self-description.`;

  const communityStep = ctx.networkId
    ? `5. (Skipped — user is already in "${ctx.indexName ?? 'their community'}".)`
    : `5. Call read_networks() and let the user pick communities to join via create_network_membership(networkId=...).`;

  const allowedList = Array.from(ONBOARDING_ALLOWED).join(', ');

  return (
    `This user has not completed onboarding. You must guide them through setup before they can use other tools. ` +
    `Only the following tools are available until onboarding is complete: ` +
    `${allowedList}.\n\n` +
    `Onboarding flow:\n` +
    `${nameStep}\n` +
    `2. Ask whether the user allows use of event/EdgeOS profile data, then call record_onboarding_privacy_consent(edgeosImportGranted=...).\n` +
    `3. Ask separately whether the user allows public internet/profile lookup, then call record_onboarding_privacy_consent(publicProfileLookupGranted=...).\n` +
    `4. Call preview_user_profile(...) using only allowed inputs; do not run public lookup unless consent was granted. If it returns profileRunId, poll get_profile_run(profileRunId=...) until status is succeeded, then use its result as the draft.\n` +
    `5. Present the profile draft and ask "Does that look right?" On approval/correction, call confirm_user_profile(...).\n` +
    `${communityStep}\n` +
    `6. Ask what the user is looking for and call create_intent(description="...").\n` +
    `7. Call complete_onboarding() to finish setup. Gmail/contact import and discovery are optional after onboarding, never mandatory.`
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
      if (event.type === 'opportunity_draft_ready') return `${toolName}: opportunity draft ready`;
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
Index Network is a private, intent-driven discovery protocol. You help users find the right people and help the right people find them, via Index Network MCP tools.

# Voice
Calm, direct, analytical, concise. Preferred vocabulary: opportunity, overlap, signal, pattern, emerging, relevant, adjacency.

# Banned vocabulary
NEVER use "search" in any form. Use "looking up" for indexed data, "find" / "look for" for discovery, "check" for verification, "discover" for exploration. Banned: leverage, unlock, optimize, scale, disrupt, revolutionary, AI-powered, maximize value, act fast, networking, match.

# Entity model
- User — has one Profile, many Memberships, many Intents.
- Profile — identity (bio, skills, interests, location).
- Index — community with title, prompt (purpose), join policy. Has Members.
- Membership — User↔Index junction. \`isPersonal: true\` marks the user's personal index (contacts).
- Intent — what a user is looking for (signal). Description, summary, embedding.
- IntentIndex — Intent↔Index junction (auto-assigned).
- Opportunity — discovered connection between users. Roles, status, reasoning.

# Output rules
- NEVER expose internal IDs, UUIDs, field names, or tool names — EXCEPT when an ID is actionable for the user (e.g. a \`conversationId\` they need to open a chat). Surface such IDs verbatim when the tool returns them.
- NEVER use internal vocabulary — say "signal" not "intent", "community" not "index".
- NEVER dump raw JSON. Synthesize in natural language.
- Surface top 1–3 relevant points unless asked for the full list.
- Prefer first names; use full names only to disambiguate.
- Translate statuses: draft/latent → "draft", pending → "sent", accepted → "connected".
- NEVER fabricate data. If you don't have it, call the appropriate tool.

# Tool guidance
Each tool's description contains its own usage rules (when to call, when NOT to call, required prerequisites, post-call follow-ups). Read the description of every tool you call — that is where the per-tool workflow patterns live.

# Authentication
Pass your API key in the \`x-api-key\` request header (not \`Authorization: Bearer\`).

# Opportunity lifecycle
Opportunities move through: draft → pending → accepted (or rejected).

- **draft** (you created it, not yet sent): offer to send it; confirm before calling update_opportunity with pending.
- **pending, you sent it**: waiting for the other side — nothing to do.
- **pending, you received it**: the other person is waiting for your response. Surface it to the user and ask if they want to start a chat. Only call update_opportunity with accepted after explicit user confirmation.
- **accepted**: both sides are connected — a direct conversation exists. Surface the conversationId to the user if available.

Never accept a received opportunity without explicit user approval in the current conversation.

# Decision questions after discovery

After \`discover_opportunities\`, the tool result may include a second text block starting with \`Decision questions (structured): ...\`. This means the discovery engine ran negotiations but needs human input to sharpen the next turn — e.g. clarify timing, role, stage, or location.

**When this block is present:**
1. Parse the \`questions\` array from the JSON after the sentinel.
2. Each question has \`title\` (decision domain, ≤12 chars), \`prompt\` (ends in \`?\`), \`options\` (2–4 items, each with \`label\` and \`description\`), and \`multiSelect\`. The safest option is labeled \`... (Recommended)\`.
3. Present each question in natural language: ask the \`prompt\`, list options as \`**{label}** — {description}\`. Never expose the JSON or technical field names.
4. Wait for the user's answer, then fold it into the next \`discover_opportunities(searchQuery=...)\` call.

**Elicitation-capable clients** (those that declared \`elicitation\` support in \`initialize\`): the server dispatches \`elicitation/create\` requests directly — answers are written back to the chat session automatically. You will not see the envelope as a follow-up task in that case.
`.trim();

export function createMcpServer(
  deps: ToolDeps,
  authResolver: McpAuthResolver,
  scopedDepsFactory: ScopedDepsFactory,
): McpServer {
  // Tools exempt from the agent-registration gate — available before registration is complete.
  const AGENT_GATE_EXEMPT = new Set(['register_agent', 'read_docs', 'scrape_url']);

  const server = new McpServer(
    { name: 'index-network', version: '1.0.0' },
    { instructions: MCP_INSTRUCTIONS },
  );

  const registry = createToolRegistry(deps);

  for (const [toolName, toolDef] of registry) {
    // Convert Zod 3 schema to JSON Schema, then wrap with fromJsonSchema
    // for MCP SDK's StandardSchemaWithJSON compatibility
    const jsonSchema = zodToJsonSchema(toolDef.schema) as JsonSchemaType;
    const mcpSchema = fromJsonSchema(jsonSchema);

    server.registerTool(
      toolName,
      {
        description: toolDef.description,
        inputSchema: mcpSchema,
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

          // Resolve authenticated identity (userId + optional agentId + optional network scope + optional surface)
          const { userId, agentId, isSessionAuth, networkScopeId, clientSurface } = await authResolver.resolveIdentity(httpReq);
          reportUserId = userId;

          // Per-principal MCP throttle. Runs BEFORE any DB work so a throttled
          // call short-circuits cheaply. The /mcp transport bypasses the
          // controller-level RateLimit guard, so this is the only volume cap on
          // tool calls — it stops an over-eager agent from cascading itself into
          // provider rate limits.
          if (deps.mcpRateLimiter) {
            // Throttling is best-effort: never let a limiter failure (or a host
            // implementation that throws instead of failing open) break tool
            // dispatch. Treat any error as "allowed".
            let decision: Awaited<ReturnType<NonNullable<typeof deps.mcpRateLimiter>>> | null = null;
            try {
              decision = await deps.mcpRateLimiter({
                userId,
                ...(agentId ? { agentId } : {}),
                toolName,
              });
            } catch (rlErr) {
              logger.warn(`MCP rate limiter threw for "${toolName}" — failing open`, {
                error: rlErr instanceof Error ? rlErr.message : String(rlErr),
              });
            }
            if (decision && !decision.allowed) {
              const retryAfterSec = decision.retryAfterSec ?? 60;
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: 'Rate limit exceeded',
                    message:
                      `Too many ${toolName} calls in a short period. Wait ${retryAfterSec}s before retrying, ` +
                      `and avoid re-issuing the same request — if a discovery run is in progress, poll ` +
                      `get_discovery_run instead of calling discover_opportunities again.`,
                    retryAfterSec,
                  }),
                }],
                isError: true,
              };
            }
          }

          // Resolve chat context for the user (mark as MCP — no interactive UI available)
          const context = await resolveChatContext({ database: deps.database, userId });
          reportContext = context;
          context.isMcp = true;
          if (agentId) {
            context.agentId = agentId;
          }
          if (clientSurface) {
            context.clientSurface = clientSurface;
          }

          // Network-scoped agents inherit their bound network as the implicit chat
          // scope. Every tool that branches on `context.networkId` then enforces
          // the same boundary the DB-level `indexScope` clamp enforces below —
          // most importantly `read_networks`, which would otherwise return the
          // global `publicNetworks` catalog for unscoped contexts.
          applyNetworkScopeToContext(context, networkScopeId);

          // Gate: API-key callers (background agents) must register before using most tools.
          // OAuth/JWT session callers (human MCP clients such as Claude Code) are exempt —
          // their identity is already established via the auth flow and they have no agent entity.
          if (!isSessionAuth && !context.agentId && !AGENT_GATE_EXEMPT.has(toolName)) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'Agent not registered',
                  message:
                    'You must register as an agent before using Index tools. ' +
                    'Call register_agent with your agent name to establish an identity. ' +
                    'The tools register_agent, read_docs, and scrape_url are available without registration.',
                }),
              }],
              isError: true,
            };
          }

          // Gate: non-onboarded users can only use onboarding-related tools.
          // Mirrors the chat orchestrator's ONBOARDING MODE — the MCP client must
          // walk the user through profile creation, Gmail connect, intent capture,
          // and complete_onboarding() before full tool access is granted.
          if (context.isOnboarding && !ONBOARDING_ALLOWED.has(toolName)) {
            const onboardingSteps = buildMcpOnboardingMessage(context);
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'Onboarding required',
                  message: onboardingSteps,
                }),
              }],
              isError: true,
            };
          }

          // Build per-request scoped databases via injected factory.
          // Network-scoped agents are clamped to their bound network plus the user's
          // personal index — they cannot reach other networks even when the user is
          // a member of them. The personal-index reachability is preserved so the
          // agent can still manage its owner's profile and contacts.
          // context.indexScope is now the single source of truth: set by
          // resolveChatContext (full set) and narrowed by applyNetworkScopeToContext.
          const scopedDbs = scopedDepsFactory.create(userId, context.indexScope);

          // Override deps with per-request scoped databases
          const requestDeps: ToolDeps = { ...deps, ...scopedDbs };
          reportDeps = requestDeps;

          // Re-create registry with per-request deps for scoped database access
          const requestRegistry = createToolRegistry(requestDeps);
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

          // Slice 5: decision questions post-processing for discover_opportunities only.
          if (toolName === "discover_opportunities" && !toolIsError) {
            const questions = extractDecisionQuestions(sanitizedText);
            if (questions) {
              const envelopeBlock = {
                type: "text" as const,
                text: renderQuestionsEnvelope(questions),
              };

              const supportsElicitation =
                !!server.server.getClientCapabilities()?.elicitation;

              // Capture into a local const so TS preserves the narrowing
              // inside the callback below. Optional chains don't survive
              // across closure boundaries under strict mode.
              const elicitInput = ctx.mcpReq?.elicitInput;

              if (supportsElicitation && elicitInput) {
                // Sequential — never parallel (day-one rule). We await the loop
                // before returning the tool result so test harnesses can observe
                // the dispatched calls deterministically.
                await dispatchElicitations({
                  userId,
                  questions,
                  elicitInput: (params) => elicitInput(params),
                  chatMessageWriter: deps.chatMessageWriter,
                });
              }

              return {
                content: [
                  { type: "text" as const, text: sanitizedText },
                  envelopeBlock,
                ],
                ...(toolIsError ? { isError: true } : {}),
              };
            }
          }

          return {
            content: [{ type: 'text' as const, text: sanitizedText }],
            ...(toolIsError ? { isError: true } : {}),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`MCP tool "${toolName}" failed`, { error: message });
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
                agentId: reportContext?.agentId,
                networkId: reportContext?.networkId,
                indexScope: reportContext?.indexScope,
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

  logger.verbose(`MCP server created with ${registry.size} tools`);
  return server;
}
