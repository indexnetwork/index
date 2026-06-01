import { StateGraph, START, END } from "@langchain/langgraph";
import { ProfileGraphState } from "./profile.state.js";
import { ProfileGenerator, ProfileDocument } from "./profile.generator.js";
import { ProfileGraphDatabase, PremiseRecord } from "../shared/interfaces/database.interface.js";
import { Scraper } from "../shared/interfaces/scraper.interface.js";
import type { ProfileEnricher } from "../shared/interfaces/enrichment.interface.js";
import { shouldEnrichGhostDisplayNameFromParallel, isEnrichedNameMeaningful } from "./profile.enricher.js";
import { socialsToEnrichmentRequest } from "../shared/utils/social-label.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { QuestionerEnqueueFn } from "../questioner/questioner.types.js";
import { timed } from "../shared/observability/performance.js";
import { requestContext } from "../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../chat/chat-streaming.types.js";
import { PremiseDecomposer } from "../premise/premise.decomposer.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

/**
 * Compiled premise graph interface. Matches the invoke signature of a compiled LangGraph.
 * Accepted as an optional dependency so write-mode input can be decomposed into premises.
 */
export interface CompiledPremiseGraph {
  invoke(input: {
    userId: string;
    assertionText: string;
    tier: 'assertive' | 'contextual';
    operationMode: 'create';
  }): Promise<{
    premise?: { id: string } | undefined;
    error?: string | undefined;
  }>;
}

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
 * Factory class to build and compile the Profile Generation Graph.
 *
 * Flow:
 * 1. check_state - Detect whether profile needs generation
 * 2. Conditional routing based on operation mode and missing components:
 *    - Query mode: Return immediately (fast path)
 *    - Write mode: Generate only what's needed
 * 3. Profile generation (if needed)
 * 4. Save profile to DB
 *
 * Key Features:
 * - Read/Write separation (query vs write)
 * - Conditional generation (skip generation if profile already exists)
 */
export class ProfileGraphFactory {
  constructor(
    private database: ProfileGraphDatabase,
    private scraper: Scraper,
    private enricher?: ProfileEnricher,
    private questionerEnqueue?: QuestionerEnqueueFn,
    private premiseGraph?: CompiledPremiseGraph,
  ) { }

  public createGraph() {
    const profileGenerator = new ProfileGenerator();
    const premiseDecomposer = new PremiseDecomposer();

    // ─────────────────────────────────────────────────────────
    // NODE: Check State
    // Loads existing profile from DB and detects what needs generation:
    // - Profile missing
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
            needsUserInfo,
            missingUserInfo,
            forceUpdate: state.forceUpdate,
            hasInput: !!state.input,
            hasMeaningfulInput,
          });

          return {
            profile: profile || undefined,
            needsProfileGeneration,
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
    // Calls enrichUserProfile to get structured data, then builds a
    // text blob as input for the decompose → aggregate → generate
    // pipeline. This ensures enriched users get premises with
    // embeddings, making them discoverable via premise-to-premise
    // matching.
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

              // Build a text blob from the enrichment result so it flows
              // through premise decomposition (when available) rather than
              // bypassing premises via prePopulatedProfile.
              const enrichmentParts = [
                enrichment!.identity.name ? `My name is ${enrichment!.identity.name}.` : '',
                enrichment!.identity.location ? `I am based in ${enrichment!.identity.location}.` : '',
                enrichment!.identity.bio || '',
                enrichment!.narrative.context || '',
                enrichment!.attributes.skills.length ? `My skills include ${enrichment!.attributes.skills.join(', ')}.` : '',
                enrichment!.attributes.interests.length ? `My interests include ${enrichment!.attributes.interests.join(', ')}.` : '',
              ].filter(Boolean).join('\n');

              return {
                input: enrichmentParts,
                needsUserInfo: false,
                needsProfileGeneration: true,
                forceUpdate: true,
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
            if (state.isAggregate) {
              inputWithContext = `EXISTING PROFILE:\n${JSON.stringify(state.profile, null, 2)}\n\nPREMISE SYNTHESIS:\n${state.input}\n\nRegenerate the profile by synthesizing the premises above. Use the existing profile as context for continuity, but the premises are the authoritative source. Output the full updated profile.`;
              logger.verbose("Aggregate synthesis with existing profile context");
            } else {
              inputWithContext = `EXISTING PROFILE:\n${JSON.stringify(state.profile, null, 2)}\n\nUSER REQUEST:\n${state.input}\n\nApply the user's request to the existing profile. Preserve existing data unless the user asks to change or remove it. You may add, update, or remove skills and interests as requested. Output the full updated profile.`;
              logger.verbose("Merging with existing profile");
            }
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
            },
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
    // NODE: Save Profile
    // Saves the generated profile to DB (no embedding)
    // ─────────────────────────────────────────────────────────
    const saveProfileNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.saveProfile", async () => {
        if (!state.profile || !state.profile.identity) {
          logger.error("Profile or identity missing in save step");
          return {
            error: "Profile missing in save step"
          };
        }

        logger.verbose("Saving profile to DB...", {
          userId: state.userId
        });

        try {
          const profile = { ...state.profile };

          await this.database.saveProfile(state.userId, profile);

          logger.verbose("✅ Profile saved successfully");

          // Fetch active premises so the questioner can see what's already covered
          let existingPremises: string[] = [];
          try {
            const activePremises = await this.database.getPremisesForUser(state.userId, 'ACTIVE');
            existingPremises = activePremises.map(p => p.assertion.text);
            logger.verbose("Fetched active premises for questioner context", {
              userId: state.userId,
              count: existingPremises.length,
            });
          } catch (premiseErr) {
            logger.error("Failed to fetch premises for questioner context — continuing with empty list", {
              userId: state.userId,
              error: premiseErr instanceof Error ? premiseErr.message : String(premiseErr),
            });
          }

          // Compute profile gaps from missing fields
          const gaps: string[] = [];
          if (!profile.identity?.location) gaps.push('location');
          if (!profile.attributes?.skills?.length) gaps.push('skills');
          if (!profile.attributes?.interests?.length) gaps.push('interests');
          if (!profile.narrative?.context) gaps.push('current work');

          if (gaps.length > 0 && this.questionerEnqueue) {
            this.questionerEnqueue({
              mode: 'profile',
              userId: state.userId,
              sourceType: 'profile',
              sourceId: state.userId,
              context: {
                userProfile: {
                  name: profile.identity?.name,
                  bio: profile.identity?.bio,
                  location: profile.identity?.location,
                  skills: profile.attributes?.skills,
                  interests: profile.attributes?.interests,
                },
                gaps,
                existingPremises,
              },
            }).catch((err) =>
              logger.error('Failed to enqueue profile question generation', { userId: state.userId, error: err })
            );
          }

          return {
            profile,
            operationsPerformed: { savedProfile: true }
          };
        } catch (error) {
          logger.error("Failed to save profile", {
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            error: "Failed to save profile"
          };
        }
      });
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Aggregate Profile
    // Fetches the user's active premises and synthesizes them into profile input.
    // Sets state.input and flags so the existing generate_profile pipeline runs.
    // ─────────────────────────────────────────────────────────
    const aggregateProfileNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.aggregateProfile", async () => {
        logger.verbose("Aggregating profile from premises...", { userId: state.userId });

        const premises: PremiseRecord[] = await this.database.getPremisesForUser(state.userId, 'ACTIVE');

        if (premises.length === 0) {
          logger.verbose("No active premises found — skipping aggregate");
          return { operationMode: 'query' as const };
        }

        const premiseTexts = premises.map(p => p.assertion.text);
        const aggregateInput = `The following are self-descriptions (premises) the user has asserted about themselves:\n\n${premiseTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nSynthesize these into a cohesive profile.`;

        logger.verbose(`Aggregated ${premises.length} premise(s) into profile input`);

        return {
          input: aggregateInput,
          needsProfileGeneration: true,
          forceUpdate: true,
          isAggregate: true,
        };
      });
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Decompose Premises
    // Decomposes free-text input (chat or scraped) into individual premises,
    // creates each via the premise graph, then routes to aggregate_profile
    // to synthesize the profile from all active premises.
    // ─────────────────────────────────────────────────────────
    const decomposePremisesNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.decomposePremises", async () => {
        if (!state.input) {
          logger.error("No input for premise decomposition");
          return { error: "Input required for premise decomposition" };
        }

        if (!this.premiseGraph) {
          // Fallback: if no premise graph is available, skip decomposition
          // and route directly to profile generation (legacy behavior)
          logger.warn("No premise graph injected — falling back to direct profile generation");
          return {
            needsProfileGeneration: true,
            forceUpdate: true,
          };
        }

        logger.verbose("Decomposing input into premises...", {
          userId: state.userId,
          inputLength: state.input.length,
        });

        const agentTimingsAccum: DebugMetaAgent[] = [];

        try {
          const _traceEmitter = requestContext.getStore()?.traceEmitter;

          const decomposeStart = Date.now();
          _traceEmitter?.({ type: "agent_start", name: "premise-decomposer" });
          const result = await premiseDecomposer.invoke(state.input);
          const decomposeMs = Date.now() - decomposeStart;
          agentTimingsAccum.push({ name: "premise.decomposer", durationMs: decomposeMs });
          _traceEmitter?.({
            type: "agent_end",
            name: "premise-decomposer",
            durationMs: decomposeMs,
            summary: `Decomposed into ${result.premises.length} premise(s)`,
          });

          if (result.premises.length === 0) {
            logger.verbose("No premises extracted — skipping decomposition");
            // No premises found; fall through to aggregate which will
            // synthesize from any existing premises, or to generate_profile
            // if needsProfileGeneration is still set from check_state
            return {
              operationMode: 'aggregate' as const,
              agentTimings: agentTimingsAccum,
            };
          }

          logger.verbose(`Creating ${result.premises.length} premise(s) via premise graph`, {
            userId: state.userId,
          });

          let created = 0;
          for (const p of result.premises) {
            try {
              const premiseResult = await invokeWithAbortSignal(this.premiseGraph, {
                userId: state.userId,
                assertionText: p.text,
                tier: p.tier,
                operationMode: 'create',
              });

              if (premiseResult.premise) {
                created++;
              } else if (premiseResult.error) {
                logger.warn("Premise creation failed", {
                  text: p.text.substring(0, 60),
                  error: premiseResult.error,
                });
              }
            } catch (err) {
              logger.warn("Premise creation threw", {
                text: p.text.substring(0, 60),
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          logger.verbose(`Created ${created}/${result.premises.length} premise(s)`, {
            userId: state.userId,
          });

          // Route to aggregate mode to rebuild the profile from all active premises
          return {
            operationMode: 'aggregate' as const,
            agentTimings: agentTimingsAccum,
            operationsPerformed: { decomposedPremises: true },
          };
        } catch (err) {
          logger.error("Premise decomposition failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          // Fallback: route to direct profile generation
          return {
            needsProfileGeneration: true,
            forceUpdate: true,
            agentTimings: agentTimingsAccum,
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

      // Aggregate mode: Synthesize profile from active premises
      if (state.operationMode === 'aggregate') {
        logger.verbose("Aggregate mode - synthesizing profile from premises");
        return "aggregate_profile";
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
          // Route through premise decomposition when a premise graph is available.
          // The decompose node extracts atomic premises, creates them, then
          // routes to aggregate_profile for profile synthesis.
          if (this.premiseGraph) {
            logger.verbose("Profile generation needed — decomposing input into premises");
            return "decompose_premises";
          }
          logger.verbose("Profile generation needed with meaningful input provided");
          return "generate_profile";
        } else {
          logger.verbose("Profile generation needed - scraping first (no meaningful input)");
          return "scrape";
        }
      }

      // Everything exists and is up to date
      logger.verbose("All components exist - ending");
      return END;
    };


    // ─────────────────────────────────────────────────────────
    // GRAPH ASSEMBLY
    // Conditional flow based on operation mode and detected needs
    // ─────────────────────────────────────────────────────────

    const workflow = new StateGraph(ProfileGraphState)
      // Add all nodes
      .addNode("check_state", checkStateNode)
      .addNode("scrape", scrapeNode)
      .addNode("decompose_premises", decomposePremisesNode)
      .addNode("auto_generate", autoGenerateNode)
      .addNode("aggregate_profile", aggregateProfileNode)
      .addNode("generate_profile", generateProfileNode)
      .addNode("save_profile", saveProfileNode)

      // Start with state check
      .addEdge(START, "check_state")

      // Conditional routing from check_state
      .addConditionalEdges(
        "check_state",
        checkStateCondition,
        {
          auto_generate: "auto_generate",       // Generate mode -> Chat API enrichment
          aggregate_profile: "aggregate_profile", // Aggregate mode -> synthesize from premises
          decompose_premises: "decompose_premises", // Write mode + input + premise graph -> decompose first
          scrape: "scrape",                     // Need profile, no input -> scrape first
          generate_profile: "generate_profile", // Need profile, have input -> generate (legacy, no premise graph)
          [END]: END                            // Query mode or everything exists
        }
      )

      // Decompose premises routes to aggregate (normal) or generate_profile (fallback)
      .addConditionalEdges(
        "decompose_premises",
        (state: typeof ProfileGraphState.State) => {
          if (state.operationMode === 'aggregate') return "aggregate_profile";
          // Fallback when decomposition failed (no premise graph or error)
          if (state.needsProfileGeneration) return "generate_profile";
          return "aggregate_profile";
        },
        {
          aggregate_profile: "aggregate_profile",
          generate_profile: "generate_profile",
        },
      )

      // Aggregate profile: generate if premises found, END if none
      .addConditionalEdges(
        "aggregate_profile",
        (state: typeof ProfileGraphState.State) => {
          if (state.needsProfileGeneration) return "generate_profile";
          logger.verbose("Aggregate mode — no premises, ending");
          return END;
        },
        { generate_profile: "generate_profile", [END]: END },
      )

      // Auto-generate routes to decompose_premises (when premise graph
      // available) or generate_profile (legacy, no premise graph)
      .addConditionalEdges(
        "auto_generate",
        (state: typeof ProfileGraphState.State) => {
          if (state.input && this.premiseGraph) {
            logger.verbose("Enrichment produced input — routing to premise decomposition");
            return "decompose_premises";
          }
          if (state.input) {
            logger.verbose("Enrichment produced input — routing to LLM generation (no premise graph)");
            return "generate_profile";
          }
          logger.verbose("Enrichment ended without data (ghost soft-deleted or error) — done");
          return END;
        },
        {
          decompose_premises: "decompose_premises",
          generate_profile: "generate_profile",
          [END]: END,
        }
      )

      // Scrape -> decompose_premises (when premise graph available) or generate_profile (legacy)
      .addConditionalEdges(
        "scrape",
        (_state: typeof ProfileGraphState.State) => {
          if (this.premiseGraph) return "decompose_premises";
          return "generate_profile";
        },
        {
          decompose_premises: "decompose_premises",
          generate_profile: "generate_profile",
        },
      )

      // Generate profile -> Save profile (linear)
      .addEdge("generate_profile", "save_profile")

      // Save profile -> END (linear)
      .addEdge("save_profile", END);

    logger.verbose("Graph built successfully");
    return workflow.compile();
  }
}
