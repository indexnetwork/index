import { encodeActions, readConversation, type WakeAction } from '@indexnetwork/agent';
import type { ConversationMessage, MatchReference } from '@indexnetwork/client';
import { NEGOTIATION_MESSAGE_LIMIT } from '@indexnetwork/protocol';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod-v4';

import { agentService } from '../../services/agent.service';
import { AGENT_DM_ID, AgentConversationError, ConversationService } from '../../services/conversation.service';
import { CREATE_OPPORTUNITIES_LIMIT, DISCOVER_LIMIT_MAX, IntentCreateRejectedError, IntentNetworkMembershipError, IntentPreparationFailedError, intentService } from '../../services/intent.service';
import { enrichmentService } from '../../services/enrichment.service';
import { negotiationService, type SubmitTurnRejection } from '../../services/negotiation.service';
import { opportunityService } from '../../services/opportunity.service';
import { userService } from '../../services/user.service';
import { RuntimeConflictError } from '../agent/runtime-errors';
import { actionLink, appLink } from '../app-link';
import { IntentPreparationReceiptError } from '../intent/intent.preparation';

import { captureMcpToolFailure, mcpError, mcpSuccess } from './mcp.results';
import type { McpPrincipal } from './mcp.types';

const LINK_HINT = ' The result starts with a markdown summary whose names are already linked. Reuse those lines; when you rephrase, put the link on the person, signal, or opportunity name itself, never as a separate "link" word.';

/** Shares one connection with the owner's chat, so the description is the only gate. */
const agentOnly = (name: string) =>
  `Agent tool. Call only when your task instructions name ${name}, never because the person asked for something.`;

const emptyInputSchema = z.object({}).strict();
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

function signalLabel(text: string | null | undefined): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return 'Untitled signal';
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

function intentLine(intent: ReturnType<typeof conciseIntent>): string {
  const state = intent.status === 'active' ? '' : ` (${intent.status.toLowerCase()})`;
  return `${mdLink(signalLabel(intent.summary ?? intent.description), intent.url)} — ${intent.waitingOpportunityCount} waiting${state}`;
}

const OPPORTUNITY_STATE: Record<string, string> = {
  pending: 'waiting on you',
  negotiating: 'agents talking',
  accepted: 'connected',
  rejected: 'passed',
  expired: 'expired',
};

function opportunityState(status: string): string {
  return OPPORTUNITY_STATE[status] ?? status;
}

function opportunityLine(peerName: string, peerUrl: string, headline: string | undefined, status: string): string {
  return `${mdLink(peerName, peerUrl)} — ${headline || 'New match'} — ${opportunityState(status)}`;
}

async function linkedIntent(intentId: string, userId: string): Promise<{ url: string; link: string }> {
  const url = appLink('i', intentId);
  const intent = await intentService.getById(intentId, userId);
  const label = intent ? signalLabel(intent.summary ?? intent.payload) : 'signal';
  return { url, link: mdLink(label, url) };
}

function safeProfile(profile: NonNullable<Awaited<ReturnType<typeof userService.findWithGraph>>>) {
  return {
    id: profile.id,
    url: appLink('u', profile.id),
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

const SOURCE_FIELDS_HINT = ' Optional sourceType and sourceId are client-owned strings Index stores and returns unchanged, for mapping your own records (such as an inferred ambient intent) to this signal.';
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

const TURN_ERRORS: Record<SubmitTurnRejection, string> = {
  not_found: 'No negotiation for this opportunity',
  not_a_seat: 'You do not hold a seat in this negotiation',
  already_settled: 'This negotiation has already settled',
  not_your_turn: 'It is not your turn',
  counter_is_first: 'counter needs a turn to answer; use propose',
  accept_without_offer: 'accept needs a standing propose from the other seat; answer a counter by proposing again',
  propose_over_offer: 'a proposal from the other seat is already standing; counter, accept or decline it',
  signal_inactive: 'A signal in this negotiation is paused or removed',
  turn_limit: 'The protocol turn limit was reached; the outcome remains undecided',
  invalid_turn: 'Invalid negotiation action or message',
  raced: 'The other seat moved first; re-read the negotiation',
};

function runTool(
  name: string,
  principal: McpPrincipal,
  operation: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  return operation().catch((error) => captureMcpToolFailure(error, name, principal));
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

const agentActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ask'),
    scope: z.enum(['intent', 'opportunity']),
    opportunityId: z.string().trim().min(1).optional(),
    question: z.string().trim().min(1).max(2000),
    options: z.array(z.string().trim().min(1).max(300)).min(2).max(4),
  }).strict(),
  z.object({ type: z.literal('expire'), questionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('note'), text: z.string().trim().min(1).max(8000) }).strict(),
  z.object({ type: z.literal('reply'), text: z.string().trim().min(1).max(8000) }).strict(),
  z.object({ type: z.literal('progress'), text: z.string().trim().min(1).max(8000) }).strict(),
]);

/** Register the curated owner-only Index tool surface on a fresh MCP server. */
export function registerMcpTools(server: McpServer, principal: McpPrincipal): void {
  server.registerTool(
    'get_my_profile',
    {
      description: 'Get the authenticated API key owner\'s safe Index profile.' + LINK_HINT,
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      description: 'Update only the supplied fields on the authenticated API key owner\'s profile.' + LINK_HINT,
      inputSchema: z.object({
        name: z.string().optional(),
        intro: z.string().optional(),
        location: z.string().optional(),
        timezone: z.string().optional(),
        avatar: z.string().optional(),
        socials: z.array(z.object({
          label: z.string().min(1),
          value: z.string().min(1),
        }).strict()).optional(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => runTool('update_my_profile', principal, async () => {
      const { socials, ...fields } = input;
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    (input) => runTool('enrich_my_profile', principal, async () => {
      const result = await enrichmentService.prefillPublicProfile(principal.userId, input);
      return mcpSuccess(result);
    }),
  );

  server.registerTool(
    'list_intents',
    {
      description: 'List the authenticated owner\'s signals with lifecycle, networks, waiting counts, and pagination.' + LINK_HINT,
      inputSchema: z.object({
        archived: z.boolean().optional(),
        query: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      }, intents.length ? ['Signals:', ...intents.map((intent) => `- ${intentLine(intent)}`)].join('\n') : 'No signals.');
    }),
  );

  server.registerTool(
    'get_intent',
    {
      description: 'Get one owned signal by UUID or supported short ID prefix, including its associated networks.' + LINK_HINT,
      inputSchema: intentIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      return mcpSuccess({ intent: { ...concise, networkIds } }, `Signal: ${intentLine(concise)}`);
    }),
  );

  server.registerTool(
    'create_intent',
    {
      description: 'Use when the owner wants to meet, find, hire, fund, collaborate with, or be introduced to people. Prepare and create a signal for the authenticated owner, sharing it only with eligible networks.' + SOURCE_FIELDS_HINT + LINK_HINT,
      inputSchema: z.object({
        description: z.string().max(65_536).refine((value) => value.trim().length > 0, 'description is required'),
        networkIds: z.array(z.string().uuid()).optional(),
        sourceType: sourceFieldSchema,
        sourceId: sourceFieldSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ description, networkIds, sourceType = null, sourceId = null }) => runTool('create_intent', principal, async () => {
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
        return mcpError('intent_needs_revision', 'The signal needs revision before it can be created.', {
          feedback: prepared.feedback,
          proposedPayload: prepared.payload,
          recovery: prepared.recovery,
        });
      }

      try {
        const created = await intentService.create(
          principal.userId,
          prepared.payload,
          networkIds ?? [],
          prepared.preparationReceipt,
          { sourceType, sourceId },
        );
        const url = appLink('i', created.id);
        const label = signalLabel(prepared.payload);
        return mcpSuccess(
          { intentId: created.id, url, networkIds: created.networkIds, sourceType, sourceId },
          `${mdLink(label, url)} — created`,
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
      description: 'Change the description or source fields of one owned, non-archived signal. Omitted fields stay as they are; null clears a source field.' + SOURCE_FIELDS_HINT + LINK_HINT,
      inputSchema: z.object({
        intentId: z.string().trim().min(1),
        description: z.string().trim().min(1).max(65_536).optional(),
        sourceType: sourceFieldSchema,
        sourceId: sourceFieldSchema,
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ intentId, description, sourceType, sourceId }) => runTool('update_intent', principal, async () => {
      if (description === undefined && sourceType === undefined && sourceId === undefined) {
        return mcpError('invalid_input', 'description, sourceType, or sourceId is required.');
      }
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const outcome = await intentService.update(resolved.id, principal.userId, description, { sourceType, sourceId });
      if (outcome.kind === 'not_found') return mcpError('intent_not_found', 'Intent not found.');
      if (outcome.kind === 'archived') return mcpError('intent_archived', 'Archived intents cannot be updated.');
      if (outcome.kind === 'rejected') return mcpError('intent_rejected', outcome.detail);
      const intent = await intentService.getById(resolved.id, principal.userId);
      const concise = intent ? conciseIntent(intent) : null;
      const fallbackUrl = appLink('i', resolved.id);
      return mcpSuccess(
        { intent: concise ?? { id: resolved.id, url: fallbackUrl, description } },
        concise ? intentLine(concise) : `${mdLink(signalLabel(description ?? 'Signal'), fallbackUrl)} — updated`,
      );
    }),
  );

  server.registerTool(
    'pause_intent',
    {
      description: 'Pause one owned signal. Pausing an already paused signal succeeds without changing it.' + LINK_HINT,
      inputSchema: intentIdSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
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
      description: 'Resume one owned signal. Resuming an already active signal succeeds; archived signals stay archived.' + LINK_HINT,
      inputSchema: intentIdSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ intentId }) => runTool('resume_intent', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
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
      description: 'Permanently archive one owned signal. This cannot currently be reversed, removes network associations, and expires related opportunities.' + LINK_HINT,
      inputSchema: z.object({
        intentId: z.string().trim().min(1),
        confirm: z.literal(true),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
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
    'list_opportunities',
    {
      description: 'Use when the owner asks who they should meet or what matches are waiting. List compact opportunity cards across the owner\'s Index or within one owned signal. Defaults to active, actionable statuses and never includes negotiation turns.' + LINK_HINT,
      inputSchema: z.object({
        intentId: z.string().trim().min(1).optional(),
        statuses: z.array(z.enum(['pending', 'negotiating', 'accepted', 'rejected', 'expired'])).min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).max(10_000).optional(),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      const opportunities = result.opportunities.slice(offset, offset + limit).map((opportunity) => ({
        id: opportunity.opportunityId,
        url: appLink('o', opportunity.opportunityId),
        acceptUrl: actionLink(opportunity.opportunityId, principal.userId, 'accept'),
        declineUrl: actionLink(opportunity.opportunityId, principal.userId, 'decline'),
        status: opportunity.status,
        negotiating: opportunity.status === 'negotiating',
        createdAt: opportunity.createdAt,
        updatedAt: opportunity.updatedAt,
        peer: { ...opportunity.peer, url: appLink('u', opportunity.peer.userId) },
        viewerRole: opportunity.viewerRole,
        headline: opportunity.headline,
        summary: opportunity.mainText,
        cta: opportunity.cta,
      }));
      const lines = opportunities.map((opportunity) =>
        `- ${opportunityLine(opportunity.peer.name, opportunity.peer.url, opportunity.headline, opportunity.status)}`);
      return mcpSuccess({
        opportunities,
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      return mcpSuccess({
        opportunity: {
          ...opportunity,
          url,
          acceptUrl,
          declineUrl,
          peer,
          otherParties,
        },
        negotiation,
      }, `${mdLink('Opportunity', url)}${people ? ` with ${people}` : ''}: ${opportunity.headline || 'New match'} — ${opportunityState(opportunity.status)}`);
    }),
  );

  server.registerTool(
    'discover_counterparties',
    {
      description: agentOnly('discover_counterparties') + ' Search one active signal\'s communities for people who could serve it, strongest first. Writes nothing.'
        + ' Use when a task is finding people for a signal that was just created, changed, or needs more reach.'
        + ' Do not use when the person asks who to meet, what matches they have, or what is waiting: that is list_opportunities.'
        + ' Do not use to look up a specific person, or for a paused or archived signal.',
      inputSchema: z.object({
        intentId: z.string().trim().min(1),
        query: z.string().trim().min(1).max(2_000).describe('The kind of person this signal needs, in your own words.'),
        limit: z.number().int().min(1).max(DISCOVER_LIMIT_MAX).optional(),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ intentId, query, limit }) => runTool('discover_counterparties', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const result = await intentService.discover(resolved.id, principal.userId, { query, limit });
      if (result.kind === 'not_found') return mcpError('intent_not_found', 'Intent not found.');
      if (result.kind === 'inactive') return mcpError('intent_inactive', 'Only an active signal can be searched.');
      return mcpSuccess({ counterparties: result.counterparties });
    }),
  );

  server.registerTool(
    'create_opportunities',
    {
      description: agentOnly('create_opportunities') + ' Open an opportunity with each counterparty discover_counterparties returned, passing its intentId and networkId. A pair that already has one reports that one.'
        + ' Use right after discover_counterparties in the same task, only for counterparties you judged worth a negotiation.'
        + ' Do not use when the person asks to meet, connect with, or be introduced to someone: that is accept_opportunity on an existing opportunity.'
        + ' Do not use with ids that did not come from discover_counterparties, or to re-open a passed or expired opportunity.',
      inputSchema: z.object({
        intentId: z.string().trim().min(1),
        counterparties: z.array(z.object({
          intentId: z.string().uuid(),
          networkId: z.string().uuid(),
        }).strict()).min(1).max(CREATE_OPPORTUNITIES_LIMIT),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ intentId, counterparties }) => runTool('create_opportunities', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const result = await intentService.createOpportunities(resolved.id, principal.userId, counterparties);
      if (result.kind === 'not_found') return mcpError('intent_not_found', 'Intent not found.');
      if (result.kind === 'inactive') return mcpError('intent_inactive', 'Only an active signal can open opportunities.');
      return mcpSuccess({
        opportunities: result.opportunities.map(({ opportunityId }) => ({ id: opportunityId, url: appLink('o', opportunityId) })),
      });
    }),
  );

  server.registerTool(
    'get_my_agent',
    {
      description: agentOnly('get_my_agent') + ' Read the agent selected to negotiate for the owner. Its id is the agentId a negotiation turn takes.',
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    () => runTool('get_my_agent', principal, async () => {
      const agent = await agentService.getSelectedNegotiator(principal.userId);
      if (!agent) return mcpError('negotiator_not_selected', 'No agent is selected to negotiate for this owner.');
      return mcpSuccess({ agent: { id: agent.id, name: agent.name, status: agent.status } });
    }),
  );

  server.registerTool(
    'get_agent_conversation',
    {
      description: 'Read one owned signal’s agent conversation the way the native Index agent reads it, including notes, progress, questions and the owner’s messages. questions are the ones still waiting. Private owner context: never forward it to a counterparty.' + LINK_HINT,
      inputSchema: intentIdSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    ({ intentId }) => runTool('get_agent_conversation', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      try {
        const conversation = await conversationService.resolveId(AGENT_DM_ID, principal.userId);
        if ('error' in conversation) return mcpError('agent_conversation_not_found', conversation.error);
        const [stored, agent] = await Promise.all([
          conversationService.getMessages(conversation.id, { intentId: resolved.id, userId: principal.userId }),
          conversationService.agentState(principal.userId, resolved.id),
        ]);
        const { url, link } = await linkedIntent(resolved.id, principal.userId);
        return mcpSuccess({
          intentId: resolved.id,
          conversation: readConversation(stored.map(inboxMessage)),
          questions: agent.questions,
          url,
        }, link);
      } catch (error) {
        const mapped = agentConversationFailure(error);
        if (mapped) return mapped;
        throw error;
      }
    }),
  );

  server.registerTool(
    'publish_agent_actions',
    {
      description: agentOnly('publish_agent_actions') + ' Persist ask, expire, note, reply or progress actions on the owner’s agent conversation, in the same format as the native Index agent. An ask is a question for the owner, not a negotiation turn and not their answer. Reuse a pending question for the same fact instead of asking again. An opportunity-scoped ask names that opportunity. This does not submit a negotiation turn or accept a match.',
      inputSchema: z.object({
        intentId: z.string().trim().min(1),
        agentId: z.string().uuid().describe('UUID of your selected negotiator.'),
        actions: z.array(agentActionSchema).min(1).max(20),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ intentId, agentId, actions }) => runTool('publish_agent_actions', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      try {
        const counterparts = new Map<string, MatchReference>();
        const canonical = new Map<string, string>();
        for (const action of actions) {
          if (action.type !== 'ask') continue;
          if (action.scope === 'opportunity' && !action.opportunityId) {
            return mcpError('invalid_scope', 'An opportunity-scoped question needs its opportunityId.');
          }
          if (!action.opportunityId || canonical.has(action.opportunityId)) continue;
          const found = await resolveOpportunity(action.opportunityId, principal);
          if ('error' in found) return found.error;
          if (!counterparts.has(found.id)) {
            const opportunity = await opportunityService.getOpportunityWithPresentation(found.id, principal.userId, { presentation: 'skeleton' });
            if (!opportunity || 'error' in opportunity || opportunity.id !== found.id || opportunity.intentId !== resolved.id) {
              return mcpError('opportunity_not_found', 'Every opportunity must belong to this owned signal.');
            }
            const peer = opportunity.otherParties[0];
            if (!peer) return mcpError('opportunity_not_found', 'Every opportunity must belong to this owned signal.');
            counterparts.set(found.id, { opportunityId: found.id, counterparty: { id: peer.id, name: peer.name } });
          }
          canonical.set(action.opportunityId, found.id);
        }
        const prepared: WakeAction[] = actions.map((action) => (
          action.type === 'ask' && action.opportunityId
            ? { ...action, opportunityId: canonical.get(action.opportunityId)! }
            : action
        ));
        const conversation = await conversationService.resolveId(AGENT_DM_ID, principal.userId);
        if ('error' in conversation) return mcpError('agent_conversation_not_found', conversation.error);
        const stored = await conversationService.getMessages(conversation.id, { intentId: resolved.id, userId: principal.userId });
        const questions = new Map<string, string>();
        for (const entry of readConversation(stored.map(inboxMessage))) {
          if (entry.kind === 'question' && entry.questionId) questions.set(entry.questionId, entry.text);
        }
        const entries = encodeActions(prepared, { counterparts, questions });
        await conversationService.publishH2A({ userId: principal.userId, intentId: resolved.id, agentId, entries });
        const { url, link } = await linkedIntent(resolved.id, principal.userId);
        return mcpSuccess({ intentId: resolved.id, entries, url }, link);
      } catch (error) {
        const mapped = agentConversationFailure(error);
        if (mapped) return mapped;
        throw error;
      }
    }),
  );

  server.registerTool(
    'answer_agent_questions',
    {
      description: 'Record the owner’s explicit answers to their agent’s questions, the same way the Index app does. Copy their words; never infer or invent an answer. An answer that names a question no longer waiting is kept as a plain message. A saved answer is not approval to accept or pass a match.' + LINK_HINT,
      inputSchema: z.object({
        intentId: z.string().trim().min(1),
        answers: z.array(z.object({
          questionId: z.string().uuid(),
          text: z.string().trim().min(1).max(8000),
        }).strict()).min(1).max(20),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ intentId, answers }) => runTool('answer_agent_questions', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const conversation = await conversationService.resolveId(AGENT_DM_ID, principal.userId);
      if ('error' in conversation) return mcpError('agent_conversation_not_found', conversation.error);
      try {
        const persisted = await conversationService.answerQuestions({
          userId: principal.userId, intentId: resolved.id, conversationId: conversation.id, answers,
        });
        const { url, link } = await linkedIntent(resolved.id, principal.userId);
        return mcpSuccess({
          intentId: resolved.id,
          answers: persisted.map((message) => {
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

  server.registerTool(
    'submit_negotiation_turn',
    {
      description: agentOnly('submit_negotiation_turn') + ' Submit one negotiator turn on an opportunity. Pass your own agent id. Use only an action from protocol.availableActions on get_opportunity. This is the agents\' exchange, not the owner\'s approval — accept_opportunity and reject_opportunity remain separate.' + LINK_HINT,
      inputSchema: z.object({
        opportunityId: z.string().trim().min(1),
        agentId: z.string().uuid().describe('UUID of your selected negotiator.'),
        action: z.enum(['propose', 'counter', 'accept', 'decline']),
        message: z.string().trim().min(1).max(NEGOTIATION_MESSAGE_LIMIT),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ opportunityId, agentId, action, message }) => runTool('submit_negotiation_turn', principal, async () => {
      const resolved = await resolveOpportunity(opportunityId, principal);
      if ('error' in resolved) return resolved.error;
      let result;
      try {
        result = await negotiationService.submitTurn(resolved.id, principal.userId, { action, message }, {
          userId: principal.userId,
          agentId,
        });
      } catch (error) {
        if (error instanceof RuntimeConflictError) {
          return mcpError('executor_changed', 'The selected negotiation executor changed; stop this work');
        }
        throw error;
      }
      if ('rejection' in result) return mcpError(result.rejection, TURN_ERRORS[result.rejection]);
      const url = appLink('o', resolved.id);
      const settled = result.outcome ? ` — ${result.outcome}` : '';
      return mcpSuccess({ negotiation: result, url }, `${mdLink('Opportunity', url)} — ${action} submitted${settled}`);
    }),
  );

  const registerOpportunityAction = (name: 'accept_opportunity' | 'reject_opportunity') => {
    const accepted = name === 'accept_opportunity';
    server.registerTool(
      name,
      {
        description: (accepted
          ? 'Accept one visible opportunity for the authenticated owner, optionally scoped to an owned signal.'
          : 'Pass on one visible opportunity for the authenticated owner, optionally scoped to an owned signal. This is the Mac app\'s Pass action and may close the associated negotiation.') + LINK_HINT,
        inputSchema: opportunityActionSchema,
        annotations: { readOnlyHint: false, destructiveHint: !accepted, openWorldHint: true },
      },
      ({ opportunityId, intentId }) => runTool(name, principal, async () => {
        const resolvedOpportunity = await resolveOpportunity(opportunityId, principal);
        if ('error' in resolvedOpportunity) return resolvedOpportunity.error;
        let resolvedIntentId: string | undefined;
        if (intentId) {
          const resolvedIntent = await resolveIntent(intentId, principal);
          if ('error' in resolvedIntent) return resolvedIntent.error;
          resolvedIntentId = resolvedIntent.id;
        }
        const result = await opportunityService.updateOpportunityStatus(
          resolvedOpportunity.id,
          accepted ? 'accepted' : 'rejected',
          principal.userId,
          { intentId: resolvedIntentId },
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
        const url = appLink('o', result.opportunity.opportunityId);
        const peer = { ...result.opportunity.peer, url: appLink('u', result.opportunity.peer.userId) };
        const opportunity = { ...result.opportunity, id: result.opportunity.opportunityId, url, peer };
        return mcpSuccess({
          ...result,
          opportunity,
          message: accepted
            ? 'Opportunity accepted.'
            : 'Opportunity passed; its associated negotiation may have been closed.',
        }, `${opportunityLine(peer.name, peer.url, opportunity.headline, opportunity.status)} — ${accepted ? 'accepted' : 'passed'}`);
      }),
    );
  };

  registerOpportunityAction('accept_opportunity');
  registerOpportunityAction('reject_opportunity');
}
