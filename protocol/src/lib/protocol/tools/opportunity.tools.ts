import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, UUID_REGEX } from "./tool.helpers";
import { MINIMAL_MAIN_TEXT_MAX_CHARS } from "../support/opportunity.constants";
import { viewerCentricCardSummary, narratorRemarkFromReasoning } from "../support/opportunity.card-text";
import { runDiscoverFromQuery, continueDiscovery } from "../support/opportunity.discover";
import type { EvaluatorEntity } from "../agents/opportunity.evaluator";
import { protocolLogger } from "../support/protocol.logger";
import type { Opportunity } from "../interfaces/database.interface";

const logger = protocolLogger("ChatTools:Opportunity");

/** Maximum number of opportunity cards to show per chat response. */
const CHAT_DISPLAY_LIMIT = 3;

/** Markdown code fence (three backticks). Avoids embedding ``` in string literals so TS parser stays in sync. */
const CODE_FENCE = String.fromCharCode(96, 96, 96);

/**
 * Sanitize JSON string for use inside a markdown code fence (```). Escapes backticks
 * so embedded ``` cannot close the fence prematurely.
 */
function sanitizeJsonForCodeFence(json: string): string {
  return json.replace(/`/g, "\\u0060");
}

/**
 * Build minimal opportunity card data for chat without calling the LLM presenter.
 * Uses only required fields from the opportunity record and counterpart name/avatar
 * so list_opportunities and discovery return quickly.
 *
 * Note: narratorChip.text is generated via regex heuristics (narratorRemarkFromReasoning)
 * rather than the OpportunityPresenter LLM. If narrator quality becomes an issue again,
 * consider making this function async and delegating to OpportunityPresenter.presentHomeCard()
 * which already produces a high-quality narratorRemark via LLM (used by the home graph
 * and discovery pipeline). The trade-off is 5-20s latency per card.
 *
 * Exported for use in tests (opportunity.tools.spec.ts).
 */
export function buildMinimalOpportunityCard(
  opp: Opportunity,
  viewerId: string,
  counterpartUserId: string,
  counterpartName: string,
  counterpartAvatar: string | null,
  introducerName?: string | null,
  introducerAvatar?: string | null,
  viewerName?: string,
  secondPartyName?: string,
  isCounterpartGhost?: boolean,
): {
  opportunityId: string;
  userId: string;
  name: string;
  avatar: string | null;
  mainText: string;
  cta: string;
  headline: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  mutualIntentsLabel: string;
  narratorChip: { name: string; text: string; avatar?: string | null; userId?: string };
  viewerRole: string;
  score: number | undefined;
  status: string;
  isGhost: boolean;
} {
  const viewerActor = opp.actors.find((a) => a.userId === viewerId);
  const viewerRole = viewerActor?.role ?? "party";
  const introducerActor = opp.actors.find(
    (a) => a.role === "introducer" && a.userId !== viewerId,
  );
  const viewerIsIntroducer = opp.actors.some(
    (a) => a.role === "introducer" && a.userId === viewerId,
  );
  const reasoning = opp.interpretation?.reasoning ?? "";
  const mainText = viewerCentricCardSummary(
    reasoning,
    counterpartName,
    MINIMAL_MAIN_TEXT_MAX_CHARS,
    viewerName,
    introducerName ?? undefined,
  );
  const score =
    typeof opp.interpretation?.confidence === "number"
      ? opp.interpretation.confidence
      : undefined;
  const narratorName = viewerIsIntroducer
    ? "You"
    : introducerName ?? (introducerActor ? "Someone" : "Index");
  const primaryActionLabel =
    viewerRole === "introducer"
      ? "Introduce Them"
      : (isCounterpartGhost ? "Invite to chat" : "Start Chat");
  return {
    opportunityId: opp.id,
    userId: counterpartUserId,
    name: counterpartName,
    avatar: counterpartAvatar,
    mainText,
    cta: "Start a conversation to connect.",
    headline: viewerIsIntroducer && secondPartyName
      ? `${counterpartName} → ${secondPartyName}`
      : `Connection with ${counterpartName}`,
    primaryActionLabel,
    secondaryActionLabel: "Skip",
    mutualIntentsLabel: "Suggested connection",
    narratorChip: {
      name: narratorName,
      text: narratorRemarkFromReasoning(reasoning, counterpartName, viewerName),
      ...(viewerIsIntroducer
        ? { userId: viewerId, avatar: null }
        : introducerActor
          ? { userId: introducerActor.userId, avatar: introducerAvatar ?? null }
          : {}),
    },
    viewerRole,
    score,
    status: opp.status ?? "latent",
    isGhost: isCounterpartGhost ?? false,
  };
}

export function createOpportunityTools(defineTool: DefineTool, deps: ToolDeps) {
  const { database, userDb, systemDb, graphs, embedder, cache } = deps;

  const createOpportunities = defineTool({
    name: "create_opportunities",
    description:
      "Creates opportunities (connections). NOT for looking up a specific person by name — use read_user_profiles(query=name) for that.\n\n" +
      "Four modes:\n" +
      "1. **Discovery**: pass searchQuery and/or indexId. Finds matching people based on intent overlap.\n" +
      "2. **Introduction**: pass partyUserIds (2+ user IDs) + entities (pre-gathered profiles and intents). " +
      "You MUST gather profiles and intents from shared indexes BEFORE calling this. " +
      "Optionally pass hint (the user's reason for the introduction).\n" +
      "3. **Direct connection**: pass targetUserId (a single user ID) + searchQuery (reason for connecting). " +
      "Creates an opportunity between the current user and the target user.\n" +
      "4. **Introducer discovery**: pass introTargetUserId (user ID to find matches FOR). " +
      "Discovers matches for that person; current user becomes the introducer. " +
      "Use when user asks 'who should I introduce to @Person'.\n\n" +
      "Results are saved as drafts; use update_opportunity(status='pending') to send.",
    querySchema: z.object({
      continueFrom: z
        .string()
        .optional()
        .describe("Discovery pagination: pass the discoveryId from a previous result to evaluate more candidates."),
      searchQuery: z
        .string()
        .optional()
        .describe("Discovery mode: what to look for."),
      indexId: z
        .string()
        .optional()
        .describe("Index UUID; optional when index-scoped."),
      intentId: z
        .string()
        .optional()
        .describe("Discovery mode: optional intent to use as source and for triggeredBy (e.g. from queue)."),
      targetUserId: z
        .string()
        .optional()
        .describe("Direct connection mode: create opportunity with this specific user ID. Used when the user wants to connect with a named person."),
      introTargetUserId: z
        .string()
        .optional()
        .describe(
          "Introducer discovery mode: find matches FOR this user ID (the current user becomes the introducer). " +
          "Use when the user asks 'who should I introduce to @Person'. " +
          "Do NOT combine with partyUserIds (that's full introduction mode)."
        ),
      partyUserIds: z
        .array(z.string())
        .optional()
        .describe("Introduction mode: user IDs to introduce (at least 2)."),
      entities: z
        .array(
          z.object({
            userId: z.string(),
            profile: z
              .object({
                name: z.string().optional(),
                bio: z.string().optional(),
                location: z.string().optional(),
                interests: z.array(z.string()).optional(),
                skills: z.array(z.string()).optional(),
                context: z.string().optional(),
              })
              .optional(),
            intents: z
              .array(
                z.object({
                  intentId: z.string(),
                  payload: z.string(),
                  summary: z.string().optional(),
                }),
              )
              .optional(),
            indexId: z
              .string()
              .describe("Shared index this entity's data comes from (required for intro mode)"),
          }),
        )
        .optional()
        .describe(
          "Introduction mode: pre-gathered profiles + intents per party. Gather via read_user_profiles + read_intents before calling.",
        ),
      hint: z
        .string()
        .optional()
        .describe(
          "Introduction mode: the user's reason for the intro (e.g. 'both AI devs').",
        ),
    }),
    handler: async ({ context, query }) => {
      // Strict scope enforcement: when chat is index-scoped, only allow that index
      if (
        context.indexId &&
        query.indexId?.trim() &&
        query.indexId.trim() !== context.indexId
      ) {
        return error(
          `This chat is scoped to ${context.indexName ?? "this index"}. You can only create opportunities in this community.`,
        );
      }

      const effectiveIndexId =
        (context.indexId || query.indexId?.trim()) ?? undefined;

      // ── Continuation mode ── (must take strict precedence — it's a pagination token)
      if (query.continueFrom) {
        const _graphStart = Date.now();
        const result = await continueDiscovery({
          opportunityGraph: graphs.opportunity,
          database,
          cache,
          userId: context.userId,
          discoveryId: query.continueFrom,
          expectedIndexId: context.indexId,
          limit: 20,
          minimalForChat: true,
          ...(context.sessionId ? { chatSessionId: context.sessionId } : {}),
        });
        const _graphMs = Date.now() - _graphStart;

        const allDebugSteps = [...(result.debugSteps ?? [])];

        if (!result.found) {
          return success({
            found: false,
            count: 0,
            message: result.message ?? "No more matching opportunities found in the remaining candidates.",
            summary: "No more matches found",
            ...(result.pagination ? { pagination: result.pagination } : {}),
            debugSteps: allDebugSteps,
            _graphTimings: [{ name: 'opportunity', durationMs: _graphMs, agents: [] }],
          });
        }

        // Format opportunity blocks — same pattern as the discovery path below
        const opportunityBlocks = (result.opportunities ?? []).map((opp) => {
          const cardData = {
            opportunityId: opp.opportunityId,
            userId: opp.userId,
            name: opp.name,
            avatar: opp.avatar,
            mainText: opp.homeCardPresentation?.personalizedSummary ?? opp.matchReason ?? "",
            cta: opp.homeCardPresentation?.suggestedAction,
            headline: opp.homeCardPresentation?.headline,
            primaryActionLabel: opp.homeCardPresentation?.primaryActionLabel,
            secondaryActionLabel: opp.homeCardPresentation?.secondaryActionLabel,
            mutualIntentsLabel: opp.homeCardPresentation?.mutualIntentsLabel,
            narratorChip: opp.narratorChip,
            viewerRole: opp.viewerRole,
            isGhost: opp.isGhost ?? false,
            score: opp.score,
            status: opp.status,
          };
          return (
            CODE_FENCE + "opportunity\n" +
            sanitizeJsonForCodeFence(JSON.stringify(cardData)) +
            "\n" + CODE_FENCE
          );
        });

        // Cap displayed cards at CHAT_DISPLAY_LIMIT; remaining feed into pagination
        const displayedBlocks = opportunityBlocks.slice(0, CHAT_DISPLAY_LIMIT);
        const extraFromCap = opportunityBlocks.length - displayedBlocks.length;

        const blocksText = displayedBlocks.join("\n\n");
        let message =
          "Found " + displayedBlocks.length + " more potential connection(s). IMPORTANT: Include the following opportunity code blocks EXACTLY as-is in your response (they render as interactive cards):\n\n" +
          blocksText;

        const totalRemaining = (result.pagination?.remaining ?? 0) + extraFromCap;
        if (totalRemaining > 0 && result.pagination?.discoveryId) {
          message += `\n\nThere are ${totalRemaining} more candidates. Ask if the user wants to see more — they can say "show me more" and you should call create_opportunities with continueFrom="${result.pagination.discoveryId}".`;
        } else {
          message += `\n\nThese are all the connections I found. If the user wants to attract more connections, suggest they create a signal — e.g. "Would you like to create a signal so others looking for someone like you can find you?" If they agree, call create_intent with a description based on what they were searching for.`;
        }

        return success({
          found: true,
          count: displayedBlocks.length,
          message,
          summary: `Found ${displayedBlocks.length} more match(es)`,
          ...(result.pagination ? { pagination: result.pagination } : {}),
          debugSteps: allDebugSteps,
          _graphTimings: [{ name: 'opportunity', durationMs: _graphMs, agents: [] }],
        });
      }

      // Derive partyUserIds from entities when agent passes entities but omits partyUserIds (intro mode).
      // Only derive when all entities share the same indexId to prevent cross-index introductions.
      const partyUserIdsFromEntities =
        query.entities &&
        query.entities.length >= 2 &&
        query.entities.every((e) => e.userId && e.indexId) &&
        new Set(query.entities.map((e) => e.indexId)).size === 1
          ? [...new Set(query.entities.map((e) => e.userId))]
          : undefined;
      const effectivePartyUserIds =
        query.partyUserIds && query.partyUserIds.length >= 2
          ? query.partyUserIds
          : (partyUserIdsFromEntities?.length ?? 0) >= 2
            ? partyUserIdsFromEntities
            : undefined;

      // ── Introduction mode ── (validation and persistence via opportunity graph)
      if (effectivePartyUserIds && effectivePartyUserIds.length >= 2) {
        if (!query.entities || query.entities.length === 0) {
          return error(
            "Introduction requires pre-gathered entity data. " +
              "First use read_index_memberships to find shared indexes, " +
              "then read_user_profiles and read_intents for each party, " +
              "then pass the results as entities.",
          );
        }

        const primaryIndexId = query.entities[0]?.indexId;
        if (!primaryIndexId) {
          return error(
            "Each entity must include an indexId (the shared index).",
          );
        }

        const introducedPartyUserIds = effectivePartyUserIds.filter(
          (uid) => uid !== context.userId,
        );
        if (introducedPartyUserIds.length === 0) {
          return error(
            "No counterpart to introduce. Provide at least one other user ID in partyUserIds (besides yourself).",
          );
        }

        const evaluatorEntities: EvaluatorEntity[] = query.entities.map(
          (e) => ({
            userId: e.userId,
            profile: e.profile ?? {},
            intents: e.intents,
            indexId: e.indexId,
          }),
        );

        const _introGraphStart = Date.now();
        const result = await graphs.opportunity.invoke({
          operationMode: "create_introduction",
          userId: context.userId,
          indexId: primaryIndexId,
          introductionEntities: evaluatorEntities,
          introductionHint: query.hint,
          requiredIndexId: context.indexId ?? undefined,
          options: {
            initialStatus: "draft" as const,
            ...(context.sessionId ? { conversationId: context.sessionId } : {}),
          },
        });
        const _introGraphMs = Date.now() - _introGraphStart;

        if (result.error || !result.opportunities?.length) {
          return error(
            result.error ?? "Failed to create introduction.",
          );
        }

        const created = result.opportunities[0];
        const reasoning =
          created.interpretation?.reasoning ?? "A suggested connection.";
        const confidence =
          typeof created.interpretation?.confidence === "number"
            ? created.interpretation.confidence
            : parseFloat(String(created.confidence ?? 0)) || 0;
        const introducerUser = await userDb.getUser();
        const firstPartyId = introducedPartyUserIds[0];
        const firstEntity = query.entities?.find((e) => e.userId === firstPartyId);
        const counterpartUser = firstPartyId
          ? await database.getUser(firstPartyId)
          : null;
        const counterpartName =
          firstEntity?.profile?.name ?? firstPartyId ?? "Someone";

        // Second party name — used in the headline for the introducer view ("A → B")
        const secondPartyId = introducedPartyUserIds[1];
        const secondEntity = query.entities?.find((e) => e.userId === secondPartyId);
        const secondPartyName = (secondEntity?.profile as { name?: string } | undefined)?.name;

        const viewerIsParty = effectivePartyUserIds.includes(context.userId);
        const viewerRole = viewerIsParty ? "party" : "introducer";
        const isCounterpartGhost = counterpartUser?.isGhost ?? false;
        const primaryActionLabel = viewerIsParty
          ? (isCounterpartGhost ? "Invite to chat" : "Start Chat")
          : "Introduce Them";
        const narratorChip = viewerIsParty
          ? {
              name: "Index",
              text: narratorRemarkFromReasoning(reasoning, counterpartName, introducerUser?.name ?? undefined),
            }
          : {
              name: "You",
              text: narratorRemarkFromReasoning(reasoning, counterpartName, introducerUser?.name ?? undefined),
              userId: context.userId,
            };

        const headline =
          !viewerIsParty && secondPartyName
            ? `${counterpartName} → ${secondPartyName}`
            : `Connection with ${counterpartName}`;

        const cardData = {
          opportunityId: created.id,
          userId: firstPartyId,
          name: counterpartName,
          avatar:
            counterpartUser?.avatar ??
            (firstEntity?.profile as { avatar?: string | null } | undefined)
              ?.avatar ??
            null,
          mainText: viewerCentricCardSummary(
            reasoning,
            counterpartName,
            MINIMAL_MAIN_TEXT_MAX_CHARS,
            undefined, // viewerName not available in this context; introducer name passed separately
            introducerUser?.name ?? undefined,
          ),
          cta: "Start a conversation to connect.",
          headline,
          primaryActionLabel,
          secondaryActionLabel: "Skip",
          mutualIntentsLabel: "Suggested connection",
          narratorChip,
          viewerRole,
          isGhost: isCounterpartGhost,
          score: confidence,
          status: created.status ?? "draft",
        };
        const block =
          CODE_FENCE + "opportunity\n" +
          sanitizeJsonForCodeFence(JSON.stringify(cardData)) +
          "\n" + CODE_FENCE;

        return success({
          found: true,
          count: 1,
          summary: "Draft introduction created",
          message:
            "Draft introduction created. IMPORTANT: Include the following " +
            CODE_FENCE +
            "opportunity code block EXACTLY as-is in your response (it renders as an interactive card):\n\n" +
            block,
          opportunities: [
            {
              opportunityId: created.id,
              matchReason: reasoning,
              score: confidence,
              status: created.status ?? "draft",
            },
          ],
          _graphTimings: [{ name: 'opportunity', durationMs: _introGraphMs, agents: result.agentTimings ?? [] }],
        });
      }

      // ── Discovery mode ──
      const searchQuery = query.searchQuery?.trim() ?? "";

      if (query.intentId != null && query.intentId !== "" && !UUID_REGEX.test(query.intentId.trim())) {
        return error("Invalid intent ID format.");
      }

      let indexScope: string[];
      const _scopeGraphTimings: Array<{ name: string; durationMs: number; agents: never[] }> = [];
      if (effectiveIndexId) {
        if (!UUID_REGEX.test(effectiveIndexId)) {
          return error("Invalid index ID format.");
        }
        const _scopeGraphStart = Date.now();
        const memberResult = await graphs.indexMembership.invoke({
          userId: context.userId,
          indexId: effectiveIndexId,
          operationMode: "read" as const,
        });
        _scopeGraphTimings.push({ name: 'index_membership', durationMs: Date.now() - _scopeGraphStart, agents: [] });
        if (memberResult.error) {
          return error("Index not found or you are not a member.");
        }
        indexScope = [effectiveIndexId];
      } else if (context.indexId) {
        // When scoped but no explicit indexId, use the scoped index
        indexScope = [context.indexId];
      } else {
        // No scope - use all indexes (only in unscoped chat)
        const _scopeGraphStart = Date.now();
        const indexResult = await graphs.index.invoke({
          userId: context.userId,
          operationMode: "read" as const,
          showAll: true,
        });
        _scopeGraphTimings.push({ name: 'index', durationMs: Date.now() - _scopeGraphStart, agents: [] });
        indexScope = (indexResult.readResult?.memberOf || []).map(
          (m: { indexId: string }) => m.indexId,
        );
      }

      const toolDebugSteps: Array<{ step: string; detail?: string }> = [
        { step: "resolve_index_scope", detail: `${indexScope.length} index(es)` },
      ];

      const triggerIntentId = query.intentId?.trim() || undefined;
      if (triggerIntentId != null && !UUID_REGEX.test(triggerIntentId)) {
        return error("Invalid intent ID format.");
      }

      if (query.introTargetUserId?.trim() && query.introTargetUserId.trim() === context.userId) {
        return error("You cannot discover introductions for yourself. Try regular discovery instead.");
      }

      const _discoverGraphStart = Date.now();
      const result = await runDiscoverFromQuery({
        opportunityGraph: graphs.opportunity,
        database,
        userId: context.userId,
        query: searchQuery,
        indexScope,
        limit: 20,
        minimalForChat: true, // Skip LLM presenter; return only required fields for fast chat
        triggerIntentId,
        targetUserId: query.targetUserId?.trim() || undefined,
        onBehalfOfUserId: query.introTargetUserId?.trim() || undefined,
        cache,
        ...(context.sessionId ? { chatSessionId: context.sessionId } : {}),
      });
      const _discoverGraphMs = Date.now() - _discoverGraphStart;
      const _discoverGraphTimings = [
        ..._scopeGraphTimings,
        { name: 'opportunity', durationMs: _discoverGraphMs, agents: [] as never[] },
      ];

      const allDebugSteps = [
        ...toolDebugSteps,
        ...(result.debugSteps ?? []),
      ];

      if (result.createIntentSuggested && result.suggestedIntentDescription) {
        return success({
          found: false,
          count: 0,
          createIntentSuggested: true,
          suggestedIntentDescription: result.suggestedIntentDescription,
          message:
            "No matching opportunities found. Call create_intent with the suggested description, then create_opportunities again.",
          summary: "No matches found",
          ...(result.pagination ? { pagination: result.pagination } : {}),
          debugSteps: allDebugSteps,
          _graphTimings: _discoverGraphTimings,
        });
      }

      if (!result.found) {
        return success({
          found: false,
          count: 0,
          message: result.message ?? "No matching opportunities found.",
          summary: "No matches found",
          ...(result.pagination ? { pagination: result.pagination } : {}),
          debugSteps: allDebugSteps,
          _graphTimings: _discoverGraphTimings,
        });
      }

      // Found but only existing connections (no new opportunities created)
      const forMention = result.existingConnectionsForMention ?? result.existingConnections ?? [];
      if ((result.opportunities?.length ?? 0) === 0 && forMention.length > 0) {
        return success({
          found: true,
          count: 0,
          message:
            result.message ??
            "No new opportunities created; you already have a connection with: " +
              forMention.map((c) => c.name + (c.status ? " (" + c.status + ")" : "")).join(", ") +
              ". View on your home page.",
          existingConnections: result.existingConnections,
          summary: "No new matches (existing connections only)",
          debugSteps: allDebugSteps,
          _graphTimings: _discoverGraphTimings,
        });
      }

      // Format opportunities as code blocks for the LLM to include in its response
      // The frontend will parse opportunity code blocks and render them as cards
      const opportunityBlocks = (result.opportunities ?? []).map((opp) => {
        const cardData = {
          opportunityId: opp.opportunityId,
          userId: opp.userId,
          name: opp.name,
          avatar: opp.avatar,
          mainText:
            opp.homeCardPresentation?.personalizedSummary ??
            opp.matchReason ??
            "",
          cta: opp.homeCardPresentation?.suggestedAction,
          headline: opp.homeCardPresentation?.headline,
          primaryActionLabel: opp.homeCardPresentation?.primaryActionLabel,
          secondaryActionLabel: opp.homeCardPresentation?.secondaryActionLabel,
          mutualIntentsLabel: opp.homeCardPresentation?.mutualIntentsLabel,
          narratorChip: opp.narratorChip,
          viewerRole: opp.viewerRole,
          isGhost: opp.isGhost ?? false,
          score: opp.score,
          status: opp.status,
        };
        return (
          CODE_FENCE + "opportunity\n" +
          sanitizeJsonForCodeFence(JSON.stringify(cardData)) +
          "\n" + CODE_FENCE
        );
      });

      // Cap displayed cards at CHAT_DISPLAY_LIMIT; remaining feed into pagination
      const displayedBlocks = opportunityBlocks.slice(0, CHAT_DISPLAY_LIMIT);
      const extraFromCap = opportunityBlocks.length - displayedBlocks.length;

      // Join all opportunity blocks into a single string for the LLM to include verbatim
      const blocksText = displayedBlocks.join("\n\n");
      let message =
        "Found " +
        displayedBlocks.length +
        " potential connection(s). IMPORTANT: Include the following " + CODE_FENCE + "opportunity code blocks EXACTLY as-is in your response (they render as interactive cards):\n\n" +
        blocksText;
      const existingForMention = result.existingConnectionsForMention ?? result.existingConnections ?? [];
      if (existingForMention.length > 0) {
        message +=
          "\n\nYou already have a connection with: " +
          existingForMention.map((c) => c.name + (c.status ? " (" + c.status + ")" : "")).join(", ") +
          ". View on your home page.";
      }

      const totalRemaining = (result.pagination?.remaining ?? 0) + extraFromCap;
      if (totalRemaining > 0 && result.pagination?.discoveryId) {
        message += `\n\nThere are ${totalRemaining} more candidates. Ask if the user wants to see more — they can say "show me more" and you should call create_opportunities with continueFrom="${result.pagination.discoveryId}".`;
      } else {
        message += `\n\nThese are all the connections I found. If the user wants to attract more connections, suggest they create a signal — e.g. "Would you like to create a signal so others looking for someone like you can find you?" If they agree, call create_intent with a description based on what they were searching for.`;
      }

      return success({
        found: true,
        count: displayedBlocks.length,
        message,
        summary: `Found ${displayedBlocks.length} match(es)`,
        ...(result.existingConnections?.length ? { existingConnections: result.existingConnections } : {}),
        ...(result.pagination ? { pagination: result.pagination } : {}),
        debugSteps: allDebugSteps,
        // Distinct from `createIntentSuggested` (no-results path) intentionally:
        // `handleCreateIntentCallback` in chat.agent.ts auto-creates for that key.
        // This flag is for the results-found path where the agent must ask the user first.
        ...(searchQuery && !query.targetUserId
          ? {
              suggestIntentCreationForVisibility: true,
              suggestedIntentDescription: searchQuery,
            }
          : {}),
        _graphTimings: _discoverGraphTimings,
      });
    },
  });

  const listOpportunities = defineTool({
    name: "list_opportunities",
    description:
      "Lists the user's opportunities (suggested connections). Returns opportunity cards to display. When chat is index-scoped, only shows opportunities from that index.",
    querySchema: z.object({
      indexId: z
        .string()
        .optional()
        .describe("Index UUID filter; defaults to current index when scoped."),
    }),
    handler: async ({ context, query }) => {
      // Strict scope enforcement: when chat is index-scoped, only allow that index
      if (
        context.indexId &&
        query.indexId?.trim() &&
        query.indexId.trim() !== context.indexId
      ) {
        return error(
          "This chat is scoped to " +
            (context.indexName ?? "this index") +
            ". You can only list opportunities from this community.",
        );
      }

      const effectiveIndexId =
        (context.indexId || query.indexId?.trim()) ?? undefined;
      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format.");
      }

      // Get opportunities; use minimal card data (no LLM presenter) for fast chat response
      const opportunities = await database.getOpportunitiesForUser(
        context.userId,
        {
          indexId: effectiveIndexId,
          limit: CHAT_DISPLAY_LIMIT,
        },
      );

      if (!opportunities || opportunities.length === 0) {
        return success({
          found: false,
          count: 0,
          summary: "No opportunities yet",
          message:
            "You have no opportunities yet. Use create_opportunities to find connections.",
        });
      }

      // Batch-fetch profiles and users for all counterpart and introducer userIds to avoid N+1
      const counterpartUserIds = new Set<string>();
      const introducerUserIds = new Set<string>();
      for (const opp of opportunities) {
        const counterpartActor = opp.actors.find(
          (a) => a.userId !== context.userId && a.role !== "introducer",
        );
        if (counterpartActor?.userId) counterpartUserIds.add(counterpartActor.userId);
        const introducerActor = opp.actors.find(
          (a) => a.role === "introducer" && a.userId !== context.userId,
        );
        if (introducerActor?.userId) introducerUserIds.add(introducerActor.userId);
      }
      const allUserIds = [
        ...new Set([...counterpartUserIds, ...introducerUserIds]),
      ];
      const [viewerUser, profileResults, userResults] = await Promise.all([
        database.getUser(context.userId),
        Promise.all(allUserIds.map((id) => database.getProfile(id))),
        Promise.all(allUserIds.map((id) => database.getUser(id))),
      ]);
      const viewerName = viewerUser?.name ?? undefined;
      const profileMap = new Map<string, Awaited<ReturnType<typeof database.getProfile>>>();
      const userMap = new Map<string, Awaited<ReturnType<typeof database.getUser>>>();
      allUserIds.forEach((userId, i) => {
        const profile = profileResults[i] ?? null;
        const user = userResults[i] ?? null;
        if (profile) profileMap.set(userId, profile);
        if (user) userMap.set(userId, user);
      });

      const opportunityBlocks: string[] = [];
      const seenOpportunityIds = new Set<string>();

      for (const opp of opportunities) {
        if (seenOpportunityIds.has(opp.id)) continue;
        seenOpportunityIds.add(opp.id);
        try {
          const counterpartActor = opp.actors.find(
            (a) => a.userId !== context.userId && a.role !== "introducer",
          );
          const counterpartUserId = counterpartActor?.userId;
          if (!counterpartUserId) continue;

          const viewerIsIntroducerHere = opp.actors.some(
            (a) => a.role === "introducer" && a.userId === context.userId,
          );
          const secondPartyActorForHeadline = viewerIsIntroducerHere
            ? opp.actors.find(
                (a) =>
                  a.userId !== context.userId &&
                  a.userId !== counterpartUserId &&
                  a.role !== "introducer",
              )
            : undefined;
          const secondPartyNameForHeadline = secondPartyActorForHeadline
            ? (profileMap.get(secondPartyActorForHeadline.userId)?.identity?.name ??
              userMap.get(secondPartyActorForHeadline.userId)?.name ??
              undefined)
            : undefined;

          const introducerActor = opp.actors.find(
            (a) => a.role === "introducer" && a.userId !== context.userId,
          );
          const createdByName = opp.detection.createdByName;

          const counterpartProfile = profileMap.get(counterpartUserId) ?? null;
          const counterpartUser = userMap.get(counterpartUserId) ?? null;
          const introducerProfile =
            introducerActor && !createdByName
              ? profileMap.get(introducerActor.userId) ?? null
              : null;

          const counterpartName =
            counterpartProfile?.identity?.name ??
            counterpartUser?.name ??
            "Someone";
          const introducerName =
            createdByName ??
            (introducerActor ? introducerProfile?.identity?.name ?? null : null);
          const introducerUser = introducerActor
            ? userMap.get(introducerActor.userId) ?? null
            : null;

          const cardData = buildMinimalOpportunityCard(
            opp,
            context.userId,
            counterpartUserId,
            counterpartName,
            counterpartUser?.avatar ?? null,
            introducerName,
            introducerUser?.avatar ?? null,
            viewerName,
            secondPartyNameForHeadline,
          );

          opportunityBlocks.push(
            CODE_FENCE + "opportunity\n" +
              sanitizeJsonForCodeFence(JSON.stringify(cardData)) +
              "\n" + CODE_FENCE,
          );
        } catch (err) {
          logger.warn("Skipping opportunity that failed to build minimal card", {
            opportunityId: opp.id,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
      }

      if (opportunityBlocks.length === 0) {
        return success({
          found: false,
          count: 0,
          summary: "No opportunities yet",
          message:
            "You have no opportunities yet. Use create_opportunities to find connections.",
        });
      }

      // Join all opportunity blocks into a single string for the LLM to include verbatim
      const blocksText = opportunityBlocks.join("\n\n");

      return success({
        found: true,
        count: opportunityBlocks.length,
        summary: `You have ${opportunityBlocks.length} opportunity(ies)`,
        message:
          "You have " +
          opportunityBlocks.length +
          " opportunity(ies). IMPORTANT: Include the following " +
          CODE_FENCE +
          "opportunity code blocks EXACTLY as-is in your response (they render as interactive cards):\n\n" +
          blocksText,
      });
    },
  });

  const updateOpportunity = defineTool({
    name: "update_opportunity",
    description:
      "Updates an opportunity's status. Use 'pending' to send a draft (notifies next person). Use 'accepted'/'rejected' to respond to a received opportunity. When chat is index-scoped, can only update opportunities from that index.",
    querySchema: z.object({
      opportunityId: z
        .string()
        .describe("Opportunity ID from list_opportunities"),
      status: z
        .enum(["pending", "accepted", "rejected", "expired"])
        .describe(
          "New status: pending (send draft), accepted, rejected, expired",
        ),
    }),
    handler: async ({ context, query }) => {
      const opportunityId = query.opportunityId?.trim();
      if (!opportunityId || !UUID_REGEX.test(opportunityId)) {
        return error("Valid opportunityId required.");
      }

      // Strict scope enforcement: when chat is index-scoped, verify opportunity is in that index
      if (context.indexId) {
        const opportunity = await systemDb.getOpportunity(opportunityId);
        if (!opportunity) {
          return error("Opportunity not found.");
        }
        const opportunityIndexId = opportunity.context?.indexId;
        if (!opportunityIndexId || opportunityIndexId !== context.indexId) {
          return error("Opportunity not found.");
        }
      }

      const isSend = query.status === "pending";
      const _updateGraphStart = Date.now();
      const result = await graphs.opportunity.invoke({
        userId: context.userId,
        operationMode: isSend ? ("send" as const) : ("update" as const),
        opportunityId: query.opportunityId,
        ...(isSend ? {} : { newStatus: query.status }),
      });
      const _updateGraphMs = Date.now() - _updateGraphStart;

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            opportunityId: result.mutationResult.opportunityId,
            status: query.status,
            message: result.mutationResult.message,
            ...(result.mutationResult.notified && {
              notified: result.mutationResult.notified,
            }),
            _graphTimings: [{ name: 'opportunity', durationMs: _updateGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(
          result.mutationResult.error || "Failed to update opportunity.",
        );
      }
      return error("Failed to update opportunity.");
    },
  });

  return [createOpportunities, listOpportunities, updateOpportunity] as const;
}
