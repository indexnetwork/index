import { StateGraph, START, END } from "@langchain/langgraph";
import { ProfileGraphState } from "../states/profile.state";
import { ProfileGenerator, ProfileDocument } from "../agents/profile.generator";
import { HydeGenerator } from "../agents/profile.hyde.generator";
import { ProfileGraphDatabase } from "../interfaces/database.interface";
import { Embedder } from "../interfaces/embedder.interface";
import { Scraper } from "../interfaces/scraper.interface";
import { searchUser } from "../../../lib/parallel/parallel";
import { protocolLogger } from "../support/protocol.logger";
import { timed } from "../../performance";

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
    private scraper: Scraper
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
                      name: profile.identity.name,
                      bio: profile.identity.bio,
                      location: profile.identity.location,
                      skills: profile.attributes.skills,
                      interests: profile.attributes.interests,
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

            const hasSocials = !!(user.socials && (
              user.socials.x ||
              user.socials.linkedin ||
              user.socials.github ||
              (user.socials.websites && user.socials.websites.length > 0)
            ));

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
          if (user.socials) {
            if (user.socials.x) socialParts.push(`X/Twitter: ${user.socials.x}`);
            if (user.socials.linkedin) socialParts.push(`LinkedIn: ${user.socials.linkedin}`);
            if (user.socials.github) socialParts.push(`GitHub: ${user.socials.github}`);
            if (user.socials.websites && user.socials.websites.length > 0) {
              user.socials.websites.forEach((url: string) => socialParts.push(`Website: ${url}`));
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
    // NODE: Auto-Generate (Parallels searchUser)
    // Calls Parallels API with structured user data (name, email,
    // socials, websites) to auto-generate profile input.
    // Used in 'generate' mode only.
    // ─────────────────────────────────────────────────────────
    const autoGenerateNode = async (state: typeof ProfileGraphState.State) => {
      return timed("ProfileGraph.autoGenerate", async () => {
        logger.verbose("Starting auto-generate", {
          userId: state.userId,
          hasEnrichmentInput: !!state.enrichmentInput,
        });

        try {
          // If enrichment input was pre-fetched (e.g. by handleEnrichGhost), use it directly
          if (state.enrichmentInput) {
            logger.verbose("Using pre-fetched enrichment input, skipping Parallels search", {
              inputLength: state.enrichmentInput.length,
            });
            return {
              input: state.enrichmentInput,
              needsUserInfo: false,
              needsProfileGeneration: true,
              operationsPerformed: { scraped: true },
            };
          }

          // Load user from DB
          const user = await this.database.getUser(state.userId);
          if (!user) {
            logger.error("User not found for auto-generate", { userId: state.userId });
            return { error: `User not found: ${state.userId}` };
          }

          // Build structured request for searchUser
          const request: {
            name?: string;
            email?: string;
            linkedin?: string;
            twitter?: string;
            github?: string;
            websites?: string[];
          } = {};

          if (user.name) request.name = user.name;
          if (user.email) request.email = user.email;
          if (user.socials?.linkedin) request.linkedin = user.socials.linkedin;
          if (user.socials?.x) request.twitter = user.socials.x;
          if (user.socials?.github) request.github = user.socials.github;
          if (user.socials?.websites && user.socials.websites.length > 0) {
            request.websites = user.socials.websites;
          }

          const hasSocials = !!(request.linkedin || request.twitter || request.github || (request.websites && request.websites.length > 0));
          const hasMeaningfulName = request.name && request.name.trim() !== '' && !request.name.includes('@') && request.name.split(/\s+/).filter(Boolean).length >= 2;

          // Helper: build basic profile input from whatever user info we have
          const buildBasicInfo = () => {
            const parts = [
              user.name ? `Name: ${user.name}` : '',
              user.email ? `Email: ${user.email}` : '',
              user.location ? `Location: ${user.location}` : '',
              user.intro ? `Bio: ${user.intro}` : '',
            ].filter(Boolean).join('\n');
            return parts || "No information available";
          };

          // Try Parallels search if we have enough info for a meaningful lookup
          if (hasSocials || hasMeaningfulName) {
            logger.verbose("Calling Parallels searchUser", {
              hasName: !!request.name,
              hasEmail: !!request.email,
              hasSocials,
            });

            try {
              const searchResult = await searchUser(request);

              const inputParts: string[] = [];
              if (searchResult.results && searchResult.results.length > 0) {
                for (const r of searchResult.results) {
                  if (r.excerpts && r.excerpts.length > 0) {
                    inputParts.push(`Source: ${r.title || r.url}\n${r.excerpts.join('\n')}`);
                  }
                }
              }

              if (inputParts.length > 0) {
                const combinedInput = inputParts.join('\n\n');
                logger.verbose("Auto-generate input ready", {
                  sourceCount: inputParts.length,
                  inputLength: combinedInput.length,
                });
                return {
                  input: combinedInput,
                  needsUserInfo: false,
                  needsProfileGeneration: true,
                  operationsPerformed: { scraped: true },
                };
              }

              logger.warn("Parallels searchUser returned no usable content, falling back to basic info", { userId: state.userId });
            } catch (searchErr) {
              logger.warn("Parallels searchUser failed, falling back to basic info", {
                userId: state.userId,
                error: searchErr instanceof Error ? searchErr.message : String(searchErr),
              });
            }
          } else {
            logger.verbose("Minimal user info — skipping Parallels, generating from name/email", { userId: state.userId });
          }

          // Fall back to basic user info (name, email, etc.)
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

        const agentTimingsAccum: import('../../../types/chat-streaming.types').DebugMetaAgent[] = [];

        try {
          // If updating existing profile, include it in the input for context
          let inputWithContext = state.input;
          if (state.profile && state.forceUpdate) {
            inputWithContext = `EXISTING PROFILE:\n${JSON.stringify(state.profile, null, 2)}\n\nUSER REQUEST:\n${state.input}\n\nApply the user's request to the existing profile. Preserve existing data unless the user asks to change or remove it. You may add, update, or remove skills and interests as requested. Output the full updated profile.`;
            logger.verbose("Merging with existing profile");
          }

          const profileGeneratorStart = Date.now();
          const result = await profileGenerator.invoke(inputWithContext);
          agentTimingsAccum.push({ name: 'profile.generator', durationMs: Date.now() - profileGeneratorStart });

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
            error: "Profile generation failed"
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
        if (!state.profile) {
          logger.error("Profile missing in embed step");
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
            '## Name', profile.identity.name,
            '## Bio', profile.identity.bio,
            '## Location', profile.identity.location,
            '# Narrative',
            '## Context', profile.narrative.context,
            '# Attributes',
            '## Interests', profile.attributes.interests.join(', '),
            '## Skills', profile.attributes.skills.join(', ')
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
        if (!state.profile) {
          logger.error("Profile missing for HyDE generation");
          return {
            error: "Profile missing for HyDE generation"
          };
        }

        logger.verbose("Starting HyDE generation...", {
          userId: state.userId,
          profileName: state.profile.identity.name
        });

        const agentTimingsAccum: import('../../../types/chat-streaming.types').DebugMetaAgent[] = [];

        try {
          const profileString = JSON.stringify(state.profile, null, 2);
          const hydeGeneratorStart = Date.now();
          const result = await hydeGenerator.invoke(profileString);
          agentTimingsAccum.push({ name: 'hyde.generator', durationMs: Date.now() - hydeGeneratorStart });

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

      // Generate mode: use Parallels searchUser to auto-generate
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
          auto_generate: "auto_generate",       // Generate mode -> Parallels searchUser
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

      // Auto-generate feeds into profile generation
      .addEdge("auto_generate", "generate_profile")

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
