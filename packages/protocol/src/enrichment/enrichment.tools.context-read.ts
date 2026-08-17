/**
 * Enrichment tools that read or preview a user context.
 */

import { z } from "zod";

import { requestContext } from "../shared/observability/request-context.js";

import type { DefineTool, ResolvedToolContext } from "../shared/agent/tool.helpers.js";
import type { EnrichmentToolDeps } from "../contexts/ports/participant-context.tools.port.js";
import { success, error, needsClarification, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { EnrichmentResult } from "../shared/interfaces/enrichment.interface.js";
import type { OnboardingProfileSeed, OnboardingState, UserRecord } from "../shared/interfaces/database.interface.js";
import type { EnrichmentRunInput, EnrichmentRunOperation } from "../shared/interfaces/enrichment-run.interface.js";
import { socialsToEnrichmentRequest, detectSocialLabel } from "../shared/utils/social-label.js";
import { normalizeTelegramHandle } from "../shared/utils/telegram-handle.js";
import { EnrichmentGenerator } from "./enrichment.generator.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { focusedNetworkId, focusedNetworkLabel } from "../shared/agent/tool.scope.js";

import { approvedProfileDraftSchema, buildApprovedDraftProfileInput, buildProfileInput, decomposeApprovedDraftProfile, enqueueEnrichmentRun, enrichFromUserRecord, isMeaningfulEnrichment, isPlaceholderName, logger, markApprovedProfileConfirmed, mergeUserSocials, normalizeSocialUpdate, persistApprovedProfileContext, selectProfileSeed, socialsRecordToRows, toProfileSummary, trimToUndefined } from "./enrichment.tools.helpers.js";

export function createUserContextReadTools(defineTool: DefineTool, deps: EnrichmentToolDeps) {
  const { userDb, systemDb, graphs, enricher, grantDefaultSystemPermissions, reportToolError, getUserContextText } = deps;

  const readUserContexts = defineTool({
    name: "read_user_contexts",
    description:
      "Retrieves user profiles containing identity info (name, bio, location) plus a rich `context` paragraph (the user's synthesized identity text). " +
      "Profiles are used for semantic matching in opportunity discovery — the richer the user's context, the better the matches.\n\n" +
      "**Usage modes:**\n" +
      "- With `query` (name search): finds members by name (case-insensitive substring) across the user's indexes. " +
      "This is the primary way to look up a person by name. Add `networkId` to restrict search to one index. (List results return thin identity only — no `context`.)\n" +
      "- With `userId`: returns that specific user's profile — name, bio, location, and their `context` paragraph.\n" +
      "- With `networkId` alone: returns thin-identity profiles of ALL members in that index (no `context`).\n" +
      "- No parameters: returns the current user's own profile, including their `context`.\n\n" +
      "**When to use:** Before creating introductions (need profiles of both parties), when the user asks about a person, " +
      "or to check if a profile exists before suggesting create_user_context.\n\n" +
      "**Returns:** Profile objects with name, bio, location, and (for single-user reads) a `context` paragraph. Use userId from results with other tools like read_intents(userId, networkId).",
    querySchema: z.object({
      userId: z.string().optional().describe("Fetch a specific user's profile by their user ID. Get user IDs from read_network_memberships or list_contacts."),
      networkId: z.string().optional().describe("Network UUID — fetch profiles of all members in this network, or narrow a name search to this network. Get from read_networks."),
      query: z.string().optional().describe("Name to search for (case-insensitive substring match). Searches across all the user's indexes unless networkId is also provided. Use this when the user asks to 'find' or 'look up' someone."),
    }),
    handler: async ({ context, query }) => {
      const scopedNetworkId = focusedNetworkId(context);
      const scopedIndexLabel = focusedNetworkLabel(context);
      const effectiveIndexId = query.networkId?.trim() || undefined;
      const targetUserId = query.userId?.trim() || undefined;
      const nameQuery = query.query?.trim() || undefined;

      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid network ID format. Use the exact UUID from read_networks.");
      }

      // --- Name search mode: query provided → find members by name ---
      if (nameQuery) {
        const pattern = nameQuery.toLowerCase();
        const MAX_RESULTS = 20;
        // When chat is network-scoped, restrict name search to that index
        const searchIndexId = effectiveIndexId || scopedNetworkId || undefined;

        let candidates: Array<{ userId: string; name: string; avatar: string | null }>;

        if (searchIndexId) {
          // Scoped to a specific index
          if (scopedNetworkId && searchIndexId !== scopedNetworkId) {
            return error(`This chat is scoped to ${scopedIndexLabel}. You can only look up people in this community.`);
          }
          const callerIsMember = await systemDb.isNetworkMember(searchIndexId, context.userId);
          if (!callerIsMember) {
            return error("You can only look up people in indexes you are a member of.");
          }
          const members = await systemDb.getNetworkMembers(searchIndexId);
          candidates = members.map((m) => ({ userId: m.userId, name: m.name, avatar: m.avatar ?? null }));
        } else {
          // Search across all user's indexes
          candidates = await systemDb.getMembersFromScope();
        }

        logger.verbose("Name search candidates", {
          query: nameQuery,
          pattern,
          candidateCount: candidates.length,
          userId: context.userId,
        });

        // Filter by name (case-insensitive substring), exclude self
        const matched = candidates
          .filter((c) => c.userId !== context.userId && c.name.toLowerCase().includes(pattern))
          .slice(0, MAX_RESULTS);

        if (matched.length === 0) {
          return success({ query: nameQuery, matchCount: 0, profiles: [], message: "No members found matching that name." });
        }

        // Fetch full profiles for matches
        const profiles = await Promise.all(
          matched.map(async (m) => {
            try {
              const profile = await systemDb.getProfile(m.userId);
              // Flat thin identity for list results. skills/interests are retired; the
              // rich identity text (global user_context) is fetched per-user via a userId read.
              return {
                userId: m.userId,
                name: m.name,
                hasProfile: !!profile,
                ...(profile
                  ? { bio: profile.identity.bio, location: profile.identity.location }
                  : {}),
              };
            } catch (err) {
              logger.warn("read_user_contexts: getProfile failed; degrading to hasProfile=false", {
                userId: m.userId,
                error: err instanceof Error ? err.message : String(err),
              });
              return { userId: m.userId, name: m.name, hasProfile: false };
            }
          })
        );

        return success({ query: nameQuery, matchCount: profiles.length, profiles });
      }

      // When no userId / networkId / query is provided, fall through to Mode 1 (self lookup).

      // --- Mode 3: networkId provided → fetch all member profiles ---
      if (effectiveIndexId) {
        // Strict scope enforcement: when chat is network-scoped, only allow querying that index
        if (scopedNetworkId && effectiveIndexId !== scopedNetworkId) {
          return error(`This chat is scoped to ${scopedIndexLabel}. You can only read profiles from this community.`);
        }

        // Verify the caller is a member of the network they're querying
        const callerIsMember = await systemDb.isNetworkMember(effectiveIndexId, context.userId);
        if (!callerIsMember) {
          return error(
            "You can only read profiles from indexes you are a member of."
          );
        }

        // Use systemDb for cross-user access within shared networkes
        const members = await systemDb.getNetworkMembers(effectiveIndexId);
        const profiles = await Promise.all(
          members.map(async (member) => {
            const profile = await systemDb.getProfile(member.userId);
            // Flat thin identity for roster results. skills/interests are retired; fetch a
            // member's global user_context text via a single-user (userId) read.
            return {
              userId: member.userId,
              name: member.name,
              hasProfile: !!profile,
              ...(profile
                ? { bio: profile.identity.bio, location: profile.identity.location }
                : {}),
            };
          })
        );
        return success({ networkId: effectiveIndexId, memberCount: members.length, profiles });
      }

      // --- Mode 2: userId provided (different user) → fetch single profile directly ---
      if (targetUserId && targetUserId !== context.userId) {
        // Strict scope enforcement: when chat is network-scoped, verify user is in that index
        if (scopedNetworkId) {
          const isInScopedIndex = await systemDb.isNetworkMember(scopedNetworkId, targetUserId);
          if (!isInScopedIndex) {
            return error(`This chat is scoped to ${scopedIndexLabel}. You can only read profiles of members in this community.`);
          }
        }

        // Use systemDb for cross-user profile access (requires shared network)
        const profile = await systemDb.getProfile(targetUserId);
        if (profile) {
          // Thin identity + the user's global user_context text (profile-replacing
          // identity paragraph). skills/interests/narrative are retired (WS6).
          const context = getUserContextText ? await getUserContextText(targetUserId) : '';
          return success({
            hasProfile: true,
            name: profile.identity.name,
            bio: profile.identity.bio,
            location: profile.identity.location,
            context,
          });
        }
        return success({ hasProfile: false, message: "This user does not have a profile yet." });
      }

      // --- Mode 1: No args / self → use profileGraph query (returns id for updates) ---
      const _readProfileGraphStart = Date.now();
      const _readProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
      _readProfileTraceEmitter?.({ type: "graph_start", name: "enrichment" });
      const result = await invokeWithAbortSignal(graphs.profile, {
        userId: context.userId,
        operationMode: 'query' as const,
      });
      const _readProfileGraphMs = Date.now() - _readProfileGraphStart;
      _readProfileTraceEmitter?.({ type: "graph_end", name: "enrichment", durationMs: _readProfileGraphMs });

      // REST/CLI self-lookup includes onboarding status. MCP does not — it
      // no longer gates or completes onboarding.
      const onboardingCompletedAt = context.user.onboarding?.completedAt ?? null;
      const onboardingFields = context.isMcp ? {} : {
        onboardingComplete: !!onboardingCompletedAt,
        ...(onboardingCompletedAt ? { onboardingCompletedAt } : {}),
      };

      if (result.readResult) {
        // Augment the graph's thin-identity readResult with the caller's global
        // user_context text (the rich, profile-replacing identity paragraph).
        const readResult = result.readResult as { hasProfile?: boolean; profile?: Record<string, unknown>; message?: string };
        // Flatten identity fields up; drop the nested `profile` object (WS11).
        const flat = readResult.hasProfile && readResult.profile
          ? { hasProfile: true, ...readResult.profile, context: getUserContextText ? await getUserContextText(context.userId) : '' }
          : { ...readResult };
        return success({ ...flat, ...onboardingFields, _graphTimings: [{ name: 'enrichment', durationMs: _readProfileGraphMs, agents: result.agentTimings ?? [] }] });
      }
      if (result.profile) {
        return success({
          hasProfile: true,
          name: result.profile.identity.name,
          bio: result.profile.identity.bio,
          location: result.profile.identity.location,
          context: getUserContextText ? await getUserContextText(context.userId) : '',
          ...onboardingFields,
          _graphTimings: [{ name: 'enrichment', durationMs: _readProfileGraphMs, agents: result.agentTimings ?? [] }],
        });
      }
      return success({
        hasProfile: false,
        ...onboardingFields,
        message: "You don't have a profile yet. Would you like to create one? You can share your LinkedIn, GitHub, or X/Twitter profile, or just tell me about yourself.",
        _graphTimings: [{ name: 'enrichment', durationMs: _readProfileGraphMs, agents: result.agentTimings ?? [] }],
      });
    },
  });

  const previewUserContext = defineTool({
    name: "preview_user_context",
    description:
      "Builds a structured profile draft without saving anything. Use this before asking the user to approve the profile. " +
      "This tool never runs public internet lookup; it uses only explicit text, staged signup/import seeds, and user-provided social URLs. " +
      "In MCP contexts, starts an async profile run and returns `profileRunId`; poll get_enrichment_run until status is `succeeded`, then present its `result`.",
    querySchema: z.object({
      name: z.string().optional().describe("Name explicitly provided by the user. The account identity is used first and this is only a fallback."),
      location: z.string().optional().describe("Location explicitly provided by the user."),
      bioOrDescription: z.string().optional().describe("Explicit self-description provided by the user."),
      linkedinUrl: z.string().optional().describe("LinkedIn URL explicitly provided by the user."),
      githubUrl: z.string().optional().describe("GitHub URL explicitly provided by the user."),
      twitterUrl: z.string().optional().describe("X/Twitter URL explicitly provided by the user."),
      websites: z.array(z.string()).optional().describe("Personal/portfolio URLs explicitly provided by the user."),
    }),
    handler: async ({ context, query }) => {
      const user = await userDb.getUser();
      if (!user) return error("User not found.");

      const profileRunId = await enqueueEnrichmentRun(deps, context, "preview_user_context", query);
      if (profileRunId) {
        return success({
          status: "queued" as const,
          profileRunId,
          message: `Profile preview started. Call get_enrichment_run with profileRunId="${profileRunId}" until it succeeds, fails, or is cancelled.`,
        });
      }

      const scopedNetworkId = focusedNetworkId(context);
      const onboarding = user.onboarding ?? context.user.onboarding;
      const seed = selectProfileSeed(onboarding, scopedNetworkId);
      // Prefer the authenticated account identity over an agent-supplied name.
      const accountName = [trimToUndefined(user.name), trimToUndefined(context.userName)]
        .find((candidate) => candidate !== undefined && !isPlaceholderName(candidate));
      const name = seed?.name || accountName || query.name?.trim() || undefined;
      const location = query.location?.trim() || seed?.location || user.location || undefined;
      const bioOrDescription = query.bioOrDescription?.trim() || seed?.bio || user.intro || undefined;
      const linkedinUrl = query.linkedinUrl?.trim();
      const githubUrl = query.githubUrl?.trim();
      const twitterUrl = query.twitterUrl?.trim();
      const websites = query.websites?.map((url) => url.trim()).filter(Boolean) ?? [];
      const socials = [
        ...(seed?.socials ?? []),
        ...(linkedinUrl ? [{ label: 'linkedin', value: linkedinUrl }] : []),
        ...(githubUrl ? [{ label: 'github', value: githubUrl }] : []),
        ...(twitterUrl ? [{ label: 'twitter', value: twitterUrl }] : []),
        ...websites.map((value) => ({ label: detectSocialLabel(value), value })),
      ];

      const input = buildProfileInput({ name, location, bioOrDescription, socials });
      if (!input.trim()) {
        return needsClarification({
          missingFields: ['profile_description'],
          message: "Please share a short description or profile links so I can draft your profile.",
        });
      }

      const generated = await new EnrichmentGenerator().invoke(input);
      const profile = { ...generated.output, userId: context.userId };
      return success({
        preview: true,
        persisted: false,
        message: "Profile draft generated. Show this to the user and ask whether it looks right before calling confirm_user_context.",
        profile: toProfileSummary(profile),
        draft: profile,
      });
    },
  });

  const confirmUserContext = defineTool({
    name: "confirm_user_context",
    description:
      "Saves an explicitly approved profile draft. Call this only after the user has seen the draft from preview_user_context and approved it or provided corrections. " +
      "This path uses only the approved draft/explicit correction text and does not scrape or run public lookup.",
    querySchema: z.object({
      draft: approvedProfileDraftSchema.optional().describe("The structured profile draft returned by preview_user_context after user approval."),
      bioOrDescription: z.string().optional().describe("Approved correction or explicit profile text if not passing a structured draft."),
      name: z.string().optional().describe("Approved name correction."),
      location: z.string().optional().describe("Approved location correction."),
    }),
    handler: async ({ context, query }) => {
      const user = await userDb.getUser();
      if (query.draft) {
        const profile = { ...query.draft, userId: context.userId };
        await userDb.saveProfile({ userId: context.userId, identity: profile.identity, context: profile.narrative?.context ?? '' });
        await persistApprovedProfileContext(deps, profile, user, focusedNetworkId(context));
        await markApprovedProfileConfirmed(deps, context);

        const decomposeLogLabel = context.isMcp
          ? 'Approved draft premise decomposition failed'
          : 'Approved draft premise decomposition failed (web)';
        decomposeApprovedDraftProfile(deps, profile).catch((err: unknown) => {
          logger.error(decomposeLogLabel, {
            userId: profile.userId,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        return success({
          created: true,
          message: context.isMcp
            ? "Profile saved from approved draft. Premise extraction is running in the background."
            : "Profile saved from approved draft.",
          profile: toProfileSummary(profile),
        });
      }

      const description = query.bioOrDescription?.trim();
      if (!description) {
        return error("Pass the approved structured draft or explicit approved profile text.");
      }
      const approvedName = query.name?.trim();
      const approvedLocation = query.location?.trim();
      const input = buildProfileInput({
        name: approvedName,
        location: approvedLocation,
        bioOrDescription: description,
      });
      const rawProfile = {
        identity: {
          name: approvedName && approvedName.length > 0 ? approvedName : user?.name ?? '',
          bio: description,
          location: approvedLocation && approvedLocation.length > 0 ? approvedLocation : user?.location ?? '',
        },
      };
      await persistApprovedProfileContext(deps, rawProfile, user, focusedNetworkId(context));
      await markApprovedProfileConfirmed(deps, context);

      const _confirmTraceEmitter = requestContext.getStore()?.traceEmitter;
      const _confirmGraphStart = Date.now();
      _confirmTraceEmitter?.({ type: "graph_start", name: "enrichment" });
      graphs.profile.invoke({
        userId: context.userId,
        operationMode: 'write' as const,
        input,
        forceUpdate: true,
      }).then((result) => {
        if (result.error || !result.profile) {
          logger.error('Background profile generation failed', {
            userId: context.userId,
            error: result.error ?? 'No profile returned',
          });
        }
      }).catch((err: unknown) =>
        logger.error('Background profile generation failed', {
          userId: context.userId,
          error: err instanceof Error ? err.message : String(err),
        })
      ).finally(() => {
        const _confirmGraphMs = Date.now() - _confirmGraphStart;
        _confirmTraceEmitter?.({ type: "graph_end", name: "enrichment", durationMs: _confirmGraphMs });
      });

      return success({
        created: true,
        message: "Profile text accepted. Your profile is being structured in the background.",
        profile: toProfileSummary({
          identity: rawProfile.identity,
          attributes: { skills: [], interests: [] },
        }),
      });
    },
  });

  return { readUserContexts, previewUserContext, confirmUserContext };
}
