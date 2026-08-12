import type { BaseMessage, AIMessage } from "@langchain/core/messages";

import type { ResolvedToolContext } from "../shared/agent/tool.factory.js";
import { focusedIntentId } from "../shared/agent/tool.scope.js";

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
  /** Whether an earlier assistant turn visibly contained a valid action proposal. */
  hasPriorAgentActionProposal?: boolean;
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

const intentCreationModule: PromptModule = {
  id: "intent-creation",
  triggers: ["create_intent"],
  content: () => `
### 2. User explicitly wants to create or save an intent

**YOU decide if it's specific enough. The tool proposes — the user confirms.**

\`\`\`
IF description is vague ("find a job", "meet people", "learn something"):
  1. read_user_contexts()           → get their background
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
  triggers: ["read_user_contexts"],
  content: () => `
### 0. User asks about a specific person by name

When the user mentions a specific person by name ("find [name]", "look up [name]", "who is [name]?", "tell me about [name]"), look them up by name first — do NOT use discovery.

- Call \`read_user_contexts(query="the name")\` — this finds members by name across the user's indexes
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
  content: (ctx) => `
### 3. User includes a URL

**YOU handle scraping before ${focusedIntentId(ctx) ? "updating the selected intent" : "intent creation"}.**

\`\`\`
1. scrape_url(url, objective="Extract key details for an intent")
2. Synthesize a conceptual description from scraped content
3. ${focusedIntentId(ctx) ? `update_intent(intentId="${focusedIntentId(ctx)}", description=synthesized_summary)` : "create_intent(description=synthesized_summary)"}
\`\`\`

Exception: for profile creation, pass URLs directly to create_user_context (it handles scraping internally).

If the user pastes or types a profile URL (e.g. linkedin.com/..., github.com/...) to create or update their profile, you MUST pass that exact URL in the corresponding parameter (e.g. linkedinUrl, githubUrl, twitterUrl) to create_user_context, or use scrape_url with that URL then update_user_context; do not use the user's stored social links for that request.
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
Index and community membership is background: handle it without talking about indexes unless the user asks or it's sign-up, leave, or owner settings. Do not proactively mention "your indexes", "your communities", "which index", "in your current communities", or similar. Only mention indexes (or communities, lists) when: (i) post-onboarding sign-up to a community, (ii) user explicitly asked about their indexes/communities, (iii) user wants to leave one, (iv) owner is changing index/community settings. Otherwise use neutral language ("where you're connected", "people you're connected with") and do not narrate "your indexes", "your current communities", "in this network", etc.
`,
};

const contactsModule: PromptModule = {
  id: "contacts",
  triggers: ["import_gmail_contacts", "add_contact", "list_contacts", "remove_contact"],
  // Gate on the CONTACTS_ENABLED flag (fail-closed: only `true` enables). When
  // contacts are disabled the import/add tools are de-registered, so this module
  // must not be injected — otherwise the orchestrator keeps advertising Gmail
  // import / add_contact and offers an action that then fails as "Unknown tool".
  triggerFilter: (iterCtx) => iterCtx.ctx.contactsEnabled === true,
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
4. For each shared network: read_intents(networkId=shared)
5. read_user_contexts(userId=other)
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
