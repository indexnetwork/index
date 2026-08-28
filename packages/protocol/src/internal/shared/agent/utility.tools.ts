import { z } from "zod";

import { requestContext } from "../observability/request-context.js";
import { ActivitySummaryResponseSchema, McpActivityCallerSchema, activitySummaryNetworkId, projectActivitySummary } from "./activity-projection.js";
import type { McpActivityCaller } from "./activity-projection.js";
import { CANONICAL_GUIDANCE_SUMMARY, CANONICAL_GUIDANCE_TOPICS, CANONICAL_GUIDANCE_TOPICS_CONTENT } from "./canonical-guidance.js";

import type { DefineTool, ToolRegistryCompositionDeps } from "./tool.helpers.js";
import { success, error, normalizeUrl } from "./tool.helpers.js";

/** Owner-trusted surfaces (REST/chat) receive the full owner view. */
const HUMAN_OWNER_CALLER: McpActivityCaller = {
  kind: "human",
  permissions: [],
  networkScopeId: null,
};

/** Host capabilities consumed by URL and profile utility tools. */
type UtilityToolDeps = Pick<ToolRegistryCompositionDeps, "scraper" | "userDb">;

/**
 * Tool-surface profile. The restricted `'mcp'` surface omits `scrape_url`
 * (IND-597) and sanitizes `read_docs` guidance so it never advertises the
 * contact/Gmail workflows removed from MCP (IND-596). The default `'rest'`
 * surface (direct HTTP Tool API + chat) retains full behavior.
 */
export type ToolSurface = "mcp" | "rest";

export interface CreateUtilityToolsOptions {
  surface?: ToolSurface;
}

export function createUtilityTools(
  defineTool: DefineTool,
  deps: UtilityToolDeps,
  options: CreateUtilityToolsOptions = {},
) {
  const { scraper } = deps;
  const isMcpSurface = options.surface === "mcp";

  // scrape_url is omitted from the MCP tool surface (IND-597). It remains
  // available via the direct HTTP Tool API and the chat agent.
  const scrapeUrl = isMcpSurface ? null : defineTool({
    name: "scrape_url",
    description:
      "Extracts text content from a web URL — articles, LinkedIn/GitHub profiles, documentation, project pages, etc. " +
      "Returns the page's text content (up to 10,000 characters) for use in subsequent tool calls.\n\n" +
      "**When to use:**\n" +
      "- Before create_intent: when the user shares a URL and wants to create an intent from it. Scrape first, then synthesize into a description.\n" +
      "- When the user asks about content at a URL.\n\n" +
      "**URL format:** Bare domains work fine (e.g. 'github.com/user/repo') — protocol (https://) is added automatically.\n\n" +
      "**Returns:** `{ url, contentLength, content }`. Content is truncated at 10,000 chars. " +
      "Returns an error if the URL is unreachable, requires login, or has no extractable text.",
    querySchema: z.object({
      url: z.string().describe("The URL to extract content from. Protocol is optional — 'github.com/user/repo', 'linkedin.com/in/name', and 'https://example.com' all work."),
      objective: z.string().optional().describe("Why you're scraping — guides content extraction for better results. Examples: 'User wants to create an intent from this project page', 'User wants to update their profile from this LinkedIn page', 'Extract key information about this company'. Omit for generic text extraction."),
    }),
    handler: async ({ context: _context, query }) => {
      const normalizedUrl = normalizeUrl(query.url);
      if (!normalizedUrl) {
        return error("Invalid URL format. Please provide a valid URL (e.g. 'github.com/user/repo' or 'https://example.com').");
      }

      const content = await scraper.extractUrlContent(normalizedUrl, {
        objective: query.objective?.trim() || undefined,
        signal: requestContext.getStore()?.abortSignal,
      });

      if (!content) {
        return error("Couldn't extract content from that URL. It may be blocked, require login, or have no extractable text.");
      }

      const truncatedContent = content.length > 10000
        ? content.substring(0, 10000) + "\n\n[Content truncated...]"
        : content;

      return success({
        url: normalizedUrl,
        contentLength: content.length,
        content: truncatedContent,
      });
    },
  });

  const readDocs = defineTool({
    name: "read_docs",
    description:
      "Returns comprehensive documentation about the Index Network protocol — entity model, workflows, tool usage guidance, and domain concepts. " +
      "This is the primary way for an external agent to bootstrap understanding of the system.\n\n" +
      "**When to use:** Call this FIRST when starting a new session.\n" +
      "Also call when you need to understand identity, context, premises, signals, communities, networks, opportunities, or negotiations.\n\n" +
      "**Returns:** Markdown documentation. Pass `topic` to get a specific section, or omit for the summary.\n\n" +
      `**Available canonical topics:** ${CANONICAL_GUIDANCE_TOPICS.join(", ")}`,
    querySchema: z.object({
      topic: z.string().optional().describe(`Narrow to a canonical topic: ${CANONICAL_GUIDANCE_TOPICS.join(", ")}. Omit to get the summary.`),
    }),
    handler: async ({ context: _context, query }) => {
      const topic = query.topic?.trim().toLowerCase();

      // Canonical guidance is the MCP read_docs foundation. When on MCP surface,
      // legacy supplemental topics (entities, intents, opportunities, etc.) are
      // omitted to avoid repeating the canonical source (IND-602/603).
      // REST/chat surfaces retain full topic coverage for backwards compatibility.
      if (isMcpSurface) {
        // MCP surface: use canonical guidance only.
        if (!topic) {
          // Return summary of canonical guidance
          return success({ content: CANONICAL_GUIDANCE_SUMMARY });
        }
        // Try to match canonical topic
        const normalizedTopic = topic.replace(/_/g, "-").toLowerCase();
        for (const canonicalTopic of CANONICAL_GUIDANCE_TOPICS) {
          if (canonicalTopic === normalizedTopic || normalizedTopic.includes(canonicalTopic.split("-")[0])) {
            return success({ topic: canonicalTopic, content: CANONICAL_GUIDANCE_TOPICS_CONTENT[canonicalTopic] });
          }
        }
        // Unknown topic on MCP surface
        return success({
          content: `Unknown canonical topic "${topic}". Available topics: ${CANONICAL_GUIDANCE_TOPICS.join(", ")}. Request summary for full canonical guidance.`,
        });
      }

      const sections: Record<string, string> = {
        // Legacy topics (REST/chat only)
        entities: `## Entity Model & Relationships

- **Users**: People on the platform. Authenticated via API key (X-API-Key header) for MCP/external agents, or session-based (Better Auth) for the web app.
- **Profiles**: A user's identity — name, bio, skills, interests, location, social links. Generated from account data or social URLs via enrichment. One profile per user.
- **Indexes** (also called "networks"): Communities or groups where members share intents and discover opportunities. Each has a title, optional prompt (purpose description), join policy (anyone or invite_only), and an owner.
- **Network Members**: Junction between Users and Indexes. Tracks permissions (owner, member), join date, auto-assign setting, and optional member prompt.
- **Intents**: Signals of interest/need — what a user is looking for (e.g. "Looking for a React developer in Berlin"). Each has a description (payload), summary, confidence score (0-1), inferenceType (explicit/implicit), source tracking, and vector embedding.
- **IntentNetworks**: Many-to-many junction between Intents and Indexes. An intent can be in multiple indexes. Has a relevancyScore (0-1) indicating how well the intent fits the index's purpose.
- **Opportunities**: Discovered connections between users based on complementary intents within shared networks. Have actors with roles (party), status lifecycle, match reasoning, confidence score, and presentation data.

### Key Relationships
- Users → Profiles (1:1)
- Users → Indexes (many:many via Network Members)
- Users → Intents (1:many, user owns intents)
- Intents → Indexes (many:many via IntentNetworks with relevancyScore)
- Opportunities → Users (many:many via actors with roles)
- Opportunities → Indexes (scoped to shared network context)`,

        intents: `## Intent Lifecycle

Intents are the core unit of discovery — they represent what users are seeking and drive semantic matching.

1. **Creation** (create_intent): User describes what they're looking for. The system runs inference (extracting structured intents from free text) and verification (checking specificity, speech-act type). Returns a proposal for user approval.
2. **Confidence & Classification**: Each intent gets a confidence score (0-1), inferenceType (explicit = user stated directly, implicit = system inferred), and speech act classification (commissive, directive, assertive).
3. **Index Assignment**: After creation, the intent is automatically evaluated against all networks the user belongs to. The index's prompt is used as criteria. Matching indexes get linked via IntentNetworks with a relevancyScore (0-1).
4. **Discovery Trigger**: Creating an intent triggers background opportunity detection — the system searches for other users in shared networks whose intents complement this one.
5. **Source Tracking**: Intents track their origin via sourceType (integration, discovery_form, enrichment) and sourceId.
6. **Update** (update_intent): Re-processes through inference/verification, recalculates embeddings and index assignments.
7. **Archive** (delete_intent): Soft-deletes the intent. It stops participating in discovery but is not permanently removed.

### Intent Best Practices
- Be specific: "Looking for a senior React developer for a 3-month contract in Berlin" > "Need a developer"
- One intent per need: don't combine multiple requests into one intent
- Update rather than delete+create to preserve history`,

        opportunities: `## Opportunity Lifecycle

Opportunities represent discovered connections between users — potential matches worth pursuing.

1. **Background matching**: The opportunity graph evaluates approved signals whose intents semantically complement each other within shared networks. It uses HyDE embeddings for retrieval and an LLM evaluator for scoring.
2. **Roles**: Each opportunity assigns roles to actors:
   - **party**: The people being connected (typically 2)
3. **Status Flow**: draft → pending → accepted/rejected/expired
   - **pending**: Sent to the other party. They're notified and can respond.
   - **accepted**: Both parties agreed to connect.
   - **rejected**: One party declined.
   - **expired**: Timed out without response.
4. **Creation**: Opportunities are created by background matching after approved signals are created or refined. list_opportunities only reviews persisted cards; it never starts matching or targets a person.
5. **Presentation**: Each opportunity includes personalized match reasoning, confidence score, and suggested next action.

### Opportunity Workflow
1. create_intent(description) or update_intent(intentId, description) → create or refine an approved signal
2. background matching → persists opportunity cards when matches are found
3. list_opportunities() → review persisted cards
4. update_opportunity(opportunityId, status="pending") → sends to other party
5. Other party sees opportunity → calls update_opportunity(status="accepted" or "rejected")`,

        indexes: `## Index Mechanics

Indexes (also called "networks") are communities where members share what they're looking for and the system discovers connections between them.

- **Purpose prompt**: Each index has an optional prompt describing its purpose (e.g. "AI/ML co-founders in Berlin"). This prompt is used by the intent indexer to evaluate whether an intent belongs in this community. Networks without prompts accept all intents (relevancyScore defaults to 1.0).
- **Join policy**: "anyone" (open — any user can self-join) or "invite_only" (only the owner can add members).
- **Membership**: Members can see all intents in the index. The **auto-assign** setting on a membership means new intents by that user are automatically evaluated against the index.
- **Owner permissions**: Network owners can update settings (title, prompt, joinPolicy), add/remove members, and delete the network (if sole member).
- **Discovery scope**: Opportunities are discovered within index boundaries — the system matches intents of members who share at least one index.

### Index Workflow
1. create_network(title, prompt) → creates new community, you become owner
2. create_network_membership(networkId, userId) → invite members
3. Members create intents → auto-assigned to the index based on prompt
4. Members' approved signals are matched in the background; list_opportunities only reviews persisted results`,

        profiles: `## Profile System

Profiles are the user's identity on the platform, used for semantic matching in opportunity discovery.

- **Structure**: name, bio, location, skills[], interests[], social links (LinkedIn, GitHub, Twitter, websites)
- **Generation**: Auto-generated from account data (name, email, social links) via web enrichment. Can also be created from explicit user input (bioOrDescription).
- **Enrichment**: The system scrapes public profiles (LinkedIn, GitHub, Twitter) to build a rich identity with skills, interests, and narrative context.
- **Embeddings**: HyDE (Hypothetical Document Embedding) generates synthetic documents for semantic matching:
  - Mirror: self-description of the person
  - Reciprocal: what this person would look for in others
  - Neighborhood: related community context
- **Onboarding flow**: research_profile() suggests a profile from account/social data; the user confirms it in conversation and the client persists it.
- **Updates**: Profile edits go through the client's profile settings; research_profile only suggests, it never persists.

### Profile Best Practices
- Richer profiles produce better opportunity matches
- Social links enable enrichment — encourage users to add LinkedIn/GitHub
- Profiles are recalculated when updated, which may surface new matches`,

        discovery: `## Discovery Mechanics

Discovery is the process of finding meaningful connections between users based on their intents and profiles.

### How Discovery Works
1. **Trigger**: Runs automatically when an approved signal is created or refined.
2. **Pipeline**: Preparation (gather user context) → Scope (determine which indexes to search) → Candidate retrieval (semantic matching via HyDE embeddings) → Evaluation (LLM scores relevance and complementarity) → Ranking → Persist as opportunities.
3. **Semantic matching**: Uses HyDE (Hypothetical Document Embeddings) to find candidate intents that complement the source. This goes beyond keyword matching — it understands conceptual relationships.
4. **Evaluation**: An LLM evaluator agent scores each candidate match on relevance, complementarity, and actionability. Low-scoring matches are filtered out.
5. **Results**: Persisted as draft opportunities with roles, reasoning, and confidence scores.
6. **Background processing**: After intent creation, a queue job continues looking for matches asynchronously.
7. **Review**: Use list_opportunities to review persisted actionable cards; it does not run matching.

### Discovery Best Practices
- More specific intents produce more relevant matches
- Richer profiles improve matching quality
- Scope to a specific index (networkId) for more targeted results
- After discovery returns no results, suggest creating an intent to attract future matches`,

        workflows: `## Common Tool Workflows

### New User Setup
1. research_profile(linkedin/github/...) → suggest a profile from social data
2. read_networks() → see available communities
3. create_network_membership(networkId) → join a community
4. create_intent(description) → post what you're looking for
5. Background matching evaluates the approved signal; list_opportunities reviews persisted results

### Finding Connections
1. read_networks() → list user's communities (get networkId)
2. create_intent(description) or update_intent(intentId, description) → create or refine an approved signal in the relevant network
3. Background matching persists eligible cards; list_opportunities reviews them
4. update_opportunity(opportunityId, status="pending") → send a persisted card

### Helping Connections Emerge
1. read_network_memberships(networkId) → understand the shared community
2. create_intent(description) or update_intent(intentId, description) → capture or refine an approved signal
3. Background matching evaluates approved signals
4. list_opportunities() → review persisted results

### Creating a Community
1. create_network(title, prompt) → create network
2. create_network_membership(networkId, userId) → invite members
3. Members create intents → auto-indexed
4. Members' approved signals are matched in the background; list_opportunities only reviews persisted results`,

        authentication: `## Authentication & API Access

### For External AI Agents (MCP)
- Authenticate via **X-API-Key** header with a valid API key
- The API key is tied to a specific user account
- All operations execute in the context of the authenticated user
- Base URL: protocol.index.network/mcp

### Key Constraints
- Users can only read their own intents globally, or intents in indexes they belong to
- Users can only read profiles of people in shared networks
- Network-scoped operations are restricted to that index
- Only network owners can update settings, add/remove members (for invite_only networks)

### Rate Limits & Best Practices
- Avoid unnecessary read_intents/read_networks calls — cache results within a conversation
- Use pagination (limit/page) for large result sets
- Call read_docs once at the start to understand the domain`,

        // Canonical topics (on REST/chat for completeness)
        "identity-context": CANONICAL_GUIDANCE_TOPICS_CONTENT["identity-context"],
        premises: CANONICAL_GUIDANCE_TOPICS_CONTENT.premises,
        signals: CANONICAL_GUIDANCE_TOPICS_CONTENT.signals,
        "communities-networks": CANONICAL_GUIDANCE_TOPICS_CONTENT["communities-networks"],
        negotiations: CANONICAL_GUIDANCE_TOPICS_CONTENT.negotiations,
      };

      if (topic) {
        const normalizedTopic = topic.replace(/_/g, "-").toLowerCase();
        const matched = Object.entries(sections).find(
          ([key]) => key === normalizedTopic || key.includes(normalizedTopic) || normalizedTopic.includes(key)
        );
        if (matched) {
          return success({ topic: matched[0], content: matched[1] });
        }
      }

      // Return full documentation (summary + all topics)
      const fullDoc = [CANONICAL_GUIDANCE_SUMMARY, ...Object.values(sections)].join("\n\n");
      return success({ content: fullDoc });
    },
  });

  const readActivitySummary = defineTool({
    name: "read_activity_summary",
    description:
      "Returns grounded, aggregate-only activity for the authenticated user's agent over a recent time window.\n\n" +
      "**Response domains (permission-projected for agent callers):**\n" +
      "- signals (`liveSignalsWatched`, `opportunitiesBySignal` with signal IDs/titles) — requires manage:intents.\n" +
      "- opportunities (`opportunitiesSurfaced`) — requires manage:opportunities.\n" +
      "- questions (`pendingQuestionsByDomain`, `answeredQuestionsByDomain`) — meta-network counts grouped by the question's affected domain; " +
      "each domain's counts require that domain's manage:identity/premises/intents/opportunities/negotiations permission; conversational chat-mode counts are human-owner-only.\n" +
      "- negotiations (`negotiationsStarted`, `negotiationsCompleted`) — requires manage:negotiations.\n" +
      "Human owners receive every domain. Agent callers receive only the domains their permissions authorize; " +
      "a network agent's network-bound aggregates are narrowed to its bound community at the query layer.\n\n" +
      "**Privacy:** the response never returns counterparty identities, chats, turns, transcripts, per-counterparty rows, " +
      "or any private content — only aggregate counts and (with manage:intents) the owner's own signal IDs/titles.",
    querySchema: z.object({
      sinceHours: z.number().int().optional().default(24).describe("Look back this many hours; values are clamped to 1-168 (default 24)."),
    }).strict(),
    handler: async ({ context, query }) => {
      const sinceHours = Math.max(1, Math.min(168, query.sinceHours));
      // Absent on owner-trusted REST/chat surfaces → full owner view. On MCP the
      // server binds the typed resolved caller context and the centralized
      // projection decides every visible domain.
      const caller = context.mcpCaller
        ? McpActivityCallerSchema.parse(context.mcpCaller)
        : HUMAN_OWNER_CALLER;
      const networkId = activitySummaryNetworkId(caller);
      const summary = await deps.userDb.getAgentActivitySummary({
        sinceHours,
        ...(networkId ? { networkId } : {}),
      });
      return success(ActivitySummaryResponseSchema.parse(
        projectActivitySummary(caller, summary),
      ));
    },
  });

  return [scrapeUrl, readDocs, readActivitySummary].filter(
    (tool): tool is Exclude<typeof tool, null> => tool !== null,
  );
}
