import { StateGraph, START, END } from "@langchain/langgraph";
import { EnrichmentGraphState } from "./enrichment.state.js";
import { EnrichmentGraphDatabase, PremiseProvenance } from "../shared/interfaces/database.interface.js";
import { Scraper } from "../shared/interfaces/scraper.interface.js";
import type { ProfileEnricher } from "../shared/interfaces/enrichment.interface.js";
import { shouldEnrichGhostDisplayNameFromParallel, isEnrichedNameMeaningful } from "./enrichment.enricher.js";
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
    /** Volatile premises auto-retract once their validity window lapses. */
    volatile?: boolean;
    /** ISO timestamp after which a contextual premise is no longer valid. */
    validUntil?: string;
    provenanceSource?: PremiseProvenance['source'];
    provenanceSourceId?: string;
  }): Promise<{
    premise?: { id: string } | undefined;
    /** Set when the create was skipped because a near-duplicate already exists. */
    duplicateOf?: { premiseId: string; assertionText: string; similarity: number } | undefined;
    error?: string | undefined;
  }>;
}

const logger = protocolLogger("EnrichmentGraphFactory");

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
export class EnrichmentGraphFactory {
  constructor(
    private database: EnrichmentGraphDatabase,
    private scraper: Scraper,
    private enricher?: ProfileEnricher,
    private questionerEnqueue?: QuestionerEnqueueFn,
    private premiseGraph?: CompiledPremiseGraph,
  ) { }

  public createGraph() {
    const premiseDecomposer = new PremiseDecomposer();

    // ─────────────────────────────────────────────────────────
    // NODE: Check State
    // Loads existing profile from DB and detects what needs generation:
    // - Profile missing
    // - User information insufficient for scraping
    // ─────────────────────────────────────────────────────────
    const checkStateNode = async (state: typeof EnrichmentGraphState.State) => {
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
          // "Has a profile" now means the user has been enriched into ACTIVE premises
          // (the user_profiles replacement). `getProfile` returns a users-sourced row
          // for every existing user, so its presence no longer signals enrichment --
          // the premise graph is the source of truth for whether generation has run.
          const hasBeenEnriched = (await this.database.getPremisesForUser(state.userId, 'ACTIVE')).length > 0;

          // Query mode: Just return the profile (fast path)
          if (state.operationMode === 'query') {
            logger.verbose("🚀 Query mode - returning existing profile (fast path)", {
              hasProfile: hasBeenEnriched
            });
            const profileWithId = hasBeenEnriched ? await this.database.getProfileByUserId(state.userId) : null;
            return {
              profile: hasBeenEnriched ? (profile || undefined) : undefined,
              readResult: hasBeenEnriched
                ? {
                    hasProfile: true,
                    // Thin identity only. The structured skills/interests attributes are
                    // retired (user_profiles removal, WS6); the rich identity text now
                    // comes from the global user_context, injected by read_user_contexts.
                    profile: {
                      id: profileWithId?.id,
                      name: profile?.identity?.name,
                      bio: profile?.identity?.bio,
                      location: profile?.identity?.location,
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
          const needsProfileGeneration = !hasBeenEnriched || (state.forceUpdate && hasMeaningfulInput);

          // Check if we need to scrape (profile generation needed but no meaningful input provided)
          const willNeedScraping = needsProfileGeneration && !hasMeaningfulInput;

          // If we need to scrape, check if we have sufficient user information
          let needsUserInfo = false;
          const missingUserInfo: string[] = [];

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
            hasProfile: hasBeenEnriched,
            needsProfileGeneration,
            needsUserInfo,
            missingUserInfo,
            forceUpdate: state.forceUpdate,
            hasInput: !!state.input,
            hasMeaningfulInput,
          });

          return {
            // Only treat the (users-sourced) profile as existing state when the user has
            // actually been enriched; un-enriched users keep `undefined` so the generate
            // path runs from scratch rather than merging into an empty users row.
            profile: hasBeenEnriched ? (profile || undefined) : undefined,
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
            error: `Failed to load profile from database: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      });
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Scrape
    // Scrapes data from web if input is not provided
    // ─────────────────────────────────────────────────────────
    const scrapeNode = async (state: typeof EnrichmentGraphState.State) => {
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
            activeSocialIds: socials.map(s => s.id),
            operationsPerformed: { scraped: true }
          };
        } catch (error) {
          logger.error("Scrape failed", {
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            error: `Web scrape failed: ${error instanceof Error ? error.message : String(error)}`
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
    const autoGenerateNode = async (state: typeof EnrichmentGraphState.State) => {
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
                activeSocialIds: socials.map(s => s.id),
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
    // NODE: Decompose Premises
    // Decomposes free-text input (chat or scraped) into individual premises
    // and creates each via the premise graph. Premise creation is the terminal
    // effect: premise lifecycle events drive user_context regeneration downstream
    // (the legacy aggregate→generate→save profile tail was removed in WS8/IND-365,
    // along with the user_profiles table it wrote to).
    // ─────────────────────────────────────────────────────────
    const decomposePremisesNode = async (state: typeof EnrichmentGraphState.State) => {
      return timed("ProfileGraph.decomposePremises", async () => {
        if (!state.input) {
          logger.error("No input for premise decomposition");
          return { error: "Input required for premise decomposition" };
        }

        if (!this.premiseGraph) {
          // No premise graph injected — nothing to decompose into. End the run.
          logger.warn("No premise graph injected — skipping premise decomposition");
          return {};
        }

        logger.verbose("Decomposing input into premises...", {
          userId: state.userId,
          inputLength: state.input.length,
        });

        const agentTimingsAccum: DebugMetaAgent[] = [];

        try {
          const _traceEmitter = requestContext.getStore()?.traceEmitter;

          // Offer the user's ACTIVE premises to the decomposer so removal/denial
          // instructions ("remove all mentions of X", "I have nothing to do with Y")
          // can be resolved to concrete retractions instead of being silently dropped.
          // Only when the adapter supports retraction — otherwise skip the lookup.
          let activePremises: Array<{ id: string; assertion: { text: string } }> = [];
          if (typeof this.database.updatePremise === 'function') {
            try {
              activePremises = await this.database.getPremisesForUser(state.userId, 'ACTIVE');
            } catch (err) {
              logger.warn("Failed to load active premises for retraction matching — proceeding without", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          const decomposeStart = Date.now();
          _traceEmitter?.({ type: "agent_start", name: "premise-decomposer" });
          // Offer the stored bio (users.intro) as well: it is a separate identity
          // field that premises never touch, so removal instructions must also be
          // able to rewrite it — otherwise disavowed facts survive in the bio and
          // resurface in every prompt that includes the profile identity.
          const currentBio = state.profile?.identity?.bio ?? '';
          const result = await premiseDecomposer.invoke(
            state.input,
            activePremises.map((p) => ({ id: p.id, text: p.assertion.text })),
            currentBio,
          );
          const decomposeMs = Date.now() - decomposeStart;
          const retractionIds = result.retractedPremiseIds ?? [];
          agentTimingsAccum.push({ name: "premise.decomposer", durationMs: decomposeMs });
          _traceEmitter?.({
            type: "agent_end",
            name: "premise-decomposer",
            durationMs: decomposeMs,
            summary: `Decomposed into ${result.premises.length} premise(s), ${retractionIds.length} retraction(s)`,
          });

          // Apply retractions FIRST so a premise that is simultaneously disavowed and
          // re-asserted in corrected form does not dedupe the new create against the
          // stale active row.
          let retracted = 0;
          for (const premiseId of retractionIds) {
            if (!this.database.updatePremise) break;
            try {
              await this.database.updatePremise(premiseId, {
                status: 'RETRACTED',
                retractedAt: new Date(),
              });
              retracted++;
            } catch (err) {
              logger.warn("Premise retraction failed", {
                premiseId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          if (retracted > 0) {
            logger.verbose(`Retracted ${retracted}/${retractionIds.length} premise(s) disavowed by input`, {
              userId: state.userId,
            });
          }

          // Apply the bio revision (before the no-new-premises early return: a pure
          // removal instruction extracts zero premises but still rewrites the bio).
          let bioRevised = false;
          const revisedBio = result.revisedBio?.trim();
          if (revisedBio && revisedBio !== currentBio.trim()) {
            try {
              await this.database.saveProfile(state.userId, {
                userId: state.userId,
                // Empty name/location are skipped by the identity persister — only
                // the bio is written.
                identity: { name: '', bio: revisedBio, location: '' },
                context: '',
              });
              bioRevised = true;
              logger.verbose("Revised stored bio per removal/correction instruction", { userId: state.userId });
            } catch (err) {
              logger.warn("Bio revision failed", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          if (result.premises.length === 0) {
            logger.verbose("No premises extracted — nothing to create");
            return {
              agentTimings: agentTimingsAccum,
              ...(retracted > 0 || bioRevised ? { operationsPerformed: { decomposedPremises: true } } : {}),
            };
          }

          logger.verbose(`Creating ${result.premises.length} premise(s) via premise graph`, {
            userId: state.userId,
          });

          let created = 0;
          let skippedDuplicates = 0;
          for (const p of result.premises) {
            try {
              // Contextual premises carry an LLM-inferred validity window and are
              // volatile (auto-retract on expiry); assertive premises do not expire.
              const isContextual = p.tier === 'contextual';
              const validUntil = isContextual && p.validityDays
                ? new Date(Date.now() + p.validityDays * 24 * 60 * 60 * 1000).toISOString()
                : undefined;

              const premiseResult = await invokeWithAbortSignal(this.premiseGraph, {
                userId: state.userId,
                assertionText: p.text,
                tier: p.tier,
                operationMode: 'create',
                volatile: isContextual,
                ...(validUntil ? { validUntil } : {}),
                ...(state.activeSocialIds?.length
                  ? { provenanceSource: 'integration' as const, provenanceSourceId: state.activeSocialIds[0] }
                  : {}),
              });

              if (premiseResult.premise) {
                created++;
              } else if (premiseResult.duplicateOf) {
                skippedDuplicates++;
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

          logger.verbose(`Created ${created}/${result.premises.length} premise(s) (${skippedDuplicates} skipped as near-duplicates)`, {
            userId: state.userId,
          });

          return {
            agentTimings: agentTimingsAccum,
            operationsPerformed: { decomposedPremises: true },
          };
        } catch (err) {
          logger.error("Premise decomposition failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          return {
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
    const checkStateCondition = (state: typeof EnrichmentGraphState.State): string => {
      // Query mode: Return immediately (fast path)
      if (state.operationMode === 'query') {
        logger.verbose("Query mode - ending (fast path)");
        return END;
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
          // The decompose node extracts atomic premises and creates them; premise
          // events drive user_context regeneration. Without a premise graph there
          // is nothing to do, so end the run.
          if (this.premiseGraph) {
            logger.verbose("Profile generation needed — decomposing input into premises");
            return "decompose_premises";
          }
          logger.verbose("Profile generation needed but no premise graph injected — ending");
          return END;
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

    const workflow = new StateGraph(EnrichmentGraphState)
      // Add all nodes
      .addNode("check_state", checkStateNode)
      .addNode("scrape", scrapeNode)
      .addNode("decompose_premises", decomposePremisesNode)
      .addNode("auto_generate", autoGenerateNode)

      // Start with state check
      .addEdge(START, "check_state")

      // Conditional routing from check_state
      .addConditionalEdges(
        "check_state",
        checkStateCondition,
        {
          auto_generate: "auto_generate",       // Generate mode -> Chat API enrichment
          decompose_premises: "decompose_premises", // Write mode + input + premise graph -> decompose
          scrape: "scrape",                     // Need premises, no input -> scrape first
          [END]: END                            // Query mode, no premise graph, or everything exists
        }
      )

      // Decompose premises creates premises as a side effect, then ends.
      // user_context regeneration is handled downstream by premise lifecycle events.
      .addEdge("decompose_premises", END)

      // Auto-generate routes to premise decomposition (when premise graph
      // available + enrichment produced input), otherwise ends.
      .addConditionalEdges(
        "auto_generate",
        (state: typeof EnrichmentGraphState.State) => {
          if (state.input && this.premiseGraph) {
            logger.verbose("Enrichment produced input — routing to premise decomposition");
            return "decompose_premises";
          }
          logger.verbose("Enrichment ended without usable input (ghost soft-deleted, error, or no premise graph) — done");
          return END;
        },
        {
          decompose_premises: "decompose_premises",
          [END]: END,
        }
      )

      // Scrape -> decompose_premises (when premise graph available), else ends.
      .addConditionalEdges(
        "scrape",
        (_state: typeof EnrichmentGraphState.State) => {
          if (this.premiseGraph) return "decompose_premises";
          return END;
        },
        {
          decompose_premises: "decompose_premises",
          [END]: END,
        },
      );

    logger.verbose("Graph built successfully");
    return workflow.compile();
  }
}
