import { StateGraph, START, END } from "@langchain/langgraph";
import { ProfileGraphState } from "./profile.state.js";
import { ProfileGenerator, ProfileDocument } from "./profile.generator.js";
import { HydeGenerator } from "./profile.hyde.generator.js";
import { ProfileGraphDatabase } from "../shared/interfaces/database.interface.js";
import { Embedder } from "../shared/interfaces/embedder.interface.js";
import { Scraper } from "../shared/interfaces/scraper.interface.js";
import type { ProfileEnricher } from "../shared/interfaces/enrichment.interface.js";
import { shouldEnrichGhostDisplayNameFromParallel, isEnrichedNameMeaningful } from "./profile.enricher.js";
import { socialsToEnrichmentRequest } from "../shared/utils/social-label.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { timed } from "../shared/observability/performance.js";
import { requestContext } from "../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../chat/chat-streaming.types.js";

const logger = protocolLogger("ProfileGraphFactory");

/** Minimum length for input to be considered meaningful (e.g. not just "Yes") */
const MIN_MEANINGFUL_INPUT_LENGTH = 20;

/** Phrases that are confirmations only and must not be used as profile content */
const CONFIRMATION_PHRASES = new Set([
  "yes", "yeah", "yep", "sure", "ok", "okay", "go ahead", "do it", "please",
  "correct", "right", "exactly", "absolutely", "of course", "sounds good",
  "create one", "create it", "set one up", "set it up", "create my profile",
  "create profile", "set up profile", "create a profile"
]);

/**
 * Returns true only if the input contains real profile information.
 * Confirmation-only replies (e.g. "Yes" to "Would you like to create a profile?")
 * must not be treated as input so we ask for user info / use scraper instead of inventing a profile.
 */
function isMeaningfulProfileInput(input: string | undefined): boolean {
  if (!input || typeof input !== "string") return false;
  const trimmed = input.trim();
  if (trimmed.length < MIN_MEANINGFUL_INPUT_LENGTH) return false;
  const lower = trimmed.toLowerCase();
  if (CONFIRMATION_PHRASES.has(lower)) return false;
  if (CONFIRMATION_PHRASES.has(lower.replace(/[.!?]+$/, ""))) return false;
  return true;
}

/**
 * Returns true only when the value is a fully valid numeric vector (flat or nested).
 * Used so we don't treat DB returns (e.g. pg vector as string, or empty/partial array) as "has embedding".
 * Ensures callers re-embed when vectors contain non-number or NaN/Infinity.
 */
function hasValidProfileEmbedding(embedding: unknown): boolean {
  if (embedding == null) return false;
  if (!Array.isArray(embedding)) return false;
  if (embedding.length === 0) return false;
  const first = embedding[0];
  if (Array.isArray(first)) {
    // Nested: number[][]
    for (let i = 0; i < embedding.length; i++) {
      const sub = embedding[i];
      if (!Array.isArray(sub) || sub.length === 0) return false;
      for (let j = 0; j < sub.length; j++) {
        const v = sub[j];
        if (typeof v !== "number" || !Number.isFinite(v)) return false;
      }
    }
    return true;
  }
  // Flat: number[]
  for (let i = 0; i < embedding.length; i++) {
    const v = embedding[i];
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
  }
  return true;
}

/**
 * Factory class to build and compile the Profile Generation Graph.
 * 
 * Flow:
 * 1. check_state - Detect what's missing (profile, embeddings, hyde)
 * 2. Conditional routing based on operation mode and missing components:
 *    - Query mode: Return immediately (fast path)
 *    - Write mode: Generate only what's needed
 * 3. Profile generation (if needed)
 * 4. Profile embedding (if needed)
 * 5. HyDE generation (if needed or profile updated)
 * 6. HyDE embedding (if needed)
 * 
 * Key Features:
 * - Read/Write separation (query vs write)
 * - Conditional generation (skip expensive operations if data exists)
 * - Automatic hyde regeneration when profile is updated
 */
export class ProfileGraphFactory {
  constructor(
    private database: ProfileGraphDatabase,
    private embedder: Embedder,
    private scraper: Scraper,
    private enricher?: ProfileEnricher,
  ) { }

  public createGraph() {
    const profileGenerator = new ProfileGenerator();
    const hydeGenerator = new HydeGenerator();

    // ─────────────────────────────────────────────────────────
    // NODE: Check State
    // Loads existing profile from DB and detects what needs generation:
    // - Profile missing
    // - Profile embedding missing
    // - HyDE description missing
    // - HyDE embedding missing
    // - User information insufficient for scraping
    // ─────────────────────────────────────────────────────────
    const checkStateNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.checkState", async () => {
        if (!state.userId) {
          logger.error("Missing userId");
          return {
            error: "userId is required"
          };
        }

        logger.verbose("Checking profile state...", {
          userId: state.userId,
          operationMode: state.operationMode,
          forceUpdate: state.forceUpdate
        });

        try {
          const profile = await this.database.getProfile(state.userId) as any;

          // Query mode: Just return the profile (fast path)
          if (state.operationMode === 'query') {
            logger.verbose("🚀 Query mode - returning existing profile (fast path)", {
              hasProfile: !!profile
            });
            const profileWithId = profile ? await this.database.getProfileByUserId(state.userId) : null;
            return {
              profile: profile || undefined,
              readResult: profile
                ? {
                    hasProfile: true,
                    profile: {
                      id: profileWithId?.id,
                      name: profile.identity?.name,
                      bio: profile.identity?.bio,
                      location: profile.identity?.location,
                      skills: profile.attributes?.skills,
                      interests: profile.attributes?.interests,
                    },
                  }
                : {
                    hasProfile: false,
                    message:
                      "You don't have a profile yet. Would you like to create one? You can share your LinkedIn, GitHub, or X/Twitter profile, or just tell me about yourself.",
                  },
            };
          }

          // Write mode: Detect what needs generation
          // Treat confirmation-only input (e.g. "Yes") as no input so we ask for info / use scraper
          const hasMeaningfulInput = !!state.input && isMeaningfulProfileInput(state.input);
          const needsProfileGeneration = !profile || (state.forceUpdate && hasMeaningfulInput);
          const needsProfileEmbedding = profile && !hasValidProfileEmbedding(profile.embedding);
          const existingHydeDoc = await this.database.getHydeDocument('profile', state.userId, 'mirror');
          const needsHydeGeneration = !existingHydeDoc || (state.forceUpdate && hasMeaningfulInput);
          const needsHydeEmbedding = false; // Profile HyDE lives in hyde_documents; no partial "text only" state

          // Check if we need to scrape (profile generation needed but no meaningful input provided)
          const willNeedScraping = needsProfileGeneration && !hasMeaningfulInput;

          // If we need to scrape, check if we have sufficient user information
          let needsUserInfo = false;
          let missingUserInfo: string[] = [];

          if (willNeedScraping) {
            logger.verbose("Will need scraping - checking user information...");

            const user = await this.database.getUser(state.userId);

            if (!user) {
              logger.error("User not found", { userId: state.userId });
              return {
                error: `User not found: ${state.userId}`
              };
            }

            // Check what information we have from the user table (schema: users)
            // Required fields: email, name (always present)
            // Optional fields: intro, avatar, location, socials

            const socials = await this.database.getUserSocials(state.userId);
            const hasSocials = socials.length > 0;

            // Check if name is a full name (not just email username)
            // For scraping to work well, we need first + last name
            const hasMeaningfulName = user.name &&
              user.name.trim() !== '' &&
              !user.name.includes('@') &&
              user.name.split(/\s+/).filter(Boolean).length >= 2;

            const hasLocation = !!(user.location && user.location.trim() !== '');

            // Minimum requirement for accurate scraping:
            // - At least ONE social link (preferred - most reliable for finding the right person)
            // - OR a full name (first + last) - less reliable but workable
            // Location helps disambiguate but is not required

            const hasMinimumInfo = hasSocials || hasMeaningfulName;

            if (!hasMinimumInfo) {
              needsUserInfo = true;

              // Build precise list of what's missing and would help
              if (!hasSocials) {
                missingUserInfo.push('social_urls');
              }
              if (!hasMeaningfulName) {
                missingUserInfo.push('full_name');
              }
              if (!hasLocation) {
                missingUserInfo.push('location'); // Nice to have
              }

              logger.verbose("⚠️ Insufficient user information for scraping", {
                hasSocials,
                hasMeaningfulName,
                hasLocation,
                currentName: user.name,
                missingUserInfo
              });
            } else {
              logger.verbose("✅ Sufficient user information for scraping", {
                hasSocials,
                hasMeaningfulName,
                hasLocation,
                willProceedWith: hasSocials ? 'social links' : 'full name'
              });
            }
          }

          logger.verbose("📊 State detection complete", {
            hasProfile: !!profile,
            needsProfileGeneration,
            needsProfileEmbedding,
            needsHydeGeneration,
            needsHydeEmbedding,
            needsUserInfo,
            missingUserInfo,
            forceUpdate: state.forceUpdate,
            hasInput: !!state.input,
            hasMeaningfulInput,
            hasHydeDocument: !!existingHydeDoc,
          });

          return {
            profile: profile || undefined,
            hydeDescription: existingHydeDoc?.hydeText ?? undefined,
            needsProfileGeneration,
            needsProfileEmbedding,
            needsHydeGeneration,
            needsHydeEmbedding,
            needsUserInfo,
            missingUserInfo
          };
        } catch (error) {
          logger.error("Failed to load profile", {
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            profile: undefined,
            error: "Failed to load profile from database"
          };
        }
      });
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Scrape
    // Scrapes data from web if input is not provided
    // ─────────────────────────────────────────────────────────
    const scrapeNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.scrape", async () => {
        if (state.input && isMeaningfulProfileInput(state.input)) {
          logger.verbose("Meaningful input already provided - skipping scrape");
          return {};
        }

        logger.verbose("Starting web scrape...", {
          userId: state.userId
        });

        try {
          // Fetch user details to construct objective for web scraping
          const user = await this.database.getUser(state.userId);

          if (!user) {
            logger.error("User not found", { userId: state.userId });
            return {
              error: `User not found: ${state.userId}`
            };
          }

          // Build scraping objective from available user information
          // Priority: social links (most reliable) > name + location > email
          const socialParts: string[] = [];
          const socials = await this.database.getUserSocials(state.userId);
          for (const s of socials) {
            switch (s.label) {
              case 'twitter': socialParts.push(`X/Twitter: ${s.value}`); break;
              case 'linkedin': socialParts.push(`LinkedIn: ${s.value}`); break;
              case 'github': socialParts.push(`GitHub: ${s.value}`); break;
              case 'telegram': socialParts.push(`Telegram: ${s.value}`); break;
              default: socialParts.push(`Website: ${s.value}`); break;
            }
          }

          // Construct objective based on what we have
          let objective = `Find information about ${user.name || 'this person'}`;

          if (user.location) {
            objective += ` located in ${user.location}`;
          }

          objective += '.\n\n';

          if (socialParts.length > 0) {
            objective += `Their social profiles:\n${socialParts.join('\n')}\n\n`;
            objective += 'Use these links to find accurate information about their professional background, skills, and interests.';
          } else if (user.email) {
            objective += `Their email: ${user.email}\n\n`;
            objective += 'Search for professional information, skills, and background about this person.';
          } else {
            objective += 'Search for professional information and background about this person.';
          }

          logger.verbose("Constructed scraping objective", {
            hasSocials: socialParts.length > 0,
            hasLocation: !!user.location,
            objectivePreview: objective.substring(0, 100)
          });

          const scrapedData = await this.scraper.scrape(objective);

          logger.verbose("✅ Scrape complete", {
            dataLength: scrapedData?.length || 0
          });

          return {
            objective,
            input: scrapedData,
            operationsPerformed: { scraped: true }
          };
        } catch (error) {
          logger.error("Scrape failed", {
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            error: "Web scrape failed"
          };
        }
      });
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Auto-Generate (Parallel Chat API enrichment)
    // Calls enrichUserProfile to get a structured profile directly.
    // On success, sets prePopulatedProfile (skips LLM generation).
    // On failure, falls back to basic user info for LLM generation.
    // Used in 'generate' mode only.
    // ─────────────────────────────────────────────────────────
    const autoGenerateNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.autoGenerate", async () => {
        logger.verbose("Starting auto-generate via Chat API enrichment", {
          userId: state.userId,
        });

        try {
          const user = await this.database.getUser(state.userId);
          if (!user) {
            logger.error("User not found for auto-generate", { userId: state.userId });
            return { error: `User not found: ${state.userId}` };
          }

          const socials = await this.database.getUserSocials(state.userId);
          const enrichmentSocials = socialsToEnrichmentRequest(socials);
          const request = {
            name: user.name || undefined,
            email: user.email || undefined,
            linkedin: enrichmentSocials.linkedin || undefined,
            twitter: enrichmentSocials.twitter || undefined,
            github: enrichmentSocials.github || undefined,
            telegram: enrichmentSocials.telegram || undefined,
            websites: enrichmentSocials.websites?.length ? enrichmentSocials.websites : undefined,
          };

          const buildBasicInfo = () => {
            const parts = [
              user.name ? `Name: ${user.name}` : '',
              user.email ? `Email: ${user.email}` : '',
              user.location ? `Location: ${user.location}` : '',
              user.intro ? `Bio: ${user.intro}` : '',
            ].filter(Boolean).join('\n');
            return parts || "No information available";
          };

          if (!this.enricher) {
            logger.warn("No enricher configured — falling back to basic info", { userId: state.userId });
            return {
              input: buildBasicInfo(),
              needsUserInfo: false,
              needsProfileGeneration: true,
              operationsPerformed: { scraped: true },
            };
          }

          try {
            const enrichment = await this.enricher.enrichUserProfile(request);

            if (enrichment && !enrichment.isHuman) {
              logger.info("Enrichment detected non-human entity, soft-deleting ghost", { userId: state.userId });
              await this.database.softDeleteGhost(state.userId);
              return { error: "Non-human entity detected" };
            }

            const hasMeaningfulEnrichment = !!enrichment &&
              enrichment.confidentMatch &&
              (
                enrichment.identity.bio.trim().length > 0 ||
                enrichment.narrative.context.trim().length > 0 ||
                enrichment.attributes.skills.length > 0 ||
                enrichment.attributes.interests.length > 0
              );

            if (hasMeaningfulEnrichment) {
              if (user.isGhost && !isEnrichedNameMeaningful(user.email || '', enrichment!.identity.name || '')) {
                logger.info("Enrichment has content but no real name for ghost, soft-deleting", { userId: state.userId });
                await this.database.softDeleteGhost(state.userId);
                return { error: "No real name found for ghost user" };
              }

              logger.verbose("Chat API enrichment succeeded", {
                userId: state.userId,
                skillsCount: enrichment!.attributes.skills.length,
                interestsCount: enrichment!.attributes.interests.length,
              });

              // Update user record with enriched data
              const updatePayload: {
                name?: string;
                intro?: string;
                location?: string;
              } = {};
              const enrichedName = enrichment!.identity.name?.trim();
              if (
                enrichedName &&
                shouldEnrichGhostDisplayNameFromParallel(
                  { isGhost: !!user.isGhost, name: user.name ?? '', email: user.email ?? '' },
                  enrichedName,
                )
              ) {
                updatePayload.name = enrichedName;
              }
              if (enrichment!.identity.bio?.trim()) updatePayload.intro = enrichment!.identity.bio.trim();
              if (enrichment!.identity.location?.trim()) updatePayload.location = enrichment!.identity.location.trim();

              const enrichedSocials: { label: string; value: string }[] = [];
              if (enrichment!.socials.twitter) enrichedSocials.push({ label: 'twitter', value: enrichment!.socials.twitter });
              if (enrichment!.socials.linkedin) enrichedSocials.push({ label: 'linkedin', value: enrichment!.socials.linkedin });
              if (enrichment!.socials.github) enrichedSocials.push({ label: 'github', value: enrichment!.socials.github });
              if (enrichment!.socials.telegram) enrichedSocials.push({ label: 'telegram', value: enrichment!.socials.telegram });
              if (enrichment!.socials.websites?.length) {
                for (const w of enrichment!.socials.websites) enrichedSocials.push({ label: 'custom', value: w });
              }
              if (enrichedSocials.length > 0) {
                const existingSocials = await this.database.getUserSocials(state.userId);
                const enrichedLabels = new Set(enrichedSocials.map(s => s.label));
                const kept = existingSocials
                  .filter(s => !enrichedLabels.has(s.label) || s.label === 'custom')
                  .map(s => ({ label: s.label, value: s.value }));
                const merged = enrichedLabels.has('custom')
                  ? [...kept.filter(s => s.label !== 'custom'), ...enrichedSocials]
                  : [...kept, ...enrichedSocials];
                await this.database.setUserSocials(state.userId, merged);
              }

              if (Object.keys(updatePayload).length > 0) {
                await this.database.updateUser(state.userId, updatePayload);
              }

              // Post-enrichment dedup: check if this ghost matches an existing user
              if (user.isGhost) {
                const currentSocials = await this.database.getUserSocials(state.userId);
                const duplicate = await this.database.findDuplicateUser(state.userId, currentSocials);
                if (duplicate) {
                  logger.info("Post-enrichment dedup: merging ghost into existing user", {
                    ghostId: state.userId,
                    targetId: duplicate.id,
                  });
                  await this.database.mergeGhostUser(state.userId, duplicate.id);
                  return { error: `Merged as duplicate of user ${duplicate.id}` };
                }
              }

              return {
                prePopulatedProfile: {
                  identity: enrichment!.identity,
                  narrative: enrichment!.narrative,
                  attributes: enrichment!.attributes,
                },
                needsUserInfo: false,
                operationsPerformed: { scraped: true },
              };
            }

            if (user.isGhost) {
              logger.info("Low-confidence enrichment for ghost, soft-deleting", { userId: state.userId });
              await this.database.softDeleteGhost(state.userId);
              return { error: "Enrichment not confident for ghost user" };
            }
            logger.warn("Chat API returned low-signal enrichment, falling back to basic info", { userId: state.userId });
          } catch (enrichErr) {
            if (user.isGhost) {
              logger.info("Enrichment failed for ghost, soft-deleting", { userId: state.userId });
              await this.database.softDeleteGhost(state.userId);
              return { error: "Enrichment failed for ghost user" };
            }
            logger.warn("Chat API enrichment failed, falling back to basic info", {
              userId: state.userId,
              error: enrichErr instanceof Error ? enrichErr.message : String(enrichErr),
            });
          }

          return {
            input: buildBasicInfo(),
            needsUserInfo: false,
            needsProfileGeneration: true,
            operationsPerformed: { scraped: true },
          };
        } catch (err) {
          logger.error("Auto-generate failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          return { error: `Auto-generate failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      });
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Use Pre-Populated Profile
    // Converts pre-populated profile (from external enrichment like Parallel Chat API)
    // into the format expected by the embedding step, skipping LLM generation.
    // ─────────────────────────────────────────────────────────
    const usePrePopulatedProfileNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.usePrePopulatedProfile", async () => {
        if (!state.prePopulatedProfile) {
          logger.error("No pre-populated profile provided");
          return { error: "Pre-populated profile required" };
        }

        logger.verbose("Using pre-populated profile from external enrichment", {
          name: state.prePopulatedProfile.identity.name,
          skillsCount: state.prePopulatedProfile.attributes.skills.length,
          interestsCount: state.prePopulatedProfile.attributes.interests.length,
        });

        return {
          profile: {
            ...state.prePopulatedProfile,
            userId: state.userId,
            embedding: [] as number[] | number[][],
          },
          needsHydeGeneration: true,
          operationsPerformed: { generatedProfile: true },
        };
      });
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Generate Profile
    // Generates profile from input using ProfileGenerator agent.
    // If updating existing profile, merges new information intelligently.
    // ─────────────────────────────────────────────────────────
    const generateProfileNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.generateProfile", async () => {
        if (!state.input) {
          logger.error("No input provided for profile generation");
          return {
            error: "Input required for profile generation"
          };
        }

        logger.verbose("Starting profile generation...", {
          hasExistingProfile: !!state.profile,
          isUpdate: state.forceUpdate,
          inputLength: state.input.length
        });

        const agentTimingsAccum: DebugMetaAgent[] = [];

        try {
          // If updating existing profile, include it in the input for context
          let inputWithContext = state.input;
          if (state.profile && state.forceUpdate) {
            inputWithContext = `EXISTING PROFILE:\n${JSON.stringify(state.profile, null, 2)}\n\nUSER REQUEST:\n${state.input}\n\nApply the user's request to the existing profile. Preserve existing data unless the user asks to change or remove it. You may add, update, or remove skills and interests as requested. Output the full updated profile.`;
            logger.verbose("Merging with existing profile");
          }

          const _traceEmitterProfileGen = requestContext.getStore()?.traceEmitter;
          const profileGeneratorStart = Date.now();
          _traceEmitterProfileGen?.({ type: "agent_start", name: "profile-generator" });
          const result = await profileGenerator.invoke(inputWithContext);
          agentTimingsAccum.push({ name: 'profile.generator', durationMs: Date.now() - profileGeneratorStart });
          _traceEmitterProfileGen?.({ type: "agent_end", name: "profile-generator", durationMs: Date.now() - profileGeneratorStart, summary: `Generated profile for ${result.output.identity.name || "user"}` });

          logger.verbose("✅ Profile generated successfully", {
            name: result.output.identity.name,
            skillsCount: result.output.attributes.skills.length,
            interestsCount: result.output.attributes.interests.length
          });

          return {
            profile: {
              ...result.output,
              userId: state.userId,
              embedding: [] as number[] | number[][]
            },
            // Mark that hyde needs regeneration since profile was updated
            needsHydeGeneration: true,
            agentTimings: agentTimingsAccum,
            operationsPerformed: { generatedProfile: true }
          };
        } catch (error) {
          logger.error("Profile generation failed", {
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            error: "Profile generation failed",
            agentTimings: agentTimingsAccum
          };
        }
      });
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Embed & Save Profile
    // Generates embedding for profile and saves to DB
    // ─────────────────────────────────────────────────────────
    const embedSaveProfileNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.embedSaveProfile", async () => {
        if (!state.profile || !state.profile.identity) {
          logger.error("Profile or identity missing in embed step");
          return {
            error: "Profile missing in embed step"
          };
        }

        logger.verbose("Starting profile embedding...", {
          userId: state.userId
        });

        try {
          const profile = { ...state.profile };
          const textToEmbed = [
            '# Identity',
            '## Name', profile.identity?.name ?? '',
            '## Bio', profile.identity?.bio ?? '',
            '## Location', profile.identity?.location ?? '',
            '# Narrative',
            '## Context', profile.narrative?.context ?? '',
            '# Attributes',
            '## Interests', (profile.attributes?.interests ?? []).join(', '),
            '## Skills', (profile.attributes?.skills ?? []).join(', ')
          ].join('\n');

          logger.verbose("Generating embedding...", {
            textLength: textToEmbed.length
          });

          const embedding = await this.embedder.generate(textToEmbed);
          profile.embedding = embedding;

          logger.verbose("Saving profile to DB...", {
            userId: state.userId,
            embeddingDimensions: Array.isArray(embedding[0]) ? embedding[0].length : embedding.length
          });

          await this.database.saveProfile(state.userId, profile);

          logger.verbose("✅ Profile saved successfully");

          return {
            profile,
            operationsPerformed: { embeddedProfile: true }
          };
        } catch (error) {
          logger.error("Failed to embed/save profile", {
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            error: "Failed to embed/save profile"
          };
        }
      });
    };


    // ─────────────────────────────────────────────────────────
    // NODE: Generate HyDE
    // Generates Hypothetical Document Embedding description for profile matching
    // ─────────────────────────────────────────────────────────
    const generateHydeNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.generateHyde", async () => {
        if (!state.profile || !state.profile.identity) {
          logger.error("Profile or identity missing for HyDE generation");
          return {
            error: "Profile missing for HyDE generation"
          };
        }

        logger.verbose("Starting HyDE generation...", {
          userId: state.userId,
          profileName: state.profile.identity?.name
        });

        const agentTimingsAccum: DebugMetaAgent[] = [];

        try {
          const profileString = JSON.stringify(state.profile, null, 2);
          const _traceEmitterHydeGen = requestContext.getStore()?.traceEmitter;
          const hydeGeneratorStart = Date.now();
          _traceEmitterHydeGen?.({ type: "agent_start", name: "hyde-generator" });
          const result = await hydeGenerator.invoke(profileString);
          agentTimingsAccum.push({ name: 'hyde.generator', durationMs: Date.now() - hydeGeneratorStart });
          _traceEmitterHydeGen?.({ type: "agent_end", name: "hyde-generator", durationMs: Date.now() - hydeGeneratorStart, summary: `Generated HyDE for ${state.profile?.identity?.name || "profile"}` });

          logger.verbose("✅ HyDE generated successfully", {
            descriptionLength: result.textToEmbed.length
          });

          return {
            hydeDescription: result.textToEmbed,
            agentTimings: agentTimingsAccum,
            operationsPerformed: { generatedHyde: true }
          };
        } catch (error) {
          logger.error("HyDE generation failed", {
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            error: "HyDE generation failed"
          };
        }
      });
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Embed & Save HyDE
    // Generates embedding for HyDE description and saves to DB
    // ─────────────────────────────────────────────────────────
    const embedSaveHydeNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.embedSaveHyde", async () => {
        if (!state.hydeDescription) {
          logger.error("HyDE description missing");
          return {
            error: "HyDE description missing"
          };
        }

        logger.verbose("Starting HyDE embedding...", {
          userId: state.userId,
          descriptionLength: state.hydeDescription.length
        });

        try {
          const hydeEmbedding = await this.embedder.generate(state.hydeDescription);

          // Normalize embedding if needed (Adapters usually handle this, but to be sure)
          const flatHydeEmbedding = Array.isArray(hydeEmbedding[0])
            ? (hydeEmbedding as number[][])[0]
            : (hydeEmbedding as number[]);

          logger.verbose("Saving HyDE to hyde_documents...", {
            userId: state.userId,
            embeddingDimensions: flatHydeEmbedding.length
          });

          await this.database.saveHydeDocument({
            sourceType: 'profile',
            sourceId: state.userId,
            strategy: 'mirror',
            targetCorpus: 'profiles',
            hydeText: state.hydeDescription,
            hydeEmbedding: flatHydeEmbedding,
          });

          return {
            operationsPerformed: { embeddedHyde: true }
          };
        } catch (error) {
          logger.error("Failed to embed/save HyDE", {
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            error: "Failed to embed/save HyDE"
          };
        }
      });
    };

    // ─────────────────────────────────────────────────────────
    // ROUTING CONDITIONS
    // Smart conditional routing based on operation mode and missing components
    // ─────────────────────────────────────────────────────────

    /**
     * Route from check_state to next step based on operation mode and detected needs.
     */
    const checkStateCondition = (state: typeof ProfileGraphState.State): string => {
      // Query mode: Return immediately (fast path)
      if (state.operationMode === 'query') {
        logger.verbose("Query mode - ending (fast path)");
        return END;
      }

      // Pre-populated profile from external enrichment (e.g. Parallel Chat API)
      // Skip profile generation, go directly to embedding
      if (state.prePopulatedProfile) {
        logger.verbose("Pre-populated profile detected - skipping generation, routing to embed");
        return "use_prepopulated_profile";
      }

      // Generate mode: use enrichUserProfile Chat API to auto-generate
      if (state.operationMode === 'generate') {
        logger.verbose("Generate mode - routing to auto_generate");
        return "auto_generate";
      }

      // Check if user information is insufficient for scraping
      // Return early so chat graph can request the missing information
      if (state.needsUserInfo) {
        logger.verbose("⚠️ Insufficient user info - requesting from user", {
          missingInfo: state.missingUserInfo
        });
        return END;
      }

      // Write mode: Check what needs generation
      if (state.needsProfileGeneration) {
        // Only use provided input if it's meaningful (not just "Yes" / confirmation)
        if (state.input && isMeaningfulProfileInput(state.input)) {
          logger.verbose("Profile generation needed with meaningful input provided");
          return "generate_profile";
        } else {
          logger.verbose("Profile generation needed - scraping first (no meaningful input)");
          return "scrape";
        }
      }

      // Profile exists but missing embedding
      if (state.needsProfileEmbedding) {
        logger.verbose("Profile embedding needed");
        return "embed_save_profile";
      }

      // Profile and embedding exist, check hyde
      if (state.needsHydeGeneration) {
        logger.verbose("HyDE generation needed");
        return "generate_hyde";
      }

      // Hyde exists but missing embedding
      if (state.needsHydeEmbedding) {
        logger.verbose("HyDE embedding needed");
        return "embed_save_hyde";
      }

      // Everything exists and is up to date
      logger.verbose("All components exist - ending");
      return END;
    };

    /**
     * Route after profile embedding to check if hyde needs generation.
     */
    const afterProfileEmbeddingCondition = (state: typeof ProfileGraphState.State): string => {
      // If profile was just generated/updated, regenerate hyde
      if (state.needsHydeGeneration || state.forceUpdate) {
        logger.verbose("Profile updated - regenerating HyDE");
        return "generate_hyde";
      }

      // Check if hyde embedding is missing
      if (state.needsHydeEmbedding) {
        logger.verbose("HyDE embedding needed");
        return "embed_save_hyde";
      }

      logger.verbose("Profile complete - ending");
      return END;
    };

    /**
     * Route after hyde generation to embedding step.
     * Always embed after generating hyde.
     */
    const afterHydeGenerationCondition = (state: typeof ProfileGraphState.State): string => {
      logger.verbose("HyDE generated - proceeding to embedding");
      return "embed_save_hyde";
    };


    // ─────────────────────────────────────────────────────────
    // GRAPH ASSEMBLY
    // Conditional flow based on operation mode and detected needs
    // ─────────────────────────────────────────────────────────

    const workflow = new StateGraph(ProfileGraphState)
      // Add all nodes
      .addNode("check_state", checkStateNode)
      .addNode("scrape", scrapeNode)
      .addNode("auto_generate", autoGenerateNode)
      .addNode("use_prepopulated_profile", usePrePopulatedProfileNode)
      .addNode("generate_profile", generateProfileNode)
      .addNode("embed_save_profile", embedSaveProfileNode)
      .addNode("generate_hyde", generateHydeNode)
      .addNode("embed_save_hyde", embedSaveHydeNode)

      // Start with state check
      .addEdge(START, "check_state")

      // Conditional routing from check_state
      .addConditionalEdges(
        "check_state",
        checkStateCondition,
        {
          use_prepopulated_profile: "use_prepopulated_profile", // Pre-populated profile -> skip generation
          auto_generate: "auto_generate",       // Generate mode -> Chat API enrichment
          scrape: "scrape",                     // Need profile, no input -> scrape first
          generate_profile: "generate_profile", // Need profile, have input -> generate
          embed_save_profile: "embed_save_profile", // Have profile, need embedding
          generate_hyde: "generate_hyde",       // Have profile+embedding, need hyde
          embed_save_hyde: "embed_save_hyde",   // Have hyde, need embedding
          [END]: END                            // Query mode or everything exists
        }
      )

      // Pre-populated profile feeds into embedding (skips generation)
      .addEdge("use_prepopulated_profile", "embed_save_profile")

      // Auto-generate routes based on enrichment result
      .addConditionalEdges(
        "auto_generate",
        (state: typeof ProfileGraphState.State) => {
          if (state.prePopulatedProfile) {
            logger.verbose("Enrichment succeeded — using pre-populated profile");
            return "use_prepopulated_profile";
          }
          if (state.input) {
            logger.verbose("Enrichment fell back — using basic info for LLM generation");
            return "generate_profile";
          }
          logger.verbose("Enrichment ended without data (ghost soft-deleted or error) — done");
          return END;
        },
        {
          use_prepopulated_profile: "use_prepopulated_profile",
          generate_profile: "generate_profile",
          [END]: END,
        }
      )

      // Scrape -> Generate profile (linear)
      .addEdge("scrape", "generate_profile")
      
      // Generate profile -> Embed profile (linear)
      .addEdge("generate_profile", "embed_save_profile")

      // After profile embedding, check if hyde needs generation
      .addConditionalEdges(
        "embed_save_profile",
        afterProfileEmbeddingCondition,
        {
          generate_hyde: "generate_hyde",     // Profile updated -> regenerate hyde
          embed_save_hyde: "embed_save_hyde", // Only hyde embedding missing
          [END]: END                          // Everything complete
        }
      )

      // After hyde generation, always embed it
      .addConditionalEdges(
        "generate_hyde",
        afterHydeGenerationCondition,
        {
          embed_save_hyde: "embed_save_hyde"
        }
      )

      // Hyde embedding -> END (linear)
      .addEdge("embed_save_hyde", END);

    logger.verbose("Graph built successfully");
    return workflow.compile();
  }
}
