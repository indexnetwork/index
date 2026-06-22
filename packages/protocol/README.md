# Index Network Protocol

Index Network is a private, intent-driven discovery protocol.

It helps people and their agents find the right opportunities through stated intent, contextual signal, shared communities, and consent-gated introductions — without turning human relationships into a public search index.

This repository contains the canonical TypeScript implementation of the protocol, published as `@indexnetwork/protocol`. The README is the protocol surface. Implementation details live in [IMPLEMENTATION.md](./IMPLEMENTATION.md).

## What the protocol is for

Most networks ask people to broadcast identity and hope the right person sees it. Index Network inverts that pattern:

1. A participant states what they are looking for, offering, building, learning, funding, hiring, or exploring.
2. Their agent turns that statement into a durable signal.
3. The signal is scoped to one or more communities where it is relevant.
4. The protocol discovers semantic overlap with other participants' signals and context.
5. Agents negotiate whether the overlap is real, timely, reciprocal, and worth surfacing.
6. A draft opportunity is shown to the appropriate participant.
7. A direct connection happens only after explicit consent.

The goal is not more reach. The goal is higher-quality discovery with less noise, less performative posting, and better timing.

## Protocol vocabulary

| Protocol term | Meaning |
|---|---|
| **Participant** | A person using Index Network directly or through an agent. |
| **Agent** | A software representative that can read, reason, discover, negotiate, and ask for consent on behalf of a participant. |
| **Signal** | A participant's stated intent: what they want, offer, need, seek, or are open to. |
| **Context** | The facts, background, constraints, and current work that explain why a signal is meaningful. |
| **Community** | A bounded discovery space with a purpose, membership, and local norms. |
| **Opportunity** | A discovered overlap between participants that may justify an introduction, collaboration, exchange, or next conversation. |
| **Negotiation** | A bounded agent-to-agent exchange that tests fit before an opportunity is surfaced. |
| **Connection** | A consented channel opened after an opportunity is accepted. |

Some implementation surfaces still expose lower-level or historical names (`intent`, `index`, `latent`, `pending`). Public agents should use the protocol vocabulary above: **signal**, **community**, **context**, **draft**, **sent**, and **connected**.

## The discovery loop

### 1. Establish context

A participant or agent supplies context: bio, current work, constraints, interests, past activity, links, or other self-descriptive material.

The protocol decomposes this into atomic premises: claims about who the participant is, what they can credibly do, and what circumstances shape their availability. Context can be global or community-scoped.

### 2. Capture a signal

A signal is not a keyword query. It is a commitment or request with enough shape to be acted on:

- "I want to meet climate founders raising a pre-seed round in Europe."
- "I can help early teams turn protocol research into developer documentation."
- "I am looking for a design partner for privacy-preserving agent infrastructure."

Underspecified signals should trigger clarification before discovery. Invalid or insincere signals should not enter the graph.

### 3. Scope to communities

Discovery happens inside communities. A community provides:

- membership boundaries,
- purpose and norms,
- relevance criteria,
- privacy expectations,
- and a shared frame for judging fit.

A participant's personal community also represents their trusted contacts.

### 4. Discover semantic overlap

The protocol compares signals and context by meaning, not by exact terms. It looks for complementary roles, adjacent goals, shared constraints, and reciprocal value.

Discovery can happen from multiple directions:

- signal → context,
- context → signal,
- signal → signal,
- premise → premise,
- and agent-supplied discovery prompts.

### 5. Evaluate fit

An overlap is not an opportunity until it passes evaluation. The protocol asks:

- Is there a real role fit?
- Is the timing plausible?
- Is the participant credible for this signal?
- Is the candidate likely to benefit too?
- Is the overlap specific enough to explain?
- Is there a safe next action?

Good opportunities are explainable. If the protocol cannot state why something surfaced, it should not be promoted.

### 6. Negotiate before surfacing

Agents may negotiate before a participant sees an opportunity. Negotiation is deliberately bounded: it should test fit, clarify constraints, and decide whether to propose, counter, accept, reject, or ask a question.

If negotiation stalls because human judgment is needed, the agent should ask a small number of structured questions rather than guessing.

### 7. Reveal with consent

Opportunities move through a consent-gated lifecycle:

| Stage | Public meaning |
|---|---|
| **Draft** | The protocol found something plausible, but it has not been sent. |
| **Sent** | One side has shared or received the opportunity and is waiting for a response. |
| **Connected** | Both sides accepted and a conversation can begin. |
| **Declined / expired** | The opportunity should not continue. |

Agents must never accept a received opportunity without explicit approval in the current conversation.

## Agent operating contract

Agents connecting to Index Network are expected to follow the protocol's behavioral contract:

- Be calm, direct, analytical, and concise.
- Prefer the language of **opportunity**, **overlap**, **signal**, **pattern**, **emerging**, **relevant**, and **adjacency**.
- Do not say "search". Use **find**, **discover**, **look up**, or **check** depending on the action.
- Do not expose internal IDs, raw JSON, database fields, or tool names unless an ID is directly actionable for the participant.
- Do not fabricate data. If the agent lacks information, it should use the appropriate protocol tool or say what is missing.
- Surface the top 1–3 relevant points by default.
- Ask for confirmation before sending, accepting, or escalating an opportunity.
- Treat community scope and participant privacy as hard boundaries.

The MCP server exports these rules as canonical runtime instructions for connected agents.

## Design principles

### Intent before graph

The protocol starts from what someone wants or can offer now, not from static identity alone.

### Privacy before reach

Discovery should happen in bounded contexts. More visibility is not automatically better.

### Semantic fit over keyword fit

The protocol should find complements, not merely text matches.

### Explanation over mystery

Every surfaced opportunity should be legible: why this, why now, why these people, and what next.

### Human consent at the edge

Agents may discover and negotiate, but they do not create relationships without human approval.

### Interoperable agents

The protocol assumes multiple agents can participate: first-party agents, personal agents, community agents, and external MCP clients.

## Canonical implementation

`@indexnetwork/protocol` is the canonical implementation of these rules as agent graphs, tools, schemas, and MCP runtime behavior.

- For package setup, exported APIs, adapter contracts, graph factories, and publishing notes, see [IMPLEMENTATION.md](./IMPLEMENTATION.md).
- For the public API stability contract, see [STABILITY.md](./STABILITY.md).
- For release history, see [CHANGELOG.md](./CHANGELOG.md).
