import { z } from "zod";

import { requestContext } from "../shared/observability/request-context.js";

import type { DefineTool, ToolDeps } from "../shared/agent/tool.helpers.js";
import { success, error, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import { MINIMAL_MAIN_TEXT_MAX_CHARS, getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from "./opportunity.labels.js";
import { viewerCentricCardSummary, narratorRemarkFromReasoning } from "./opportunity.presentation.js";
import { runDiscoverFromQuery, continueDiscovery } from "./opportunity.discover.js";
import type { EvaluatorEntity } from "./opportunity.evaluator.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { Opportunity, OpportunityStatus } from "../shared/interfaces/database.interface.js";

const logger = protocolLogger("ChatTools:Opportunity");

/**
 * Statuses for which `update_opportunity` must refuse mutations.
 * - `accepted` / `rejected` / `expired`: terminal outcomes.
 * - `negotiating`: an async negotiation graph is actively writing this row;
 *   a concurrent user/agent override would race with it.
 */
const UPDATE_OPPORTUNITY_BLOCKED_STATUSES = new Set<OpportunityStatus>([
  "accepted",
  "rejected",
  "expired",
  "negotiating",
]);

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
  secondPartyAvatar?: string | null,
  secondPartyUserId?: string,
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
  secondParty?: { name: string; avatar?: string | null; userId?: string };
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
    : introducerName?.trim() || (introducerActor ? "Someone" : "Index");
  const primaryActionLabel = getPrimaryActionLabel(viewerRole);
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
    secondaryActionLabel: SECONDARY_ACTION_LABEL,
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
    ...(viewerIsIntroducer && secondPartyName
      ? {
          secondParty: {
            name: secondPartyName,
            ...(secondPartyAvatar != null ? { avatar: secondPartyAvatar } : {}),
            ...(secondPartyUserId ? { userId: secondPartyUserId } : {}),
          },
        }
      : {}),
  };
}

/**
 * Minimal shape consumed by buildOpportunityPresentation for prose rendering.
 * Card data objects in the codebase carry additional frontend-only fields;
 * only these are surfaced to MCP agents.
 */
type OpportunityCardLike = Record<string, unknown> & {
  opportunityId: string;
  name?: string | undefined;
  mainText?: string | undefined;
  status?: string | undefined;
};

/**
 * Format opportunity cards into the "opportunities" portion of a tool response.
 *
 * Web chat (`isMcp=false`): emits ```opportunity``` code fences with an
 * "include EXACTLY as-is" directive so the frontend card renderer can parse
 * and render interactive cards.
 *
 * MCP (`isMcp=true`): emits prose (name, reason, status, opportunityId per
 * card) with an explicit reminder to synthesize in natural language and not
 * dump raw fields or IDs. MCP clients have no card renderer, so code fences
 * would surface as raw JSON to end users.
 */
function buildOpportunityPresentation(
  cards: OpportunityCardLike[],
  opts: { isMcp: boolean; leadIn: string; label?: "opportunity" | "opportunities" },
): string {
  if (cards.length === 0) return opts.leadIn;

  if (opts.isMcp) {
    const prose = cards
      .map((card, i) => {
        const lines: string[] = [`${i + 1}. ${card.name ?? "Unknown"}`];
        if (card.mainText) lines.push(`   ${card.mainText}`);
        if (card.status) lines.push(`   status: ${card.status}`);
        lines.push(`   opportunityId: ${card.opportunityId}`);
        return lines.join("\n");
      })
      .join("\n\n");
    return (
      `${opts.leadIn}\n\n${prose}\n\n` +
      `Summarize these for the user in natural prose — mention first names and a brief match reason per connection. ` +
      `Do NOT print raw JSON, field labels, opportunityIds, or confidence scores. ` +
      `Use opportunityId values only when calling update_opportunity (send/accept/reject).`
    );
  }

  const label = opts.label ?? (cards.length === 1 ? "opportunity" : "opportunities");
  const blocks = cards
    .map(
      (card) =>
        CODE_FENCE + "opportunity\n" + sanitizeJsonForCodeFence(JSON.stringify(card)) + "\n" + CODE_FENCE,
    )
    .join("\n\n");
  return (
    `${opts.leadIn} IMPORTANT: Include the following ${CODE_FENCE}${label} code blocks EXACTLY as-is in your response (they render as interactive cards):\n\n${blocks}`
  );
}

export function createOpportunityTools(defineTool: DefineTool, deps: ToolDeps) {
  const { database, userDb, systemDb, graphs, embedder, cache } = deps;

  const createOpportunities = defineTool({
    name: "create_opportunities",
    description:
      "Creates opportunities — discovered connections between users based on complementary intents. Opportunities are the core output " +
      "of the discovery engine, representing potential valuable connections between people.\n\n" +
      "**NOT for person lookup** — use read_user_profiles(query=name) to find people by name.\n\n" +
      "**Four modes:**\n" +
      "1. **Discovery** (most common): pass `searchQuery` and/or `networkId`. The system finds other users in shared indexes " +
      "whose intents semantically complement the query. Uses HyDE embeddings and LLM evaluation for scoring.\n" +
      "2. **Introduction**: pass `partyUserIds` (2+ user IDs) + `entities` (pre-gathered profiles and intents from shared indexes). " +
      "You MUST call read_user_profiles and read_intents for each party BEFORE calling this. " +
      "Optionally pass `hint` with the user's reason for the introduction.\n" +
      "3. **Direct connection**: pass `targetUserId` + `searchQuery`. Creates an opportunity between the current user and one specific person.\n" +
      "4. **Introducer discovery**: pass `introTargetUserId` (find matches FOR that person; current user becomes the introducer). " +
      "Use when user asks 'who should I introduce to [person]?'\n\n" +
      "**Returns:** Opportunity code blocks (render as interactive cards) with opportunityId, match reasoning, confidence score, and status. " +
      "All results start as drafts. Supports pagination via `continueFrom` for large result sets.\n\n" +
      "**Next steps:** Use update_opportunity(opportunityId, status='pending') to send a draft to the other party.\n\n" +
      "**Discovery-first rule.** For open-ended connection-seeking requests (\"find me a mentor\", " +
      "\"who needs a React dev\", \"looking for investors\"), call this tool with `searchQuery` FIRST. " +
      "Do NOT call create_intent for these phrasings — create_intent is only for when the user explicitly " +
      "asks to \"create\", \"save\", \"add\", or \"remember\" a signal.\n\n" +
      "**Personal-index scoping.** When the user says \"in my network\", \"from my contacts\", \"people I know\", " +
      "or similar scoping language, pass the user's personal index ID (from memberships where `isPersonal: true`) " +
      "as `networkId`. The personal index contains the user's contacts — scoping discovery to it restricts " +
      "results to people the user already knows. Without this scoping language, omit networkId to let discovery " +
      "run across all indexes.\n\n" +
      "**Introduction mode prerequisites.** When using `partyUserIds` + `entities`, YOU must pre-fetch each party's " +
      "profile and intents before calling this tool. The entities array must include each party's userId, profile, " +
      "intents from shared indexes, and the shared networkId. Call read_user_profiles, read_network_memberships, " +
      "and read_intents for both parties first. The introducer (current user) must NOT appear in entities.\n\n" +
      "**Signal-visibility follow-up.** If the response includes `suggestIntentCreationForVisibility: true` and " +
      "`suggestedIntentDescription`, after presenting opportunity cards ask the user ONCE whether they'd also like " +
      "to create a signal so others can find them. On yes, call create_intent with the suggested description. " +
      "Never suggest this after introducer-mode (`introTargetUserId`) calls — the query describes the other person's " +
      "needs, not the signed-in user's.",
    querySchema: z.object({
      continueFrom: z
        .string()
        .optional()
        .describe("Pagination token: pass the discoveryId from a previous create_opportunities result to evaluate the next batch of candidates. Do not combine with other mode parameters."),
      searchQuery: z
        .string()
        .optional()
        .describe("Discovery mode: natural language description of what to look for (e.g. 'AI/ML engineers', 'startup advisors in fintech'). Drives semantic matching against other users' intents and profiles."),
      networkId: z
        .string()
        .optional()
        .describe("Index UUID to scope discovery to a specific community. Get from read_networks. Defaults to the scoped index in index-scoped chats. Pass the personal index ID (from read_networks, isPersonal=true) to scope to the user's contacts only."),
      intentId: z
        .string()
        .optional()
        .describe("Optional intent UUID to use as the discovery source. The intent's description drives matching instead of searchQuery. Get from read_intents. Typically used by background processing, not direct agent calls."),
      targetUserId: z
        .string()
        .optional()
        .describe("Direct connection mode: create an opportunity with this specific user. Get the userId from read_user_profiles(query=name). Combine with searchQuery to explain the connection reason."),
      introTargetUserId: z
        .string()
        .optional()
        .describe(
          "Introducer discovery mode: find matches FOR this user ID (the current user becomes the introducer). " +
          "Get the userId from read_user_profiles(query=name). " +
          "Use when the user asks 'who should I introduce to [person]?'. " +
          "Do NOT combine with partyUserIds (that's full introduction mode)."
        ),
      partyUserIds: z
        .array(z.string())
        .optional()
        .describe("Introduction mode: array of 2+ user IDs to introduce to each other. Get user IDs from read_user_profiles or read_network_memberships. Must also provide entities with pre-gathered profile/intent data."),
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
            networkId: z
              .string()
              .describe("Shared index this entity's data comes from (required for intro mode)"),
          }),
        )
        .optional()
        .describe(
          "Introduction mode: pre-gathered profile and intent data for each party being introduced. " +
          "Each entry needs userId, networkId (the shared index), and optionally profile (name, bio, skills, interests) and intents (intentId, payload). " +
          "Gather this data by calling read_user_profiles and read_intents for each party BEFORE calling create_opportunities. " +
          "All entities must share the same networkId (the shared index where both parties are members).",
        ),
      hint: z
        .string()
        .optional()
        .describe(
          "Introduction mode: the user's reason for making this introduction (e.g. 'both working on AI in healthcare', " +
          "'complementary skills for a startup'). Helps the evaluator produce better match reasoning.",
        ),
    }),
    handler: async ({ context, query }) => {
      // Strict scope enforcement: when chat is index-scoped, only allow that index
      if (
        context.networkId &&
        query.networkId?.trim() &&
        query.networkId.trim() !== context.networkId
      ) {
        return error(
          `This chat is scoped to ${context.networkName ?? "this index"}. You can only create opportunities in this community.`,
        );
      }

      const effectiveIndexId =
        (context.networkId || query.networkId?.trim()) ?? undefined;

      // ── Continuation mode ── (must take strict precedence — it's a pagination token)
      if (query.continueFrom) {
        const _continueTraceEmitter = requestContext.getStore()?.traceEmitter;
        const _graphStart = Date.now();
        _continueTraceEmitter?.({ type: "graph_start", name: "opportunity" });
        const result = await continueDiscovery({
          opportunityGraph: graphs.opportunity,
          database,
          cache,
          userId: context.userId,
          discoveryId: query.continueFrom,
          expectedIndexId: context.networkId,
          limit: 20,
          minimalForChat: true,
          ...(context.sessionId ? { chatSessionId: context.sessionId } : {}),
        });
        const _graphMs = Date.now() - _graphStart;
        _continueTraceEmitter?.({ type: "graph_end", name: "opportunity", durationMs: _graphMs });

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

        // Build card data; cap at CHAT_DISPLAY_LIMIT (remaining feeds into pagination)
        const allCardData = (result.opportunities ?? []).map((opp) => ({
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
        }));
        const displayedCards = allCardData.slice(0, CHAT_DISPLAY_LIMIT);
        const extraFromCap = allCardData.length - displayedCards.length;

        let message = buildOpportunityPresentation(displayedCards, {
          isMcp: context.isMcp ?? false,
          leadIn: `Found ${displayedCards.length} more potential connection(s).`,
        });

        const isIntroducerContinuation = !!query.introTargetUserId?.trim();
        const totalRemaining = (result.pagination?.remaining ?? 0) + extraFromCap;
        if (totalRemaining > 0 && result.pagination?.discoveryId) {
          message += `\n\nThere are ${totalRemaining} more candidates. Ask if the user wants to see more — they can say "show me more" and you should call create_opportunities with continueFrom="${result.pagination.discoveryId}".`;
        } else if (isIntroducerContinuation) {
          message += `\n\nThese are all the introduction candidates I found for this person.`;
        } else {
          message += `\n\nThese are all the connections I found. If the user wants to attract more connections, suggest they create a signal — e.g. "Would you like to create a signal so others looking for someone like you can find you?" If they agree, call create_intent with a description based on what they were searching for.`;
        }

        return success({
          found: true,
          count: displayedCards.length,
          message,
          summary: `Found ${displayedCards.length} more match(es)`,
          ...(result.pagination ? { pagination: result.pagination } : {}),
          debugSteps: allDebugSteps,
          _graphTimings: [{ name: 'opportunity', durationMs: _graphMs, agents: [] }],
        });
      }

      // Normalize entity networkIds before any checks to avoid raw-vs-trimmed mismatches.
      const normalizedEntities = query.entities?.map((e) => ({ ...e, networkId: e.networkId?.trim() }));

      // Derive partyUserIds from entities when agent passes entities but omits partyUserIds (intro mode).
      // Only derive when all entities share the same networkId to prevent cross-network introductions.
      const partyUserIdsFromEntities =
        normalizedEntities &&
        normalizedEntities.length >= 2 &&
        normalizedEntities.every((e) => e.userId && e.networkId) &&
        new Set(normalizedEntities.map((e) => e.networkId)).size === 1
          ? [...new Set(normalizedEntities.map((e) => e.userId))]
          : undefined;
      const effectivePartyUserIds =
        query.partyUserIds && query.partyUserIds.length >= 2
          ? query.partyUserIds
          : (partyUserIdsFromEntities?.length ?? 0) >= 2
            ? partyUserIdsFromEntities
            : undefined;

      // ── Introduction mode ── (validation and persistence via opportunity graph)
      if (effectivePartyUserIds && effectivePartyUserIds.length >= 2) {
        if (!normalizedEntities || normalizedEntities.length === 0) {
          return error(
            "Introduction requires pre-gathered entity data. " +
              "First use read_network_memberships to find shared networks, " +
              "then read_user_profiles and read_intents for each party, " +
              "then pass the results as entities.",
          );
        }

        const normalizedEntityNetworkIds = normalizedEntities
          .map((e) => e.networkId)
          .filter((id): id is string => Boolean(id));

        if (
          normalizedEntityNetworkIds.length !== normalizedEntities.length ||
          new Set(normalizedEntityNetworkIds).size !== 1
        ) {
          return error("All entities must include the same shared networkId.");
        }

        const [primaryNetworkId] = normalizedEntityNetworkIds;

        const introducedPartyUserIds = effectivePartyUserIds.filter(
          (uid) => uid !== context.userId,
        );
        if (introducedPartyUserIds.length === 0) {
          return error(
            "No counterpart to introduce. Provide at least one other user ID in partyUserIds (besides yourself).",
          );
        }

        const evaluatorEntities: EvaluatorEntity[] = normalizedEntities.map(
          (e) => ({
            userId: e.userId,
            profile: e.profile ?? {},
            intents: e.intents,
            networkId: e.networkId,
          }),
        );

        const _introGraphStart = Date.now();
        const _introTraceEmitter = requestContext.getStore()?.traceEmitter;
        _introTraceEmitter?.({ type: "graph_start", name: "opportunity" });
        const result = await graphs.opportunity.invoke({
          operationMode: "create_introduction",
          userId: context.userId,
          networkId: primaryNetworkId,
          introductionEntities: evaluatorEntities,
          introductionHint: query.hint,
          requiredNetworkId: context.networkId ?? undefined,
          options: {
            initialStatus: "draft" as const,
            ...(context.sessionId ? { conversationId: context.sessionId } : {}),
          },
        });
        const _introGraphMs = Date.now() - _introGraphStart;
        _introTraceEmitter?.({ type: "graph_end", name: "opportunity", durationMs: _introGraphMs });

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

        // Second party — used in the headline and arrow layout for the introducer view ("A → B")
        const secondPartyId = introducedPartyUserIds[1];
        const secondEntity = query.entities?.find((e) => e.userId === secondPartyId);
        const secondPartyName = (secondEntity?.profile as { name?: string } | undefined)?.name;
        const secondPartyAvatar = (secondEntity?.profile as { avatar?: string | null } | undefined)?.avatar ?? null;
        const secondPartyUser = secondPartyId ? await database.getUser(secondPartyId) : null;

        const viewerIsParty = effectivePartyUserIds.includes(context.userId);
        const viewerRole = viewerIsParty ? "party" : "introducer";
        const isCounterpartGhost = counterpartUser?.isGhost ?? false;
        const primaryActionLabel = getPrimaryActionLabel(viewerRole);
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
          secondaryActionLabel: SECONDARY_ACTION_LABEL,
          mutualIntentsLabel: "Suggested connection",
          narratorChip,
          viewerRole,
          isGhost: isCounterpartGhost,
          score: confidence,
          status: created.status ?? "draft",
          ...(!viewerIsParty && secondPartyName
            ? {
                secondParty: {
                  name: secondPartyName,
                  avatar: secondPartyUser?.avatar ?? secondPartyAvatar,
                  ...(secondPartyId ? { userId: secondPartyId } : {}),
                },
              }
            : {}),
        };
        return success({
          found: true,
          count: 1,
          summary: "Draft introduction created",
          message: buildOpportunityPresentation([cardData], {
            isMcp: context.isMcp ?? false,
            leadIn: "Draft introduction created.",
            label: "opportunity",
          }),
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

      let networkScope: string[];
      const _scopeGraphTimings: Array<{ name: string; durationMs: number; agents: Array<{ name: string; durationMs: number }> }> = [];
      if (effectiveIndexId) {
        if (!UUID_REGEX.test(effectiveIndexId)) {
          return error("Invalid network ID format.");
        }
        const _scopeGraphStart = Date.now();
        const _scopeIndexMembershipTraceEmitter = requestContext.getStore()?.traceEmitter;
        _scopeIndexMembershipTraceEmitter?.({ type: "graph_start", name: "network_membership" });
        const memberResult = await graphs.networkMembership.invoke({
          userId: context.userId,
          networkId: effectiveIndexId,
          operationMode: "read" as const,
        });
        const _scopeIndexMembershipMs = Date.now() - _scopeGraphStart;
        _scopeIndexMembershipTraceEmitter?.({ type: "graph_end", name: "network_membership", durationMs: _scopeIndexMembershipMs });
        _scopeGraphTimings.push({ name: 'network_membership', durationMs: _scopeIndexMembershipMs, agents: [] });
        if (memberResult.error) {
          return error("Network not found or you are not a member.");
        }
        networkScope = [effectiveIndexId];
      } else if (context.networkId) {
        // When scoped but no explicit networkId, use the scoped index
        networkScope = [context.networkId];
      } else {
        // No scope - use all indexes (only in unscoped chat)
        const _scopeGraphStart = Date.now();
        const _scopeIndexTraceEmitter = requestContext.getStore()?.traceEmitter;
        _scopeIndexTraceEmitter?.({ type: "graph_start", name: "index" });
        const indexResult = await graphs.network.invoke({
          userId: context.userId,
          operationMode: "read" as const,
          showAll: true,
        });
        const _scopeIndexMs = Date.now() - _scopeGraphStart;
        _scopeIndexTraceEmitter?.({ type: "graph_end", name: "index", durationMs: _scopeIndexMs });
        _scopeGraphTimings.push({ name: 'index', durationMs: _scopeIndexMs, agents: [] });
        networkScope = (indexResult.readResult?.memberOf || []).map(
          (m: { networkId: string }) => m.networkId,
        );
      }

      const toolDebugSteps: Array<{ step: string; detail?: string }> = [
        { step: "resolve_index_scope", detail: `${networkScope.length} index(es)` },
      ];

      const triggerIntentId = query.intentId?.trim() || undefined;
      if (triggerIntentId != null && !UUID_REGEX.test(triggerIntentId)) {
        return error("Invalid intent ID format.");
      }

      if (query.introTargetUserId?.trim() && query.introTargetUserId.trim() === context.userId) {
        return error("You cannot discover introductions for yourself. Try regular discovery instead.");
      }

      const _discoverTraceEmitter = requestContext.getStore()?.traceEmitter;
      const _discoverGraphStart = Date.now();
      _discoverTraceEmitter?.({ type: "graph_start", name: "opportunity" });
      // Chat-driven invocations run under the orchestrator trigger: persist
      // opens at 'negotiating', negotiate fans out with a 60s park window,
      // each accepted draft streams via traceEmitter, and the persist step
      // surfaces already-accepted pairs. Other callers (maintenance, queue
      // workers) still get the 'ambient' default.
      const runDiscoveryOrchestrator = !!context.sessionId;
      const result = await runDiscoverFromQuery({
        opportunityGraph: graphs.opportunity,
        database,
        userId: context.userId,
        query: searchQuery,
        networkScope,
        limit: 20,
        minimalForChat: true, // Skip LLM presenter; return only required fields for fast chat
        triggerIntentId,
        targetUserId: query.targetUserId?.trim() || undefined,
        onBehalfOfUserId: query.introTargetUserId?.trim() || undefined,
        cache,
        ...(context.sessionId ? { chatSessionId: context.sessionId } : {}),
        ...(runDiscoveryOrchestrator && { trigger: 'orchestrator' as const }),
      });
      const _discoverGraphMs = Date.now() - _discoverGraphStart;
      _discoverTraceEmitter?.({ type: "graph_end", name: "opportunity", durationMs: _discoverGraphMs });
      const _discoverGraphTimings = [
        ..._scopeGraphTimings,
        { name: 'opportunity', durationMs: _discoverGraphMs, agents: [] },
      ];

      const allDebugSteps = [
        ...toolDebugSteps,
        ...(result.debugSteps ?? []),
      ];

      // Extract negotiation timing from trace (if negotiation ran)
      const negotiateStep = (result.debugSteps ?? []).find(
        s => s.step === 'negotiate' && s.data?.durationMs != null
      );
      const _allGraphTimings = [
        ..._discoverGraphTimings,
        ...(negotiateStep?.data?.durationMs != null
          ? [{ name: 'negotiation', durationMs: negotiateStep.data.durationMs as number, agents: [] }]
          : []),
      ];

      const isIntroducerFlow = !!query.introTargetUserId?.trim();

      if (result.createIntentSuggested && result.suggestedIntentDescription && !isIntroducerFlow) {
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
          _graphTimings: _allGraphTimings,
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
          _graphTimings: _allGraphTimings,
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
          _graphTimings: _allGraphTimings,
        });
      }

      // Build card data; cap at CHAT_DISPLAY_LIMIT (remaining feeds into pagination)
      const allCardData = (result.opportunities ?? []).map((opp) => ({
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
        ...(opp.secondParty && { secondParty: opp.secondParty }),
      }));
      const displayedCards = allCardData.slice(0, CHAT_DISPLAY_LIMIT);
      const extraFromCap = allCardData.length - displayedCards.length;

      let message = buildOpportunityPresentation(displayedCards, {
        isMcp: context.isMcp ?? false,
        leadIn: `Found ${displayedCards.length} potential connection(s).`,
      });
      const existingForMention = result.existingConnectionsForMention ?? result.existingConnections ?? [];
      if (existingForMention.length > 0) {
        message +=
          "\n\nYou already have a connection with: " +
          existingForMention.map((c) => c.name + (c.status ? " (" + c.status + ")" : "")).join(", ") +
          ". View on your home page.";
      }
      // Orchestrator-only: dedupAlreadyAccepted surfaces pairs that already
      // have an accepted opp between the users. Tell the LLM so it can guide
      // the user to the existing chat instead of treating this like a brand-
      // new connection.
      if (result.alreadyAcceptedPairs && result.alreadyAcceptedPairs.length > 0) {
        message +=
          `\n\nYou already have ${result.alreadyAcceptedPairs.length} accepted opportunity(ies) with some of these candidates — open the existing chat with them rather than creating a new draft.`;
      }

      const totalRemaining = (result.pagination?.remaining ?? 0) + extraFromCap;
      if (totalRemaining > 0 && result.pagination?.discoveryId) {
        message += `\n\nThere are ${totalRemaining} more candidates. Ask if the user wants to see more — they can say "show me more" and you should call create_opportunities with continueFrom="${result.pagination.discoveryId}".`;
      } else if (isIntroducerFlow) {
        message += `\n\nThese are all the introduction candidates I found for this person.`;
      } else {
        message += `\n\nThese are all the connections I found. If the user wants to attract more connections, suggest they create a signal — e.g. "Would you like to create a signal so others looking for someone like you can find you?" If they agree, call create_intent with a description based on what they were searching for.`;
      }

      return success({
        found: true,
        count: displayedCards.length,
        message,
        summary: `Found ${displayedCards.length} match(es)`,
        ...(result.existingConnections?.length ? { existingConnections: result.existingConnections } : {}),
        ...(result.pagination ? { pagination: result.pagination } : {}),
        debugSteps: allDebugSteps,
        // Distinct from `createIntentSuggested` (no-results path) intentionally:
        // `handleCreateIntentCallback` in chat.agent.ts auto-creates for that key.
        // This flag is for the results-found path where the agent must ask the user first.
        ...(searchQuery && !query.targetUserId && !isIntroducerFlow
          ? {
              suggestIntentCreationForVisibility: true,
              suggestedIntentDescription: searchQuery,
            }
          : {}),
        _graphTimings: _allGraphTimings,
      });
    },
  });

  const listOpportunities = defineTool({
    name: "list_opportunities",
    description:
      "Lists the authenticated user's existing opportunities (discovered connections). Returns opportunity cards ready for display.\n\n" +
      "**What are opportunities?** Matches between users whose intents complement each other within shared indexes. " +
      "Each opportunity has a status: draft (not yet sent), pending (sent, awaiting response), accepted, rejected, or expired.\n\n" +
      "**When to use:** When the user wants to see their current connections/matches, check the status of previously discovered opportunities, " +
      "or review what's waiting for their response.\n\n" +
      "**Returns:** Up to 3 opportunity code blocks (interactive cards) with counterpart name, match reasoning, confidence score, " +
      "and current status. Use update_opportunity to act on them (send, accept, reject).",
    querySchema: z.object({
      networkId: z
        .string()
        .optional()
        .describe("Index UUID to filter opportunities to a specific community. Get from read_networks. Defaults to the scoped index in index-scoped chats. Omit to see opportunities across all indexes."),
    }),
    handler: async ({ context, query }) => {
      // Strict scope enforcement: when chat is index-scoped, only allow that index
      if (
        context.networkId &&
        query.networkId?.trim() &&
        query.networkId.trim() !== context.networkId
      ) {
        return error(
          "This chat is scoped to " +
            (context.networkName ?? "this index") +
            ". You can only list opportunities from this community.",
        );
      }

      const effectiveIndexId =
        (context.networkId || query.networkId?.trim()) ?? undefined;
      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid network ID format.");
      }

      // Get opportunities; use minimal card data (no LLM presenter) for fast chat response
      const opportunities = await database.getOpportunitiesForUser(
        context.userId,
        {
          networkId: effectiveIndexId,
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

      const cardDataList: Array<ReturnType<typeof buildMinimalOpportunityCard>> = [];
      const seenOpportunityIds = new Set<string>();
      const skippedCards: Array<{ opportunityId: string; error: string }> = [];

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

          const secondPartyUser = secondPartyActorForHeadline
            ? userMap.get(secondPartyActorForHeadline.userId) ?? null
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
            secondPartyUser?.avatar ?? null,
            secondPartyActorForHeadline?.userId,
          );

          cardDataList.push(cardData);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn("Skipping opportunity that failed to build minimal card", {
            opportunityId: opp.id,
            error: errMsg,
          });
          skippedCards.push({ opportunityId: opp.id, error: errMsg });
          continue;
        }
      }

      const listDebugSteps: Array<{ step: string; detail?: string; data?: Record<string, unknown> }> = [];
      if (skippedCards.length > 0) {
        listDebugSteps.push({
          step: "card_build_errors",
          detail: `${skippedCards.length} opportunity card(s) failed to build`,
          data: {
            skippedCount: skippedCards.length,
            totalOpportunities: opportunities.length,
            errors: skippedCards,
          },
        });
      }

      if (cardDataList.length === 0) {
        if (skippedCards.length > 0) {
          return success({
            found: false,
            count: 0,
            summary: "Some opportunities couldn't be displayed",
            message:
              "I found opportunities, but couldn't render them. Please try again.",
            ...(listDebugSteps.length ? { debugSteps: listDebugSteps } : {}),
          });
        }
        return success({
          found: false,
          count: 0,
          summary: "No opportunities yet",
          message:
            "You have no opportunities yet. Use create_opportunities to find connections.",
        });
      }

      return success({
        found: true,
        count: cardDataList.length,
        summary: `You have ${cardDataList.length} opportunity(ies)`,
        message: buildOpportunityPresentation(cardDataList, {
          isMcp: context.isMcp ?? false,
          leadIn: `You have ${cardDataList.length} opportunity(ies).`,
        }),
        ...(listDebugSteps.length ? { debugSteps: listDebugSteps } : {}),
      });
    },
  });

  const updateOpportunity = defineTool({
    name: "update_opportunity",
    description:
      "Updates an opportunity's status, advancing it through the connection lifecycle.\n\n" +
      "**Status transitions:**\n" +
      "- `pending`: Sends a draft opportunity to the other party. They'll be notified and can accept or reject. " +
      "This is the primary action after create_opportunities returns a draft.\n" +
      "- `accepted`: Accept a received opportunity — opens a direct conversation between both parties. Returns a conversationId to surface to the user.\n" +
      "- `rejected`: Decline a received opportunity.\n" +
      "- `expired`: Mark as expired (typically done by the system after timeout).\n\n" +
      "**When to use:** After create_opportunities or list_opportunities returns opportunity cards. " +
      "The user clicks 'Send' (pending), 'Accept', or 'Reject' on the card, and the agent calls this tool.\n\n" +
      "**Returns:** Confirmation with the new status and notification details (who was notified).",
    querySchema: z.object({
      opportunityId: z
        .string()
        .describe("The UUID of the opportunity to update. Get from create_opportunities or list_opportunities results."),
      status: z
        .enum(["pending", "accepted", "rejected", "expired"])
        .describe(
          "New status: 'pending' = send the draft to the other party, 'accepted' = accept the connection, " +
          "'rejected' = decline, 'expired' = mark as timed out.",
        ),
    }),
    handler: async ({ context, query }) => {
      const opportunityId = query.opportunityId?.trim();
      if (!opportunityId || !UUID_REGEX.test(opportunityId)) {
        return error("Valid opportunityId required.");
      }

      // Always fetch the opportunity — needed for actor guard and state machine
      const opportunity = await systemDb.getOpportunity(opportunityId);
      if (!opportunity) {
        return error("Opportunity not found.");
      }

      // Actor guard: caller must be a party to the opportunity
      const isActor = opportunity.actors?.some((a) => a.userId === context.userId);
      if (!isActor) {
        return error("Opportunity not found.");
      }

      // Terminal-state and in-flight-negotiation guard.
      // Not a full state-machine: the Zod enum already constrains the target status,
      // and source statuses like `draft` / `latent` remain permitted.
      if (UPDATE_OPPORTUNITY_BLOCKED_STATUSES.has(opportunity.status)) {
        return error(`This opportunity is already ${opportunity.status} and cannot be updated.`);
      }

      // Strict scope enforcement: when chat is index-scoped, verify opportunity is in that index
      if (context.networkId) {
        const opportunityIndexId =
          opportunity.context?.networkId ??
          opportunity.actors?.find((a) => a.networkId === context.networkId)?.networkId;
        if (!opportunityIndexId || opportunityIndexId !== context.networkId) {
          return error("Opportunity not found.");
        }
      }

      const isSend = query.status === "pending";
      const _updateGraphStart = Date.now();
      const _updateTraceEmitter = requestContext.getStore()?.traceEmitter;
      _updateTraceEmitter?.({ type: "graph_start", name: "opportunity" });
      const result = await graphs.opportunity.invoke({
        userId: context.userId,
        operationMode: isSend ? ("send" as const) : ("update" as const),
        opportunityId: query.opportunityId,
        ...(isSend ? {} : { newStatus: query.status }),
      });
      const _updateGraphMs = Date.now() - _updateGraphStart;
      _updateTraceEmitter?.({ type: "graph_end", name: "opportunity", durationMs: _updateGraphMs });

      if (result.mutationResult) {
        if (result.mutationResult.success) {
          return success({
            opportunityId: result.mutationResult.opportunityId,
            status: query.status,
            message: result.mutationResult.message,
            ...(result.mutationResult.notified && { notified: result.mutationResult.notified }),
            ...(result.mutationResult.conversationId && {
              conversationId: result.mutationResult.conversationId,
            }),
            _graphTimings: [{ name: 'opportunity', durationMs: _updateGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return error(result.mutationResult.error || "Failed to update opportunity.");
      }
      return error("Failed to update opportunity.");
    },
  });

  return [createOpportunities, listOpportunities, updateOpportunity] as const;
}
