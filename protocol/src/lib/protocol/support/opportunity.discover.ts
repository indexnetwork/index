/**
 * Run discovery from an ad-hoc query (e.g. chat "find me a mentor", "who needs a React developer").
 *
 * Invokes the opportunity graph with the query as sourceText. The HyDE graph's
 * LensInferrer automatically infers search lenses from the query, replacing the
 * old hardcoded strategy selection. Returns formatted candidates (enriched with
 * profile name/bio) for chat display.
 *
 * Used by the create_opportunities chat tool.
 */

import type { Opportunity, ChatGraphCompositeDatabase } from "../interfaces/database.interface";
import type { Cache } from "../interfaces/cache.interface";
import type { OpportunityGraphOptions, CandidateMatch } from "../states/opportunity.state";
import {
  OpportunityPresenter,
  gatherPresenterContext,
  type OpportunityPresentationResult,
  type HomeCardPresentationResult,
  type HomeCardLLMResult,
  type HomeCardPresenterInput,
} from "../agents/opportunity.presenter";
import { MINIMAL_MAIN_TEXT_MAX_CHARS, getPrimaryActionLabel, SECONDARY_ACTION_LABEL } from "./opportunity.constants";
import { viewerCentricCardSummary, narratorRemarkFromReasoning } from "./opportunity.card-text";
import { protocolLogger, withCallLogging } from "./protocol.logger";

const logger = protocolLogger("OpportunityDiscover");

/** Compiled opportunity graph (from OpportunityGraphFactory.createGraph()). */
export type CompiledOpportunityGraph = ReturnType<
  import("../graphs/opportunity.graph").OpportunityGraphFactory["createGraph"]
>;

export interface DiscoverInput {
  /** Compiled opportunity graph (already has DB, embedder, cache, HyDE graph). */
  opportunityGraph: CompiledOpportunityGraph;
  /** Database for enriching candidates with profile (getProfile). */
  database: ChatGraphCompositeDatabase;
  userId: string;
  query: string;
  indexScope: string[];
  limit?: number;
  /** Optional intent to use as discovery source and for triggeredBy (e.g. from opportunity queue). */
  triggerIntentId?: string;
  /** When set, filter discovery candidates to this specific user only (direct connection). */
  targetUserId?: string;
  /** When set, discover on behalf of this user (introducer flow). The caller (userId) becomes the introducer. */
  onBehalfOfUserId?: string;
  /** When provided, each opportunity is enriched with personalized presentation (headline, personalizedSummary, suggestedAction). */
  presenter?: OpportunityPresenter;
  /**
   * When true, use the full home card presentation format (with narratorRemark, action labels, mutualIntentsLabel).
   * This enables rendering the same rich opportunity cards in chat as on the home page.
   */
  useHomeCardFormat?: boolean;
  /**
   * When true, skip the LLM presenter and return minimal card data only (faster for chat).
   * Sets homeCardPresentation and narratorChip from static labels and match reason.
   */
  minimalForChat?: boolean;
  /** When set (e.g. from chat), create opportunities as draft with context.conversationId = chatSessionId. */
  chatSessionId?: string;
  /** Redis cache for discovery pagination. When provided, remaining candidates are cached for continuation. */
  cache?: Cache;
}

/** Context used by the minimal (no-LLM) path; only introducerName is needed for narrator chip. */
type MinimalPresenterContext = { introducerName?: string };

/** Max chars for bio and matchReason in chat tool results to keep context manageable. */
const MAX_FIELD_CHARS = 100;

function truncateForChat(
  s: string | undefined,
  max = MAX_FIELD_CHARS,
): string | undefined {
  if (s == null || s === "") return undefined;
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + "...";
}

/** One formatted opportunity for chat (candidate-facing). */
export interface FormattedDiscoveryCandidate {
  opportunityId: string;
  userId: string;
  name?: string;
  avatar?: string | null;
  bio?: string;
  matchReason: string;
  score: number;
  status?: string;
  /** Present when DiscoverInput.presenter was provided (basic presentation). */
  presentation?: OpportunityPresentationResult;
  /** Present when DiscoverInput.useHomeCardFormat is true (full home card contract). */
  homeCardPresentation?: HomeCardPresentationResult;
  /** Viewer's role in this opportunity. */
  viewerRole?: string;
  /** Whether the counterpart is a ghost (not yet onboarded) user. */
  isGhost?: boolean;
  /** Narrator chip for home card display (name + remark, with optional avatar/userId for introducer). */
  narratorChip?: {
    name: string;
    text: string;
    avatar?: string | null;
    userId?: string;
  };
}

/** One step for debug visibility (subgraph/subtask). */
export interface DiscoverDebugStep {
  step: string;
  detail?: string;
  /** Structured data for rich display (e.g., candidate counts, scores). */
  data?: Record<string, unknown>;
}

/** One existing connection (no new opportunity created; user already has one with this person). */
export interface ExistingConnection {
  userId: string;
  name: string;
  status?: string;
  opportunityId?: string;
}

/** Statuses for which an existing connection may be shown as a card; others (accepted, rejected, expired) are only mentioned in text. */
const EXISTING_CONNECTION_CARD_STATUSES = ['draft', 'latent', 'pending'] as const;

export interface DiscoverResult {
  found: boolean;
  count: number;
  message?: string;
  opportunities?: FormattedDiscoveryCandidate[];
  /** Existing connections eligible for card display (draft, latent, or pending). Others are mention-only. */
  existingConnections?: ExistingConnection[];
  /** All existing connections for mention text (e.g. "You already have a connection with: X (pending), Y (draft)."). */
  existingConnectionsForMention?: ExistingConnection[];
  /** When true, the chat agent should call create_intent(suggestedIntentDescription) and retry discovery. */
  createIntentSuggested?: boolean;
  /** Description to pass to create_intent when createIntentSuggested is true. */
  suggestedIntentDescription?: string;
  /** Internal steps for copy-debug (select_strategies, opportunity_graph, enrich, etc.). */
  debugSteps?: DiscoverDebugStep[];
  /** Pagination metadata -- present when there are more unevaluated candidates. */
  pagination?: {
    discoveryId: string;
    evaluated: number;
    remaining: number;
  };
}

/** Input for the shared enrichment helper. */
interface EnrichOpportunitiesInput {
  opportunities: Opportunity[];
  database: ChatGraphCompositeDatabase;
  userId: string;
  chatSessionId?: string;
  minimalForChat?: boolean;
  presenter?: OpportunityPresenter;
  useHomeCardFormat?: boolean;
  debugSteps: DiscoverDebugStep[];
  /** IDs of pre-existing opportunities merged into the list; these preserve their real status. */
  existingOpportunityIds?: Set<string>;
  /** When set, bypass the onboarding filter for this specific user (direct connection mode). */
  targetUserId?: string;
}

/**
 * Enrich raw opportunities with profile data, presentation (LLM or minimal),
 * and narrator chips. Shared by both `runDiscoverFromQuery` and `continueDiscovery`
 * to avoid duplicating the profile-lookup / presenter / card-formatting logic.
 *
 * @param input - Enrichment context (opportunities, database, viewer, presentation options).
 * @returns Formatted discovery candidates ready for chat or home card display.
 */
async function enrichOpportunities(
  input: EnrichOpportunitiesInput,
): Promise<FormattedDiscoveryCandidate[]> {
  const {
    opportunities,
    database,
    userId,
    chatSessionId,
    minimalForChat,
    presenter,
    useHomeCardFormat,
    debugSteps,
    existingOpportunityIds,
    targetUserId,
  } = input;

  const baseEnrichedRaw = await Promise.all(
    opportunities.map(async (opp) => {
      const candidateActor = opp.actors.find((a) => a.userId !== userId && a.role !== 'introducer');
      const candidateUserId = candidateActor?.userId ?? "";
      const viewerActor = opp.actors.find((a) => a.userId === userId);
      const [profile, candidateUser] = candidateUserId
        ? await Promise.all([database.getProfile(candidateUserId), database.getUser(candidateUserId)])
        : [null, null];
      // Skip soft-deleted users (deletedAt is set)
      if (candidateUser && 'deletedAt' in candidateUser && candidateUser.deletedAt) return null;
      // Skip non-onboarded real users (registered but haven't completed onboarding),
      // unless this is an explicit direct-connection target (targetUserId bypass).
      const isDirectTarget = targetUserId && candidateUserId === targetUserId;
      if (candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt && !isDirectTarget) return null;
      const confidence =
        typeof opp.interpretation?.confidence === "number"
          ? opp.interpretation.confidence
          : parseFloat(String(opp.interpretation?.confidence ?? 0)) || 0;
      return {
        opportunity: opp,
        candidateUserId,
        viewerRole: viewerActor?.role ?? "party",
        profile,
        confidence,
      };
    }),
  );
  const baseEnriched = baseEnrichedRaw.filter((item): item is NonNullable<typeof item> => item !== null);
  debugSteps.push({
    step: "enrich_profiles",
    detail: `${baseEnriched.length} profile(s)`,
  });

  // Batch-fetch user records (candidates, introducers, and other party actors) for name/avatar fallback.
  const allActorUserIds = new Set<string>();
  for (const item of baseEnriched) {
    for (const actor of item.opportunity.actors) {
      if (actor.userId && actor.userId !== userId) {
        allActorUserIds.add(actor.userId);
      }
    }
  }
  const candidateUserIds = [...allActorUserIds];
  const [viewerUser, ...userResults] = await Promise.all([
    database.getUser(userId),
    ...candidateUserIds.map((id) => database.getUser(id)),
  ]);
  const avatarByUserId = new Map<string, string | null>();
  const nameByUserId = new Map<string, string | null>();
  const isGhostByUserId = new Map<string, boolean>();
  candidateUserIds.forEach((id, i) => {
    const user = userResults[i] ?? null;
    avatarByUserId.set(id, user?.avatar ?? null);
    nameByUserId.set(id, user?.name ?? null);
    isGhostByUserId.set(id, user?.isGhost ?? false);
  });
  const viewerName = viewerUser?.name ?? undefined;

  // Retry name resolution for candidates whose name is still missing.
  // The profile or user record may not have been ready on the first fetch
  // (e.g. profile generation still in flight). One retry covers transient gaps.
  const missingNameIds = baseEnriched
    .map((item) => item.candidateUserId)
    .filter((id) => id && !nameByUserId.get(id) && !baseEnriched.find((b) => b.candidateUserId === id && b.profile?.identity?.name));
  if (missingNameIds.length > 0) {
    const retried = await Promise.all(
      missingNameIds.map(async (id) => {
        const [profile, user] = await Promise.all([
          database.getProfile(id),
          database.getUser(id),
        ]);
        return { id, profile, user };
      }),
    );
    for (const r of retried) {
      const name = r.profile?.identity?.name ?? r.user?.name ?? null;
      if (name) nameByUserId.set(r.id, name);
      // Also update the baseEnriched profile so counterpartName picks it up
      if (r.profile) {
        const item = baseEnriched.find((b) => b.candidateUserId === r.id);
        if (item && !item.profile) item.profile = r.profile;
      }
      if (r.user?.avatar && !avatarByUserId.get(r.id)) {
        avatarByUserId.set(r.id, r.user.avatar);
      }
    }
    logger.verbose("[enrichOpportunities] Retried name lookup for candidates with missing names", {
      attempted: missingNameIds.length,
      resolved: retried.filter((r) => r.profile?.identity?.name ?? r.user?.name).length,
    });
  }

  let presentations: OpportunityPresentationResult[] | undefined;
  let homeCardPresentations: HomeCardPresentationResult[] | undefined;
  let presenterContexts:
    | (Awaited<ReturnType<typeof gatherPresenterContext>> | MinimalPresenterContext)[]
    | undefined;

  if (minimalForChat && baseEnriched.length > 0) {
    // Minimal path: no LLM, viewer-centric card text (introduce counterpart to viewer)
    const counterpartName = (n: {
      profile?: { identity?: { name?: string } } | null;
      candidateUserId: string;
    }) => n.profile?.identity?.name ?? nameByUserId.get(n.candidateUserId) ?? "";
    homeCardPresentations = baseEnriched.map((item) => {
      const name = counterpartName(item)?.trim();
      const reasoning = item.opportunity.interpretation?.reasoning ?? "";
      const introducerName = item.opportunity.detection?.createdByName ?? undefined;
      const viewerIsIntroducer = item.opportunity.actors.some(
        (a) => a.role === "introducer" && a.userId === userId,
      );

      // For introducer view, find the second party (target user) name
      let secondPartyName: string | undefined;
      if (viewerIsIntroducer) {
        const otherPartyActors = item.opportunity.actors.filter(
          (a) => a.role !== "introducer" && a.userId !== item.candidateUserId,
        );
        if (otherPartyActors.length > 0) {
          const otherUserId = otherPartyActors[0].userId;
          secondPartyName = nameByUserId.get(otherUserId) ?? undefined;
        }
      }

      const isCounterpartGhost = isGhostByUserId.get(item.candidateUserId) ?? false;
      return {
        headline: viewerIsIntroducer && secondPartyName
          ? `${name} → ${secondPartyName}`
          : (name ? `Connection with ${name}` : "Suggested connection"),
        personalizedSummary:
          viewerCentricCardSummary(
            reasoning,
            name,
            MINIMAL_MAIN_TEXT_MAX_CHARS,
            viewerName,
            introducerName,
          ),
        suggestedAction: "Start a conversation to connect.",
        narratorRemark: narratorRemarkFromReasoning(reasoning, name, viewerName),
        primaryActionLabel: getPrimaryActionLabel(viewerIsIntroducer ? "introducer" : "party"),
        secondaryActionLabel: SECONDARY_ACTION_LABEL,
        mutualIntentsLabel: "Suggested connection",
      };
    });
    presenterContexts = baseEnriched.map((item) => ({
      introducerName: item.opportunity.detection.createdByName ?? undefined,
    })) as MinimalPresenterContext[];
  } else if (presenter && baseEnriched.length > 0) {
    try {
      presenterContexts = await Promise.all(
        baseEnriched.map(({ opportunity }) =>
          gatherPresenterContext(database, opportunity, userId),
        ),
      );

      if (useHomeCardFormat) {
        // Use full home card format with action labels, narrator remark, etc.
        const fullContexts = presenterContexts as Awaited<
          ReturnType<typeof gatherPresenterContext>
        >[];
        const homeCardInputs: HomeCardPresenterInput[] = fullContexts.map(
          (ctx, idx) => ({
            ...ctx,
            mutualIntentCount: undefined,
            opportunityStatus: baseEnriched[idx].opportunity.status,
          }),
        );
        const llmResults = await presenter.presentHomeCardBatch(
          homeCardInputs,
          { concurrency: 5 },
        );
        // Append hardcoded button labels to LLM results
        homeCardPresentations = llmResults.map((llm, idx) => ({
          ...llm,
          primaryActionLabel: getPrimaryActionLabel(baseEnriched[idx].viewerRole),
          secondaryActionLabel: SECONDARY_ACTION_LABEL,
        }));
      } else {
        // Use basic presentation format
        presentations = await presenter.presentBatch(
          presenterContexts as Awaited<
            ReturnType<typeof gatherPresenterContext>
          >[],
          {
            concurrency: 5,
          },
        );
      }
    } catch (error) {
      logger.warn(
        "Presenter enrichment failed during opportunity discovery; returning base results without presentations",
        {
          userId,
          opportunitiesCount: baseEnriched.length,
          useHomeCardFormat,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      presentations = undefined;
      homeCardPresentations = undefined;
    }
  }

  const enriched: FormattedDiscoveryCandidate[] = baseEnriched.map(
    (item, idx) => {
      const homeCard = homeCardPresentations?.[idx];
      const ctx = presenterContexts?.[idx];

      // Build narrator chip for home card format
      let narratorChip: FormattedDiscoveryCandidate["narratorChip"];
      if (homeCard) {
        const viewerIsIntroducer = item.opportunity.actors.some(
          (a) => a.role === "introducer" && a.userId === userId,
        );
        if (viewerIsIntroducer) {
          narratorChip = {
            name: "You",
            text: homeCard.narratorRemark,
            userId: userId,
          };
        } else {
          const introducerActor = item.opportunity.actors.find(
            (a) => a.role === "introducer" && a.userId !== userId,
          );
          if (introducerActor) {
            const introducerName =
              ctx?.introducerName ??
              nameByUserId.get(introducerActor.userId) ??
              "Someone";
            narratorChip = {
              name: introducerName,
              text: homeCard.narratorRemark,
              userId: introducerActor.userId,
              avatar: avatarByUserId.get(introducerActor.userId) ?? null,
            };
          } else {
            narratorChip = {
              name: "Index",
              text: homeCard.narratorRemark,
            };
          }
        }
      }

      const isGhost = isGhostByUserId.get(item.candidateUserId) ?? false;
      return {
        opportunityId: item.opportunity.id,
        userId: item.candidateUserId,
        name: item.profile?.identity?.name ?? nameByUserId.get(item.candidateUserId) ?? undefined,
        avatar: avatarByUserId.get(item.candidateUserId) ?? null,
        bio: truncateForChat(item.profile?.identity?.bio),
        matchReason:
          truncateForChat(
            item.opportunity.interpretation?.reasoning ?? "",
          ) ?? "",
        score: item.confidence,
        status: chatSessionId && !existingOpportunityIds?.has(item.opportunity.id) ? "draft" : item.opportunity.status,
        viewerRole: item.viewerRole,
        isGhost,
        ...(presentations?.[idx] && { presentation: presentations[idx] }),
        ...(homeCard && {
          homeCardPresentation: homeCard,
        }),
        ...(narratorChip && { narratorChip }),
      };
    },
  );
  debugSteps.push({
    step: "format_cards",
    detail: `${enriched.length} card(s)`,
  });

  return enriched;
}

/** Cached discovery session data stored in Redis. */
interface CachedDiscoverySession {
  candidates: CandidateMatch[];
  userId: string;
  onBehalfOfUserId?: string;
  query: string;
  indexScope: string[];
  options: OpportunityGraphOptions;
}

/**
 * Run discovery from an ad-hoc query (e.g. "find me a mentor", "who needs a React developer").
 * The HyDE graph's LensInferrer automatically infers search lenses from the query.
 * Invokes the opportunity graph and returns formatted candidates suitable for chat display.
 */
export async function runDiscoverFromQuery(
  input: DiscoverInput,
): Promise<DiscoverResult> {
  const {
    opportunityGraph,
    database,
    userId,
    query,
    indexScope,
    limit = 5,
    triggerIntentId,
    targetUserId,
    onBehalfOfUserId,
    chatSessionId,
  } = input;

  if (indexScope.length === 0) {
    return {
      found: false,
      count: 0,
      message:
        "You need to join at least one index (community) to discover opportunities. Use read_indexes to see available indexes, or create one.",
    };
  }

  const debugSteps: DiscoverDebugStep[] = [];

  // When query is empty, the opportunity graph uses the user's intents in scope (indexedIntents[0].payload)
  // Lens inference is handled automatically by the HyDE graph's LensInferrer
  const queryOrEmpty = query?.trim() ?? "";
  const options: OpportunityGraphOptions = {
    limit,
    initialStatus: chatSessionId ? "draft" : "latent",
    ...(chatSessionId ? { conversationId: chatSessionId } : {}),
  };

  return withCallLogging(
    logger,
    "runDiscoverFromQuery",
    {
      userId,
      queryPreview: queryOrEmpty
        ? queryOrEmpty.substring(0, 50)
        : "(using user intents in scope)",
      indexScopeCount: indexScope.length,
      limit,
    },
    async () => {
      const result = await opportunityGraph.invoke({
        userId,
        searchQuery: queryOrEmpty || undefined,
        indexId: indexScope.length === 1 ? indexScope[0] : undefined,
        triggerIntentId,
        targetUserId,
        onBehalfOfUserId,
        options,
      });

      // Extract trace from graph and append to debugSteps
      const graphTrace = Array.isArray(result.trace) ? result.trace : [];
      for (const t of graphTrace) {
        debugSteps.push({
          step: t.node,
          detail: t.detail,
          ...(t.data ? { data: t.data } : {}),
        });
      }

      // Bail early if the graph returned an error
      if (result.error) {
        logger.warn("runDiscoverFromQuery graph returned error", { error: result.error });
        return {
          found: false,
          count: 0,
          message: "Failed to find opportunities. Please try again.",
          debugSteps,
        };
      }

      // Cache remaining candidates for pagination
      let pagination: DiscoverResult['pagination'] | undefined;
      const remainingCandidates: CandidateMatch[] = result.remainingCandidates || [];
      if (remainingCandidates.length > 0 && input.cache) {
        try {
          const discoveryId = crypto.randomUUID();
          const cacheKey = `discovery:${userId}:${discoveryId}`;
          await input.cache.set(cacheKey, {
            candidates: remainingCandidates,
            userId,
            onBehalfOfUserId,
            query: queryOrEmpty,
            indexScope,
            options,
          } satisfies CachedDiscoverySession, { ttl: 1800 }); // 30 minutes
          pagination = {
            discoveryId,
            evaluated: (result.candidates?.length ?? 0) - remainingCandidates.length,
            remaining: remainingCandidates.length,
          };
        } catch (cacheErr) {
          logger.warn("Failed to cache discovery pagination", {
            userId,
            error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
          });
        }
      }

      if (result.createIntentSuggested && result.suggestedIntentDescription) {
        if (chatSessionId) {
          return {
            found: false,
            count: 0,
            message: "No matching opportunities found. Try a different query.",
            pagination,
          };
        }
        return {
          found: false,
          count: 0,
          createIntentSuggested: true,
          suggestedIntentDescription: result.suggestedIntentDescription,
          message:
            "No matching opportunities; add an intent with the suggested description to improve discovery.",
          debugSteps,
          pagination,
        };
      }

      let opportunities: Opportunity[] = Array.isArray(result.opportunities)
        ? result.opportunities
        : [];
      let existingOpportunityIds: Set<string> | undefined;
      const rawExistingBetweenActors = Array.isArray(result.existingBetweenActors)
        ? result.existingBetweenActors
        : [];
      // Enrich existing-between-actors with names so the tool can say "You already have a connection with X (pending)."
      const existingConnections: ExistingConnection[] = await Promise.all(
        rawExistingBetweenActors.map(async (item) => {
          const user = await database.getUser(item.candidateUserId);
          return {
            userId: item.candidateUserId,
            name: user?.name ?? "Someone",
            ...(item.existingStatus ? { status: item.existingStatus } : {}),
            ...(item.existingOpportunityId ? { opportunityId: item.existingOpportunityId } : {}),
          };
        }),
      );
      if (existingConnections.length > 0) {
        logger.verbose("[runDiscoverFromQuery] Skipped duplicates; existing connections", {
          count: existingConnections.length,
          userIds: existingConnections.map((c) => c.userId),
        });
      }
      // Only expose existing connections as cards when status is in EXISTING_CONNECTION_CARD_STATUSES (draft, latent, pending); others are mention-only.
      const existingConnectionsForCards = existingConnections.filter((c) =>
        c.status != null && EXISTING_CONNECTION_CARD_STATUSES.includes(c.status as typeof EXISTING_CONNECTION_CARD_STATUSES[number])
      );

      // Fetch full opportunity data for existing connections that should be shown as cards
      // and merge them with the newly created opportunities
      if (existingConnectionsForCards.length > 0) {
        const existingOpps = await Promise.all(
          existingConnectionsForCards
            .filter((c) => c.opportunityId)
            .map((c) => database.getOpportunity(c.opportunityId!))
        );
        const validExistingOpps = existingOpps.filter((o): o is Opportunity => o != null);
        if (validExistingOpps.length > 0) {
          logger.verbose("[runDiscoverFromQuery] Including existing opportunities as cards", {
            count: validExistingOpps.length,
            ids: validExistingOpps.map((o) => o.id),
          });
          existingOpportunityIds = new Set(validExistingOpps.map((o) => o.id));
          opportunities = [...opportunities, ...validExistingOpps];
        }
      }

      // Chat discovery: when we have chatSessionId we just invoked the graph; all result.opportunities
      // were created in this call and belong to this session. Do not filter by status: the enricher
      // may set status to pending/latent when merging with related opportunities, so filtering to
      // "draft" would incorrectly drop them.
      if (chatSessionId && (result.opportunities?.length ?? 0) > 0) {
        logger.verbose("[runDiscoverFromQuery] Chat session opportunities from graph", {
          count: opportunities.length,
          statuses: opportunities.map((o) => o.status),
        });
      }
      debugSteps.push({
        step: "opportunity_graph",
        detail: `${opportunities.length} opportunity(ies)${existingConnections.length > 0 ? `, ${existingConnections.length} existing` : ""}`,
      });
      if (opportunities.length === 0) {
        if (existingConnections.length > 0) {
          return {
            found: true,
            count: 0,
            message:
              "No new opportunities created; you already have a connection with: " +
              existingConnections.map((c) => `${c.name}${c.status ? ` (${c.status})` : ""}`).join(", ") +
              ". View on your home page.",
            existingConnections: existingConnectionsForCards,
            existingConnectionsForMention: existingConnections,
            debugSteps,
            pagination,
          };
        }
        return {
          found: false,
          count: 0,
          message:
            "No matching opportunities found. Try a different query or create intents to improve matching.",
          debugSteps,
          pagination,
        };
      }

      const enriched = await enrichOpportunities({
        opportunities,
        database,
        userId,
        chatSessionId,
        minimalForChat: input.minimalForChat,
        presenter: input.presenter,
        useHomeCardFormat: input.useHomeCardFormat,
        debugSteps,
        existingOpportunityIds,
        targetUserId,
      });

      return {
        found: true,
        count: enriched.length,
        opportunities: enriched,
        ...(existingConnectionsForCards.length > 0 ? { existingConnections: existingConnectionsForCards } : {}),
        ...(existingConnections.length > 0 ? { existingConnectionsForMention: existingConnections } : {}),
        debugSteps,
        pagination,
      };
    },
    { context: { userId }, logOutput: false },
  ).catch((err) => {
    return {
      found: false,
      count: 0,
      message: "Failed to find opportunities. Please try again.",
    };
  });
}

/**
 * Continue a paginated discovery by evaluating the next batch of cached candidates.
 * Loads candidates from Redis, invokes the opportunity graph in continue_discovery mode,
 * then enriches and returns the results with updated pagination metadata.
 *
 * @param input - Continuation context (graph, database, cache, discoveryId, etc.).
 * @returns Discovery result with enriched opportunities and pagination state.
 */
export async function continueDiscovery(input: {
  opportunityGraph: CompiledOpportunityGraph;
  database: ChatGraphCompositeDatabase;
  cache: Cache;
  userId: string;
  discoveryId: string;
  /** If provided, validates the cached session's indexScope contains this index. */
  expectedIndexId?: string;
  limit?: number;
  chatSessionId?: string;
  minimalForChat?: boolean;
  presenter?: OpportunityPresenter;
  useHomeCardFormat?: boolean;
}): Promise<DiscoverResult> {
  const {
    opportunityGraph,
    database,
    cache,
    userId,
    discoveryId,
    expectedIndexId,
    limit = 20,
    chatSessionId,
  } = input;
  const cacheKey = `discovery:${userId}:${discoveryId}`;

  const cached = await cache.get<CachedDiscoverySession>(cacheKey);

  if (!cached) {
    return {
      found: false,
      count: 0,
      message: "Discovery session expired or not found. Please start a new search.",
    };
  }

  // Validate that the cached session's scope matches the current chat context
  if (expectedIndexId && !cached.indexScope.includes(expectedIndexId)) {
    return {
      found: false,
      count: 0,
      message: "Discovery session was created in a different context. Please start a new search.",
    };
  }

  const debugSteps: DiscoverDebugStep[] = [];

  const result = await opportunityGraph.invoke({
    userId,
    searchQuery: cached.query || undefined,
    candidates: cached.candidates,
    operationMode: 'continue_discovery' as const,
    onBehalfOfUserId: cached.onBehalfOfUserId,
    options: {
      ...cached.options,
      limit,
      ...(chatSessionId ? { conversationId: chatSessionId } : {}),
    },
  });

  // Extract trace from graph and append to debugSteps
  const graphTrace = result.trace || [];
  for (const t of graphTrace) {
    debugSteps.push({
      step: t.node,
      detail: t.detail,
      ...(t.data ? { data: t.data } : {}),
    });
  }

  // Bail early if the graph returned an error
  if (result.error) {
    logger.warn("continueDiscovery graph returned error", { error: result.error });
    return {
      found: false,
      count: 0,
      message: "Discovery continuation failed. Please start a new search.",
      debugSteps,
    };
  }

  // Update cache with remaining candidates or delete if exhausted
  const remaining: CandidateMatch[] = result.remainingCandidates || [];
  let pagination: DiscoverResult['pagination'] | undefined;
  try {
    if (remaining.length > 0) {
      await cache.set(cacheKey, {
        ...cached,
        candidates: remaining,
      } satisfies CachedDiscoverySession, { ttl: 1800 });
      pagination = {
        discoveryId,
        evaluated: cached.candidates.length - remaining.length,
        remaining: remaining.length,
      };
    } else {
      await cache.delete(cacheKey);
    }
  } catch (cacheErr) {
    logger.warn("Failed to update discovery pagination cache", {
      userId,
      discoveryId,
      error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
    });
  }

  // Check for opportunities in result
  const opportunities: Opportunity[] = Array.isArray(result.opportunities) ? result.opportunities : [];

  if (opportunities.length === 0) {
    return {
      found: false,
      count: 0,
      message: "No more matching opportunities found in the remaining candidates.",
      debugSteps,
      pagination,
    };
  }

  const enriched = await enrichOpportunities({
    opportunities,
    database,
    userId,
    chatSessionId,
    minimalForChat: input.minimalForChat,
    presenter: input.presenter,
    useHomeCardFormat: input.useHomeCardFormat,
    debugSteps,
  });

  return {
    found: true,
    count: enriched.length,
    opportunities: enriched,
    debugSteps,
    pagination,
  };
}
