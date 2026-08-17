/**
 * Enrichment tools that create or update a user context.
 */

import { z } from "zod";

import { requestContext } from "../shared/observability/request-context.js";

import type { DefineTool, ResolvedToolContext } from "../shared/agent/tool.helpers.js";
import type { EnrichmentToolDeps } from "../contexts/context.tools.port.js";
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

export function createUserContextWriteTools(defineTool: DefineTool, deps: EnrichmentToolDeps) {
  const { userDb, systemDb, graphs, enricher, grantDefaultSystemPermissions, reportToolError, getUserContextText } = deps;

  const createUserContext = defineTool({
    name: "create_user_context",
    description:
      "Legacy/backward-compatible tool that creates or regenerates the authenticated user's profile. Prefer " +
      "preview_user_context → confirm_user_context so the draft is shown before saving. " +
      "Profiles are essential for discovery — they provide the semantic context used to match users with complementary intents.\n\n" +
      "**How it works:** For generic clients, the system can enrich profile data from public web sources (LinkedIn, GitHub, Twitter) and/or explicit user input, " +
      "then generates a structured profile with bio, skills, interests, location, and narrative context.\n\n" +
      "**Usage patterns:**\n" +
      "- No args: attempts auto-generation from account data. If insufficient info, returns `missingFields` — ask the user for name/social URLs and retry.\n" +
      "- With social URLs (linkedinUrl, githubUrl, etc.): enriches from those specific URLs.\n" +
      "- With bioOrDescription: creates profile from explicit text only (no web scraping).\n" +
      "- First call may return a preview. Prefer preview_user_context instead because it does not persist enrichment side effects.\n\n" +
      "**Returns:** The generated profile (name, bio, location, skills, interests) or a `needsClarification` response listing missing fields.\n\n" +
      "**Next steps:** After profile creation, the user can create intents (create_intent) and join indexes (create_network_membership) to start discovering opportunities.",
    querySchema: z.object({
      name: z.string().optional().describe("User's full name (first and last). Pass when the user explicitly provides their name."),
      linkedinUrl: z.string().optional().describe("LinkedIn profile URL (e.g. 'https://linkedin.com/in/username'). Pass when user shares a LinkedIn link."),
      githubUrl: z.string().optional().describe("GitHub profile URL (e.g. 'https://github.com/username'). Pass when user shares a GitHub link."),
      twitterUrl: z.string().optional().describe("X/Twitter profile URL (e.g. 'https://x.com/username'). Pass when user shares a Twitter/X link."),
      websites: z.array(z.string()).optional().describe("Personal or portfolio website URLs. Pass when user shares website links."),
      location: z.string().optional().describe("User's location (e.g. 'Berlin, Germany' or 'SF Bay Area'). Pass when the user mentions where they are based."),
      bioOrDescription: z.string().optional().describe("Explicit profile text from the user (e.g. 'software engineer focused on AI/ML, based in SF'). When provided, creates/updates profile from this text only — no web scraping. Use when user describes themselves in chat."),
      confirm: z.boolean().optional().describe("Set to true to save a previously previewed profile after the user approves the preview."),
    }),
    handler: async ({ context, query }) => {
      // Persist user-info fields (name, location, socials) to users table before any branching.
      // This ensures users.name is always updated regardless of which code path runs.
      // Trim all string fields to avoid persisting whitespace-only values.
      const name = query.name?.trim();
      const location = query.location?.trim();
      const linkedinUrl = query.linkedinUrl?.trim();
      const githubUrl = query.githubUrl?.trim();
      const twitterUrl = query.twitterUrl?.trim();
      const websites = query.websites?.map((url) => url.trim()).filter(Boolean);
      const hasSocialsFromQuery = Boolean(linkedinUrl || githubUrl || twitterUrl || websites?.length);
      if (name || location) {
        await userDb.updateUser({
          ...(name ? { name } : {}),
          ...(location ? { location } : {}),
        });
      }
      if (hasSocialsFromQuery) {
        const newSocials: { label: string; value: string }[] = [];
        if (linkedinUrl) newSocials.push({ label: 'linkedin', value: linkedinUrl });
        if (githubUrl) newSocials.push({ label: 'github', value: githubUrl });
        if (twitterUrl) newSocials.push({ label: 'twitter', value: twitterUrl });
        if (websites?.length) {
          for (const w of websites) newSocials.push({ label: detectSocialLabel(w), value: w });
        }
        await mergeUserSocials(deps, newSocials);
      }
      logger.verbose("Persisted user-info fields to user record", { userId: context.userId });

      const isOnboarding = !(context.user.onboarding?.completedAt);
      if (isOnboarding) {
        // "Already enriched?" must key on a real enrichment signal, not getProfile():
        // post-WS11 getProfile() returns a presentation row for EVERY existing user, so
        // it would always short-circuit onboarding and refuse to enrich. The global
        // user_context is the canonical signal (non-empty <=> the user has premises /
        // has been enriched), mirroring findWithGraph's `hasProfile`.
        const existingContext = getUserContextText
          ? (await getUserContextText(context.userId)).trim()
          : '';
        if (existingContext) {
          const existingProfile = await userDb.getProfile();
          return success({
            alreadyExists: true,
            message: context.isMcp
              ? "Profile already exists. If they want changes, use create_user_context(bioOrDescription=\"...\", confirm=true)."
              : "Profile already exists. If the user confirmed it, call complete_onboarding() to finish setup. If they want changes, use create_user_context(bioOrDescription=\"...\", confirm=true).",
            ...(existingProfile
              ? {
                  profile: {
                    name: existingProfile.identity.name,
                    bio: existingProfile.identity.bio,
                    location: existingProfile.identity.location,
                  },
                }
              : {}),
          });
        }

        // Preview mode: enrich and persist enrichment results, but don't generate full profile
        if (!query.confirm) {
          try {
            const user = await userDb.getUser();
            const enrichment = user ? await enrichFromUserRecord(deps, user) : null;

            if (isMeaningfulEnrichment(enrichment)) {
              // Persist enrichment data to user record so confirm path has it
              const updatePayload: {
                name?: string;
                intro?: string;
                location?: string;
              } = {};
              if (enrichment.identity.name?.trim()) {
                updatePayload.name = enrichment.identity.name.trim();
              }
              if (enrichment.identity.bio?.trim()) updatePayload.intro = enrichment.identity.bio.trim();
              if (enrichment.identity.location?.trim()) updatePayload.location = enrichment.identity.location.trim();
              if (Object.keys(updatePayload).length > 0) await userDb.updateUser(updatePayload);
              const enrichedSocials: { label: string; value: string }[] = [];
              if (enrichment.socials.twitter) enrichedSocials.push({ label: 'twitter', value: enrichment.socials.twitter });
              if (enrichment.socials.linkedin) enrichedSocials.push({ label: 'linkedin', value: enrichment.socials.linkedin });
              if (enrichment.socials.github) enrichedSocials.push({ label: 'github', value: enrichment.socials.github });
              if (enrichment.socials.telegram) enrichedSocials.push({ label: 'telegram', value: enrichment.socials.telegram });
              if (enrichment.socials.websites?.length) {
                for (const w of enrichment.socials.websites) enrichedSocials.push({ label: 'custom', value: w });
              }
              if (enrichedSocials.length > 0) {
                await mergeUserSocials(deps, enrichedSocials);
              }

              return success({
                preview: true,
                message: "Profile preview generated. Call create_user_context(confirm=true) to save.",
                profile: {
                  name: enrichment.identity.name,
                  bio: enrichment.identity.bio,
                  location: enrichment.identity.location,
                  skills: enrichment.attributes.skills,
                  interests: enrichment.attributes.interests,
                },
                // Always present when isMeaningfulEnrichment passes — may be {} if the
                // enrichment found no social handles. LLM should ask the user to provide
                // links when empty (see buildOnboarding step 3 in chat.prompt.ts).
                detectedSocials: enrichment.socials,
              });
            }
          } catch (err) {
            logger.warn("Enrichment preview failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          }

          return needsClarification({
            missingFields: ['bio_or_social_urls'],
            message: "I couldn't find enough public info. Could you share a short description of yourself, or a LinkedIn/GitHub/X profile link?",
          });
        }

        // Confirm mode: invoke graph in generate mode (enrichment data already persisted during preview)
        // Do NOT re-run enrichFromUserRecord — the graph's autoGenerateNode handles enrichment
        // from the (now well-populated) user record, avoiding non-deterministic drift.
        try {
          const _confirmGraphStart = Date.now();
          const _confirmTraceEmitter = requestContext.getStore()?.traceEmitter;
          _confirmTraceEmitter?.({ type: "graph_start", name: "enrichment" });
          const result = await invokeWithAbortSignal(graphs.profile, {
            userId: context.userId,
            operationMode: 'generate' as const,
          });
          const _confirmGraphMs = Date.now() - _confirmGraphStart;
          _confirmTraceEmitter?.({ type: "graph_end", name: "enrichment", durationMs: _confirmGraphMs });

          if (result.error) return error(result.error);
          if (result.profile) {
            await markApprovedProfileConfirmed(deps, context);
            return success({
              created: true,
              message: "Profile saved.",
              profile: {
                name: result.profile.identity.name,
                bio: result.profile.identity.bio,
                location: result.profile.identity.location,
                skills: result.profile.attributes.skills,
                interests: result.profile.attributes.interests,
              },
              _graphTimings: [{ name: 'enrichment', durationMs: _confirmGraphMs, agents: result.agentTimings ?? [] }],
            });
          }
        } catch (err) {
          logger.warn("Profile generation on confirm failed, falling back to full graph", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        // Fallback: graph invocation failed on confirm, fall through to full graph invocation
      }

      const hasBioOrDescription = !!query.bioOrDescription?.trim();

      if (hasBioOrDescription) {
        // Create/update profile from user's explicit text only; do not persist to user record
        // Include name and location in the input if provided so the EnrichmentGenerator can use them
        const inputParts: string[] = [];
        if (name) inputParts.push(`Name: ${name}`);
        if (location) inputParts.push(`Location: ${location}`);
        inputParts.push(query.bioOrDescription!.trim());
        const profileInput = inputParts.join('\n');

        const _bioProfileGraphStart = Date.now();
        const _bioProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
        _bioProfileTraceEmitter?.({ type: "graph_start", name: "enrichment" });
        const result = await invokeWithAbortSignal(graphs.profile, {
          userId: context.userId,
          operationMode: 'write' as const,
          input: profileInput,
          forceUpdate: true,
        });
        const _bioProfileGraphMs = Date.now() - _bioProfileGraphStart;
        _bioProfileTraceEmitter?.({ type: "graph_end", name: "enrichment", durationMs: _bioProfileGraphMs });
        if (result.error) {
          return error(result.error);
        }
        if (result.profile) {
          if (isOnboarding && query.confirm) await markApprovedProfileConfirmed(deps, context);
          return success({
            created: true,
            message: "Profile created/updated with the information you provided.",
            profile: {
              name: result.profile.identity.name,
              bio: result.profile.identity.bio,
              location: result.profile.identity.location,
              skills: result.profile.attributes.skills,
              interests: result.profile.attributes.interests,
            },
            _graphTimings: [{ name: 'enrichment', durationMs: _bioProfileGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        if (isOnboarding && query.confirm) await markApprovedProfileConfirmed(deps, context);
        return success({
          created: true,
          message: "Profile created/updated with the information you provided.",
          _graphTimings: [{ name: 'enrichment', durationMs: _bioProfileGraphMs, agents: result.agentTimings ?? [] }],
        });
      }

      // Invoke profile graph in generate mode (uses enrichUserProfile Chat API)
      const _generateProfileGraphStart = Date.now();
      const _generateProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
      _generateProfileTraceEmitter?.({ type: "graph_start", name: "enrichment" });
      const result = await invokeWithAbortSignal(graphs.profile, {
        userId: context.userId,
        operationMode: 'generate' as const,
        forceUpdate: true,
      });
      const _generateProfileGraphMs = Date.now() - _generateProfileGraphStart;
      _generateProfileTraceEmitter?.({ type: "graph_end", name: "enrichment", durationMs: _generateProfileGraphMs });

      // If user info is insufficient, ask conversationally
      if (result.needsUserInfo) {
        return needsClarification({
          missingFields: result.missingUserInfo || ['social_urls', 'full_name'],
          message: "I need a bit more information to create your profile. Could you share your full name and any social links (LinkedIn, GitHub, or X/Twitter)?",
        });
      }

      if (result.error) {
        return error(result.error);
      }

      if (result.profile) {
        if (isOnboarding && query.confirm) await markApprovedProfileConfirmed(deps, context);
        return success({
          created: true,
          message: "Profile generated from your account data.",
          profile: {
            name: result.profile.identity.name,
            bio: result.profile.identity.bio,
            location: result.profile.identity.location,
            skills: result.profile.attributes.skills,
            interests: result.profile.attributes.interests,
          },
          _graphTimings: [{ name: 'enrichment', durationMs: _generateProfileGraphMs, agents: result.agentTimings ?? [] }],
        });
      }

      return error("Failed to create profile. Please try again.");
    },
  });

  const updateUserContext = defineTool({
    name: "update_user_context",
    description:
      "Updates the authenticated user's existing profile using a verb-style instruction interface.\n\n" +
      "**How to use it:**\n" +
      "- `action`: a natural-language instruction describing what to change (e.g. \"add interests\", \"update bio\", \"remove skill\", \"set location\").\n" +
      "- `details`: the content to apply (e.g. \"procedural generation, roguelikes, narrative games\").\n" +
      "- `socials`: optional social handles to merge into the user's reachable profile (e.g. `{ telegram: \"@alice\" }`).\n\n" +
      "**Examples:**\n" +
      "- `action=\"add interests\"`, `details=\"procedural generation, roguelikes\"`\n" +
      "- `action=\"update bio\"`, `details=\"Product designer focused on desktop CRPG interfaces\"`\n" +
      "- `action=\"set location\"`, `details=\"Berlin\"`\n" +
      "- `action=\"remove all mentions of X\"` — existing profile facts matching X are retracted; the profile text regenerates without them shortly after.\n" +
      "- `socials={ telegram: \"@alice\" }` to silently add a reachable chat handle without regenerating the profile.\n\n" +
      "**When to use:** When the user wants to make specific changes without regenerating the whole profile. For full profile regeneration from social URLs, use create_user_context instead.\n\n" +
      "**Important:** If the user provides a URL to update from, call scrape_url first, then pass the scraped content in `details`.\n\n" +
      "**MCP behavior:** For MCP clients, text/profile graph updates are accepted immediately and completed in the background to avoid transport timeouts. Social-only updates still complete synchronously.\n\n" +
      "**Returns:** Confirmation that the profile was updated or accepted for background update.",
    querySchema: z.object({
      profileId: z.string().optional().describe("Profile UUID from read_user_contexts. Omit to update the current user's own profile (most common usage)."),
      action: z.string().optional().describe("Natural language description of ALL changes to make in a single call. Examples: 'update bio to focus on AI research', 'add Python and Rust to skills', 'change location to Berlin and add machine learning to interests'. Optional when only updating socials."),
      details: z.string().optional().describe("Additional context or content to incorporate. Use this to pass scraped URL content (from scrape_url) or longer text the user provided."),
      socials: z.record(z.string()).optional().describe("Social handles or URLs to merge into the user profile, keyed by label. Example: { telegram: '@alice', github: 'alice' }. Existing socials with other labels are preserved."),
    }),
    handler: async ({ context, query }) => {
      const socialUpdates = socialsRecordToRows(query.socials);
      const inputForProfile = [query.action, query.details].filter(Boolean).join("\n");
      if (!inputForProfile.trim()) {
        if (socialUpdates.length > 0) {
          await mergeUserSocials(deps, socialUpdates);
          return success({ message: "Profile socials updated." });
        }
        return error("Please specify what to update (e.g. action: 'update bio to X') or provide socials.");
      }

      const profileRunId = await enqueueEnrichmentRun(deps, context, "update_user_context", query);
      if (profileRunId) {
        return success({
          status: "queued" as const,
          profileRunId,
          message: `Profile update started. Call get_enrichment_run with profileRunId="${profileRunId}" until it succeeds, fails, or is cancelled.`,
        });
      }

      // Use profileGraph query mode to validate profile existence and get id
      const _updateQueryProfileGraphStart = Date.now();
      const _updateQueryProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
      _updateQueryProfileTraceEmitter?.({ type: "graph_start", name: "enrichment" });
      const queryResult = await invokeWithAbortSignal(graphs.profile, { userId: context.userId, operationMode: 'query' as const });
      const _updateQueryProfileGraphMs = Date.now() - _updateQueryProfileGraphStart;
      _updateQueryProfileTraceEmitter?.({ type: "graph_end", name: "enrichment", durationMs: _updateQueryProfileGraphMs });
      if (!queryResult.readResult?.hasProfile && !queryResult.profile) {
        return error("You don't have a profile yet. Use create_user_context first.");
      }
      const existingProfileId = queryResult.readResult?.profile?.id;
      const providedProfileId = query.profileId?.trim();
      if (providedProfileId && existingProfileId && providedProfileId !== existingProfileId) {
        return error("Invalid profileId. Use the profile id from read_user_contexts.");
      }

      if (socialUpdates.length > 0) {
        await mergeUserSocials(deps, socialUpdates);
      }

      if (context.isMcp) {
        const _backgroundWriteProfileGraphStart = Date.now();
        const _backgroundWriteProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
        _backgroundWriteProfileTraceEmitter?.({ type: "graph_start", name: "enrichment" });
        graphs.profile.invoke({
          userId: context.userId,
          operationMode: "write",
          input: inputForProfile,
          forceUpdate: true,
        }).then((writeResult) => {
          if (writeResult.error) {
            logger.error("Background profile update failed", {
              userId: context.userId,
              error: writeResult.error,
            });
            reportToolError?.(new Error(writeResult.error), {
              subsystem: "enrichment",
              operation: "profile.update_background",
              toolName: "update_user_context",
              userId: context.userId,
              tags: { toolName: "update_user_context", execution: "background" },
              context: { profileId: existingProfileId ?? providedProfileId },
            });
          }
        }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("Background profile update failed", {
            userId: context.userId,
            error: message,
          });
          reportToolError?.(err, {
            subsystem: "enrichment",
            operation: "profile.update_background",
            toolName: "update_user_context",
            userId: context.userId,
            tags: { toolName: "update_user_context", execution: "background" },
            context: { profileId: existingProfileId ?? providedProfileId },
          });
        }).finally(() => {
          const _backgroundWriteProfileGraphMs = Date.now() - _backgroundWriteProfileGraphStart;
          _backgroundWriteProfileTraceEmitter?.({ type: "graph_end", name: "enrichment", durationMs: _backgroundWriteProfileGraphMs });
        });

        return success({
          accepted: true,
          message: "Profile update accepted. The structured profile will refresh in the background.",
          _graphTimings: [
            { name: 'enrichment', durationMs: _updateQueryProfileGraphMs, agents: queryResult.agentTimings ?? [] },
          ],
        });
      }

      // Execute update directly
      const _updateWriteProfileGraphStart = Date.now();
      const _updateWriteProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
      _updateWriteProfileTraceEmitter?.({ type: "graph_start", name: "enrichment" });
      const _writeResult = await invokeWithAbortSignal(graphs.profile, {
        userId: context.userId,
        operationMode: "write",
        input: inputForProfile,
        forceUpdate: true,
      });
      const _updateWriteProfileGraphMs = Date.now() - _updateWriteProfileGraphStart;
      _updateWriteProfileTraceEmitter?.({ type: "graph_end", name: "enrichment", durationMs: _updateWriteProfileGraphMs });
      if (_writeResult.error) {
        return error(_writeResult.error);
      }
      return success({
        message: "Profile updated.",
        _graphTimings: [
          { name: 'enrichment', durationMs: _updateQueryProfileGraphMs, agents: queryResult.agentTimings ?? [] },
          { name: 'enrichment', durationMs: _updateWriteProfileGraphMs, agents: _writeResult.agentTimings ?? [] },
        ],
      });
    },
  });

  return { createUserContext, updateUserContext };
}
