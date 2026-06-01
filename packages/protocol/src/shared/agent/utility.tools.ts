import { z } from "zod";

import { requestContext } from "../observability/request-context.js";

import type { DefineTool, ToolDeps } from "./tool.helpers.js";
import { success, error, normalizeUrl } from "./tool.helpers.js";

export function createUtilityTools(defineTool: DefineTool, deps: ToolDeps) {
  const { scraper } = deps;

  const scrapeUrl = defineTool({
    name: "scrape_url",
    description:
      "Extracts text content from a web URL — articles, LinkedIn/GitHub profiles, documentation, project pages, etc. " +
      "Returns the page's text content (up to 10,000 characters) for use in subsequent tool calls.\n\n" +
      "**When to use:**\n" +
      "- Before create_intent: when the user shares a URL and wants to create an intent from it. Scrape first, then synthesize into a description.\n" +
      "- Before create_user_profile or update_user_profile: when the user shares a profile URL to update their profile from.\n" +
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
      "**When to use:** Call this FIRST when starting a new session. MCP agents MUST call read_docs(topic='mcp_agent_guide') at the start of every conversation to learn proper output formatting and workflow rules.\n" +
      "Also call when you need to understand:\n" +
      "- What entities exist and how they relate (intents, indexes, opportunities, profiles, contacts)\n" +
      "- The discovery workflow (how intents become opportunities)\n" +
      "- Which tools to call in what order for common tasks\n" +
      "- Authentication and API patterns\n\n" +
      "**Returns:** Markdown documentation. Pass `topic` to get a specific section, or omit for the full reference.\n\n" +
      "**Available topics:** 'entities', 'intents', 'opportunities', 'indexes', 'profiles', 'contacts', 'discovery', 'workflows', 'authentication', 'mcp_agent_guide'",
    querySchema: z.object({
      topic: z.string().optional().describe("Narrow to a specific topic: 'entities', 'intents', 'opportunities', 'indexes', 'profiles', 'contacts', 'discovery', 'workflows', or 'authentication'. Omit to get the full documentation."),
    }),
    handler: async ({ context: _context, query }) => {
      const topic = query.topic?.trim().toLowerCase();

      const sections: Record<string, string> = {
        entities: `## Entity Model & Relationships

- **Users**: People on the platform. Authenticated via API key (X-API-Key header) for MCP/external agents, or session-based (Better Auth) for the web app.
- **Profiles**: A user's identity — name, bio, skills, interests, location, social links. Generated from account data or social URLs via enrichment. One profile per user.
- **Indexes** (also called "networks"): Communities or groups where members share intents and discover opportunities. Each has a title, optional prompt (purpose description), join policy (anyone or invite_only), and an owner. The user's **personal index** (isPersonal=true) stores their contacts.
- **Index Members**: Junction between Users and Indexes. Tracks permissions (owner, member, contact), join date, auto-assign setting, and optional member prompt.
- **Intents**: Signals of interest/need — what a user is looking for (e.g. "Looking for a React developer in Berlin"). Each has a description (payload), summary, confidence score (0-1), inferenceType (explicit/implicit), source tracking, and vector embedding.
- **IntentNetworks**: Many-to-many junction between Intents and Indexes. An intent can be in multiple indexes. Has a relevancyScore (0-1) indicating how well the intent fits the index's purpose.
- **Opportunities**: Discovered connections between users based on complementary intents within shared indexes. Have actors with roles (introducer, party), status lifecycle, match reasoning, confidence score, and presentation data.
- **Contacts**: People in a user's personal network, stored as index members with 'contact' permission on the personal index. Can be real users or ghost users (placeholder accounts enriched from public data).
- **Ghost Users**: Placeholder accounts created for contacts who aren't on the platform yet. Enriched with public profile data (LinkedIn, GitHub) and participate in opportunity matching.

### Key Relationships
- Users → Profiles (1:1)
- Users → Indexes (many:many via Index Members)
- Users → Intents (1:many, user owns intents)
- Intents → Indexes (many:many via IntentNetworks with relevancyScore)
- Opportunities → Users (many:many via actors with roles)
- Opportunities → Indexes (scoped to shared index context)
- Contacts → Personal Index (stored as members with 'contact' permission)`,

        intents: `## Intent Lifecycle

Intents are the core unit of discovery — they represent what users are seeking and drive semantic matching.

1. **Creation** (create_intent): User describes what they're looking for. The system runs inference (extracting structured intents from free text) and verification (checking specificity, speech-act type). Returns a proposal for user approval.
2. **Confidence & Classification**: Each intent gets a confidence score (0-1), inferenceType (explicit = user stated directly, implicit = system inferred), and speech act classification (commissive, directive, assertive).
3. **Index Assignment**: After creation, the intent is automatically evaluated against all indexes the user belongs to. The index's prompt is used as criteria. Matching indexes get linked via IntentNetworks with a relevancyScore (0-1).
4. **Discovery Trigger**: Creating an intent triggers background opportunity detection — the system searches for other users in shared indexes whose intents complement this one.
5. **Source Tracking**: Intents track their origin via sourceType (file, integration, link, discovery_form, enrichment) and sourceId.
6. **Update** (update_intent): Re-processes through inference/verification, recalculates embeddings and index assignments.
7. **Archive** (delete_intent): Soft-deletes the intent. It stops participating in discovery but is not permanently removed.

### Intent Best Practices
- Be specific: "Looking for a senior React developer for a 3-month contract in Berlin" > "Need a developer"
- One intent per need: don't combine multiple requests into one intent
- Update rather than delete+create to preserve history`,

        opportunities: `## Opportunity Lifecycle

Opportunities represent discovered connections between users — potential matches worth pursuing.

1. **Detection** (discover_opportunities): The opportunity graph finds users whose intents semantically complement each other within shared indexes. Uses HyDE embeddings for retrieval and an LLM evaluator for scoring.
2. **Roles**: Each opportunity assigns roles to actors:
   - **introducer**: The person who triggered the introduction (may be the system or another user)
   - **party**: The people being connected (typically 2)
3. **Status Flow**: draft → pending → accepted/rejected/expired
   - **draft**: Created but not sent. Only the creator/introducer sees it.
   - **pending**: Sent to the other party. They're notified and can respond.
   - **accepted**: Both parties agreed to connect.
   - **rejected**: One party declined.
   - **expired**: Timed out without response.
4. **Creation Modes**:
   - **Discovery**: Automatic — system finds matches based on intent overlap (discover_opportunities with searchQuery)
   - **Introduction**: Manual — a user introduces two specific people (discover_opportunities with partyUserIds + entities)
   - **Direct**: One-to-one — connect with a specific person (discover_opportunities with targetUserId)
5. **Presentation**: Each opportunity includes personalized match reasoning, confidence score, and suggested next action.

### Opportunity Workflow
1. discover_opportunities(searchQuery="AI engineers") → returns draft opportunity cards
2. update_opportunity(opportunityId, status="pending") → sends to other party
3. Other party sees opportunity → calls update_opportunity(status="accepted" or "rejected")`,

        indexes: `## Index Mechanics

Indexes (also called "networks") are communities where members share what they're looking for and the system discovers connections between them.

- **Purpose prompt**: Each index has an optional prompt describing its purpose (e.g. "AI/ML co-founders in Berlin"). This prompt is used by the intent indexer to evaluate whether an intent belongs in this community. Indexes without prompts accept all intents (relevancyScore defaults to 1.0).
- **Join policy**: "anyone" (open — any user can self-join) or "invite_only" (only the owner can add members).
- **Personal index**: Each user has exactly one personal index (isPersonal=true) created on registration. It stores their contacts. Cannot be deleted, renamed, or listed publicly.
- **Membership**: Members can see all intents in the index. The **auto-assign** setting on a membership means new intents by that user are automatically evaluated against the index.
- **Owner permissions**: Index owners can update settings (title, prompt, joinPolicy), add/remove members, and delete the index (if sole member).
- **Discovery scope**: Opportunities are discovered within index boundaries — the system matches intents of members who share at least one index.

### Index Workflow
1. create_network(title, prompt) → creates new community, you become owner
2. create_network_membership(networkId, userId) → invite members
3. Members create intents → auto-assigned to the index based on prompt
4. discover_opportunities(networkId) → discover matches within this community`,

        profiles: `## Profile System

Profiles are the user's identity on the platform, used for semantic matching in opportunity discovery.

- **Structure**: name, bio, location, skills[], interests[], social links (LinkedIn, GitHub, Twitter, websites)
- **Generation**: Auto-generated from account data (name, email, social links) via web enrichment. Can also be created from explicit user input (bioOrDescription).
- **Enrichment**: The system scrapes public profiles (LinkedIn, GitHub, Twitter) to build a rich identity with skills, interests, and narrative context.
- **Embeddings**: HyDE (Hypothetical Document Embedding) generates synthetic documents for semantic matching:
  - Mirror: self-description of the person
  - Reciprocal: what this person would look for in others
  - Neighborhood: related community context
- **Onboarding flow**: create_user_profile() → preview → create_user_profile(confirm=true) → complete_onboarding()
- **Updates**: Use update_user_profile for targeted changes, create_user_profile for full regeneration.

### Profile Best Practices
- Richer profiles produce better opportunity matches
- Social links enable enrichment — encourage users to add LinkedIn/GitHub
- Profiles are recalculated when updated, which may surface new matches`,

        contacts: `## Contact Management

Contacts are people in a user's personal network, stored as members of their personal index with 'contact' permission.

- **Adding contacts**: Via import_contacts (bulk), add_contact (single email), or import_gmail_contacts (Google integration).
- **Ghost users**: When a contact email doesn't match an existing account, a ghost user is created. Ghost users are enriched with public profile data and participate in opportunity matching — they can be discovered even before joining the platform.
- **Personal index scope**: Pass the personal index networkId to discover_opportunities to scope discovery to just the user's contacts.
- **Contact data**: Each contact has userId, name, email, avatar, and isGhost flag.

### Contact Workflow
1. import_contacts or import_gmail_contacts → bulk add to network
2. list_contacts → view all contacts with userId
3. discover_opportunities(networkId=personalIndexId) → find matches among contacts
4. add_contact(email) → add individual contact
5. remove_contact(contactUserId) → remove from network`,

        discovery: `## Discovery Mechanics

Discovery is the process of finding meaningful connections between users based on their intents and profiles.

### How Discovery Works
1. **Trigger**: Runs automatically when an intent is created, or explicitly when discover_opportunities is called.
2. **Pipeline**: Preparation (gather user context) → Scope (determine which indexes to search) → Candidate retrieval (semantic matching via HyDE embeddings) → Evaluation (LLM scores relevance and complementarity) → Ranking → Persist as opportunities.
3. **Semantic matching**: Uses HyDE (Hypothetical Document Embeddings) to find candidate intents that complement the source. This goes beyond keyword matching — it understands conceptual relationships.
4. **Evaluation**: An LLM evaluator agent scores each candidate match on relevance, complementarity, and actionability. Low-scoring matches are filtered out.
5. **Results**: Persisted as draft opportunities with roles, reasoning, and confidence scores.
6. **Background processing**: After intent creation, a queue job continues looking for matches asynchronously.
7. **Pagination**: Large result sets are paginated. Use continueFrom with the discoveryId to evaluate more candidates.

### Discovery Best Practices
- More specific intents produce more relevant matches
- Richer profiles improve matching quality
- Scope to a specific index (networkId) for more targeted results
- After discovery returns no results, suggest creating an intent to attract future matches`,

        workflows: `## Common Tool Workflows

### New User Setup
1. create_user_profile(linkedinUrl/githubUrl) → generate profile from social data
2. complete_onboarding() → unlock full access
3. read_networks() → see available communities
4. create_network_membership(networkId) → join a community
5. create_intent(description) → post what you're looking for
6. discover_opportunities(searchQuery) → find matches

### Finding Connections
1. read_networks() → list user's communities (get networkId)
2. discover_opportunities(searchQuery, networkId) → discover matches
3. Review opportunity cards → update_opportunity(opportunityId, status="pending") to send

### Making an Introduction
1. read_network_memberships(networkId) → find members in shared community
2. read_user_profiles(userId) → get profiles of both parties
3. read_intents(networkId, userId) → get intents of both parties
4. discover_opportunities(partyUserIds=[id1,id2], entities=[...], hint="reason") → create introduction

### Managing Contacts
1. import_gmail_contacts() or import_contacts([...]) → add contacts
2. list_contacts() → view network
3. discover_opportunities(networkId=personalIndexId) → find matches among contacts

### Creating a Community
1. create_network(title, prompt) → create index
2. create_network_membership(networkId, userId) → invite members
3. Members create intents → auto-indexed
4. discover_opportunities(networkId) → discover connections within community`,

        authentication: `## Authentication & API Access

### For External AI Agents (MCP)
- Authenticate via **X-API-Key** header with a valid API key
- The API key is tied to a specific user account
- All operations execute in the context of the authenticated user
- Base URL: protocol.index.network/mcp

### Key Constraints
- Users can only read their own intents globally, or intents in indexes they belong to
- Users can only read profiles of people in shared indexes
- Index-scoped operations are restricted to that index
- Personal indexes cannot be deleted or renamed
- Only index owners can update settings, add/remove members (for invite_only indexes)

### Rate Limits & Best Practices
- Avoid unnecessary read_intents/read_networks calls — cache results within a conversation
- Use pagination (limit/page) for large result sets
- Call read_docs once at the start to understand the domain`,

        mcp_agent_guide: `## MCP Agent Integration Guide

**IMPORTANT: Read this section if you are an AI agent accessing Index Network via MCP tools.**

### Output Formatting
- Tool results often contain structured JSON data (proposals, opportunities, cards). **Do NOT dump raw JSON to the user.** Parse the JSON and present information in natural language with clear formatting.
- Some tool results contain interactive card markup (code blocks with \`intent_proposal\`, \`opportunity_card\` language tags). These are designed for the Index Network web UI. **As an MCP agent, ignore card markup.** Instead, extract the meaningful data from the JSON and present it conversationally.
- When presenting opportunities or intents, use bullet points or short paragraphs — not raw JSON objects.

### Intent Creation Workflow
- **Always pass \`autoApprove: true\` when calling \`create_intent\`.** This persists intents directly without returning proposal cards that require manual UI approval.
- The tool will return a list of created intents with their descriptions and confidence scores. Present these in natural language.
- Do not tell the user to "click on cards" or "approve above" — there is no UI. Intents are created immediately with autoApprove.
- After creating intents, proactively suggest or run discovery to find matches.

### Discovery Workflow
- After creating intents, proactively suggest running discovery: \`discover_opportunities(searchQuery=...)\`
- Present discovered opportunities in natural language with the counterpart's name, match reasoning, and suggested next steps.
- Do not reference "cards", "panels", or any web UI elements.

### General MCP Agent Rules
- You are operating via API tools, not a web interface. Never reference clicking, scrolling, cards, panels, or any visual UI elements.
- Be proactive: if a logical next step exists (e.g., running discovery after creating intents), suggest or execute it.
- Use \`list_opportunities\` to check existing matches, \`list_negotiations\` for ongoing negotiations.
- Use \`read_networks\` to understand which communities the user belongs to before scoping operations.
- When errors occur, provide clear technical context rather than vague "backend issue" messages.`,
      };

      if (topic) {
        const matched = Object.entries(sections).find(([key]) => key.includes(topic) || topic.includes(key));
        if (matched) {
          return success({ topic: matched[0], content: matched[1] });
        }
        // If topic not found, return all
      }

      const fullDoc = Object.values(sections).join("\n\n");
      return success({ content: fullDoc });
    },
  });

  return [scrapeUrl, readDocs] as const;
}
