import { readConversation } from '@indexnetwork/agent';
import type { ConversationMessage } from '@indexnetwork/client';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod-v4';

import { AGENT_DM_ID, AgentConversationError, ConversationService } from '../../services/conversation.service';
import { IntentCreateRejectedError, IntentNetworkMembershipError, IntentPreparationFailedError, intentService } from '../../services/intent.service';
import { enrichmentService } from '../../services/enrichment.service';
import { negotiationService } from '../../services/negotiation.service';
import { networkService } from '../../services/network.service';
import { opportunityService } from '../../services/opportunity.service';
import { userService } from '../../services/user.service';
import { RuntimeConflictError } from '../agent/runtime-errors';
import { actionLink, appLink } from '../app-link';
import { IntentPreparationReceiptError } from '../intent/intent.preparation';

import { cosignEnricher, cosignLine } from './mcp.cosign';
import { MCP_CADENCE, MCP_ONBOARDING } from './mcp.instructions';
import { clientRequestedProgress, mcpProgress } from './mcp.progress';
import { captureMcpToolFailure, mcpError, mcpSuccess } from './mcp.results';
import { userEventTail, watchIntentDiscovery, type IntentWatchOutcome } from './mcp.watch';
import type { McpPrincipal } from './mcp.types';

const LINK_HINT = ' The result starts with a markdown summary whose names are already linked. Reuse those lines; when you rephrase, put the link on the person, intent, or opportunity name itself, never as a separate "link" word.';
const CADENCE_HINT = ` ${MCP_CADENCE}`;
const NARRATION_HINT = ' While this call runs, discovery is live; when the result arrives, lead your reply with what happened during the watch — negotiations opened, opportunities ready, or a question waiting — before anything else. It is the part the owner is waiting to hear.';

/** Every hint is an explicit boolean. Idempotent means the same arguments again change nothing further. */
const hints = (
  title: string,
  readOnlyHint: boolean,
  destructiveHint: boolean,
  openWorldHint: boolean,
  idempotentHint: boolean,
) => ({ title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint });

const emptyInputSchema = z.object({}).strict();

/** An invite link (`…/l/<code>`) or the bare code from it. */
export function inviteCodeFrom(input: string): string | null {
  const trimmed = input.trim();
  const fromLink = trimmed.match(/\/l\/([^/?#\s]+)/);
  const code = fromLink ? decodeURIComponent(fromLink[1]) : trimmed;
  return /^[\w-]{4,128}$/.test(code) ? code : null;
}
const intentIdSchema = z.object({
  intentId: z.string().trim().min(1),
}).strict();
const opportunityActionSchema = z.object({
  opportunityId: z.string().trim().min(1),
  intentId: z.string().trim().min(1).optional(),
}).strict();

function mdLink(label: string, url: string): string {
  return `[${label.replace(/[[\]]/g, '\\$&')}](${url})`;
}

function intentLabel(text: string | null | undefined): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return 'Untitled intent';
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

function intentLine(intent: ReturnType<typeof conciseIntent>): string {
  const state = intent.status === 'active' ? '' : ` (${intent.status.toLowerCase()})`;
  return `${mdLink(intentLabel(intent.summary ?? intent.description), intent.url)} — ${intent.waitingOpportunityCount} waiting${state}`;
}

const OPPORTUNITY_STATE: Record<string, string> = {
  pending: 'waiting on you',
  negotiating: 'agents talking',
  accepted: 'connected',
  rejected: 'passed',
  expired: 'expired',
};

/** Accepting is a single yes that opens the chat, so a pending row the viewer accepted is an open chat. */
function opportunityState(status: string, viewerCommitted?: boolean): string {
  if (status === 'pending' && viewerCommitted) return 'chat open';
  return OPPORTUNITY_STATE[status] ?? status;
}

function opportunityLine(peerName: string, peerUrl: string, headline: string | undefined, status: string, prior?: { status: string } | null, viewerCommitted?: boolean): string {
  const earlier = prior?.status === 'accepted' ? ' — already connected' : prior ? ' — you already said yes earlier' : '';
  return `${mdLink(peerName, peerUrl)} — ${headline || 'New match'} — ${opportunityState(status, viewerCommitted)}${earlier}`;
}

async function linkedIntent(intentId: string, userId: string): Promise<{ url: string; link: string }> {
  const url = appLink('i', intentId);
  const intent = await intentService.getById(intentId, userId);
  const label = intent ? intentLabel(intent.summary ?? intent.payload) : 'intent';
  return { url, link: mdLink(label, url) };
}

function safeProfile(profile: NonNullable<Awaited<ReturnType<typeof userService.findWithGraph>>>) {
  return {
    id: profile.id,
    url: appLink('u', profile.id),
    // The shareable address: index.network/<username>. Null until claimed.
    username: profile.username,
    email: profile.email,
    name: profile.name,
    intro: profile.intro,
    location: profile.location,
    timezone: profile.timezone,
    avatar: profile.avatar,
    socials: profile.socials.map(({ label, value }) => ({ label, value })),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function conciseIntent(intent: Awaited<ReturnType<typeof intentService.listIntents>>['intents'][number]) {
  return {
    id: intent.id,
    url: appLink('i', intent.id),
    description: intent.payload,
    summary: intent.summary,
    status: intent.status,
    private: intent.isPrivate,
    archived: intent.archivedAt !== null,
    archivedAt: intent.archivedAt,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    networks: intent.networks,
    waitingOpportunityCount: intent.waitingOpportunityCount,
    sourceType: intent.sourceType,
    sourceId: intent.sourceId,
  };
}

const SOURCE_FIELDS_HINT = ' Optional sourceType and sourceId are client-owned strings Index stores and returns unchanged, for mapping your own records (such as an inferred ambient intent) to this intent.';
const sourceFieldSchema = z.string().max(1024).nullable().optional();

async function resolveIntent(intentId: string, principal: McpPrincipal) {
  const resolved = await intentService.resolveId(intentId, principal.userId);
  if ('error' in resolved) {
    return {
      error: mcpError(
        resolved.status === 409 ? 'intent_id_ambiguous' : 'intent_not_found',
        resolved.error,
      ),
    } as const;
  }
  return resolved;
}

async function resolveOpportunity(opportunityId: string, principal: McpPrincipal) {
  const resolved = await opportunityService.resolveId(opportunityId, principal.userId);
  if ('error' in resolved) {
    return {
      error: mcpError(
        resolved.status === 409 ? 'opportunity_id_ambiguous' : 'opportunity_not_found',
        resolved.error,
      ),
    } as const;
  }
  return resolved;
}

function intentTransitionError(
  outcome: Awaited<ReturnType<typeof intentService.transitionStatus>>,
): CallToolResult | null {
  if (outcome.kind === 'success') return null;
  if (outcome.kind === 'not_found' || outcome.kind === 'scope_violation') {
    return mcpError('intent_not_found', 'Intent not found.');
  }
  if (outcome.kind === 'enqueue_failed') {
    return mcpError('enqueue_failed', 'The intent could not be resumed because discovery could not be queued.', {
      retryable: true,
      intentId: outcome.id,
      status: outcome.status,
    });
  }
  if (outcome.kind === 'conflict' && outcome.archived) {
    return mcpError('intent_archived', 'Archived intents cannot be resumed or changed.');
  }
  return mcpError('intent_conflict', 'The intent changed concurrently. Read it and try again.', {
    retryable: true,
  });
}

function runTool(
  name: string,
  principal: McpPrincipal,
  operation: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  return operation()
    .catch((error) => captureMcpToolFailure(error, name, principal))
    .then((result) => (principal.onboarding ? withOnboarding(result) : result));
}

/** Many hosts never show the model the initialize instructions, but every host shows it tool results. */
function withOnboarding(result: CallToolResult): CallToolResult {
  const [first, ...rest] = result.content;
  if (first?.type !== 'text') return result;
  return { ...result, content: [{ ...first, text: `${first.text}\n\n${MCP_ONBOARDING}` }, ...rest] };
}

const conversationService = new ConversationService();

/** Same failures the agent conversation HTTP routes return. */
function agentConversationFailure(error: unknown): CallToolResult | null {
  if (error instanceof AgentConversationError) {
    return mcpError(error.status === 404 ? 'not_found' : 'agent_conversation_error', error.message);
  }
  if (error instanceof RuntimeConflictError) {
    return mcpError('executor_changed', 'The selected negotiation executor changed; stop this work');
  }
  return null;
}

function inboxMessage(message: {
  id: string;
  conversationId: string;
  senderId: string;
  role: 'user' | 'agent';
  parts: unknown;
  createdAt: Date;
  metadata: unknown;
}): ConversationMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    role: message.role,
    parts: message.parts,
    createdAt: message.createdAt.toISOString(),
    metadata: message.metadata ?? undefined,
  };
}

/** Register the curated owner-only Index tool surface on a fresh MCP server. */
export function registerMcpTools(server: McpServer, principal: McpPrincipal): void {
  server.registerTool(
    'get_my_profile',
    {
      description: 'Get the authenticated API key owner\'s safe Index profile.' + LINK_HINT,
      inputSchema: emptyInputSchema,
      annotations: hints('Get my profile', true, false, false, true),
    },
    () => runTool('get_my_profile', principal, async () => {
      const profile = await userService.findWithGraph(principal.userId);
      if (!profile) return mcpError('profile_not_found', 'Profile not found.');
      const safe = safeProfile(profile);
      return mcpSuccess({ profile: safe }, `${mdLink(safe.name || 'Your profile', safe.url)} — profile`);
    }),
  );

  server.registerTool(
    'update_my_profile',
    {
      description: 'Replace the supplied fields on the authenticated API key owner\'s profile. Omitted fields stay. Sending socials replaces the whole list, and the previous values are not kept.' + LINK_HINT,
      inputSchema: z.object({
        name: z.string().optional(),
        /** The handle in index.network/<username>; null clears it. */
        username: z.string().max(80).nullable().optional(),
        intro: z.string().optional(),
        location: z.string().optional(),
        timezone: z.string().optional(),
        avatar: z.string().optional(),
        socials: z.array(z.object({
          label: z.string().min(1),
          value: z.string().min(1),
        }).strict()).optional(),
      }).strict(),
      annotations: hints('Update my profile', false, true, false, true),
    },
    (input) => runTool('update_my_profile', principal, async () => {
      const { socials, username, ...fields } = input;
      // The username goes first: a refused one fails the whole save, before anything else is written.
      if (username !== undefined) {
        const claimed = await userService.setUsername(principal.userId, username);
        if (claimed.kind === 'invalid') return mcpError('username_invalid', claimed.error);
        if (claimed.kind === 'taken') return mcpError('username_taken', 'That username is taken.');
      }
      if (Object.keys(fields).length > 0) {
        await userService.update(principal.userId, fields);
      }
      if (socials !== undefined) {
        await userService.setSocials(principal.userId, socials);
      }
      const profile = await userService.findWithGraph(principal.userId);
      if (!profile) return mcpError('profile_not_found', 'Profile not found.');
      const safe = safeProfile(profile);
      return mcpSuccess({ profile: safe }, `${mdLink(safe.name || 'Your profile', safe.url)} — updated`);
    }),
  );

  server.registerTool(
    'enrich_my_profile',
    {
      description: 'Research the authenticated owner and propose profile fields without saving them.',
      inputSchema: z.object({
        name: z.string().optional(),
        linkedin: z.string().optional(),
        twitter: z.string().optional(),
        github: z.string().optional(),
        telegram: z.string().optional(),
        websites: z.array(z.string()).optional(),
      }).strict(),
      annotations: hints('Enrich my profile', true, false, true, true),
    },
    (input, ctx) => runTool('enrich_my_profile', principal, async () => {
      await mcpProgress(ctx, 1)('Researching your profile...');
      const result = await enrichmentService.prefillPublicProfile(principal.userId, input);
      return mcpSuccess(result);
    }),
  );

  server.registerTool(
    'list_intents',
    {
      description: 'List the authenticated owner\'s intents with lifecycle, networks, waiting counts, and pagination.' + LINK_HINT,
      inputSchema: z.object({
        archived: z.boolean().optional(),
        query: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).strict(),
      annotations: hints('List intents', true, false, false, true),
    },
    (input) => runTool('list_intents', principal, async () => {
      const result = await intentService.listIntents(principal.userId, {
        archived: input.archived,
        q: input.query?.trim() || undefined,
        page: input.page,
        limit: input.limit,
      });
      const intents = result.intents.map(conciseIntent);
      return mcpSuccess({
        intents,
        totalWaitingOpportunities: result.totalWaitingOpportunities,
        pagination: result.pagination,
      }, intents.length ? ['Intents:', ...intents.map((intent) => `- ${intentLine(intent)}`)].join('\n') : 'No intents.');
    }),
  );

  server.registerTool(
    'get_intent',
    {
      description: 'Get one owned intent by UUID or supported short ID prefix, including its associated networks.' + LINK_HINT,
      inputSchema: intentIdSchema,
      annotations: hints('Get intent', true, false, false, true),
    },
    ({ intentId }) => runTool('get_intent', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const [intent, networkIds] = await Promise.all([
        intentService.getById(resolved.id, principal.userId),
        intentService.listNetworks(resolved.id, principal.userId),
      ]);
      if (!intent || !networkIds) return mcpError('intent_not_found', 'Intent not found.');
      const concise = conciseIntent(intent);
      return mcpSuccess({ intent: { ...concise, networkIds } }, `Intent: ${intentLine(concise)}`);
    }),
  );

  server.registerTool(
    'create_intent',
    {
      description: 'Use when the owner wants to meet, find, hire, fund, collaborate with, or be introduced to people: a cofounder, investors for a round, a first hire, a mentor, early users — or simply interesting people, like a reading partner, new friends over dinner, or people to meet in a city they are visiting. Prepare and create an intent for the authenticated owner, sharing it only with eligible networks.' + SOURCE_FIELDS_HINT + LINK_HINT + NARRATION_HINT,
      inputSchema: z.object({
        description: z.string().max(65_536).refine((value) => value.trim().length > 0, 'description is required'),
        networkIds: z.array(z.string().uuid()).optional(),
        visibility: z.enum(['networks_only', 'mutuals_only']).optional(),
        private: z.boolean().optional(),
        sourceType: sourceFieldSchema,
        sourceId: sourceFieldSchema,
        watchSeconds: z.number().int().min(0).max(300).optional()
          .describe('After creating, keep the call open up to this many seconds while discovery runs, streaming progress and returning early once the first opportunity or agent question arrives. Defaults to 60; 0 returns immediately. Shortened when the call carries no progress token.'),
      }).strict(),
      annotations: hints('Create intent', false, false, false, false),
    },
    ({ description, networkIds, visibility, private: isPrivate, sourceType = null, sourceId = null, watchSeconds }, ctx) => runTool('create_intent', principal, async () => {
      if (isPrivate) {
        try {
          const created = await intentService.create(principal.userId, description, networkIds ?? [], undefined, { sourceType, sourceId }, { isPrivate: true });
          const url = appLink('i', created.id);
          return mcpSuccess({ intentId: created.id, url, networkIds: created.networkIds, sourceType, sourceId }, `${mdLink(intentLabel(description), url)} — created`);
        } catch (error) {
          if (error instanceof IntentCreateRejectedError) return mcpError(error.code, error.message);
          if (error instanceof IntentNetworkMembershipError) return mcpError(error.code, error.message, { networkId: error.networkId });
          throw error;
        }
      }
      const step = mcpProgress(ctx);
      await step('Preparing your intent...');
      let prepared;
      try {
        prepared = await intentService.prepare(principal.userId, { payload: description });
      } catch (error) {
        if (error instanceof IntentPreparationFailedError) {
          return mcpError('preparation_failed', error.message, { retryable: true });
        }
        throw error;
      }
      if (prepared.status !== 'ready') {
        return mcpError('intent_needs_revision', 'The intent needs revision before it can be created.', {
          feedback: prepared.feedback,
          proposedPayload: prepared.payload,
          recovery: prepared.recovery,
        });
      }

      try {
        // Without progress notifications resetting the host's timeout, a long quiet wait looks stalled.
        const watchFor = Math.min(watchSeconds ?? 60, clientRequestedProgress(ctx) ? 300 : 20);
        // Snapshot the stream tail before creating: discovery frames can land before create() returns.
        const sinceId = watchFor > 0 ? await userEventTail(principal.userId) : null;
        await step('Creating your intent...');
        const created = await intentService.create(
          principal.userId,
          prepared.payload,
          networkIds ?? [],
          prepared.preparationReceipt,
          { sourceType, sourceId },
          { visibility, isPrivate },
        );
        await step('Discovering counterparties...');
        // The intent exists now, so a watch failure must degrade to the plain created result.
        let watch: IntentWatchOutcome | null = null;
        if (sinceId) {
          try {
            watch = await watchIntentDiscovery({
              userId: principal.userId, intentId: created.id, sinceId, seconds: watchFor,
              signal: ctx.mcpReq.signal, step,
              // The presenter decides what the owner may see; an unrevealable peer comes back 'Unknown'.
              peerName: async (opportunityId) => {
                try {
                  const presented = await opportunityService.getOpportunityWithPresentation(opportunityId, principal.userId);
                  const name = presented && !('error' in presented) ? presented.peer.name : null;
                  return name && name !== 'Unknown' ? name : null;
                } catch { return null; }
              },
            });
          } catch { watch = null; }
        }
        const url = appLink('i', created.id);
        const label = intentLabel(prepared.payload);
        const lines = [`${mdLink(label, url)} — created`];
        if (watch?.pendingQuestion) {
          lines.push(`Your agent has a question: "${watch.pendingQuestion.question}" — read it with get_intent_conversation and answer with principal_send_message.`);
        }
        if (watch?.opportunities.length) {
          lines.push('Live while you waited — ready now:', ...watch.opportunities.map((o) => `- ${mdLink(o.headline, o.url)}`));
        } else if (watch) {
          const named = watch.negotiatingWith.slice(0, 3);
          const who = named.length
            ? ` (${named.join(', ')}${watch.negotiating > named.length ? ' and more' : ''})`
            : '';
          lines.push(watch.negotiating > 0
            ? `Live while you waited: ${watch.negotiating === 1 ? 'an agent' : `${watch.negotiating} agents`} entered negotiation for this intent${who}. Discovery continues — check list_opportunities in a few minutes.`
            : `Nothing surfaced in the first ${watch.seconds}s. Discovery continues — check list_opportunities in a few minutes.`);
        }
        return mcpSuccess(
          { intentId: created.id, url, networkIds: created.networkIds, sourceType, sourceId, ...(watch && { watch }) },
          lines.join('\n'),
        );
      } catch (error) {
        if (error instanceof IntentNetworkMembershipError) {
          return mcpError(error.code, error.message, { networkId: error.networkId });
        }
        if (error instanceof IntentCreateRejectedError) {
          return mcpError(error.code, error.message);
        }
        if (error instanceof IntentPreparationFailedError) {
          return mcpError('preparation_failed', error.message, { retryable: true });
        }
        if (error instanceof IntentPreparationReceiptError) {
          return mcpError('invalid_preparation', error.message);
        }
        throw error;
      }
    }),
  );

  server.registerTool(
    'update_intent',
    {
      description: 'Replace the description or source fields of one owned, non-archived intent. The previous description is not kept. Omitted fields stay; null clears a source field.' + SOURCE_FIELDS_HINT + LINK_HINT,
      inputSchema: z.object({
        intentId: z.string().trim().min(1),
        description: z.string().trim().min(1).max(65_536).optional(),
        private: z.literal(true).optional(),
        sourceType: sourceFieldSchema,
        sourceId: sourceFieldSchema,
      }).strict(),
      annotations: hints('Update intent', false, true, false, true),
    },
    ({ intentId, description, private: isPrivate, sourceType, sourceId }) => runTool('update_intent', principal, async () => {
      if (description === undefined && isPrivate === undefined && sourceType === undefined && sourceId === undefined) {
        return mcpError('invalid_input', 'description, private, sourceType, or sourceId is required.');
      }
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const outcome = await intentService.update(resolved.id, principal.userId, description, { sourceType, sourceId }, { isPrivate });
      if (outcome.kind === 'not_found') return mcpError('intent_not_found', 'Intent not found.');
      if (outcome.kind === 'archived') return mcpError('intent_archived', 'Archived intents cannot be updated.');
      if (outcome.kind === 'rejected') return mcpError('intent_rejected', outcome.detail);
      const intent = await intentService.getById(resolved.id, principal.userId);
      const concise = intent ? conciseIntent(intent) : null;
      const fallbackUrl = appLink('i', resolved.id);
      return mcpSuccess(
        { intent: concise ?? { id: resolved.id, url: fallbackUrl, description } },
        concise ? intentLine(concise) : `${mdLink(intentLabel(description ?? 'Intent'), fallbackUrl)} — updated`,
      );
    }),
  );

  server.registerTool(
    'pause_intent',
    {
      description: 'Pause one owned intent. Pausing an already paused intent succeeds without changing it.' + LINK_HINT,
      inputSchema: intentIdSchema,
      annotations: hints('Pause intent', false, true, false, true),
    },
    ({ intentId }) => runTool('pause_intent', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const outcome = await intentService.transitionStatus(resolved.id, principal.userId, 'paused');
      if (outcome.kind !== 'success') return intentTransitionError(outcome)!;
      const { url, link } = await linkedIntent(outcome.id, principal.userId);
      return mcpSuccess(
        { intentId: outcome.id, url, status: outcome.status, changed: outcome.changed },
        `${link} — paused`,
      );
    }),
  );

  server.registerTool(
    'resume_intent',
    {
      description: 'Resume one owned intent. Resuming an already active intent succeeds; archived intents stay archived.' + LINK_HINT,
      inputSchema: intentIdSchema,
      annotations: hints('Resume intent', false, false, false, true),
    },
    ({ intentId }, ctx) => runTool('resume_intent', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      await mcpProgress(ctx, 1)('Resuming discovery...');
      const outcome = await intentService.transitionStatus(resolved.id, principal.userId, 'active');
      if (outcome.kind !== 'success') return intentTransitionError(outcome)!;
      const { url, link } = await linkedIntent(outcome.id, principal.userId);
      return mcpSuccess(
        { intentId: outcome.id, url, status: outcome.status, changed: outcome.changed },
        `${link} — resumed`,
      );
    }),
  );

  server.registerTool(
    'archive_intent',
    {
      description: 'Permanently archive one owned intent. This cannot currently be reversed, removes network associations, and expires related opportunities.' + LINK_HINT,
      inputSchema: z.object({
        intentId: z.string().trim().min(1),
        confirm: z.literal(true),
      }).strict(),
      annotations: hints('Archive intent', false, true, false, false),
    },
    ({ intentId }) => runTool('archive_intent', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const { url, link } = await linkedIntent(resolved.id, principal.userId);
      const result = await intentService.archive(resolved.id, principal.userId);
      if (!result.success) return mcpError('intent_not_found', result.error ?? 'Intent not found.');
      return mcpSuccess({
        intentId: resolved.id,
        url,
        archived: true,
        message: 'Archiving cannot currently be reversed; network associations were removed and related opportunities were expired.',
      }, `${link} — archived`);
    }),
  );

  server.registerTool(
    'join_network',
    {
      description: 'Join a network from an invite link the person gave you (https://index.network/l/<code>) or the code in it. Their intents then start matching with its members. Some networks hold the request for an admin; the result says joined, pending, or already a member.',
      inputSchema: z.object({
        invite: z.string().trim().min(1).max(500),
      }).strict(),
      annotations: hints('Join network', false, false, false, true),
    },
    ({ invite }) => runTool('join_network', principal, async () => {
      const code = inviteCodeFrom(invite);
      if (!code) return mcpError('invalid_invite', 'That is not an Index invite link or code.');
      try {
        const result = await networkService.acceptInvitation(code, principal.userId);
        const { id, title } = result.network;
        const summary = {
          joined: `Joined ${title}.`,
          already_member: `Already a member of ${title}.`,
          pending: `Asked to join ${title}. An admin has to approve it.`,
        }[result.status];
        return mcpSuccess({ status: result.status, network: { id, title } }, summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (message.includes('declined')) return mcpError('join_declined', 'An admin declined this request to join.');
        if (message.includes('Invalid or expired')) return mcpError('invalid_invite', 'This invite link is invalid or has expired.');
        throw err;
      }
    }),
  );

  server.registerTool(
    'list_opportunities',
    {
      description: 'Use when the owner asks who they should meet or what matches are waiting. List compact opportunity cards across the owner\'s Index or within one owned intent. Defaults to active, actionable statuses and never includes negotiation turns; use list_negotiations for those.' + LINK_HINT + CADENCE_HINT,
      inputSchema: z.object({
        intentId: z.string().trim().min(1).optional(),
        statuses: z.array(z.enum(['pending', 'negotiating', 'accepted', 'rejected', 'expired'])).min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).max(10_000).optional(),
      }).strict(),
      annotations: hints('List opportunities', true, false, false, true),
    },
    (input) => runTool('list_opportunities', principal, async () => {
      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;
      let resolvedIntentId: string | undefined;
      if (input.intentId) {
        const resolved = await resolveIntent(input.intentId, principal);
        if ('error' in resolved) return resolved.error;
        resolvedIntentId = resolved.id;
      }
      const result = await opportunityService.presentOpportunitiesForViewer(principal.userId, {
        intentId: resolvedIntentId,
        statuses: input.statuses ?? ['negotiating', 'pending'],
        limit: limit + offset,
      });
      if ('error' in result) return mcpError('opportunities_unavailable', result.error);
      const opportunities = result.opportunities.slice(offset, offset + limit).map((opportunity) => {
        // With a chat already open, link to it: the /o/ link would say yes for the owner.
        const chatUrl = opportunity.peerChat ? `${appLink('u', opportunity.peer.userId)}/chat` : null;
        return {
          id: opportunity.opportunityId,
          url: chatUrl ?? appLink('o', opportunity.opportunityId),
          ...(chatUrl ? {} : {
            acceptUrl: actionLink(opportunity.opportunityId, principal.userId, 'accept'),
            declineUrl: actionLink(opportunity.opportunityId, principal.userId, 'decline'),
          }),
          priorOpportunity: opportunity.priorOpportunity ?? null,
          peerChat: opportunity.peerChat && chatUrl ? { ...opportunity.peerChat, url: chatUrl } : null,
          status: opportunity.status,
          viewerCommitted: opportunity.viewerCommitted === true,
          negotiating: opportunity.status === 'negotiating',
          createdAt: opportunity.createdAt,
          updatedAt: opportunity.updatedAt,
          peer: { ...opportunity.peer, url: appLink('u', opportunity.peer.userId) },
          viewerRole: opportunity.viewerRole,
          headline: opportunity.headline,
          summary: opportunity.mainText,
          cta: opportunity.cta,
        };
      });
      const enrich = await cosignEnricher(principal.userId);
      const cosigns = await Promise.all(opportunities.map((opportunity, index) => (enrich && index < 10 ? enrich(opportunity.peer.userId) : null)));
      const lines = opportunities.map((opportunity, index) =>
        `- ${opportunityLine(opportunity.peer.name, opportunity.peer.url, opportunity.headline, opportunity.status, opportunity.priorOpportunity, opportunity.viewerCommitted)}${cosignLine(cosigns[index])}`);
      return mcpSuccess({
        opportunities: opportunities.map((opportunity, index) => ({ ...opportunity, cosign: cosigns[index] })),
        pagination: {
          limit,
          offset,
          count: opportunities.length,
        },
      }, lines.length ? ['Opportunities:', ...lines].join('\n') : 'No opportunities.');
    }),
  );

  server.registerTool(
    'get_opportunity',
    {
      description: 'Get one visible opportunity by UUID or supported short ID prefix, plus its negotiation when one exists.' + LINK_HINT,
      inputSchema: z.object({ opportunityId: z.string().trim().min(1) }).strict(),
      annotations: hints('Get opportunity', true, false, false, true),
    },
    ({ opportunityId }) => runTool('get_opportunity', principal, async () => {
      const resolved = await resolveOpportunity(opportunityId, principal);
      if ('error' in resolved) return resolved.error;
      const opportunity = await opportunityService.getOpportunityWithPresentation(resolved.id, principal.userId);
      if (!opportunity) return mcpError('opportunity_not_found', 'Opportunity not found.');
      if ('error' in opportunity) return mcpError('opportunity_not_found', 'Opportunity not found.');
      const negotiation = await negotiationService.read(resolved.id, principal.userId);
      const url = appLink('o', opportunity.id);
      const acceptUrl = actionLink(opportunity.id, principal.userId, 'accept');
      const declineUrl = actionLink(opportunity.id, principal.userId, 'decline');
      const peer = { ...opportunity.peer, url: appLink('u', opportunity.peer.userId) };
      const otherParties = opportunity.otherParties.map((party) => ({ ...party, url: appLink('u', party.id) }));
      const people = otherParties.map((party) => mdLink(party.name, party.url)).join(', ');
      const cosign = await (await cosignEnricher(principal.userId))?.(opportunity.peer.userId) ?? null;
      return mcpSuccess({
        opportunity: {
          ...opportunity,
          url,
          acceptUrl,
          declineUrl,
          peer,
          otherParties,
          cosign,
        },
        negotiation,
      }, `${mdLink('Opportunity', url)}${people ? ` with ${people}` : ''}: ${opportunity.headline || 'New match'} — ${opportunityState(opportunity.status, opportunity.viewerCommitted)}${cosignLine(cosign)}`);
    }),
  );

  const negotiationView = <T extends Awaited<ReturnType<typeof negotiationService.list>>[number]>(view: T) => ({
    ...view,
    url: appLink('o', view.opportunityId),
    yourTurn: view.awaitingUserId === principal.userId,
    counterparty: { ...view.counterparty, url: appLink('u', view.counterparty.userId) },
  });

  const negotiationLine = (view: ReturnType<typeof negotiationView>): string => {
    const status = view.outcome ?? (view.yourTurn ? 'your agent\'s turn' : 'their turn');
    return `${mdLink(view.counterparty.name || 'Someone', view.url)} — ${status} — ${view.turnCount} turns`;
  };

  server.registerTool(
    'list_negotiations',
    {
      description: 'List the owner\'s negotiations (the agents\' exchanges behind opportunities), optionally for one owned intent, with whose turn it is and the outcome. Filter by state: open or settled. Turns are not included; read them with get_negotiation.' + LINK_HINT + CADENCE_HINT,
      inputSchema: z.object({
        intentId: z.string().trim().min(1).optional(),
        state: z.enum(['open', 'settled']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).max(10_000).optional(),
      }).strict(),
      annotations: hints('List negotiations', true, false, false, true),
    },
    (input) => runTool('list_negotiations', principal, async () => {
      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;
      let resolvedIntentId: string | undefined;
      if (input.intentId) {
        const resolved = await resolveIntent(input.intentId, principal);
        if ('error' in resolved) return resolved.error;
        resolvedIntentId = resolved.id;
      }
      const all = await negotiationService.list(principal.userId, {
        intentId: resolvedIntentId,
        ...(input.state === 'open' ? { open: true } : {}),
      });
      const filtered = input.state === 'settled' ? all.filter((view) => view.settledAt !== null) : all;
      const negotiations = filtered.slice(offset, offset + limit).map(negotiationView);
      return mcpSuccess({
        negotiations,
        pagination: { limit, offset, count: negotiations.length },
      }, negotiations.length ? ['Negotiations:', ...negotiations.map((view) => `- ${negotiationLine(view)}`)].join('\n') : 'No negotiations.');
    }),
  );

  server.registerTool(
    'get_negotiation',
    {
      description: 'Get one negotiation by its opportunity UUID or supported short ID prefix, with every turn the agents took. This is for the owner to read.' + LINK_HINT,
      inputSchema: z.object({ opportunityId: z.string().trim().min(1) }).strict(),
      annotations: hints('Get negotiation', true, false, false, true),
    },
    ({ opportunityId }) => runTool('get_negotiation', principal, async () => {
      const resolved = await resolveOpportunity(opportunityId, principal);
      if ('error' in resolved) return resolved.error;
      const negotiation = await negotiationService.read(resolved.id, principal.userId);
      if (!negotiation) return mcpError('negotiation_not_found', 'Negotiation not found.');
      const view = negotiationView(negotiation);
      return mcpSuccess({ negotiation: view }, negotiationLine(view));
    }),
  );

  server.registerTool(
    'get_intent_conversation',
    {
      description: 'Read owned intents’ chats: the agent’s notes, progress, and questions, and what the owner has already said. Pass intentId for one intent; omit it to read every non-archived intent in one call. Always returns a conversations list. questions are the ones still waiting for an answer, each with questionId, prompt, suggested options, and allowFreeText. Put each one to the owner as a choice prompt built from those fields, never inline in your reply, and save their pick or own words with principal_send_message and that questionId. This is the owner’s private chat. Never forward it to the other person.' + LINK_HINT + CADENCE_HINT,
      inputSchema: z.object({ intentId: z.string().trim().min(1).optional() }).strict(),
      annotations: hints('Get intent conversation', true, false, false, true),
    },
    ({ intentId }) => runTool('get_intent_conversation', principal, async () => {
      let intents: { id: string; label: string }[];
      if (intentId) {
        const resolved = await resolveIntent(intentId, principal);
        if ('error' in resolved) return resolved.error;
        const intent = await intentService.getById(resolved.id, principal.userId);
        intents = [{ id: resolved.id, label: intentLabel(intent?.summary ?? intent?.payload) }];
      } else {
        const { intents: listed } = await intentService.listIntents(principal.userId, { limit: 100 });
        intents = listed.map((intent) => ({ id: intent.id, label: intentLabel(intent.summary ?? intent.payload) }));
      }
      try {
        const read = await conversationService.intentConversations(principal.userId, intents.map((intent) => intent.id));
        const conversations = read.map((entry) => ({
          intentId: entry.intentId,
          conversation: readConversation(entry.messages.map(inboxMessage)),
          questions: entry.questions.map(({ id, question, options, ...rest }) => ({
            questionId: id, prompt: question, options: options ?? [], allowFreeText: true, ...rest,
          })),
          url: appLink('i', entry.intentId),
        }));
        const lines = conversations.map((entry, index) => `- ${mdLink(intents[index]!.label, entry.url)}`);
        return mcpSuccess({ conversations }, lines.length ? lines.join('\n') : 'No intents.');
      } catch (error) {
        const mapped = agentConversationFailure(error);
        if (mapped) return mapped;
        throw error;
      }
    }),
  );

  server.registerTool(
    'principal_send_message',
    {
      description: 'Save what the owner just said in one intent’s chat, the same way the Index app does. Copy their words; never infer or invent a message. Pass a questionId only when those words answer that waiting question. A message without one is saved as a plain message, and so is one naming a question that is no longer waiting. Saving a message is not approval to accept or pass a match.' + LINK_HINT,
      inputSchema: z.object({
        intentId: z.string().trim().min(1),
        messages: z.array(z.object({
          text: z.string().trim().min(1).max(8000),
          questionId: z.string().uuid().optional(),
        }).strict()).min(1).max(20),
      }).strict(),
      annotations: hints('Send message', false, false, false, false),
    },
    ({ intentId, messages }, ctx) => runTool('principal_send_message', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const conversation = await conversationService.resolveId(AGENT_DM_ID, principal.userId);
      if ('error' in conversation) return mcpError('agent_conversation_not_found', conversation.error);
      try {
        await mcpProgress(ctx, 1)('Sending to your agent...');
        const persisted = await conversationService.answerQuestions({
          userId: principal.userId, intentId: resolved.id, conversationId: conversation.id, answers: messages,
        });
        const { url, link } = await linkedIntent(resolved.id, principal.userId);
        return mcpSuccess({
          intentId: resolved.id,
          messages: persisted.map((message) => {
            const principalMessage = (message.metadata as { principalMessage?: { kind?: string; questionId?: string } } | null)?.principalMessage;
            return { id: message.id, kind: principalMessage?.kind ?? 'user', questionId: principalMessage?.questionId ?? null };
          }),
          url,
        }, link);
      } catch (error) {
        const mapped = agentConversationFailure(error);
        if (mapped) return mapped;
        throw error;
      }
    }),
  );

  const registerOpportunityAction = (name: 'accept_opportunity' | 'reject_opportunity') => {
    const accepted = name === 'accept_opportunity';
    server.registerTool(
      name,
      {
        description: (accepted
          ? 'Accept one visible opportunity for the authenticated owner, optionally scoped to an owned intent. Accepting is a single yes: it opens a direct chat with the other person immediately and never waits for them to accept.'
          : 'Pass on one visible opportunity for the authenticated owner, optionally scoped to an owned intent. This is the Mac app\'s Pass action and may close the associated negotiation.') + LINK_HINT,
        inputSchema: opportunityActionSchema,
        annotations: hints(accepted ? 'Accept opportunity' : 'Pass on opportunity', false, true, false, false),
      },
      ({ opportunityId, intentId }, ctx) => runTool(name, principal, async () => {
        const resolvedOpportunity = await resolveOpportunity(opportunityId, principal);
        if ('error' in resolvedOpportunity) return resolvedOpportunity.error;
        let resolvedIntentId: string | undefined;
        if (intentId) {
          const resolvedIntent = await resolveIntent(intentId, principal);
          if ('error' in resolvedIntent) return resolvedIntent.error;
          resolvedIntentId = resolvedIntent.id;
        }
        const scope = { intentId: resolvedIntentId };
        // Like the web app: accepting opens the chat. Someone not on Index has nobody to chat with, so only the accept is recorded.
        const current = accepted ? await opportunityService.getOpportunityWithPresentation(resolvedOpportunity.id, principal.userId) : null;
        const notOnIndex = !!current && !('error' in current) && current.peer.emailVerified === false;
        if (accepted && !notOnIndex) {
          const peerName = current && !('error' in current) && current.peer.name !== 'Unknown' ? current.peer.name : null;
          await mcpProgress(ctx, 1)(peerName ? `Opening your chat with ${peerName}...` : 'Opening your chat...');
        }
        const result = accepted && !notOnIndex
          ? await opportunityService.startChat(resolvedOpportunity.id, principal.userId, scope)
          : await opportunityService.updateOpportunityStatus(
            resolvedOpportunity.id,
            accepted ? 'accepted' : 'rejected',
            principal.userId,
            scope,
          );
        if ('error' in result) {
          const code = result.status === 404
            ? 'opportunity_not_found'
            : result.status === 403
              ? 'opportunity_forbidden'
              : result.status === 409
                ? 'opportunity_conflict'
                : 'opportunity_update_failed';
          return mcpError(code, result.error);
        }
        const peer = { ...result.opportunity.peer, url: appLink('u', result.opportunity.peer.userId) };
        const chatOpen = accepted && 'conversationId' in result && !!result.conversationId;
        const url = chatOpen ? `${peer.url}/chat` : appLink('o', result.opportunity.opportunityId);
        const opportunity = { ...result.opportunity, id: result.opportunity.opportunityId, url, peer };
        return mcpSuccess({
          ...result,
          opportunity,
          chatUrl: chatOpen ? url : null,
          message: chatOpen
            ? `Accepted. The chat with ${peer.name} is open now; they don't need to accept first, and you can message them right away.`
            : accepted
              ? 'Opportunity accepted.'
              : 'Opportunity passed; its associated negotiation may have been closed.',
        }, `${opportunityLine(peer.name, url, opportunity.headline, opportunity.status, null, chatOpen)} — ${accepted ? 'accepted' : 'passed'}`);
      }),
    );
  };

  registerOpportunityAction('accept_opportunity');
  registerOpportunityAction('reject_opportunity');
}
