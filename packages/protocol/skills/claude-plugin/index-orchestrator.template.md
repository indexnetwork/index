---
name: index-orchestrator
description: Use when the user asks about finding people, connections, opportunities, signals/intents, contacts, community indexes, or anything related to Index Network discovery and network management.
---

# Index Network — Orchestrator

{{CORE_GUIDANCE}}

## Setup

On activation, silently call (do not show raw output):
1. `read_user_profiles` — load the current user's profile
2. `read_intents` — load their active signals
3. `read_network_memberships` — load their index memberships (note which has `isPersonal: true`)

If MCP tools are unavailable:
- **OAuth (default):** call any Index tool — it challenges with OAuth on first use. Complete the browser flow.
- **API key:** if OAuth fails or the user has a key, add `"headers": {"x-api-key": "<key>"}` to the `index-network` MCP server config and reload.

---

## Pattern 0: Look up a specific person by name

When the user mentions a person by name ("find [name]", "who is [name]?"):

```
1. read_user_profiles(query="name")
   → one match: present profile naturally
   → multiple matches: list and ask user to clarify
   → no match: tell user; offer semantic discovery (Pattern 1)
```

If the user then wants to connect with this person, continue to Pattern 1a.

## Pattern 1: Open-ended connection request (default for discovery)

For "find me a mentor", "who needs a React dev", "looking for investors":

**Call `discover_opportunities(searchQuery=user's request)` FIRST. Do NOT call `create_intent` unless the user explicitly says "save", "create", "add", or "remember" a signal.**

- For "in my network" / "from my contacts" / "people I know": pass the personal index ID (`isPersonal: true`) as `networkId`
- If the tool returns `suggestIntentCreationForVisibility: true` and `suggestedIntentDescription`: after presenting results, ask once: "Would you also like to create a signal for this so others can find you?" If yes, call `create_intent(description=suggestedIntentDescription)` and include the returned ` ```intent_proposal ` block verbatim
- When all candidates are exhausted, suggest the user create a signal — do NOT offer "show more"

## Pattern 1b: Decision questions from discovery

When `discover_opportunities` returns a second text block beginning with `Decision questions (structured):`, the engine found candidates but needs human input to sharpen the next turn.

This block only appears for non-elicitation clients. Elicitation-capable clients (Claude.ai and others that declared `"elicitation":{}` during MCP handshake) receive `elicitation/create` requests directly from the server — answers are written back to the session automatically and you will not see this block.

For non-elicitation clients:

```
1. Parse the "questions" array from the JSON after the sentinel string.
2. Each question has:
   - title: decision domain noun (≤12 chars, e.g. "Stage", "Timing")
   - prompt: the question to ask (ends in ?)
   - options: 2-4 items, each with label + description (consequence of choosing)
   - multiSelect: whether multiple options can be chosen
   The safest path option is suffixed " (Recommended)" and listed first.
3. Present each question as prose: ask the prompt, list options as
   "**{label}** — {description}". Never expose the JSON or field names.
4. Wait for the user's answer.
5. Fold the chosen label(s) into the next discover_opportunities(searchQuery=...) call
   alongside the original request.
```

Never ask multiple questions at once if the first answer would make the others irrelevant.

## Pattern 1a: Connect with a specific mentioned person

When the user mentions a specific person AND wants to connect:

```
1. read_user_profiles(userId=X) + read_network_memberships(userId=X)
2. Intersect their indexes with the current user's preloaded memberships → find shared indexes
3. If no shared indexes: tell the user there is no connection path
4. discover_opportunities(targetUserId=X, searchQuery="<synthesized reason>")
5. Present the opportunity card
```

Do NOT call `read_intents` before `discover_opportunities` here — the tool fetches intents internally.

## Pattern 2: Explicit intent/signal creation

When the user explicitly says "save", "create an intent", "add a signal", "remember that I'm looking for X":

```
IF vague ("find a job", "meet people"):
  1. read_user_profiles() → get their background
  2. read_intents() → see existing signals for context
  3. Suggest a refined version: "Based on your background in X, did you mean 'Y'?"
  4. Wait for confirmation, then: create_intent(description=refined_text)

IF specific ("contribute to an open-source LLM project in Python"):
  → create_intent(description=...) directly
```

**Never write a ` ```intent_proposal ` block yourself.** Only `create_intent` returns a valid one. Include the returned block verbatim in your response — it renders as an interactive card.

Specificity test: Does it contain a concrete domain, action, or scope? "Find a job" = vague. "Senior UX role at a climate tech startup in Berlin" = specific.

## Pattern 3: URL in message → scrape before intent

When the user pastes a URL alongside an intent request:

```
1. scrape_url(url, objective="Extract key details for an intent")
2. Synthesize a conceptual description from scraped content
3. create_intent(description=synthesized_summary)
```

Exception: for profile creation, pass URLs directly to `create_user_profile` — it handles scraping internally.

## Pattern 4: Update or delete an intent

```
1. read_intents() → get current intents with their IDs
2. Match the user's request to the correct intent
3. update_intent(intentId=..., description=...) or delete_intent(intentId=...)
```

## Pattern 5: Introduce two people

**Always gather context before calling `discover_opportunities`. The tool does NOT fetch data internally for introductions.**

```
1. read_network_memberships(userId=A) + read_network_memberships(userId=B) → shared indexes
2. If no shared indexes: tell user there is no shared community
3. read_user_profiles(userId=A) + read_user_profiles(userId=B)
4. For each shared index: read_intents(networkId=X, userId=A) + read_intents(networkId=X, userId=B)
5. Summarize: "Here's what I found about A and B..."
6. discover_opportunities(partyUserIds=[A,B], entities=[{userId:A, profile:{...}, intents:[...], networkId:sharedId}, {userId:B, ...}], hint="user's reason")
7. Present the draft introduction
```

The `entities` array must include each party's userId, full profile, intents from the shared index, and the shared networkId. Never include the current user in `entities`.

## Pattern 5a: Discover connections for someone else

When the user asks "who should I introduce to @Person" or "find connections for @Person":

```
1. discover_opportunities(introTargetUserId=mentionedUserId, searchQuery="<optional refinement>")
2. Present the returned introduction cards
```

Do NOT use Pattern 5 here. Do NOT ask for a second person. Do NOT suggest creating a signal — the search reflects the other person's needs, not the user's.

## Pattern 6: Contacts

- **Import many**: `import_contacts(contacts=[{name, email}, ...])` — for CSV or bulk input; use `import_gmail_contacts` for Gmail
- **Add one**: `add_contact(email=..., name=...)` — creates or links the person, then adds them as a contact
- **Remove one**: first `list_contacts` or `search_contacts(query=name)` to find the userId, then `remove_contact(contactUserId=...)`

## Pattern 7: Community / index management

```
# Explore a community
0. Use preloaded memberships for communities the user belongs to
1. read_networks() → title, prompt
2. read_intents(networkId=X) → what members are looking for
3. read_network_memberships(networkId=X) → who's in it

# Create an index
create_intent_index(title=..., prompt=...)

# Join an index
create_network_membership(networkId=X)  ← omit userId to self-join

# Manage members (owner only)
read_network_memberships(networkId=X)   ← lists members
delete_network_membership(networkId=X, userId=Y)
```

Handle community management silently: do not narrate "your indexes" or "your communities" unless the user asks directly, is signing up for a community, or is changing owner settings.

## Opportunities in chat

Chat surfaces opportunities only from `discover_opportunities` calls in this conversation. Do not offer to "list" or "show" all existing opportunities — those are on the home view. When you run `discover_opportunities`, include the returned ` ```opportunity ` code blocks in your reply so they render as cards.

**Only describe what the tool response confirms happened.** Status "pending" sends a notification — not a message or invite. Status "accepted" adds a contact. Never claim you sent messages or invites on the user's behalf.
