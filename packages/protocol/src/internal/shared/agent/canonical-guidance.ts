/**
 * Canonical guidance for Index Network protocol operations.
 *
 * This is the single normative source for:
 * - Entity model and identity/context definitions
 * - Premise, signal, community, network, and opportunity concepts
 * - Negotiation semantics (owner approval vs A2A acceptance)
 * - H2A and A2A collaboration (H2H is never exposed)
 * - Retired vocabulary (no contact/Gmail/scrape/profile/ghost-user guidance)
 *
 * Wired into:
 * - MCP_INSTRUCTIONS (packages/protocol/src/mcp/mcp.server.ts)
 * - read_docs tool (packages/protocol/src/shared/agent/utility.tools.ts)
 *
 * IND-602, IND-603
 */

export const CANONICAL_GUIDANCE_TOPICS = [
  "identity-context",
  "premises",
  "signals",
  "communities-networks",
  "opportunities",
  "negotiations",
  "workflows",
] as const;

export type CanonicalGuidanceTopic = (typeof CANONICAL_GUIDANCE_TOPICS)[number];

/**
 * Summary of canonical entity model and protocol semantics.
 * Used in MCP_INSTRUCTIONS and as read_docs summary across all surfaces.
 * Never mentions retired contact/Gmail/scrape/profile/ghost-user guidance.
 * Optimized to ~1900 chars to leave room for MCP_INSTRUCTIONS context budget.
 */
export const CANONICAL_GUIDANCE_SUMMARY = `# Index Network Protocol

Index Network is a private, intent-driven discovery protocol. Users express signals (intents), agents find matches within shared networks, and decisions proceed through clear gates.

## Core Concepts

**Identity & Context** — Account and presentation metadata plus scoped runtime state (networks, signals, stage).

**Premises** — Foundational facts: background, experience, stage, timeline, constraints.

**Signals** — What users seek (intents, opportunities). Drive semantic matching.

**Communities & Networks** — Private groups where members share signals and discover connections via shared membership.

**Opportunities** — Discovered matches between users. Lifecycle: draft → pending → accepted/rejected/expired.

**Negotiations** — Agents coordinate, users approve. **A2A acceptance is not owner approval.** These are separate gates.

**Workflows** — H2A (users express signals → agents discover) and A2A (agents coordinate) over MCP. Further escalation via native surfaces (human-to-human threads do not cross MCP).

## Canonical Topics

Refer to these for detailed entity facts and lifecycle:

- **identity-context** — Presentation identity, context scoping, matching inputs
- **premises** — Background, stage, constraints
- **signals** — Intent inference, classification
- **communities-networks** — Membership, auto-assign
- **opportunities** — Discovery, roles, reasoning
- **negotiations** — Owner approval vs A2A, acceptance gates
- **workflows** — H2A and A2A tool sequences`;

/**
 * Detailed canonical topic content for read_docs.
 * Indexed by topic name; each contains current entity, capability, and lifecycle facts.
 */
export const CANONICAL_GUIDANCE_TOPICS_CONTENT: Record<CanonicalGuidanceTopic, string> = {
  "identity-context": `## Identity & Context

**Identity** is account and presentation metadata: name, bio, location, skills, interests, and social links. It identifies and presents the user; it does not provide a profile-vector matching corpus.

**Context** is scoped runtime state: network memberships, approved signals, lifecycle stage, and current opportunity or negotiation state. It determines the user's active scope and available workflow state.

### Matching Inputs
Matching uses approved signals, premises, shared network membership, and current opportunity or negotiation state. Premises supply the asserted background, constraints, and capabilities that ground relevant matches.

### Context Scoping
- Users can belong to multiple networks
- Each network has a scope (open to all members or invite-only)
- Matching is scoped to shared networks

### Key Distinction
Identity is account/presentation metadata. Context is dynamic, scoped runtime state for what the user is doing now.`,

  premises: `## Premises

**Premise** is the foundational context that shapes what matches will be relevant: a user's background, experience level, location, timeline, stage of life, constraints, and what they can actually commit to.

### Premise Examples
- "I'm a junior developer with 2 years of Python experience"
- "I'm based in Berlin and can't relocate"
- "I'm looking to start a company but can only contribute part-time until March"
- "I've exited twice and have capital to invest"

### Why Premises Matter
Premises filter and prioritize candidates. Two opportunities with identical signal overlap will rank differently based on whose premises align. A senior engineer may look for "growing engineers" (premise: mentor/investor) vs "equal partners" (premise: cofounder).

### Expressing Premises
- In profile: bio section and skills/interests summarize professional premise
- In intents: the description should include stage, timeline, and constraints
- In context: shared network membership indicates domain interest

### Premise Inference
The system learns premises from:
- Explicit user input (bio, intent descriptions)
- Social enrichment (LinkedIn career history, GitHub project scale)
- Behavioral signals (intents created, networks joined)`,

  signals: `## Signals

**Signal** is what a user is actively looking for — an intent, a need, a role they want to fill. Signals are the atoms of discovery.

### Signal Properties
- Description (free text: "Looking for a React developer for a 3-month contract in Berlin")
- Summary (structured extract: role, domain, stage, geography, duration)
- Confidence (0-1, how well the inference captured the user's intent)
- Inference type (explicit = user stated directly; implicit = system inferred)
- Embedding (semantic vector for matching)

### Signal vs Premise
- **Premise** is the user's foundational context ("I'm a senior engineer in Berlin")
- **Signal** is what they're seeking right now ("I'm looking for co-founders to start an AI company")

### Signal Lifecycle
1. User creates intent (explicit signal) or system infers from behavior (implicit)
2. Signal is embedded (converted to semantic vector)
3. Signal is assigned to networks (via auto-assign rules)
4. Signal participates in discovery (matched against other signals)

### Signal Best Practices
- Be specific: "Senior React developer, 3-month contract, Berlin" > "Need a developer"
- One signal per need: don't combine multiple requests
- Update signals when context changes (location, timeline, role requirements)`,

  "communities-networks": `## Communities & Networks

**Network** (also called "community") is a private group where members share signals and discover connections. Each network has:
- Title and optional purpose prompt (describing what the network is for)
- Membership list (with permissions and auto-assign settings)
- Join policy (open to anyone or invite-only)
- Scope for discovery (opportunities are found within shared networks)

### Network Properties
- Purpose prompt: Used to evaluate whether new signals belong in this network (signals with high relevance are auto-assigned)
- Join policy: "anyone" (self-join) or "invite_only" (owner invites)
- Owner: Can update settings, add/remove members, delete network
- Auto-assign: Members can opt in/out of automatic signal assignment

### Network Scope for Discovery
- Opportunities are discovered only between members of shared networks
- If two users share network A but not B, discovery in A will find them
- Scoping discovery to a specific network (networkId parameter) narrows results to that community

### Community Membership
- Members see all signals in the network
- Members can create signals (intents) that are auto-evaluated for relevance to the network
- Members can discover within the network
- Permissions track member type (owner, member, contact)

### Key Constraint
Discovery is networked — it only finds matches within shared networks. This privacy boundary is fundamental.`,

  opportunities: `## Opportunities

**Opportunity** is a discovered connection between two or more users based on complementary signals and shared network membership. Each opportunity has:
- Parties (the people being connected)
- Roles (party)
- Status (draft → pending → accepted/rejected/expired)
- Match reasoning (why they're a good fit)
- Confidence score (0-1 from evaluation)

### Opportunity Lifecycle
1. **Draft**: Created locally, only visible to creator. Offer to send.
2. **Pending**: Sent to recipient. They're notified and waiting.
3. **Accepted**: Recipient accepted. Both parties see the match.
4. **Rejected**: Recipient declined.
5. **Expired**: Timed out without response.

### Background Matching
Approved signals are evaluated in the background. Use list_opportunities only to review persisted cards; it does not start matching.

### Opportunity Evaluation
- Candidate retrieval: Uses HyDE embeddings to find semantically related signals
- LLM evaluation: Scores relevance, complementarity, and actionability
- Reasoning: Each opportunity includes match reasoning for the user

### Opportunity Acceptance
Accepting an opportunity expresses interest in the connection. Owner acceptance (explicit user confirmation) is required for any escalation.`,

  negotiations: `## Negotiations

**Negotiation** is how agents and users coordinate to reach decisions about matches. Two distinct gates govern acceptance:

### Agent-to-Agent (A2A) Acceptance
When two agent services coordinate on behalf of their users, they may reach agreement that a match is worth pursuing. Agents veto, accept, or defer based on their user's context. This is A2A acceptance.

### Owner Approval (Human Confirmation)
When a human user explicitly confirms in conversation "Yes, I want to pursue this connection", that is owner approval. Owner approval is a separate, human-driven gate.

### Critical Rule
**A2A acceptance is not owner approval.** Agents can accept while humans have not yet approved. The system tracks these separately:
- A2A acceptance: Agents vetted the match and recommend it
- Owner approval: The human explicitly confirmed

These gates are independent. Do not conflate them.

### Negotiation Workflow
1. Discovery creates draft opportunity
2. A2A coordination (agents evaluate viability)
3. A2A acceptance (agents agree to propose)
4. Opportunity sent to recipient (pending)
5. Owner review (human reads match reasoning)
6. Owner approval (human confirms)
7. Escalation (via native surfaces, not MCP)

### Rules
- Track A2A and owner approval separately
- Never accept without explicit user approval
- Always surface reasoning to owner
- Human-to-human messaging is not MCP`,

  workflows: `## Common Tool Workflows

### H2A: Human→Agent Discovery
User expresses signals (intents). Agent discovers matches and presents reasoning.

1. User creates intents (signals)
2. Background matching evaluates approved signals
3. Agent uses list_opportunities to surface persisted matches
4. User reviews and approves (owner approval)
5. Escalation via native surfaces

### A2A: Agent→Agent Coordination
Two agents coordinate on behalf of users to identify, vet, and propose matches.

1. Approved signals for User A are evaluated in the background
2. Agent B vets match from User B side (A2A negotiation)
3. Agents reach agreement (A2A acceptance)
4. Both agents present to users with shared reasoning
5. Both users approve (owner approval required)
6. Escalation via native surfaces

### MCP Scope
The MCP protocol carries H2A and A2A workflows only. Escalation to direct messaging (web, Telegram, native surfaces) is outside MCP.

### Best Practices
- Call read_docs to understand the domain
- Create or refine approved signals in relevant shared networks; list_opportunities reviews persisted results
- Present matches and reasoning to users
- Get explicit owner approval before any commitment
- Escalation to direct messaging is not MCP`,
};
