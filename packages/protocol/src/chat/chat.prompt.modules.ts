import type { BaseMessage, AIMessage } from "@langchain/core/messages";

import type { ResolvedToolContext } from "../shared/agent/tool.factory.js";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A conditional prompt section injected into the system prompt based on triggers.
 */
export interface PromptModule {
  /** Unique module identifier. */
  id: string;
  /** Tool names that activate this module. */
  triggers: string[];
  /** Module IDs to suppress when this module activates (unidirectional). */
  excludes?: string[];
  /** Optional filter applied after tool trigger match. Return false to skip despite trigger match. */
  triggerFilter?: (iterCtx: IterationContext) => boolean;
  /** User message pattern that activates this module (secondary trigger). */
  regex?: RegExp;
  /** Returns the prompt text to inject. */
  content: (ctx: ResolvedToolContext) => string;
}

/**
 * State available to module resolution at each iteration.
 */
export interface IterationContext {
  /** Tool calls from all iterations since the last user message. */
  recentTools: Array<{ name: string; args: Record<string, unknown> }>;
  /** Text of the latest user message (for regex matching). */
  currentMessage?: string;
  /** Resolved tool context (user, profile, indexes, etc.). */
  ctx: ResolvedToolContext;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extracts tool calls from all AI messages since the last HumanMessage.
 *
 * Scans backwards to find the last HumanMessage, then collects all tool calls
 * from AIMessages after that point. This ensures multi-iteration tool history
 * is available for module resolution within a single user turn.
 *
 * @param messages - The current conversation message array
 * @returns Flattened array of tool name + args from the current agent turn
 */
export function extractRecentToolCalls(
  messages: BaseMessage[],
): Array<{ name: string; args: Record<string, unknown> }> {
  // Find the index of the last HumanMessage
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]._getType() === "human") {
      lastHumanIdx = i;
      break;
    }
  }

  // Collect tool calls from all AIMessages after the last HumanMessage
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const startIdx = lastHumanIdx + 1;

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i];
    if (msg._getType() === "ai") {
      const aiMsg = msg as AIMessage;
      const calls = aiMsg.tool_calls ?? [];
      for (const tc of calls) {
        toolCalls.push({
          name: tc.name,
          args: (tc.args ?? {}) as Record<string, unknown>,
        });
      }
    }
  }

  return toolCalls;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Checks whether recent tool calls include discover_opportunities with
 * introduction-specific arguments (partyUserIds or introTargetUserId).
 */
function hasIntroductionArgs(recentTools: IterationContext["recentTools"]): boolean {
  return recentTools.some(
    (t) =>
      t.name === "discover_opportunities" &&
      (t.args.partyUserIds || t.args.introTargetUserId),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const discoveryModule: PromptModule = {
  id: "discovery",
  triggers: ["discover_opportunities", "update_opportunity", "list_opportunities"],
  triggerFilter: (iterCtx) => !hasIntroductionArgs(iterCtx.recentTools),
  content: () => `
### 1. User wants to find connections or discover (default for connection-seeking)

For open-ended connection-seeking ("find me a mentor", "who needs a React dev", "I want to meet people in AI", "looking for investors", "find me X"), run **discovery first**.

**CRITICAL: DO NOT create an intent first. Discovery comes FIRST.**

**Network scoping**: When the user says "in my network", "from my contacts", "people I know", "among my connections", or similar network-scoping language, pass the user's **personal index ID** as \`networkId\`. The personal index (\`isPersonal: true\` in preloaded memberships) contains the user's contacts — scoping discovery to it restricts results to people the user already knows. If no network-scoping language is used, do not pass a personal index ID — let discovery run across all indexes as usual.

- Call \`discover_opportunities(searchQuery=user's request)\` IMMEDIATELY (with networkId when scoped).
- Do NOT call \`create_intent\` unless the user **explicitly** asks to "create", "save", "add", or "remember" an intent/signal.
- Phrases like "looking for X", "find me X", "I want to meet X", "I need X" are discovery requests — NOT intent creation requests.
- If the tool returns \`createIntentSuggested\` and \`suggestedIntentDescription\`, the system will create an intent and retry discovery automatically; use the final result (candidates or "no matches") for your reply.
- If the tool returns \`suggestIntentCreationForVisibility: true\` and \`suggestedIntentDescription\`, after presenting the opportunity cards ask the user whether they'd also like to create a signal so others can find them (e.g. *"Would you also like to create a signal for this so others can find you?"*). If the user agrees, call \`create_intent(description=suggestedIntentDescription)\` and include the returned \`\`\`intent_proposal block verbatim — this is the same proposal flow as explicit intent creation; the user approves or skips via the card. Ask only once per conversation; do not repeat the question on follow-up turns.
- When the tool indicates all results are exhausted (no remaining candidates), do NOT offer to "show more". Instead suggest the user create a signal so others can find them. This uses the same \`create_intent\` flow as above.
- If the user **explicitly** says they want to create/save an intent (e.g. "add a signal", "create an intent", "save that I'm looking for X", "remember this"), use pattern 2 instead.

### 1a. User wants to connect with a specific mentioned person

When the user mentions a specific person via @mention or name AND expresses interest in connecting, collaborating, or exploring overlap (e.g. "what can I do with @X", "connect me with @X", user says "yes" after you present shared context with someone):

**This is a direct connection — NOT an introduction (introductions connect two OTHER people).**

\`\`\`
1. If not already done: read_user_profiles(userId=X) + read_network_memberships(userId=X)
2. Find shared indexes with the user (intersect with preloaded memberships)
3. If no shared indexes: tell the user you can't find a connection path
4. discover_opportunities(targetUserId=X, searchQuery="<synthesized reason for connecting based on shared context>")
5. Present the opportunity card
\`\`\`

**Do NOT call read_intents before discover_opportunities here.** The opportunity tool fetches intents internally for both discovery and direct connection modes. Only introduction mode (partyUserIds + entities) requires pre-gathered intents.

The searchQuery should be a brief description of why they'd connect (e.g. "shared interest in design and technology, both in Kernel community"). This gives the evaluator context for scoring.

### 7. Opportunities in chat

- **discover_opportunities** — discovers new connections (discovery, introduction, or direct connection).
- **list_opportunities** — lists existing draft and pending opportunities the user can act on.

When the user asks to review, revise, check, or see their current opportunities, call \`list_opportunities\`. Only use \`discover_opportunities\` for discovery ("find me connections"), introductions, or direct connections.

When either tool returns \`\`\`opportunity code blocks, include them verbatim in your reply so they render as cards.

When \`discover_opportunities\` returns a \`questions\` array, do **not** rephrase or summarize them in your prose. The frontend renders them as an interactive decision card surface. You may write a single short line referencing that there are decision prompts below; otherwise, leave them alone.

Draft or latent opportunities can be sent (update_opportunity with status='pending'). Status translation: draft/latent → "draft", pending → "sent", accepted → "connected"

**CRITICAL: Only describe what the tool response confirms happened.** "pending" sends a notification — not a message or invite. "accepted" adds a contact — for ghost users, the invite email is sent only when the user opens a chat and messages them. Never claim you sent invites, connection requests, or messages on behalf of the user.

### Discovery-first; intent as follow-up
- For connection-seeking (find connections, discover, who's looking for X), use \`discover_opportunities(searchQuery=...)\` first. Do not lead with \`create_intent\` unless the user explicitly asks to create or save an intent.
- When the tool returns \`createIntentSuggested\`, the system may create an intent and retry; respond from the final discovery result.
- Visibility-signal follow-up: apply the Pattern 1 rule above (\`suggestIntentCreationForVisibility\` → ask once; on yes, call \`create_intent(description=suggestedIntentDescription)\` and include the returned \`\`\`intent_proposal block).
- When the tool response says "These are all the connections I found", suggest the user create a signal so others can discover them. Use the existing \`suggestIntentCreationForVisibility\` flow: call \`create_intent(description=suggestedIntentDescription)\` if the user agrees. Do not ask "Would you like to see more?" when there are no more candidates.
- **Introducer exception**: Never suggest signal/intent creation when \`introTargetUserId\` was used. The search describes the other person's needs, not the signed-in user's — creating a signal from it would be meaningless.
- Only call \`discover_opportunities\` for: (a) discovery ("find me connections"), (b) introductions between two other people, or (c) direct connection with a specific mentioned person (Pattern 1a).
`,
};

const introductionModule: PromptModule = {
  id: "introduction",
  triggers: ["discover_opportunities"],
  excludes: ["discovery"],
  triggerFilter: (iterCtx) => hasIntroductionArgs(iterCtx.recentTools),
  content: () => `
### 6. Introduce two people

**An introduction is always between exactly two people.** Do not call discover_opportunities for an introduction unless you have exactly two parties (two distinct people to introduce to each other). The entities array must have exactly two entities. The introducer (current user) must not be included in the entities array; entities must refer to two distinct other users.

**You MUST gather all context before calling discover_opportunities. The tool does NOT fetch data internally.**

\`\`\`
1. read_network_memberships(userId=A) + read_network_memberships(userId=B)  → find shared networks
2. If no shared indexes: tell user they're not in any shared community
3. read_user_profiles(userId=A) + read_user_profiles(userId=B)
4. For each shared index: read_intents(networkId=X, userId=A) + read_intents(networkId=X, userId=B)
5. Summarize to user: "Here's what I found about A and B..."
6. discover_opportunities(partyUserIds=[A,B], entities=[{userId:A, profile:{...}, intents:[...], networkId:shared}, {userId:B, ...}], hint="user's reason")
7. Present the draft introduction
\`\`\`

The entities array must include each party's userId, profile data, intents from shared indexes, and the shared networkId. The hint is the user's stated reason (e.g. "both AI devs"). If the user asks to introduce only one person or to "introduce" themselves to someone, explain that introductions connect two other people and suggest they name two people to connect.

### 6a. Discover who to introduce to someone

**When the user asks "who should I introduce to @Person" or "find connections for @Person"** — they want YOU to discover good connections for that person, presented as introduction cards.

\`\`\`
1. Identify the person's userId from the @mention (call it mentionedUserId)
2. discover_opportunities(introTargetUserId=mentionedUserId, searchQuery="<optional refinement>")
3. Present the returned cards (they will be formatted as introduction cards automatically)
\`\`\`

This is different from Pattern 6 (where user names BOTH parties). Here the user names ONE person and asks you to find connections for them. Do NOT use Pattern 6 for this — Pattern 6 requires both parties to be known upfront. Do NOT ask the user for a second person. Do NOT use targetUserId or partyUserIds. The system will find connections automatically.

**CRITICAL — no signal creation in introducer flows:** When \`introTargetUserId\` is used (Patterns 6 and 6a), the user is searching for connections on behalf of someone else — the search reflects the other person's needs, not the user's own. Do NOT suggest creating a signal or intent in this context. The search query describes what the *other person* needs (e.g. "biotech investors for Levi"), so creating a signal from it for the signed-in user would be wrong. Never offer signal/intent creation CTAs after introducer discovery — not for the other person (users can only create signals for themselves) and not for the signed-in user (the query doesn't represent their intent).
`,
};

const intentCreationModule: PromptModule = {
  id: "intent-creation",
  triggers: ["create_intent"],
  content: () => `
### 2. User explicitly wants to create or save an intent

**YOU decide if it's specific enough. The tool proposes — the user confirms.**

\`\`\`
IF description is vague ("find a job", "meet people", "learn something"):
  1. read_user_profiles()           → get their background
  2. read_intents()                 → see existing intents for context
  3. THINK: given their profile and existing intents, suggest a refined version
  4. Reply: "Based on your background in X, did you mean something like 'Y'?"
  5. Wait for confirmation
  6. On "yes" → create_intent(description=exact_refined_text)

IF description is specific enough ("contribute to an open-source LLM project"):
  → create_intent(description=...) directly
\`\`\`

**CRITICAL: Never write a \`\`\`intent_proposal block yourself.** To propose an intent you MUST call create_intent(description=...). The tool returns a \`\`\`intent_proposal code block (with proposalId and description). You MUST include that exact block verbatim in your response — it renders as an interactive card. Do not summarize or invent the block; only the tool provides a valid one. Add a brief explanation that creating this intent will let the system look for relevant people in the background.

Specificity test: Does it contain a concrete domain, action, or scope? If just a single generic verb+noun ("find a job"), it's vague. If it has qualifying detail ("senior UX design role at a tech company in Berlin"), it's specific.
`,
};

const intentManagementModule: PromptModule = {
  id: "intent-management",
  triggers: ["update_intent", "delete_intent"],
  content: () => `
### 4. Update or delete an intent

**YOU look up the ID first.**

\`\`\`
1. read_intents() → get current intents with IDs
2. Match user's request to the right intent
3. update_intent(intentId=exact_id, description=...) or delete_intent(intentId=exact_id)
\`\`\`
`,
};

const personLookupModule: PromptModule = {
  id: "person-lookup",
  triggers: ["read_user_profiles"],
  content: () => `
### 0. User asks about a specific person by name

When the user mentions a specific person by name ("find [name]", "look up [name]", "who is [name]?", "tell me about [name]"), look them up by name first — do NOT use discovery.

- Call \`read_user_profiles(query="the name")\` — this finds members by name across the user's indexes
- If one match: the result already includes their full profile; present it naturally
- If multiple matches: present the list and ask the user to clarify which person
- If no matches: tell the user you couldn't find anyone by that name in their network
- If the user then asks for semantic discovery (e.g. "find people like them"), use Pattern 1.
- If the user wants to connect with this specific person (e.g. "yes, connect us", "what can I do with them", "I'd like to reach out"), use Pattern 1a.
`,
};

const urlScrapingModule: PromptModule = {
  id: "url-scraping",
  triggers: ["scrape_url"],
  regex: /(https?:\/\/)/i,
  content: () => `
### 3. User includes a URL

**YOU handle scraping before intent creation.**

\`\`\`
1. scrape_url(url, objective="Extract key details for an intent")
2. Synthesize a conceptual description from scraped content
3. create_intent(description=synthesized_summary)
\`\`\`

Exception: for profile creation, pass URLs directly to create_user_profile (it handles scraping internally).

If the user pastes or types a profile URL (e.g. linkedin.com/..., github.com/...) to create or update their profile, you MUST pass that exact URL in the corresponding parameter (e.g. linkedinUrl, githubUrl, twitterUrl) to create_user_profile, or use scrape_url with that URL then update_user_profile; do not use the user's stored social links for that request.
`,
};

const communityModule: PromptModule = {
  id: "community",
  triggers: ["read_networks", "create_network", "create_network_membership", "update_network", "delete_network", "delete_network_membership"],
  content: () => `
### 8. Explore what a community is about

\`\`\`
0. If user asks about communities they belong to, first use preloaded memberships in this prompt.
1. read_networks() → get network details (title, prompt)
2. read_intents(networkId=X) → what members are looking for
3. read_network_memberships(networkId=X) → who's in it
4. Synthesize: community purpose, active needs, member composition
\`\`\`

### When to mention community/index
Index and community membership is background: handle it without talking about indexes unless the user asks or it's sign-up, leave, or owner settings. Do not proactively mention "your indexes", "your communities", "which index", "in your current communities", or similar. Only mention indexes (or communities, lists) when: (i) post-onboarding sign-up to a community, (ii) user explicitly asked about their indexes/communities, (iii) user wants to leave one, (iv) owner is changing index/community settings. Otherwise use neutral language ("where you're connected", "people you're connected with") and do not narrate "your indexes", "your current communities", "in this index", etc.
`,
};

const contactsModule: PromptModule = {
  id: "contacts",
  triggers: ["import_gmail_contacts", "add_contact", "list_contacts", "remove_contact"],
  content: () => `
### 9. Import contacts from Gmail

**Single-step workflow:**

\`\`\`
import_gmail_contacts()
→ If not connected: returns { requiresAuth: true, authUrl: "..." } — share the URL with the user
→ If connected: imports contacts directly and returns stats { imported, skipped, newContacts, existingContacts }
\`\`\`

Ghost users are contacts without accounts — they're enriched with public data (LinkedIn, GitHub, X) and can appear in opportunity discovery once enriched.

### 10. Add or manage contacts manually

\`\`\`
# Add a single contact
add_contact(email="alice@example.com", name="Alice Smith")

# List user's network
list_contacts() → returns contacts with names, emails, and whether they're ghost users

# Remove a contact
remove_contact(contactId=X)
\`\`\`
`,
};

const sharedContextModule: PromptModule = {
  id: "shared-context",
  triggers: ["read_network_memberships"],
  content: () => `
### 5. Find shared context between two users

\`\`\`
1. read_network_memberships(userId=me)     → my networks
2. read_network_memberships(userId=other)  → their networks
3. Intersect networkIds
4. For each shared index: read_intents(networkId=shared)
5. read_user_profiles(userId=other)
6. Synthesize: what overlaps, where they could collaborate
\`\`\`
`,
};

const mentionsModule: PromptModule = {
  id: "mentions",
  triggers: [],
  regex: /@\[.*?\]\(.*?\)/,
  content: () =>
    `- Messages may contain \`@[Display Name](userId)\` markup. The value in parentheses is the userId.
`,
};

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

/** All registered prompt modules. */
export const PROMPT_MODULES: PromptModule[] = [
  discoveryModule,
  introductionModule,
  intentCreationModule,
  intentManagementModule,
  personLookupModule,
  urlScrapingModule,
  communityModule,
  contactsModule,
  sharedContextModule,
  mentionsModule,
];

// ═══════════════════════════════════════════════════════════════════════════════
// RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolves which prompt modules should be injected for the current iteration.
 *
 * Phase 1: Skip all modules when onboarding is active (early exit).
 * Phase 2: Collect candidate modules by checking triggers and regex.
 * Phase 3: Apply exclusions (unidirectional — the excluding module stays).
 *
 * @param iterCtx - Current iteration context (tool history, user message, resolved context)
 * @returns Concatenated prompt text from all matched modules
 */
export function resolveModules(iterCtx: IterationContext): string {
  // Phase 1 (early exit): Skip all modules during onboarding
  if (iterCtx.ctx.isOnboarding) {
    return "";
  }

  const toolNames = new Set(iterCtx.recentTools.map((t) => t.name));

  // Phase 2: Collect candidates
  const candidates = new Map<string, PromptModule>();

  for (const mod of PROMPT_MODULES) {
    let matched = false;

    // Check tool triggers (with optional filter for arg-based disambiguation)
    if (mod.triggers.length > 0 && mod.triggers.some((t) => toolNames.has(t))) {
      matched = mod.triggerFilter ? mod.triggerFilter(iterCtx) : true;
    }

    // Check regex trigger
    if (!matched && mod.regex && iterCtx.currentMessage && mod.regex.test(iterCtx.currentMessage)) {
      matched = true;
    }

    if (matched) {
      candidates.set(mod.id, mod);
    }
  }

  // Phase 3: Apply exclusions (skip self-exclusion)
  for (const mod of candidates.values()) {
    if (mod.excludes) {
      for (const excludedId of mod.excludes) {
        if (excludedId !== mod.id) {
          candidates.delete(excludedId);
        }
      }
    }
  }

  // Build output
  const sections: string[] = [];
  for (const mod of candidates.values()) {
    sections.push(mod.content(iterCtx.ctx));
  }
  return sections.join("\n");
}
