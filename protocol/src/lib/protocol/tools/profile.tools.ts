import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, needsClarification, UUID_REGEX } from "./tool.helpers";
import { protocolLogger } from "../support/protocol.logger";

const logger = protocolLogger("ChatTools:Profile");

export function createProfileTools(defineTool: DefineTool, deps: ToolDeps) {
  const { userDb, systemDb, graphs } = deps;

  const readUserProfiles = defineTool({
    name: "read_user_profiles",
    description:
      "Find or read user profiles. When the user asks to find, look up, or learn about a specific person by name, use `query` — this is the primary way to look up people by name. With `query`: finds members by name (case-insensitive) across the user's indexes (or a specific index if `indexId` also provided). With `userId`: returns that user's profile. With `indexId` alone: returns profiles of all members in that index. In an index-scoped chat, no args returns the current user's profile. Outside an index-scoped chat, at least one parameter is required.",
    querySchema: z.object({
      userId: z.string().optional().describe("Optional user ID to fetch a specific user's profile"),
      indexId: z.string().optional().describe("Optional index ID to fetch profiles of all members in that index"),
      query: z.string().optional().describe("Name to find (case-insensitive substring match). Searches across the user's indexes, or within a specific index if indexId is also provided."),
    }),
    handler: async ({ context, query }) => {
      const effectiveIndexId = query.indexId?.trim() || undefined;
      const targetUserId = query.userId?.trim() || undefined;
      const nameQuery = query.query?.trim() || undefined;

      if (effectiveIndexId && !UUID_REGEX.test(effectiveIndexId)) {
        return error("Invalid index ID format. Use the exact UUID from read_indexes.");
      }

      // --- Name search mode: query provided → find members by name ---
      if (nameQuery) {
        const pattern = nameQuery.toLowerCase();
        const MAX_RESULTS = 20;
        // When chat is index-scoped, restrict name search to that index
        const searchIndexId = effectiveIndexId || context.indexId || undefined;

        let candidates: Array<{ userId: string; name: string; avatar: string | null }>;

        if (searchIndexId) {
          // Scoped to a specific index
          if (context.indexId && searchIndexId !== context.indexId) {
            return error(
              context.indexName
                ? `This chat is scoped to ${context.indexName}. You can only look up people in this community.`
                : `This chat is scoped to this index. You can only look up people in this community.`
            );
          }
          const callerIsMember = await systemDb.isIndexMember(searchIndexId, context.userId);
          if (!callerIsMember) {
            return error("You can only look up people in indexes you are a member of.");
          }
          const members = await systemDb.getIndexMembers(searchIndexId);
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
            const profile = await systemDb.getProfile(m.userId);
            return {
              userId: m.userId,
              name: m.name,
              hasProfile: !!profile,
              profile: profile
                ? {
                    name: profile.identity.name,
                    bio: profile.identity.bio,
                    location: profile.identity.location,
                    skills: profile.attributes.skills,
                    interests: profile.attributes.interests,
                  }
                : undefined,
            };
          })
        );

        return success({ query: nameQuery, matchCount: profiles.length, profiles });
      }

      // Guard: when chat is NOT index-scoped and no userId/indexId provided, disallow
      if (!effectiveIndexId && !targetUserId && !context.indexId) {
        return error("Please provide a userId, indexId, or query. Outside of an index-scoped chat, read_user_profiles requires at least one of these parameters. To read your own profile, pass your own userId.");
      }

      // --- Mode 3: indexId provided → fetch all member profiles ---
      if (effectiveIndexId) {
        // Strict scope enforcement: when chat is index-scoped, only allow querying that index
        if (context.indexId && effectiveIndexId !== context.indexId) {
          return error(
            context.indexName
              ? `This chat is scoped to ${context.indexName}. You can only read profiles from this community.`
              : `This chat is scoped to this index. You can only read profiles from this community.`
          );
        }

        // Verify the caller is a member of the index they're querying
        const callerIsMember = await systemDb.isIndexMember(effectiveIndexId, context.userId);
        if (!callerIsMember) {
          return error(
            "You can only read profiles from indexes you are a member of."
          );
        }

        // Use systemDb for cross-user access within shared indexes
        const members = await systemDb.getIndexMembers(effectiveIndexId);
        const profiles = await Promise.all(
          members.map(async (member) => {
            const profile = await systemDb.getProfile(member.userId);
            return {
              userId: member.userId,
              name: member.name,
              hasProfile: !!profile,
              profile: profile
                ? {
                    name: profile.identity.name,
                    bio: profile.identity.bio,
                    location: profile.identity.location,
                    skills: profile.attributes.skills,
                    interests: profile.attributes.interests,
                  }
                : undefined,
            };
          })
        );
        return success({ indexId: effectiveIndexId, memberCount: members.length, profiles });
      }

      // --- Mode 2: userId provided (different user) → fetch single profile directly ---
      if (targetUserId && targetUserId !== context.userId) {
        // Strict scope enforcement: when chat is index-scoped, verify user is in that index
        if (context.indexId) {
          const isInScopedIndex = await systemDb.isIndexMember(context.indexId, targetUserId);
          if (!isInScopedIndex) {
            return error(
              context.indexName
                ? `This chat is scoped to ${context.indexName}. You can only read profiles of members in this community.`
                : `This chat is scoped to this index. You can only read profiles of members in this community.`
            );
          }
        }

        // Use systemDb for cross-user profile access (requires shared index)
        const profile = await systemDb.getProfile(targetUserId);
        if (profile) {
          return success({
            hasProfile: true,
            profile: {
              name: profile.identity.name,
              bio: profile.identity.bio,
              location: profile.identity.location,
              skills: profile.attributes.skills,
              interests: profile.attributes.interests,
            },
          });
        }
        return success({ hasProfile: false, message: "This user does not have a profile yet." });
      }

      // --- Mode 1: No args / self → use profileGraph query (returns id for updates) ---
      const _readProfileGraphStart = Date.now();
      const result = await graphs.profile.invoke({
        userId: context.userId,
        operationMode: 'query' as const,
      });
      const _readProfileGraphMs = Date.now() - _readProfileGraphStart;

      if (result.readResult) {
        return success({ ...result.readResult, _graphTimings: [{ name: 'profile', durationMs: _readProfileGraphMs, agents: result.agentTimings ?? [] }] });
      }
      if (result.profile) {
        return success({
          hasProfile: true,
          profile: {
            name: result.profile.identity.name,
            bio: result.profile.identity.bio,
            location: result.profile.identity.location,
            skills: result.profile.attributes.skills,
            interests: result.profile.attributes.interests,
          },
          _graphTimings: [{ name: 'profile', durationMs: _readProfileGraphMs, agents: result.agentTimings ?? [] }],
        });
      }
      return success({
        hasProfile: false,
        message: "You don't have a profile yet. Would you like to create one? You can share your LinkedIn, GitHub, or X/Twitter profile, or just tell me about yourself.",
        _graphTimings: [{ name: 'profile', durationMs: _readProfileGraphMs, agents: result.agentTimings ?? [] }],
      });
    },
  });

  const createUserProfile = defineTool({
    name: "create_user_profile",
    description:
      "Auto-generates (or regenerates) a profile from the user's account data (name, email, social links) via web lookup, or from explicit text when the user provides a short description (e.g. role, skills, location). When the user provides a profile URL in their message, pass it in the matching parameter (e.g. linkedinUrl) so that URL is used for this request, not their saved links. Works whether or not the user already has a profile. Call with no args first; if it returns missing fields, ask the user conversationally for their full name and/or social URLs, then call again with those fields filled in.",
    querySchema: z.object({
      name: z.string().optional().describe("User's full name (first and last), if provided by the user"),
      linkedinUrl: z.string().optional().describe("LinkedIn profile URL"),
      githubUrl: z.string().optional().describe("GitHub profile URL"),
      twitterUrl: z.string().optional().describe("X/Twitter profile URL"),
      websites: z.array(z.string()).optional().describe("Personal or portfolio website URLs"),
      location: z.string().optional().describe("User's location (city, country)"),
      bioOrDescription: z.string().optional().describe("Explicit profile text from the user (e.g. 'software engineer, AI/ML, SF Bay Area'); creates or updates profile from this text only, no scraping"),
    }),
    handler: async ({ context, query }) => {
      const onboarding = context.user.onboarding;
      const isOnboarding =
        !!onboarding &&
        (onboarding.flow != null || onboarding.currentStep != null) &&
        !onboarding.completedAt;
      if (isOnboarding) {
        const _onboardingProfileGraphStart = Date.now();
        const existing = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
        const _onboardingProfileGraphMs = Date.now() - _onboardingProfileGraphStart;
        if (existing.readResult?.hasProfile && existing.readResult.profile) {
          const p = existing.readResult.profile;
          return success({
            alreadyExists: true,
            message: "Profile already exists. If the user confirmed it, call complete_onboarding() to finish setup. If they want changes, use update_user_profile().",
            profile: {
              name: p.name,
              bio: p.bio,
              location: p.location,
              skills: p.skills,
              interests: p.interests,
            },
            _graphTimings: [{ name: 'profile', durationMs: _onboardingProfileGraphMs, agents: existing.agentTimings ?? [] }],
          });
        }
      }

      const hasBioOrDescription = !!query.bioOrDescription?.trim();

      if (hasBioOrDescription) {
        // Create/update profile from user's explicit text only; do not persist to user record
        // Include name and location in the input if provided so the ProfileGenerator can use them
        const inputParts: string[] = [];
        if (query.name) inputParts.push(`Name: ${query.name}`);
        if (query.location) inputParts.push(`Location: ${query.location}`);
        inputParts.push(query.bioOrDescription!.trim());
        const profileInput = inputParts.join('\n');
        
        const _bioProfileGraphStart = Date.now();
        const result = await graphs.profile.invoke({
          userId: context.userId,
          operationMode: 'write' as const,
          input: profileInput,
          forceUpdate: true,
        });
        const _bioProfileGraphMs = Date.now() - _bioProfileGraphStart;
        if (result.error) {
          return error(result.error);
        }
        if (result.profile) {
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
            _graphTimings: [{ name: 'profile', durationMs: _bioProfileGraphMs, agents: result.agentTimings ?? [] }],
          });
        }
        return success({
          created: true,
          message: "Profile created/updated with the information you provided.",
          _graphTimings: [{ name: 'profile', durationMs: _bioProfileGraphMs, agents: result.agentTimings ?? [] }],
        });
      }

      // If any user-info fields are provided, persist them to the users table first
      const hasSocials = !!(query.linkedinUrl || query.githubUrl || query.twitterUrl || (query.websites && query.websites.length));
      if (query.name || query.location || hasSocials) {
        const socialsUpdate: { linkedin?: string; github?: string; x?: string; websites?: string[] } = {};
        if (query.linkedinUrl) socialsUpdate.linkedin = query.linkedinUrl;
        if (query.githubUrl) socialsUpdate.github = query.githubUrl;
        if (query.twitterUrl) socialsUpdate.x = query.twitterUrl;
        if (query.websites && query.websites.length) socialsUpdate.websites = query.websites;

        // Use userDb for the user's own data
        await userDb.updateUser({
          ...(query.name ? { name: query.name } : {}),
          ...(query.location ? { location: query.location } : {}),
          ...(hasSocials ? { socials: socialsUpdate } : {}),
        });
        logger.verbose("Updated user record before profile generation", { userId: context.userId });
      }

      // Invoke profile graph in generate mode (uses user table data + Parallels searchUser)
      const _generateProfileGraphStart = Date.now();
      const result = await graphs.profile.invoke({
        userId: context.userId,
        operationMode: 'generate' as const,
        forceUpdate: true,
      });
      const _generateProfileGraphMs = Date.now() - _generateProfileGraphStart;

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
          _graphTimings: [{ name: 'profile', durationMs: _generateProfileGraphMs, agents: result.agentTimings ?? [] }],
        });
      }

      return error("Failed to create profile. Please try again.");
    },
  });

  const updateUserProfile = defineTool({
    name: "update_user_profile",
    description:
      "Updates the user's existing profile. For the current user's profile, profileId can be omitted and the tool will use their profile. Use ONE call per request with all changes in action (and details if needed). For profile URLs call scrape_url first, then pass scraped content in details.",
    querySchema: z.object({
      profileId: z.string().optional().describe("Optional profile id from read_user_profiles; omit for current user's profile"),
      action: z.string().describe("What to do: one or more changes, e.g. 'update bio to X', 'add Python to skills'"),
      details: z.string().optional().describe("Additional context or pasted content"),
    }),
    handler: async ({ context, query }) => {
      // Use profileGraph query mode to validate profile existence and get id
      const _updateQueryProfileGraphStart = Date.now();
      const queryResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
      const _updateQueryProfileGraphMs = Date.now() - _updateQueryProfileGraphStart;
      if (!queryResult.readResult?.hasProfile && !queryResult.profile) {
        return error("You don't have a profile yet. Use create_user_profile first.");
      }
      const existingProfileId = queryResult.readResult?.profile?.id;
      const providedProfileId = query.profileId?.trim();
      if (providedProfileId && existingProfileId && providedProfileId !== existingProfileId) {
        return error("Invalid profileId. Use the profile id from read_user_profiles.");
      }

      const inputForProfile = [query.action, query.details].filter(Boolean).join("\n") || (query.details ?? query.action);
      if (!inputForProfile.trim()) {
        return error("Please specify what to update (e.g. action: 'update bio to X').");
      }

      // Execute update directly
      const _updateWriteProfileGraphStart = Date.now();
      const _writeResult = await graphs.profile.invoke({
        userId: context.userId,
        operationMode: "write",
        input: inputForProfile,
        forceUpdate: true,
      });
      const _updateWriteProfileGraphMs = Date.now() - _updateWriteProfileGraphStart;
      if (_writeResult.error) {
        return error(_writeResult.error);
      }
      return success({
        message: "Profile updated.",
        _graphTimings: [
          { name: 'profile', durationMs: _updateQueryProfileGraphMs, agents: queryResult.agentTimings ?? [] },
          { name: 'profile', durationMs: _updateWriteProfileGraphMs, agents: _writeResult.agentTimings ?? [] },
        ],
      });
    },
  });

  const completeOnboarding = defineTool({
    name: "complete_onboarding",
    description:
      "Marks onboarding as complete. Call this ONLY after the user has explicitly confirmed their profile is correct. Do NOT call this until the user says 'yes', 'looks good', 'that's right', or similar confirmation.",
    querySchema: z.object({}),
    handler: async ({ context }) => {
      const currentOnboarding = context.user.onboarding ?? {};
      if (currentOnboarding.completedAt) {
        logger.verbose("Onboarding already completed, skipping", { userId: context.userId });
        return success({ message: "Onboarding already completed." });
      }
      await userDb.updateUser({
        onboarding: {
          ...currentOnboarding,
          completedAt: new Date().toISOString(),
        },
      });
      logger.info("Onboarding completed", { userId: context.userId });
      return success({ message: "Onboarding complete." });
    },
  });

  return [readUserProfiles, createUserProfile, updateUserProfile, completeOnboarding] as const;
}
