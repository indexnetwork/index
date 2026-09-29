import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod-v4';

import { IntentCreateRejectedError, IntentNetworkMembershipError, IntentPreparationFailedError, intentService } from '../../services/intent.service';
import { enrichmentService } from '../../services/enrichment.service';
import { negotiationService } from '../../services/negotiation.service';
import { opportunityService } from '../../services/opportunity.service';
import { userService } from '../../services/user.service';
import { appLink } from '../app-link';
import { IntentPreparationReceiptError } from '../intent/intent.preparation';

import { captureMcpToolFailure, mcpError, mcpSuccess } from './mcp.results';
import type { McpPrincipal } from './mcp.types';

const LINK_HINT = ' The result starts with a markdown summary whose names are already linked; keep those links (or each item\'s `url`) when mentioning a person, signal, or opportunity.';

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
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

function intentLine(intent: ReturnType<typeof conciseIntent>): string {
  return `${mdLink(signalLabel(intent.summary ?? intent.description), intent.url)} — ${intent.status}`;
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
  };
}

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
  return operation().catch((error) => captureMcpToolFailure(error, name, principal));
}

/** Register the curated owner-only Index tool surface on a fresh MCP server. */
export function registerMcpTools(server: McpServer, principal: McpPrincipal): void {
  server.registerTool(
    'get_my_profile',
    {
      description: 'Get the authenticated API key owner\'s safe Index profile.' + LINK_HINT,
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
    },
    () => runTool('get_my_profile', principal, async () => {
      const profile = await userService.findWithGraph(principal.userId);
      if (!profile) return mcpError('profile_not_found', 'Profile not found.');
      const safe = safeProfile(profile);
      return mcpSuccess({ profile: safe }, `Profile: ${mdLink(safe.name || 'Your profile', safe.url)}`);
    }),
  );

  server.registerTool(
    'update_my_profile',
    {
      description: 'Update only the supplied fields on the authenticated API key owner\'s profile.',
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
      return mcpSuccess({ profile: safe }, `Updated profile: ${mdLink(safe.name || 'Your profile', safe.url)}`);
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      description: 'Prepare and create a signal for the authenticated owner, sharing it only with eligible networks.' + LINK_HINT,
      inputSchema: z.object({
        description: z.string().max(65_536).refine((value) => value.trim().length > 0, 'description is required'),
        networkIds: z.array(z.string().uuid()).optional(),
      }).strict(),
    },
    ({ description, networkIds }) => runTool('create_intent', principal, async () => {
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
        );
        const url = appLink('i', created.id);
        return mcpSuccess(
          { intentId: created.id, url, networkIds: created.networkIds },
          `Created signal ${mdLink(signalLabel(prepared.payload), url)}.`,
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
      description: 'Change only the description of one owned, non-archived signal.',
      inputSchema: z.object({
        intentId: z.string().trim().min(1),
        description: z.string().trim().min(1).max(65_536),
      }).strict(),
    },
    ({ intentId, description }) => runTool('update_intent', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const outcome = await intentService.update(resolved.id, principal.userId, description);
      if (outcome.kind === 'not_found') return mcpError('intent_not_found', 'Intent not found.');
      if (outcome.kind === 'archived') return mcpError('intent_archived', 'Archived intents cannot be updated.');
      if (outcome.kind === 'rejected') return mcpError('intent_rejected', outcome.detail);
      const intent = await intentService.getById(resolved.id, principal.userId);
      const concise = intent ? conciseIntent(intent) : null;
      return mcpSuccess(
        { intent: concise ?? { id: resolved.id, url: appLink('i', resolved.id), description } },
        `Updated signal ${concise ? intentLine(concise) : mdLink(signalLabel(description), appLink('i', resolved.id))}`,
      );
    }),
  );

  server.registerTool(
    'pause_intent',
    {
      description: 'Pause one owned signal. Pausing an already paused signal succeeds without changing it.',
      inputSchema: intentIdSchema,
    },
    ({ intentId }) => runTool('pause_intent', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const outcome = await intentService.transitionStatus(resolved.id, principal.userId, 'PAUSED');
      if (outcome.kind !== 'success') return intentTransitionError(outcome)!;
      return mcpSuccess({ intentId: outcome.id, status: outcome.status, changed: outcome.changed });
    }),
  );

  server.registerTool(
    'resume_intent',
    {
      description: 'Resume one owned signal. Resuming an already active signal succeeds; archived signals stay archived.',
      inputSchema: intentIdSchema,
    },
    ({ intentId }) => runTool('resume_intent', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const outcome = await intentService.transitionStatus(resolved.id, principal.userId, 'ACTIVE');
      if (outcome.kind !== 'success') return intentTransitionError(outcome)!;
      return mcpSuccess({ intentId: outcome.id, status: outcome.status, changed: outcome.changed });
    }),
  );

  server.registerTool(
    'archive_intent',
    {
      description: 'Permanently archive one owned signal. This cannot currently be reversed, removes network associations, and expires related opportunities.',
      inputSchema: z.object({
        intentId: z.string().trim().min(1),
        confirm: z.literal(true),
      }).strict(),
      annotations: { destructiveHint: true },
    },
    ({ intentId }) => runTool('archive_intent', principal, async () => {
      const resolved = await resolveIntent(intentId, principal);
      if ('error' in resolved) return resolved.error;
      const result = await intentService.archive(resolved.id, principal.userId);
      if (!result.success) return mcpError('intent_not_found', result.error ?? 'Intent not found.');
      return mcpSuccess({
        intentId: resolved.id,
        archived: true,
        message: 'Archiving cannot currently be reversed; network associations were removed and related opportunities were expired.',
      });
    }),
  );

  server.registerTool(
    'list_opportunities',
    {
      description: 'List compact opportunity cards across the owner\'s Index or within one owned signal. Defaults to active, actionable statuses and never includes negotiation turns.' + LINK_HINT,
      inputSchema: z.object({
        intentId: z.string().trim().min(1).optional(),
        statuses: z.array(z.enum(['pending', 'negotiating', 'accepted', 'rejected', 'expired'])).min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).max(10_000).optional(),
      }).strict(),
      annotations: { readOnlyHint: true },
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
        `- ${mdLink(opportunity.headline || 'Opportunity', opportunity.url)} with ${mdLink(opportunity.peer.name, opportunity.peer.url)} — ${opportunity.status}`);
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
      annotations: { readOnlyHint: true },
    },
    ({ opportunityId }) => runTool('get_opportunity', principal, async () => {
      const resolved = await resolveOpportunity(opportunityId, principal);
      if ('error' in resolved) return resolved.error;
      const opportunity = await opportunityService.getOpportunityWithPresentation(resolved.id, principal.userId);
      if (!opportunity) return mcpError('opportunity_not_found', 'Opportunity not found.');
      if ('error' in opportunity) return mcpError('opportunity_not_found', 'Opportunity not found.');
      const negotiation = await negotiationService.read(resolved.id, principal.userId);
      const url = appLink('o', opportunity.id);
      const otherParties = opportunity.otherParties.map((party) => ({ ...party, url: appLink('u', party.id) }));
      const people = otherParties.map((party) => mdLink(party.name, party.url)).join(', ');
      return mcpSuccess({
        opportunity: {
          ...opportunity,
          url,
          peer: { ...opportunity.peer, url: appLink('u', opportunity.peer.userId) },
          otherParties,
        },
        negotiation,
      }, `Opportunity: ${mdLink(opportunity.headline || 'Opportunity', url)}${people ? ` with ${people}` : ''} — ${opportunity.status}`);
    }),
  );

  const registerOpportunityAction = (name: 'accept_opportunity' | 'reject_opportunity') => {
    const accepted = name === 'accept_opportunity';
    server.registerTool(
      name,
      {
        description: accepted
          ? 'Accept one visible opportunity for the authenticated owner, optionally scoped to an owned signal.'
          : 'Pass on one visible opportunity for the authenticated owner, optionally scoped to an owned signal. This is the Mac app\'s Pass action and may close the associated negotiation.',
        inputSchema: opportunityActionSchema,
        annotations: { destructiveHint: !accepted },
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
        return mcpSuccess({
          ...result,
          message: accepted
            ? 'Opportunity accepted.'
            : 'Opportunity passed; its associated negotiation may have been closed.',
        });
      }),
    );
  };

  registerOpportunityAction('accept_opportunity');
  registerOpportunityAction('reject_opportunity');
}
