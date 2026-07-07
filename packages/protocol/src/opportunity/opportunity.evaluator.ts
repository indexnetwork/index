import type { Runnable } from "@langchain/core/runnables";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { Lens } from "../shared/hyde/lens.inferrer.js";
import type { OpportunityStatus } from "../shared/interfaces/database.interface.js";
import { Timed } from "../shared/observability/performance.js";
import { stripUuids } from "./opportunity.presentation.js";
import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import type { OpportunityEvidence } from '../shared/schemas/network-assignment.schema.js';
import { renderOpportunityEvidenceForPrompt } from './opportunity.evidence.js';

const logger = protocolLogger("OpportunityEvaluator");


// ──────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────


const systemPrompt = `
    You are an expert "Opportunity Matcher" and super-connector.
    Your Goal: Analyze a Source User's profile against a Candidate User's profile to identify A SINGLE HIGH-VALUE opportunity.

    Input:
    - Source Context: The Source User's own Profile.
    - Candidate Profile (JSON)
    - Existing Opportunities (Context of matches already made)

    Output:
    - A list containing EXACTLY ONE "Opportunity" if a match exists.
    - If NO match exists, return an empty list.
    - Score (0-100): How strong is this match?
      - 90-100: "Must Meet" (Perfect alignment).
      - 70-89: "Should Meet" (Strong overlaps, clear potential).
      - <70: No opportunity (Return empty list).

    **CRITICAL: VALENCY & REASONING**
    
    1. **Valency Analysis**:
       - Determine the semantic role of the Candidate relative to the Source's goal.
       - "Agent": The Candidate CAN DO something for the Source (e.g., Source needs a dev, Candidate IS a dev).
       - "Patient": The Candidate NEEDS something from the Source (e.g., Source is a mentor, Candidate needs mentoring).
       - "Peer": Symmetric collaboration.

    2. **Reasoning (Third-Party Analytical Perspective)**:
       - **reasoning**: A neutral, third-party explanation of why this opportunity exists. Written for other LLM agents to read and understand.
       - Mention BOTH users by their roles (e.g. "The source user" and "The candidate") and explain why they are a match.
       - Do NOT address either user as "you". Write from an objective observer's perspective.
       - Include what each side brings to the connection and why it is mutually valuable.
       - NEVER leak private intents. If someone's intent is confidential, describe their relevant attributes instead.

    **VISIBILITY IMPLICATIONS OF ROLE ASSIGNMENT**

    The valency role you assign directly controls who sees the opportunity and when:
    - "Agent" (helper/provider): LAST to see the opportunity — only after the Patient has committed to reaching out. Agents are protected from noise; they only see high-intent connections.
    - "Patient" (seeker/requester): Sees the opportunity early and decides whether to reach out.
    - "Peer" (symmetric): Both parties see the opportunity immediately and either can initiate.

    Choose the role carefully — it determines the entire flow of how the connection unfolds.

    Rules:
    1. SYNTHESIS (CRITICAL): If multiple distinct match angles exist, SYNTHESIZE them into a SINGLE, robust opportunity.
    2. NEVER address either user directly — always use third-party references ("the source", "the candidate").
    3. COMPREHENSIVE: The single opportunity must capture ALL the value of the connection.
    4. Be specific about the "Why" for BOTH sides in the reasoning.
    5. DEDUPLICATION: Do NOT suggest opportunities that duplicate "Existing Opportunities".
    6. Do not suggest an opportunity if the source and candidate clearly already know each other (e.g. same company, co-founders, same team).
    7. SAME-SIDE MATCHING: If both the source and candidate are SEEKING the same resource (e.g., both looking for investors, both seeking a co-founder), this is not an opportunity. Return an empty list unless one side clearly OFFERS what the other SEEKS.
`;

// Entity-bundle system prompt (C2): entities + four match patterns + actors output
// NOTE: entityBundleSystemPrompt uses a >= 30 threshold (permissive) while
// systemPrompt uses >= 70 (strict). This is intentional: batch mode casts a wide
// net so the calling pipeline can apply its own filters; pairwise mode is strict
// because it returns a single yes/no decision per candidate pair.
const entityBundleSystemPrompt = `
You are an expert "Opportunity Matcher" and super-connector.
Your Goal: Analyze a set of entities (people), each with a profile and optional intents, and identify HIGH-VALUE opportunities among them.

Input:
- DISCOVERER: The user ID who triggered discovery (for context; they may or may not be in the entity list).
- ENTITIES: A set of entities. Each entity has:
  - userId, networkId (the index through which they were found)
  - evidenceKey (stable key for the matched resource when available)
  - profile: name, bio, location, interests, skills, context
  - intents (optional): list of { intentId, payload, summary } — some entities are profile-only, some have intents
  - ragScore, matchedVia (how they were found)
  - evidence (typed retrieval evidence: discovery kind, network, score, lens, source/candidate ids)
- EXISTING OPPORTUNITIES: Context of matches already made (for deduplication).

BEFORE SCORING — determine role satisfiability:

Definitions:
  SUBSTITUTIVE ROLE: The candidate can directly fill the open position in the discoverer's intent. The candidate IS the person/entity the discoverer is seeking. Example: discoverer seeks "co-founder" → candidate is an engineer willing to co-found.
  COMPLEMENTARY ROLE: The candidate's contribution is defined relative to the seeker-sought relation from the outside — they fund, advise, recruit for, or enable the sought relationship rather than participating in it as the target. Example: discoverer seeks "co-founder" → candidate is a VC (funds the company, does not co-found it).

Step 1 — Identify the open argument in each discoverer intent: what type of person or entity would satisfy the intent if found?
Step 2 — For each candidate, ask: can this candidate directly fill that open argument position?
  YES → substitutive role. Proceed to scoring.
  NO → complementary role. Apply Rule 7 (score ≤ 30, return no opportunity).
Step 3 — Contextual override: if the candidate's profile contains explicit evidence that they currently function in the substitutive role (e.g., a former investor who is now building full-time as a technical co-founder), re-evaluate Step 2 against their current role, not their categorical label.

Match patterns to consider:
1. Profile-to-profile: Complementary backgrounds (skills, interests, location).
2. Profile-to-intents+profile: Someone's skills/background match another's stated goals (intents).
3. Intents+profile-to-profile: Someone's stated goals match another's skills/background.
4. Intents+profile-to-intents+profile: Complementary or reciprocal goals between two or more people.

Output:
- A list of 0..N opportunities. Each opportunity has:
  - reasoning: Third-party analytical explanation (for other LLM agents). Mention entities by role. Do NOT use "you". Never leak private intents.
  - score: 0-100.
    - 90-100: Must Meet — candidate's PRIMARY role directly matches what the discoverer seeks.
      Example: discoverer seeks "AI/ML co-founder" → candidate IS an AI/ML engineer who wants to co-found.
    - 70-89: Should Meet — meaningful overlap on role type AND complementary intent.
    - 50-69: Worth Considering — tangential overlap only.
    - <30 (return empty): Complementary-role mismatch (candidate cannot fill the discoverer's open argument position), same-side match, or already acquainted.
      Example: discoverer seeks "co-founder" → candidate is a VC investor. The investor's contribution is external to the co-founding relation; they cannot substitute into it. Score 0.
  - IMPORTANT: Include ALL reasonable matches with scores >= 30, and ONLY those. Any candidate you would reject (complementary-role mismatch, same-side, already-acquainted, or a hard location mismatch) must score strictly below 30 and be omitted entirely — the surfacing threshold is 30, so a rejected candidate parked at exactly 30 would be wrongly surfaced.
  - actors: At least 2 actors per opportunity. Each actor has:
    - userId
    - role: "agent" (can do something for others), "patient" (needs something from others), "peer" (symmetric collaboration)
    - intentId (optional): if the match is intent-driven, the specific intent ID for that user
    - evidenceKey (optional): copy the entity evidenceKey when the actor is driven by a specific listed entity

VISIBILITY (role controls who sees the opportunity when):
- agent: Last to see — after the patient has committed to reaching out.
- patient: Sees early and decides whether to reach out.
- peer: Both see immediately; either can initiate.

Rules:
1. ONE OPPORTUNITY PER CANDIDATE: Create a SEPARATE opportunity for EACH candidate who matches. Do NOT combine multiple candidates into one opportunity. Each opportunity should have exactly 2 actors: the DISCOVERER and ONE candidate.
2. INDIVIDUAL REASONING: Write specific reasoning for EACH candidate individually. Do NOT mention other candidates in the reasoning. Focus on why THIS specific candidate matches THIS specific discoverer.
3. DEDUPLICATION: Do not suggest opportunities that duplicate Existing Opportunities.
4. Write reasoning from an objective observer's perspective; be specific about the "Why" for each side.
5. When in introduction mode, each opportunity must have exactly two actors — the two people being introduced. The discoverer (introducer) is added by the system and must not be included in your actors list.
6. ALREADY KNOW EACH OTHER: Do NOT suggest an opportunity if the entities clearly already know each other. Examples: co-founders of the same company, same team at the same organization, same employer, or any relationship that is obviously existing from their profiles (bio, context). When in doubt, if both profiles mention the same company/org/team in a way that implies they work together, return an empty list for that pair.
7. ROLE-SATISFIABILITY (evaluate before scoring): A candidate satisfies a discoverer's intent only if they can fill the SUBSTITUTIVE ROLE — the open argument position in the intent (the type of person the discoverer is seeking). A candidate in a COMPLEMENTARY ROLE (one that funds, advises, recruits for, or otherwise enables the sought relation from outside it) does not satisfy the intent, regardless of how closely associated their domain is.
   COMPLEMENTARY-ROLE CAP: If the candidate occupies a complementary rather than substitutive role relative to the discoverer's intent, score below 30 (e.g. 0–20). Return no opportunity. A "reject" score must be strictly below 30 so the candidate is not surfaced — never park a rejected candidate at exactly 30.
   CONTEXTUAL OVERRIDE: If the candidate's profile contains explicit evidence that they currently function in the substitutive role (not merely historically or tangentially), treat them as substitutive and score normally.
8. SAME-SIDE MATCHING: Before scoring, check whether the DISCOVERER and CANDIDATE are both SEEKING the same thing. Look at both parties' intents for directionality:
   - SEEKING signals: "looking for", "seeking", "want to find", "need", "raising", "hiring"
   - OFFERING signals: "can offer", "expert in", "investing in", "mentoring", "available for"
   If both parties have SEEKING intents targeting the same resource (e.g., both seeking investors, both seeking co-founders, both seeking mentorship), this is NOT an opportunity — score <30. An opportunity requires one side to OFFER what the other SEEKS.
9. LOCATION MATCHING: When the DISCOVERY REQUEST mentions a specific location (city, region, or country):
   a. If a candidate's profile.location is KNOWN and clearly does NOT match the requested location (different city/region), score below 30 (e.g. 0–25) and return no opportunity. An explicitly requested location is a hard constraint: a known geographic mismatch excludes the candidate.
   b. If a candidate's profile.location is UNKNOWN, EMPTY, or AMBIGUOUS, do NOT penalize — allow them through and score based on other factors. Note in reasoning that their location is unverified.
   c. If a candidate's profile.location matches or is reasonably close (e.g., "Bay Area" matches "San Francisco", "Remote" matches any location), score normally.
   d. "Remote" or "Global" locations are compatible with any requested location.
10. EVENT NETWORK AWARENESS: When NETWORK CONTEXTS includes an event-type network (identified by dates, location, schedule, or themes):
   a. TEMPORAL RELEVANCE: If the event has start/end dates, factor time into scoring. Intents about meeting at the event, sharing logistics, or collaborating during the event are highly relevant when the event is upcoming or in progress. After the event ends, such intents lose relevance — score lower unless the connection has lasting value beyond the event.
   b. THEME ALIGNMENT: Event networks may list themes or tracks. Candidates whose expertise or intents align with event themes should score higher for that network's entities.
   c. CO-ATTENDANCE SIGNAL: Two entities found through the same event network share a co-attendance signal — they will likely be in the same place at the same time. This is a positive signal for in-person collaboration opportunities.
   d. SCHEDULE CONTEXT: If the event network includes upcoming events or sessions, use them as additional matching context. Two people attending the same session or interested in the same topic track are stronger matches.
   e. CO-ATTENDANCE ROLE: When two co-attendees express mutual or reciprocal collaboration intent — each seeking to work with the other's type, with no clear one-directional provider/seeker split — assign the "peer" role to both. Symmetric, two-sided collaboration is a peer relationship, not an agent/patient one; default to "peer" rather than "agent" for co-attendance matches.
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

const OpportunitySchema = z.object({
  reasoning: z.string().describe('Third-party analytical explanation of why this opportunity exists. Mentions both users by role. Written for other LLM agents to understand the match.'),
  score: z.number().min(0).max(100).describe('Relevance score 0-100'),
  valencyRole: z.enum(['Agent', 'Patient', 'Peer']).describe("The semantic role of the Candidate relative to the Source"),
  sourceId: z.string().describe('The user ID of the source'),
  candidateId: z.string().describe('The user ID of the candidate'),
});

const responseFormat = z.object({
  opportunities: z.array(OpportunitySchema).describe("List of opportunities identified"),
});

// ─── Entity-bundle evaluator (C1): types and output schema with actors ───

export interface EvaluatorEntity {
  userId: string;
  profile: {
    name?: string;
    bio?: string;
    location?: string;
    interests?: string[];
    skills?: string[];
    context?: string;
  };
  intents?: Array<{
    intentId: string;
    payload: string;
    summary?: string;
  }>;
  networkId: string;
  evidenceKey?: string;
  ragScore?: number;
  matchedVia?: string;
  evidence?: OpportunityEvidence[];
}

export interface EvaluatorInput {
  /** The user who triggered discovery (for context, not special treatment). */
  discovererId: string;
  /** All relevant entities. In introduction mode, only the people being introduced (no introducer). */
  entities: EvaluatorEntity[];
  /** Existing opportunities for deduplication. */
  existingOpportunities?: string;
  /** When true, DISCOVERER is the introducer; reasoning and actors must be only among ENTITIES. */
  introductionMode?: boolean;
  /** Name of the introducer (for attribution in reasoning when introductionMode is true). */
  introducerName?: string;
  /** Optional hint/context from the introducer about why these people should meet. */
  introductionHint?: string;
  /** Optional discovery query (e.g. from chat). When set, only suggest opportunities where candidates clearly match this request. */
  discoveryQuery?: string;
  /** Pre-rendered network context markdown, keyed by networkId. */
  networkContexts?: Record<string, string>;
}

const ActorSchema = z.object({
  userId: z.string(),
  role: z.enum(['agent', 'patient', 'peer']),
  intentId: z.string().nullable().describe('If the match is intent-driven, the specific intent ID; null otherwise'),
  evidenceKey: z.string().nullable().optional().describe('Stable evidence key for the matched entity; null if unknown'),
});

const OpportunityWithActorsSchema = z.object({
  reasoning: z.string(),
  score: z.number().min(0).max(100),
  actors: z.array(ActorSchema).min(2).describe('All actors in this opportunity with their roles'),
});

const entityBundleResponseFormat = z.object({
  opportunities: z.array(OpportunityWithActorsSchema).describe('List of opportunities (0..N)'),
});

export type EvaluatorActor = z.infer<typeof ActorSchema>;
export type EvaluatedOpportunityWithActors = z.infer<typeof OpportunityWithActorsSchema>;
export type EvaluatorOutputBundle = z.infer<typeof entityBundleResponseFormat>;

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

type Opportunity = z.infer<typeof OpportunitySchema>;
type EvaluatorOutput = z.infer<typeof responseFormat>;

// Define CandidateProfile type (simplified for now, ideally imported from shared types)
export interface CandidateProfile {
  userId: string;
  identity?: { name?: string; bio?: string; location?: string };
  attributes?: { interests?: string[]; skills?: string[] };
  narrative?: { context?: string };
  score?: number; // Search score
}

interface OpportunityEvaluatorOptions {
  minScore?: number;
  limit?: number;
  hydeDescription?: string;
  /** Pre-inferred lenses (if not provided, lens inference runs automatically in HyDE graph). */
  lenses?: Lens[];
  existingOpportunities?: string;
  candidates?: CandidateProfile[]; // For direct evaluation
  filter?: Record<string, unknown>;
  initialStatus?: OpportunityStatus;
}

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

/** Optional test double for entity-bundle model (avoids live LLM in unit tests). */
export type OpportunityEvaluatorOptionsConstructor = {
  entityBundleModel?: Runnable;
};

export class OpportunityEvaluator {
  private model: Runnable;
  private entityBundleModel: Runnable;

  constructor(options?: OpportunityEvaluatorOptionsConstructor) {
    this.model = createStructuredModel("opportunityEvaluator", responseFormat, {
      name: "opportunity_evaluator"
    });
    this.entityBundleModel = options?.entityBundleModel ?? createStructuredModel("opportunityEvaluator", entityBundleResponseFormat, {
      name: "opportunity_evaluator_entity_bundle"
    });
  }

  /**
   * Main Entry Point: Batch analysis of candidates.
   * 
   * @param sourceProfileContext - The profile context string of the user we are finding opportunities FOR.
   * @param candidates - List of potential matches to evaluate.
   * @param options - Config (minScore, valid types, etc).
   * @returns A sorted list of high-value `Opportunity` objects.
   */
  @Timed()
  public async invoke(
    sourceProfileContext: string,
    candidates: CandidateProfile[],
    options: OpportunityEvaluatorOptions
  ): Promise<Opportunity[]> {
    const minScore = options.minScore || 70;

    logger.verbose(`[OpportunityEvaluator.invoke] Analyzing ${candidates.length} candidates...`);

    if (candidates.length === 0) {
      logger.verbose('[OpportunityEvaluator] No candidates provided.');
      return [];
    }

    const opportunities: Opportunity[] = [];

    // Analyze each candidate in parallel (bounded)
    const promises = candidates.map(async (candidate) => {
      // Pass existing opportunities context if provided
      const existingContext = options.existingOpportunities || '';
      return this.analyzeMatch(sourceProfileContext, candidate, candidate.userId, existingContext);
    });

    const results = await Promise.all(promises);
    results.flat().forEach(op => {
      if (op.score >= minScore) {
        opportunities.push(op as Opportunity);
      }
    });

    // Sort by score and take top 1
    const out = opportunities.sort((a, b) => b.score - a.score).slice(0, 1);
    logger.verbose('[OpportunityEvaluator.invoke] Done', { accepted: out.length });
    return out;
  }

  /**
   * Analyze a single match pair using the primary Agent model.
   */
  private async analyzeMatch(
    sourceProfileContext: string,
    candidateProfile: CandidateProfile,
    candidateUserId: string,
    existingOpportunities: string
  ): Promise<Opportunity[]> {
    try {
      // Construct the source context part of the prompt
      const sourceContext = `SOURCE PROFILE:\n${sourceProfileContext}`;

      const existingContextPart = existingOpportunities
        ? `\nEXISTING OPPORTUNITIES (Deduplication Context):\n${existingOpportunities}\n`
        : '';

      // Create candidate context using template string
      const candidateContext = `
            ID: ${candidateUserId}
            Name: ${candidateProfile.identity?.name || 'Unknown'}
            Bio: ${candidateProfile.identity?.bio || ''}
            Location: ${candidateProfile.identity?.location || ''}
            Interests: ${candidateProfile.attributes?.interests?.join(', ') || ''}
            Skills: ${candidateProfile.attributes?.skills?.join(', ') || ''}

            Context: ${candidateProfile.narrative?.context || ''}
            `;

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(`${sourceContext}\n${existingContextPart}\nCANDIDATE PROFILE:\n${candidateContext}`)
      ];

      const result = await invokeWithAbortSignal(this.model, messages);
      const output = responseFormat.parse(result);

      const mappedOpportunities = output.opportunities.map((op: Opportunity) => ({
        ...op,
        reasoning: stripUuids(op.reasoning),
        candidateId: candidateUserId,
      }));

      return mappedOpportunities;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(`[OpportunityEvaluator] Analysis failed for candidate ${candidateUserId}`, { message });
      throw e;
    }
  }

  /**
   * Entity-bundle entry point (C3): single LLM call with all entities, returns 0..N opportunities with actors.
   */
  @Timed()
  public async invokeEntityBundle(
    input: EvaluatorInput,
    options: { minScore?: number; returnAll?: boolean } = {}
  ): Promise<EvaluatedOpportunityWithActors[]> {
    const minScore = options.minScore ?? 70;
    const returnAll = options.returnAll ?? false;
    const totalEntities = input.entities?.length ?? 0;
    if (!input.entities?.length) {
      logger.verbose('[OpportunityEvaluator.invokeEntityBundle] No entities.');
      return [];
    }
    const existingPart = input.existingOpportunities
      ? `\nEXISTING OPPORTUNITIES:\n${input.existingOpportunities}\n`
      : '';
    const introModePart = input.introductionMode
      ? `\nINTRODUCTION MODE: This is a human-curated introduction. ${input.introducerName ?? 'The introducer'} (DISCOVERER: ${input.discovererId}) explicitly wants these people to connect. This is NOT an automatic discovery — a real person saw value in this connection.

CRITICAL REASONING INSTRUCTIONS FOR INTRODUCTIONS:
- Your reasoning MUST acknowledge that this is an introduction initiated by ${input.introducerName ?? 'the introducer'}, not a system-discovered match.
- Start reasoning with something like "${input.introducerName ?? 'The introducer'} is connecting [Name A] and [Name B] because..." or "This introduction by ${input.introducerName ?? 'the introducer'} brings together..."
- Even if the parties' intents or profiles don't obviously overlap, the introduction is still valid because the introducer saw the connection. Explain what the introducer likely sees in this match.
- If explicit intents align, mention them — but frame it as supporting the introducer's judgment, not as the primary reason.${input.introductionHint ? `\nINTRODUCER'S CONTEXT: "${input.introductionHint}" — use this to inform your reasoning about why the introducer made this connection.` : ''}
- Actors must refer ONLY to the ENTITIES below (the people being introduced). Do not include the DISCOVERER as an actor.
- You must output exactly two actors per opportunity (the two people being introduced). The introducer is added separately; do not include them in actors.
- Be generous with scoring (70+ for any introduction with a plausible basis, since a human made the judgment).
`
      : '';
    const discoveryQueryPart = input.discoveryQuery?.trim()
      ? `\nDISCOVERY REQUEST: The user asked: "${input.discoveryQuery.trim()}"

CRITICAL SCORING RULES FOR DISCOVERY REQUESTS:

0. QUERY IS PRIMARY: The DISCOVERY REQUEST above is the primary evaluation criterion. The source user's stored INTENTS (if listed below) are background context — use them ONLY to fill in blanks when the query is too broad or vague to evaluate on its own. If the query is specific enough to score candidates, score strictly against the query and IGNORE stored intents. Never let a stored intent override or replace the query as the basis for scoring. When a specific query imposes a hard identity, role, capability, or location constraint, candidates that only match background context or thematic adjacency must score strictly below 30 and be omitted.

1. CLASSIFY THE QUERY TYPE — determine the predication type before scoring:

   IDENTITY/ROLE QUERY: The query term is a count noun or sortal that can serve as a predicate nominal — "X IS A [query]" is grammatical and meaningful. Examples: "samurai", "investors", "designers", "nurses", "founders". The user wants someone who IS that thing — not someone who works with, creates content about, or is tangentially associated with it.
   → Test: Can you say "this person IS a [query term]"? If yes, this is an identity query.
   → CRITICAL: Subject-matter contact is NOT identity. A character designer who draws samurai IS NOT a samurai. An engineer who raised funding IS NOT an investor. A journalist who covers finance IS NOT an investor. IS-A is not transitive through creative subject matter, professional adjacency, or domain familiarity.

   TOPICAL/DOMAIN QUERY: The query is a field, domain, or abstract topic — "X IS A [query]" is ungrammatical. Examples: "machine learning", "sustainability", "blockchain". The user wants someone who works in or has expertise in this domain.
   → Test: "This person IS a machine learning" makes no sense → topical query.

   NEED/CAPABILITY QUERY: The query contains a purposive frame — "someone to help with X", "need a Y", "looking for Z". The user describes a specific need.

2. APPLY TYPE-SPECIFIC SCORING:

   For IDENTITY/ROLE queries — apply a categorical gate:
   - First, make a binary IS-A judgment for each candidate: does this person's PRIMARY professional identity or self-description place them within the extension of the query term?
   - IS-A = TRUE → score 75-100 (modulated by intent alignment and profile richness)
   - IS-A = FALSE → score <30. Hard ceiling. Return no opportunity. Do NOT award surfacing credit for subject-matter adjacency, thematic association, creative output involving the query term, having received the thing, or being adjacent to people who are the thing.
   - Do NOT rescue a failed IS-A judgment with background intents. If the user searched "samurai" and the candidate is a visual artist (IS-A = false), the candidate's alignment with a background intent like "connect with visual artists" does not matter — the explicit query takes priority. If the user searched "investors" and the candidate merely raised money, score <30. If the user searched "scouts" and the candidate was scouted, score <30. If the user searched "art director", a solo illustrator is not enough: require explicit evidence that the candidate owns visual direction, leads/briefs other artists, manages a visual system, or is described as an art/creative director. General visual taste, composition skill, or illustration output alone is a failed IS-A judgment and must score <30.

   For TOPICAL/DOMAIN queries — apply gradient scoring:
   - 90-100: Deep expertise, primary focus area
   - 70-89: Substantial engagement, meaningful work in the domain
   - 50-69: Peripheral involvement, tangential connection
   - <50: No meaningful engagement

   For NEED/CAPABILITY queries — apply capability + availability scoring:
   - Score based on both capability match AND openness to the described collaboration
   - 90-100: Perfect capability match with explicit availability
   - 70-89: Strong capability, plausible availability

3. SAME-SIDE CHECK: If the candidate's intents show they are ALSO SEEKING what the discoverer is seeking (e.g., both looking for investors, both looking for co-founders), this is a same-side match. Score <30 regardless of keyword overlap in bios. The candidate must BE or OFFER what the discoverer is looking for, not also be looking for it.

4. LOCATION ENFORCEMENT: If the discovery request mentions a specific location (e.g., "in SF", "based in London", "Istanbul"), check each candidate's profile.location:
   - KNOWN MISMATCH (e.g., request says "SF" but candidate is "New York"): Score <30 and return no opportunity. State the mismatch in reasoning if returning diagnostic output. A known location mismatch is a hard query failure, even when the candidate otherwise matches the source's background interests.
   - UNKNOWN/EMPTY location: Do not penalize, and do NOT reject solely because the query contains a location. Treat location as unverified/missing evidence, then score on the non-location parts of the query. If the candidate strongly satisfies the requested role/domain (e.g., query "Unreal Engine developers in SF" and candidate is clearly an Unreal Engine developer with empty location), score normally enough to surface (typically 60-89) and note that location is unverified.
   - MATCH or COMPATIBLE (e.g., "Bay Area" ≈ "SF", "Remote" ≈ any): Score normally.
`
      : '';
    const hasDiscoveryQuery = !!input.discoveryQuery?.trim();
    const entitiesBlock = input.entities.map((e) => {
      const isSource = e.userId === input.discovererId;
      // When an explicit discovery query is active, label the source user's stored
      // intents as background context so the LLM treats the query as primary.
      const intentsLabel = isSource && hasDiscoveryQuery ? 'BACKGROUND INTENTS (use only if query is too vague)' : 'INTENTS';
      const intentsPart = e.intents?.length
        ? `\n  ${intentsLabel}:\n${e.intents.map((i) => `    - ${i.intentId}: ${i.payload}`).join('\n')}`
        : '';
      // Mask the discoverer's name so the LLM cannot leak it into reasoning.
      // The system prompt already says "use third-party references", but the LLM
      // ignores this when the actual name is visible. Masking it forces role-based
      // language ("the source user is looking…" instead of "Alice is looking…").
      const displayName = e.userId === input.discovererId
        ? '(source user)'
        : (e.profile.name ?? '');
      return `
  USER: ${e.userId}
  INDEX: ${e.networkId}
  EVIDENCE KEY: ${e.evidenceKey ?? '—'}
  PROFILE: Name: ${displayName} | Bio: ${e.profile.bio ?? ''} | Location: ${e.profile.location ?? ''} | Interests: ${e.profile.interests?.join(', ') ?? ''} | Skills: ${e.profile.skills?.join(', ') ?? ''} | Context: ${e.profile.context ?? ''}${intentsPart}
  RAG SCORE: ${e.ragScore ?? '—'}
  MATCHED VIA: ${e.matchedVia ?? '—'}
  EVIDENCE:
${renderOpportunityEvidenceForPrompt(e.evidence ?? [])}`;
    }).join('\n');
    const networkContextPart = input.networkContexts && Object.keys(input.networkContexts).length > 0
      ? `\n\nNETWORK CONTEXTS:\n${Object.entries(input.networkContexts).map(([nid, ctx]) => `[INDEX: ${nid}]\n${ctx}`).join('\n\n')}`
      : '';
    const humanContent = `DISCOVERER: ${input.discovererId}${introModePart}${discoveryQueryPart}${networkContextPart}\n\nENTITIES:\n${entitiesBlock}${existingPart}`;
    const messages = [
      new SystemMessage(entityBundleSystemPrompt),
      new HumanMessage(humanContent),
    ];
    let parsedTotal = 0;
    try {
      const result = await invokeWithAbortSignal(this.entityBundleModel, messages);
      const parsed = entityBundleResponseFormat.parse(result);
      for (const op of parsed.opportunities) {
        op.reasoning = stripUuids(op.reasoning);
      }
      parsedTotal = parsed.opportunities.length;
      const introGuard =
        input.introductionMode
          ? parsed.opportunities.filter((op) => op.actors.length === 2)
          : parsed.opportunities;
      const filtered = introGuard.filter((op) => op.score >= minScore);
      logger.verbose('[OpportunityEvaluator.invokeEntityBundle] Done', {
        total: parsed.opportunities.length,
        afterIntroGuard: introGuard.length,
        accepted: filtered.length,
        returnAll,
      });
      return returnAll ? introGuard : filtered;
    } catch (llmError) {
      logger.error('[OpportunityEvaluator.invokeEntityBundle] Failed', {
        discovererId: input.discovererId,
        totalEntities,
        parsedTotal,
        minScore,
        llmError,
      });
      throw llmError;
    }
  }

  /**
   * Factory method to expose the agent as a LangChain tool.
   * Simplified to only accept direct evaluation arguments.
   * PURE: Does not perform any database lookups.
   */
  public static asTool() {
    return tool(
      async (args: {
        sourceProfileContext: string;
        candidatesJson?: string;
        minScore?: number;
      }) => {
        const agent = new OpportunityEvaluator();

        const sourceProfileContext = args.sourceProfileContext;

        let candidates: CandidateProfile[] = [];
        if (args.candidatesJson) {
          try {
            candidates = JSON.parse(args.candidatesJson);
          } catch (e) {
            logger.error("Failed to parse candidates JSON");
          }
        }

        const options: OpportunityEvaluatorOptions = {
          minScore: args.minScore,
        };

        return await agent.invoke(sourceProfileContext, candidates, options);
      },
      {
        name: 'opportunity_evaluator',
        description: 'Evaluates candidates against a source profile. SOURCE PROFILE CONTEXT MUST BE PROVIDED.',
        schema: z.object({
          sourceProfileContext: z.string().describe('The resolved source user profile context'),
          candidatesJson: z.string().optional().describe('JSON string list of Candidates'),
          minScore: z.number().optional().describe('Minimum score to accept a match')
        })
      }
    );
  }
}
