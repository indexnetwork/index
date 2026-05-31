import { z } from "zod";

import { requestContext } from "../shared/observability/request-context.js";

import type { DefineTool, ToolDeps } from "../shared/agent/tool.helpers.js";
import { success, error, needsClarification, UUID_REGEX } from "../shared/agent/tool.helpers.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { EnrichmentResult, ProfileEnricher } from "../shared/interfaces/enrichment.interface.js";
import type { OnboardingPrivacyState, OnboardingProfileSeed, OnboardingState, PrivacyConsentSource, UserRecord } from "../shared/interfaces/database.interface.js";
import { socialsToEnrichmentRequest, detectSocialLabel } from "../shared/utils/social-label.js";
import { ProfileGenerator } from "./profile.generator.js";

const logger = protocolLogger("ChatTools:Profile");

function isMeaningfulEnrichment(enrichment: EnrichmentResult | null): enrichment is EnrichmentResult {
  return !!enrichment &&
    enrichment.confidentMatch &&
    (
      enrichment.identity.bio.trim().length > 0 ||
      enrichment.narrative.context.trim().length > 0 ||
      enrichment.attributes.skills.length > 0 ||
      enrichment.attributes.interests.length > 0
    );
}

export function createProfileTools(defineTool: DefineTool, deps: ToolDeps) {
  const { userDb, systemDb, database, graphs, enricher, grantDefaultSystemPermissions } = deps;

  async function enrichFromUserRecord(user: { name?: string | null; email?: string | null; socials: Array<{ id: string; userId: string; label: string; value: string }> }) {
    const enrichmentSocials = socialsToEnrichmentRequest(user.socials);
    return enricher.enrichUserProfile({
      name: user.name || undefined,
      email: user.email || undefined,
      linkedin: enrichmentSocials.linkedin || undefined,
      twitter: enrichmentSocials.twitter || undefined,
      github: enrichmentSocials.github || undefined,
      telegram: enrichmentSocials.telegram || undefined,
      websites: enrichmentSocials.websites?.length ? enrichmentSocials.websites : undefined,
    });
  }

  function hasPublicProfileLookupConsent(onboarding: OnboardingState | null | undefined): boolean {
    return onboarding?.privacy?.publicProfileLookup?.granted === true;
  }

  function hasEdgeosImportConsent(onboarding: OnboardingState | null | undefined): boolean {
    return onboarding?.privacy?.edgeosImport?.granted === true;
  }

  function normalizeConsentSource(source: unknown): PrivacyConsentSource {
    return source === 'agentvillage_onboarding' || source === 'hermes_setup' || source === 'web_onboarding' || source === 'api'
      ? source
      : 'api';
  }

  function consentDecision(granted: boolean, source: PrivacyConsentSource) {
    return { granted, decidedAt: new Date().toISOString(), source };
  }

  function selectProfileSeed(onboarding: OnboardingState | null | undefined, networkId?: string): OnboardingProfileSeed | undefined {
    const seeds = onboarding?.profileSeeds ?? [];
    if (seeds.length === 0) return undefined;
    const scoped = networkId ? seeds.filter((seed) => seed.networkId === networkId) : seeds;
    return scoped[scoped.length - 1] ?? seeds[seeds.length - 1];
  }

  async function persistApprovedProfileContext(profile: { identity: { name: string; bio: string; location: string } }, user: UserRecord | null, networkId?: string): Promise<void> {
    await userDb.updateUser({
      name: profile.identity.name,
      intro: profile.identity.bio,
      location: profile.identity.location,
    });

    const onboarding = user?.onboarding ?? undefined;
    if (!hasEdgeosImportConsent(onboarding)) return;
    const seed = selectProfileSeed(onboarding, networkId);
    if (!seed?.socials?.length) return;

    const existingSocials = await userDb.getUserSocials();
    const seededLabels = new Set(seed.socials.map((social) => social.label));
    const kept = existingSocials
      .filter((social) => !seededLabels.has(social.label) || social.label === 'custom')
      .map((social) => ({ label: social.label, value: social.value }));
    const merged = seededLabels.has('custom')
      ? [...kept.filter((social) => social.label !== 'custom'), ...seed.socials]
      : [...kept, ...seed.socials];
    await userDb.setUserSocials(merged);
  }

  function buildProfileInput(parts: {
    name?: string;
    location?: string;
    bioOrDescription?: string;
    edgeosProfileText?: string;
    enrichment?: EnrichmentResult | null;
    socials?: Array<{ label: string; value: string }>;
  }): string {
    const lines: string[] = [];
    if (parts.name) lines.push(`Name: ${parts.name}`);
    if (parts.location) lines.push(`Location: ${parts.location}`);
    if (parts.bioOrDescription) lines.push(parts.bioOrDescription);
    if (parts.edgeosProfileText) lines.push(`Event-provided profile information:\n${parts.edgeosProfileText}`);
    if (parts.socials?.length) {
      lines.push(`User-provided public links:\n${parts.socials.map((s) => `${s.label}: ${s.value}`).join('\n')}`);
    }
    const enrichment = parts.enrichment ?? null;
    if (isMeaningfulEnrichment(enrichment)) {
      lines.push([
        enrichment.identity.name ? `Enriched name: ${enrichment.identity.name}` : '',
        enrichment.identity.location ? `Enriched location: ${enrichment.identity.location}` : '',
        enrichment.identity.bio ? `Enriched bio: ${enrichment.identity.bio}` : '',
        enrichment.narrative.context ? `Enriched context: ${enrichment.narrative.context}` : '',
        enrichment.attributes.skills.length ? `Skills: ${enrichment.attributes.skills.join(', ')}` : '',
        enrichment.attributes.interests.length ? `Interests: ${enrichment.attributes.interests.join(', ')}` : '',
      ].filter(Boolean).join('\n'));
    }
    return lines.filter((line) => line.trim().length > 0).join('\n\n');
  }

  function toProfileSummary(profile: { identity: { name: string; bio: string; location: string }; attributes: { skills: string[]; interests: string[] } }) {
    return {
      name: profile.identity.name,
      bio: profile.identity.bio,
      location: profile.identity.location,
      skills: profile.attributes.skills,
      interests: profile.attributes.interests,
    };
  }

  const readUserProfiles = defineTool({
    name: "read_user_profiles",
    description:
      "Retrieves user profiles containing identity info (name, bio, location), skills, and interests. Profiles are used for semantic matching " +
      "in opportunity discovery — richer profiles produce better matches.\n\n" +
      "**Usage modes:**\n" +
      "- With `query` (name search): finds members by name (case-insensitive substring) across the user's indexes. " +
      "This is the primary way to look up a person by name. Add `networkId` to restrict search to one index.\n" +
      "- With `userId`: returns that specific user's full profile (name, bio, skills, interests, location).\n" +
      "- With `networkId` alone: returns profiles of ALL members in that index.\n" +
      "- No parameters: returns the current user's own profile.\n\n" +
      "**When to use:** Before creating introductions (need profiles of both parties), when the user asks about a person, " +
      "or to check if a profile exists before suggesting create_user_profile. " +
      "MCP agents should call this with no arguments at session start to fetch the caller's profile AND onboarding status.\n\n" +
      "**Returns:** Profile objects with name, bio, location, skills[], interests[]. Use userId from results with other tools like read_intents(userId, networkId). " +
      "When called for the current user (no args, or userId=self), the response also includes `onboardingComplete: boolean` and `onboardingCompletedAt?: string` — " +
      "use these as the source of truth for whether the user still needs onboarding (do not rely on local file state).",
    querySchema: z.object({
      userId: z.string().optional().describe("Fetch a specific user's profile by their user ID. Get user IDs from read_network_memberships or list_contacts."),
      networkId: z.string().optional().describe("Index UUID — fetch profiles of all members in this index, or narrow a name search to this index. Get from read_networks."),
      query: z.string().optional().describe("Name to search for (case-insensitive substring match). Searches across all the user's indexes unless networkId is also provided. Use this when the user asks to 'find' or 'look up' someone."),
    }),
    handler: async ({ context, query }) => {
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
        // When chat is index-scoped, restrict name search to that index
        const searchIndexId = effectiveIndexId || context.networkId || undefined;

        let candidates: Array<{ userId: string; name: string; avatar: string | null }>;

        if (searchIndexId) {
          // Scoped to a specific index
          if (context.networkId && searchIndexId !== context.networkId) {
            return error(
              context.indexName
                ? `This chat is scoped to ${context.indexName}. You can only look up people in this community.`
                : `This chat is scoped to this index. You can only look up people in this community.`
            );
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
            } catch (err) {
              logger.warn("read_user_profiles: getProfile failed; degrading to hasProfile=false", {
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
        // Strict scope enforcement: when chat is index-scoped, only allow querying that index
        if (context.networkId && effectiveIndexId !== context.networkId) {
          return error(
            context.indexName
              ? `This chat is scoped to ${context.indexName}. You can only read profiles from this community.`
              : `This chat is scoped to this index. You can only read profiles from this community.`
          );
        }

        // Verify the caller is a member of the index they're querying
        const callerIsMember = await systemDb.isNetworkMember(effectiveIndexId, context.userId);
        if (!callerIsMember) {
          return error(
            "You can only read profiles from indexes you are a member of."
          );
        }

        // Use systemDb for cross-user access within shared indexes
        const members = await systemDb.getNetworkMembers(effectiveIndexId);
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
        return success({ networkId: effectiveIndexId, memberCount: members.length, profiles });
      }

      // --- Mode 2: userId provided (different user) → fetch single profile directly ---
      if (targetUserId && targetUserId !== context.userId) {
        // Strict scope enforcement: when chat is index-scoped, verify user is in that index
        if (context.networkId) {
          const isInScopedIndex = await systemDb.isNetworkMember(context.networkId, targetUserId);
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
      const _readProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
      _readProfileTraceEmitter?.({ type: "graph_start", name: "profile" });
      const result = await graphs.profile.invoke({
        userId: context.userId,
        operationMode: 'query' as const,
      });
      const _readProfileGraphMs = Date.now() - _readProfileGraphStart;
      _readProfileTraceEmitter?.({ type: "graph_end", name: "profile", durationMs: _readProfileGraphMs });

      // Self-lookup includes onboarding status so MCP agents (e.g. Edge Claw)
      // can decide whether to run the onboarding flow without depending on
      // local-only state like a workspace BOOTSTRAP.md file.
      const onboardingCompletedAt = context.user.onboarding?.completedAt ?? null;
      const onboardingFields = {
        onboardingComplete: !!onboardingCompletedAt,
        ...(onboardingCompletedAt ? { onboardingCompletedAt } : {}),
      };

      if (result.readResult) {
        return success({ ...result.readResult, ...onboardingFields, _graphTimings: [{ name: 'profile', durationMs: _readProfileGraphMs, agents: result.agentTimings ?? [] }] });
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
          ...onboardingFields,
          _graphTimings: [{ name: 'profile', durationMs: _readProfileGraphMs, agents: result.agentTimings ?? [] }],
        });
      }
      return success({
        hasProfile: false,
        ...onboardingFields,
        message: "You don't have a profile yet. Would you like to create one? You can share your LinkedIn, GitHub, or X/Twitter profile, or just tell me about yourself.",
        _graphTimings: [{ name: 'profile', durationMs: _readProfileGraphMs, agents: result.agentTimings ?? [] }],
      });
    },
  });

  const recordOnboardingPrivacyConsent = defineTool({
    name: "record_onboarding_privacy_consent",
    description:
      "Records exactly one authenticated-user onboarding privacy choice. Use this during AgentVillage/Hermes onboarding only after the user explicitly answers the matching consent question in a prior message. " +
      "Do not call this in the same assistant turn as the consent question, and do not combine EdgeOS import and public lookup decisions in one call. " +
      "This only records consent; it does not mark onboarding complete and does not create or update a profile.",
    querySchema: z.object({
      edgeosImportGranted: z.boolean().optional().describe("Whether the user grants permission to use EdgeOS/event-provided profile data for onboarding."),
      publicProfileLookupGranted: z.boolean().optional().describe("Whether the user grants permission for public internet/profile lookup during onboarding."),
      source: z.enum(['agentvillage_onboarding', 'hermes_setup', 'web_onboarding', 'api']).optional().default('api').describe("Where this consent decision was collected."),
    }),
    handler: async ({ context, query }) => {
      const user = await userDb.getUser();
      if (user?.isGhost) {
        return error("Ghost users cannot record onboarding consent. The user must authenticate as a real account first.");
      }
      const hasEdgeosDecision = query.edgeosImportGranted !== undefined;
      const hasPublicLookupDecision = query.publicProfileLookupGranted !== undefined;
      if (!hasEdgeosDecision && !hasPublicLookupDecision) {
        return error("Provide exactly one consent decision to record.");
      }
      if (hasEdgeosDecision && hasPublicLookupDecision) {
        return error("Record EdgeOS import consent and public-profile lookup consent separately, after each explicit user answer. Do not combine them in one call.");
      }

      const currentOnboarding = user?.onboarding ?? context.user.onboarding ?? {};
      const currentPrivacy: OnboardingPrivacyState = currentOnboarding.privacy ?? {};
      const source = normalizeConsentSource(query.source);
      const privacy: OnboardingPrivacyState = {
        ...currentPrivacy,
        ...(query.edgeosImportGranted !== undefined && { edgeosImport: consentDecision(query.edgeosImportGranted, source) }),
        ...(query.publicProfileLookupGranted !== undefined && { publicProfileLookup: consentDecision(query.publicProfileLookupGranted, source) }),
      };

      await userDb.updateUser({
        onboarding: {
          ...currentOnboarding,
          privacy,
        },
      });

      return success({
        message: "Privacy choices recorded.",
        privacy,
      });
    },
  });

  const previewUserProfile = defineTool({
    name: "preview_user_profile",
    description:
      "Builds a structured profile draft for onboarding without saving anything. Use this after recording privacy consent and before asking the user to approve the profile. " +
      "If allowPublicLookup is false, this tool uses only explicit text, EdgeOS/event data the user allowed, and user-provided social URLs. If allowPublicLookup is true, persisted public lookup consent is required.",
    querySchema: z.object({
      name: z.string().optional().describe("Name explicitly provided by the user or already known from the authenticated account."),
      location: z.string().optional().describe("Location explicitly provided by the user or allowed event data."),
      bioOrDescription: z.string().optional().describe("Explicit self-description provided by the user."),
      edgeosProfileText: z.string().optional().describe("EdgeOS/event profile text, only if the user granted EdgeOS import consent."),
      allowPublicLookup: z.boolean().optional().default(false).describe("Whether to include public profile lookup. Requires previously recorded publicProfileLookup consent."),
      linkedinUrl: z.string().optional().describe("LinkedIn URL explicitly provided by the user."),
      githubUrl: z.string().optional().describe("GitHub URL explicitly provided by the user."),
      twitterUrl: z.string().optional().describe("X/Twitter URL explicitly provided by the user."),
      websites: z.array(z.string()).optional().describe("Personal/portfolio URLs explicitly provided by the user."),
    }),
    handler: async ({ context, query }) => {
      const user = await userDb.getUser();
      if (!user) return error("User not found.");

      const onboarding = user.onboarding ?? context.user.onboarding;
      const hasEdgeosConsent = hasEdgeosImportConsent(onboarding);
      const seed = hasEdgeosConsent ? selectProfileSeed(onboarding, context.networkId) : undefined;
      const name = query.name?.trim() || seed?.name || user.name || undefined;
      const location = query.location?.trim() || seed?.location || user.location || undefined;
      const bioOrDescription = query.bioOrDescription?.trim() || seed?.bio || user.intro || undefined;
      const edgeosProfileText = query.edgeosProfileText?.trim() || undefined;
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

      if (edgeosProfileText && !hasEdgeosConsent) {
        return error("EdgeOS import consent has not been recorded. Ask the user first, then call record_onboarding_privacy_consent(edgeosImportGranted=true) before using event-provided profile data.");
      }

      let enrichment: EnrichmentResult | null = null;
      if (query.allowPublicLookup) {
        if (!hasPublicProfileLookupConsent(user.onboarding ?? context.user.onboarding)) {
          return error("Public profile lookup consent has not been recorded. Ask the user first, then call record_onboarding_privacy_consent(publicProfileLookupGranted=true).");
        }
        enrichment = await enrichFromUserRecord({
          name,
          email: user.email,
          socials: socials.map((social, index) => ({ id: `preview-${index}`, userId: context.userId, ...social })),
        });
      }

      const input = buildProfileInput({ name, location, bioOrDescription, edgeosProfileText, enrichment, socials });
      if (!input.trim()) {
        return needsClarification({
          missingFields: ['profile_description'],
          message: "Please share a short description, allowed EdgeOS profile text, or user-provided profile links so I can draft your profile.",
        });
      }

      const generated = await new ProfileGenerator().invoke(input);
      const profile = { ...generated.output, userId: context.userId };
      return success({
        preview: true,
        persisted: false,
        message: "Profile draft generated. Show this to the user and ask whether it looks right before calling confirm_user_profile.",
        profile: toProfileSummary(profile),
        draft: profile,
      });
    },
  });

  const confirmUserProfile = defineTool({
    name: "confirm_user_profile",
    description:
      "Saves an explicitly approved onboarding profile draft. Call this only after the user has seen the draft from preview_user_profile and approved it or provided corrections. " +
      "This path uses only the approved draft/explicit correction text and does not scrape or run public lookup.",
    querySchema: z.object({
      draft: z.object({
        identity: z.object({ name: z.string(), bio: z.string(), location: z.string() }),
        narrative: z.object({ context: z.string() }),
        attributes: z.object({ interests: z.array(z.string()), skills: z.array(z.string()) }),
      }).optional().describe("The structured profile draft returned by preview_user_profile after user approval."),
      bioOrDescription: z.string().optional().describe("Approved correction or explicit profile text if not passing a structured draft."),
      name: z.string().optional().describe("Approved name correction."),
      location: z.string().optional().describe("Approved location correction."),
    }),
    handler: async ({ context, query }) => {
      const user = await userDb.getUser();
      if (query.draft) {
        const profile = { ...query.draft, userId: context.userId };
        await userDb.saveProfile(profile);
        await persistApprovedProfileContext(profile, user, context.networkId);
        return success({
          created: true,
          message: "Profile saved from approved draft.",
          profile: toProfileSummary(profile),
        });
      }

      const description = query.bioOrDescription?.trim();
      if (!description) {
        return error("Pass the approved structured draft or explicit approved profile text.");
      }
      const input = buildProfileInput({
        name: query.name?.trim(),
        location: query.location?.trim(),
        bioOrDescription: description,
      });
      const rawProfile = {
        identity: {
          name: query.name?.trim() ?? user?.name ?? '',
          bio: description,
          location: query.location?.trim() ?? '',
        },
      };
      await persistApprovedProfileContext(rawProfile, user, context.networkId);

      const _confirmTraceEmitter = requestContext.getStore()?.traceEmitter;
      const _confirmGraphStart = Date.now();
      _confirmTraceEmitter?.({ type: "graph_start", name: "profile" });
      graphs.profile.invoke({
        userId: context.userId,
        operationMode: 'write' as const,
        input,
        forceUpdate: true,
      }).then((result) => {
        const _confirmGraphMs = Date.now() - _confirmGraphStart;
        _confirmTraceEmitter?.({ type: "graph_end", name: "profile", durationMs: _confirmGraphMs });
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
      );

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

  const createUserProfile = defineTool({
    name: "create_user_profile",
    description:
      "Legacy/backward-compatible tool that creates or regenerates the authenticated user's profile. AgentVillage/Hermes onboarding must use " +
      "record_onboarding_privacy_consent → preview_user_profile → confirm_user_profile instead, so consent is recorded and the draft is shown before saving. " +
      "Profiles are essential for discovery — they provide the semantic context used to match users with complementary intents.\n\n" +
      "**How it works:** For generic clients, the system can enrich profile data from public web sources (LinkedIn, GitHub, Twitter) and/or explicit user input, " +
      "then generates a structured profile with bio, skills, interests, location, and narrative context. Do not call with no arguments in consent-required onboarding flows.\n\n" +
      "**Usage patterns:**\n" +
      "- No args: attempts auto-generation from account data. If insufficient info, returns `missingFields` — ask the user for name/social URLs and retry.\n" +
      "- With social URLs (linkedinUrl, githubUrl, etc.): enriches from those specific URLs.\n" +
      "- With bioOrDescription: creates profile from explicit text only (no web scraping).\n" +
      "- Legacy onboarding clients: first call returns a preview. AgentVillage/Hermes clients should not use this preview path; use preview_user_profile instead because it does not persist enrichment side effects.\n\n" +
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
      confirm: z.boolean().optional().describe("Set to true to save a previously previewed profile. Only used during onboarding flow after the user approves the preview."),
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
        const existingSocials = await userDb.getUserSocials();
        const newSocials: { label: string; value: string }[] = [];
        if (linkedinUrl) newSocials.push({ label: 'linkedin', value: linkedinUrl });
        if (githubUrl) newSocials.push({ label: 'github', value: githubUrl });
        if (twitterUrl) newSocials.push({ label: 'twitter', value: twitterUrl });
        if (websites?.length) {
          for (const w of websites) newSocials.push({ label: detectSocialLabel(w) === 'custom' ? 'custom' : detectSocialLabel(w), value: w });
        }
        const newLabels = new Set(newSocials.map(s => s.label));
        const kept = existingSocials
          .filter(s => !newLabels.has(s.label) || s.label === 'custom')
          .map(s => ({ label: s.label, value: s.value }));
        const merged = newLabels.has('custom')
          ? [...kept.filter(s => s.label !== 'custom'), ...newSocials]
          : [...kept, ...newSocials];
        await userDb.setUserSocials(merged);
      }
      logger.verbose("Persisted user-info fields to user record", { userId: context.userId });

      const isOnboarding = !(context.user.onboarding?.completedAt);
      if (isOnboarding) {
        const existingProfile = await userDb.getProfile();
        if (existingProfile) {
          return success({
            alreadyExists: true,
            message: "Profile already exists. If the user confirmed it, call complete_onboarding() to finish setup. If they want changes, use create_user_profile(bioOrDescription=\"...\", confirm=true).",
            profile: {
              name: existingProfile.identity.name,
              bio: existingProfile.identity.bio,
              location: existingProfile.identity.location,
              skills: existingProfile.attributes.skills,
              interests: existingProfile.attributes.interests,
            },
          });
        }

        // Preview mode: enrich and persist enrichment results, but don't generate full profile
        if (!query.confirm) {
          try {
            const user = await userDb.getUser();
            const enrichment = user ? await enrichFromUserRecord(user) : null;

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
                const existingSocials = await userDb.getUserSocials();
                const enrichedLabels = new Set(enrichedSocials.map(s => s.label));
                const kept = existingSocials
                  .filter(s => !enrichedLabels.has(s.label) || s.label === 'custom')
                  .map(s => ({ label: s.label, value: s.value }));
                const merged = enrichedLabels.has('custom')
                  ? [...kept.filter(s => s.label !== 'custom'), ...enrichedSocials]
                  : [...kept, ...enrichedSocials];
                await userDb.setUserSocials(merged);
              }

              return success({
                preview: true,
                message: "Profile preview generated. Call create_user_profile(confirm=true) to save.",
                profile: {
                  name: enrichment.identity.name,
                  bio: enrichment.identity.bio,
                  location: enrichment.identity.location,
                  skills: enrichment.attributes.skills,
                  interests: enrichment.attributes.interests,
                },
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
          _confirmTraceEmitter?.({ type: "graph_start", name: "profile" });
          const result = await graphs.profile.invoke({
            userId: context.userId,
            operationMode: 'generate' as const,
          });
          const _confirmGraphMs = Date.now() - _confirmGraphStart;
          _confirmTraceEmitter?.({ type: "graph_end", name: "profile", durationMs: _confirmGraphMs });

          if (result.error) return error(result.error);
          if (result.profile) {
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
              _graphTimings: [{ name: 'profile', durationMs: _confirmGraphMs, agents: result.agentTimings ?? [] }],
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
        // Include name and location in the input if provided so the ProfileGenerator can use them
        const inputParts: string[] = [];
        if (name) inputParts.push(`Name: ${name}`);
        if (location) inputParts.push(`Location: ${location}`);
        inputParts.push(query.bioOrDescription!.trim());
        const profileInput = inputParts.join('\n');
        
        const _bioProfileGraphStart = Date.now();
        const _bioProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
        _bioProfileTraceEmitter?.({ type: "graph_start", name: "profile" });
        const result = await graphs.profile.invoke({
          userId: context.userId,
          operationMode: 'write' as const,
          input: profileInput,
          forceUpdate: true,
        });
        const _bioProfileGraphMs = Date.now() - _bioProfileGraphStart;
        _bioProfileTraceEmitter?.({ type: "graph_end", name: "profile", durationMs: _bioProfileGraphMs });
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

      // Invoke profile graph in generate mode (uses enrichUserProfile Chat API)
      const _generateProfileGraphStart = Date.now();
      const _generateProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
      _generateProfileTraceEmitter?.({ type: "graph_start", name: "profile" });
      const result = await graphs.profile.invoke({
        userId: context.userId,
        operationMode: 'generate' as const,
        forceUpdate: true,
      });
      const _generateProfileGraphMs = Date.now() - _generateProfileGraphStart;
      _generateProfileTraceEmitter?.({ type: "graph_end", name: "profile", durationMs: _generateProfileGraphMs });

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
      "Updates the authenticated user's existing profile using a verb-style instruction interface.\n\n" +
      "**How to use it:**\n" +
      "- `action`: a natural-language instruction describing what to change (e.g. \"add interests\", \"update bio\", \"remove skill\", \"set location\").\n" +
      "- `details`: the content to apply (e.g. \"procedural generation, roguelikes, narrative games\").\n\n" +
      "**Examples:**\n" +
      "- `action=\"add interests\"`, `details=\"procedural generation, roguelikes\"`\n" +
      "- `action=\"update bio\"`, `details=\"Product designer focused on desktop CRPG interfaces\"`\n" +
      "- `action=\"set location\"`, `details=\"Berlin\"`\n\n" +
      "**When to use:** When the user wants to make specific changes without regenerating the whole profile. For full profile regeneration from social URLs, use create_user_profile instead.\n\n" +
      "**Important:** If the user provides a URL to update from, call scrape_url first, then pass the scraped content in `details`.\n\n" +
      "**Returns:** Confirmation that the profile was updated.",
    querySchema: z.object({
      profileId: z.string().optional().describe("Profile UUID from read_user_profiles. Omit to update the current user's own profile (most common usage)."),
      action: z.string().describe("Natural language description of ALL changes to make in a single call. Examples: 'update bio to focus on AI research', 'add Python and Rust to skills', 'change location to Berlin and add machine learning to interests'."),
      details: z.string().optional().describe("Additional context or content to incorporate. Use this to pass scraped URL content (from scrape_url) or longer text the user provided."),
    }),
    handler: async ({ context, query }) => {
      // Use profileGraph query mode to validate profile existence and get id
      const _updateQueryProfileGraphStart = Date.now();
      const _updateQueryProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
      _updateQueryProfileTraceEmitter?.({ type: "graph_start", name: "profile" });
      const queryResult = await graphs.profile.invoke({ userId: context.userId, operationMode: 'query' as const });
      const _updateQueryProfileGraphMs = Date.now() - _updateQueryProfileGraphStart;
      _updateQueryProfileTraceEmitter?.({ type: "graph_end", name: "profile", durationMs: _updateQueryProfileGraphMs });
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
      const _updateWriteProfileTraceEmitter = requestContext.getStore()?.traceEmitter;
      _updateWriteProfileTraceEmitter?.({ type: "graph_start", name: "profile" });
      const _writeResult = await graphs.profile.invoke({
        userId: context.userId,
        operationMode: "write",
        input: inputForProfile,
        forceUpdate: true,
      });
      const _updateWriteProfileGraphMs = Date.now() - _updateWriteProfileGraphStart;
      _updateWriteProfileTraceEmitter?.({ type: "graph_end", name: "profile", durationMs: _updateWriteProfileGraphMs });
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
      "Marks the user's onboarding as complete, unlocking full platform access. This is the final step in the new-user setup flow.\n\n" +
      "**Prerequisites:** The user must have a profile (created via create_user_profile) AND must have explicitly confirmed it " +
      "(said 'yes', 'looks good', 'that's right', or similar). Do NOT call this until the user confirms.\n\n" +
      "**What happens:** Sets completedAt timestamp on the user's onboarding record. May also auto-join the user to preconfigured indexes " +
      "(communities) based on server configuration.\n\n" +
      "**Workflow:** create_user_profile() -> user confirms preview -> create_user_profile(confirm=true) -> user confirms saved profile -> complete_onboarding()\n\n" +
      "**Returns:** Confirmation that onboarding is complete. No parameters needed.",
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

      if (grantDefaultSystemPermissions) {
        try {
          await grantDefaultSystemPermissions(context.userId);
        } catch (err) {
          logger.warn('Default system agent permission grant failed (non-fatal)', {
            userId: context.userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const autoJoinIds = (process.env.AUTO_JOIN_INDEX_IDS ?? '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
      for (const networkId of autoJoinIds) {
        try {
          await database.addMemberToNetwork(networkId, context.userId, 'member');
        } catch (err) {
          logger.warn('Auto-join network failed (non-fatal)', { networkId, userId: context.userId, error: err instanceof Error ? err.message : String(err) });
        }
      }

      logger.info("Onboarding completed", { userId: context.userId, autoJoinedNetworks: autoJoinIds.length });
      return success({ message: "Onboarding complete." });
    },
  });

  return [readUserProfiles, recordOnboardingPrivacyConsent, previewUserProfile, confirmUserProfile, createUserProfile, updateUserProfile, completeOnboarding] as const;
}
