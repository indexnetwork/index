# Index Network: Technical Architecture

## Overview

Index Network is a discovery protocol that fundamentally reimagines how people connect online. Instead of profile-based social networks where identity drives discovery, Index operates on an **intent-driven model** where users express what they're seeking, and AI agents facilitate connections based on semantic understanding and contextual relevance.

By centering discovery on **indexes** (privacy-controlled intent collections) and **intents** (open-ended expressions of what someone seeks), Index enables a more efficent, private, and personal way for people to connect.

**Current Implementation**: The protocol is currently implemented as a centralized system using PostgreSQL for all data storage and application-layer privacy controls. The architecture is designed with decentralization compatibility in mind, enabling future migration to off-chain storage, confidential compute environments, and token-based economic mechanisms when the protocol transitions to decentralized operation.

## Architectural Principles

### 1. Intent Over Identity

Traditional social platforms focus on *who you are* – your job title, company, education. Index focuses on *what you want* – your goals, needs, and interests expressed as structured intents. This exciting shift enables more meaningful connections because it matches people based on complementary objectives rather than similar backgrounds.

**Intent Typology**: Index primarily focuses on **social intents** - expressions of presence and availability for connection. Within the broader landscape of digital intent, there are many intent types:

- **Social Intent** — Connecting, relating, engaging with others socially ("We're here.")
- **Transactional Intent** — Buying, hiring, exchanging  
- **Information-Seeking Intent** — Asking, searching
- **Latent/Other Intent** — Watching, inferring, delegating

Index specializes in the social intent space, enabling people to signal their presence, availability, and interests for collaboration, socializing, and meaningful relationships.

**Technical Implementation**: Intents are stored as text payloads that can be enhanced with contextual information from associated files. Index treats intents as first-class entities with their own lifecycle, privacy controls, and agent interactions.

### 2. Privacy by Design

Privacy isn't an afterthought but a foundational design constraint. Index uses a multi-layered access control model where content is organized into **indexes** with granular permissions. Users can share specific contexts without exposing their entire intentions, just like we do in real life.

**Technical Implementation**: Index-based access control with five permission levels:
- `can-read`: View intents in the index
- `can-write`: Add intents to the index  
- `can-write-intents`: Create and modify intents in the index
- `can-view-files`: Access supporting documents
- `can-discover`: Participate in discovery within this context

### 3. Agent-Mediated Context

Rather than algorithmic matching or manual browsing, multiple AI agents coexist to maintain relationships between contextual elements. The integrity of these relationships forms the context itself as an emergent property—this emergence is the architecture, not imposed frameworks or predefined models.

**Technical Implementation**: Context broker agents that analyze intent relationships and create "stakes" – confidence signals about potential matches with explanatory reasoning.

## Core Data Architecture

### Intent Graph

The core data layer stores the essential relationships between users, their intents, and organizational contexts:

```sql
-- Users have multiple intents across different contexts
users ←→ intents (1:many)
-- Intents can belong to multiple indexes (contexts)
intents ←→ indexes (many:many via intent_indexes)
-- Indexes have members with specific permissions
indexes ←→ users (many:many via index_members)
-- Agents create stakes connecting related intents
intent_stakes → [array of intent_ids] + reasoning
```

**Why this structure**: The many-to-many relationship between intents and indexes is fundamental for enabling **private discovery networks** across organizations, communities, and professional groups. This design allows a single intent to be shared in multiple contexts—such as a global "Open Collaboration" index, a private company workspace, a community hub, or a direct one-on-one share—each governed by its own privacy and access controls. As a result, users can participate in both broad professional discovery and tightly scoped, invite-only collaboration, all while maintaining granular control over where and how their intents are visible. 

### Scalable Intent Storage

**Current Implementation**: Intents are stored in PostgreSQL with a design optimized for future migration to **off-chain** storage with **on-chain finality** using a hash and roll-up architecture. This future approach will enable:

- **Peer-to-Peer Discovery**: Agents enable direct, programmable discovery without intermediaries
- **Programmable Incentives**: Agents can deploy custom incentive logic at the protocol layer, so that each element remains connected to the value layer.
- **Privacy**: Raw intent data never leaves confidential compute; not exposed on public chains
- **Integrity**: Cryptographic proofs guarantee data authenticity
- **Performance**: Fast, low-latency queries without blockchain bottlenecks

**Privacy Architecture**: The protocol is designed for intents to be **only accessible to agents running in confidential compute environments**. The agent runtime will maintain the storage and retrieval of intents that hosted exclusively within TEE-protected infrastructure. No intent data will be exposed to:
- Public networks or APIs
- User interfaces directly
- Non-TEE computational environments
- Third-party systems

Users can access their own intent data through standard interfaces, but agents query the protected database using natural language within the confidential compute network when analyzing cross-user relationships. When agents find matches, they share **only their reasoning and confidence scores** with users through contextually private interfaces - never the raw intent data of other users.

### Why This Separation

The separation between intents and indexes serves a crucial strategic purpose: **context isolation for privacy management**. This architectural decision enables users to share different aspects of their intents in different contexts.

Context isolation makes privacy management practical and intuitive. A researcher can share academic papers in one index, startup ideas in another, and consulting availability in a third – each with appropriate audiences and permissions. This prevents the "all-or-nothing" privacy problem of traditional platforms where you either share everything or nothing.

## Agent Runtime Architecture

### Context Brokers

Context brokers are the primary intelligence layer that processes intents and creates connections:

```typescript
abstract class BaseContextBroker {
  abstract onIntentCreated(intentId: string): Promise<void>;
  abstract onIntentUpdated(intentId: string): Promise<void>; 
  abstract onIntentArchived(intentId: string): Promise<void>;
}
```

**Current Implementation**:

**Semantic Relevancy Broker**: The first and primary agent implementation uses LLM-based semantic analysis to find related intents across users and creates stakes with explanatory reasoning. This agent represents the foundational intelligence layer for the social intent pairing.

**Why this architecture**: The broker pattern enables multiple competing broker agents to operate simultaneously. Each broker can implement different brokerage strategies (semantic, temporal, network-based) and stake on connections they believe are valuable. This creates a vibrant marketplace of social intelligence where agents compete and collaborate to provide the best matches.

### Stakes as Relevancy Signals

When agents identify potential connections, they create "stakes" – records that commit to a relationship between specific intents:

```typescript
interface IntentStake {
  intents: string[];        // Array of related intent IDs (references only)
  stake: bigint;           // Confidence score (future: economic stake)
  reasoning: string;       // Explanation shared with users (privacy-safe)
  agentId: string;        // Which agent created this stake
}
```

**Privacy Architecture**: Stakes contain **only intent IDs and agent reasoning** - never the actual intent content. When users see potential matches, they receive:
- Agent's explanation of why the match is relevant
- Confidence scores as staked value  

The underlying intent details of other users remain private within the confidential compute environment.

**Strategic Design**: Stakes serve multiple exciting purposes:
- **Explainability**: Users understand why they're matched
- **Quality Control**: Agents build reputation based on stake accuracy
- **Economic Incentives**: Future token mechanics can reward successful connections
- **Composability**: Multiple agents can stake on the same intent relationships for different reasons.

### Multi-Layer Quality Control

Index implements several mechanisms to ensure match quality and prevent abuse:

### Stake Patterns in Index

The system supports multiple staking patterns that enable different types of discovery and community formation:

| **Stake Pattern** | **Description** | **Example** | **Strategic Function** |
|-------------------|------------------------------------------------------------------|----------------------------------------------------------------------------|-------------------------------------|
| **1:1** | One agent stakes on one intent involving one other person | "Introduce Alice to Bob" | Precision matchmaking |
| **1:n** | One agent stakes on multiple people for a single user's intent | "Suggest cofounders to Alice" | Personalized recommendations |
| **n:1** | Multiple agents stake on the same person for one user | "Multiple agents suggest Bob to Alice" | Compounding trust signal |
| **n:n** | Multiple agents stake on multiple people for one user | "Agents suggest a set of collaborators for Alice's startup" | Community curation / cohort building |
| **1→n (broadcast)** | One agent stakes on the same person across multiple relevant users | "Suggest Bob to 5 different people looking for AI collaborators" | Demand-side liquidity discovery |
| **n→1 (converge)** | Many agents stake different dimensions on one match candidate | "Trust agent + skill agent + context agent all stake on the same connection" | Multi-perspective evaluation |

These patterns enable Index to scale from individual connections to community-wide discovery while maintaining explainability and agent accountability.

### Programmable Discovery Markets

Index makes discovery markets programmable—allowing anyone to define new economic rules and connection strategies over intents. The future of social coordination is shaped by how these programmable markets are composed, forked, and remixed to surface new forms of connection.

**Customizable Market Logic**: Agents and communities will be able to launch their own discovery markets, each with unique staking, scoring, and reward mechanisms. For example, some markets may reward consensus and safe matches, while others incentivize risk-taking and novel connections.

**Exploration-Driven Incentives**: By supporting mechanisms like logarithmic market scoring rules, these markets can dynamically adjust the "price" of matches. As common connections become saturated, agents are nudged to explore the long tail—surfacing niche, underexplored relationships that might otherwise be missed.

This architecture enables an exciting future where the very logic of discovery is open, remixable, and shaped by the needs and creativity of its participants.

**Multiple Market Perspectives**: The same intent pool can support multiple discovery markets with different strategies:
- **Consensus-driven markets**: Focus on safe, obvious matches
- **Exploration markets**: Reward novel, high-risk connections  
- **Domain-specific markets**: Optimize for particular industries or contexts

As Index Network grows, the combinatorial explosion of potential connections creates a rich discovery space where specialized "signal miners" - agents optimized for finding specific types of valuable connections - can carve out profitable niches.

### Core Processing Agents

**Intent Inferrer**: Analyzes uploaded files and generates suggested intents
```typescript
analyzeFolder(folderPath: string, fileIds: string[]) 
  → InferredIntent[] // high-confidence intent suggestions
```

**Intent Enhancer**: Uses context from index files to expand and enrich user-created intents
```typescript
processIntent(intentPayload: string, indexId: string) 
  → EnhancedIntent // Contextually enriched version by reading files
```

**Intent Summarizer**: Creates concise summaries for storage and display
```typescript
sumarizeIntent(text: string, maxLength: number) 
  → Summary // Condensed version maintaining key meaning
```

**Why this separation**: Separating agents enables both individualistic and social discovery. While each agent maintains context isolation for privacy and clear separation of concerns, this architecture naturally supports multi-user entities that represent communities, organizations, and networks as they exist in society - creating digital "4th spaces" for discovery.

Indexes can be used for:
- **Individuals**: Personal indexes that can be used for sharing, organisation.
- **Group**: Community or organizational indexes that represent shared intentions.
- **Network**: Shared intentions among inter-group connections.

This simple approach mirrors how we naturally navigate social spaces - we have individual preferences while also being part of communities, organizations, and networks that have their own social dynamics. Each agent accesses only the relevant data needed for its integrity, enabling rich user-centric discovery while maintaining social privacy expectations.

### Dynamic Knowledge Graph Construction via Staking

Unlike traditional knowledge graphs with fixed relationships, Index creates **situational knowledge graphs** that emerge from agent signals:

```typescript
// Between any two users, multiple agents provide different perspectives
// Note: This represents what's shared with users, not the raw intent data
const userRelationship = {
  users: ["user-a", "user-b"],
  agentSignals: [
    { agentId: "semantic-matcher", reasoning: "Both working on AI privacy", stake: 0.8 },
    { agentId: "network-analyzer", reasoning: "Mutual connections in crypto space", stake: 0.7 },
    { agentId: "experience-matcher", reasoning: "Both have startup exits", stake: 0.9 }
  ]
  // Raw intent content remains in confidential compute only
}
```

**Ephemeral Structure**: When users connect, the knowledge graph for that relationship dissolves, and new graphs form around emerging opportunities. This prevents static categorization while enabling rich, multi-dimensional relationship reasoning.

**Contextual Integrity**: Each agent contributes its own reasoning layer, creating a composite understanding that's richer than any single agent could provide. Agents can build on each other's signals, creating compounding relevance where one agent's output becomes another's input signal.

## Discovery and Social Connection Flow

### 1. Content Upload and Intent Generation

```
User uploads files → Index → Intent Inferrer Agent → Suggested Intents
```

When a user uploads files to an index, the Intent Inferrer agent analyzes the content using the Unstructured API for document parsing and intent generation. The agent considers the most likely target audience (e.g., if analyzing a pitch deck, prioritizes investor-focused intents).

**Technical Implementation**: Uses optimized document processing with parallel PDF page splitting and fast processing strategies. Content is intelligently chunked and analyzed to generate exactly 5 high-confidence intent suggestions.

### Data Clean Room Architecture

**Future Architecture**: The privacy guarantees will follow established patterns from advertising technology's **data clean rooms**. In the planned architecture:

```
Encrypted Intent Data → TEE Processing Environment → Limited Agent Actions → Stake Signals Only
```

Agents can only output **reasoning explanations** and **confidence scores as stakes** to users. The actual intent content of other users remains encrypted and inaccessible outside the confidential compute network. This creates a "privacy superhighway" where agents prove their identity through TEE attestation to gain permissioned access, but can only share derived insights, never raw data.

**Future Direction**: Agent contribution will become permissionless, with norm and flow control enforced using contextual+differential privacy techniques. This will enable open participation by agents while maintaining strong privacy guarantees for all users.


### 3. Agent-Mediated Connections

```
Intent Created → Context Brokers → Semantic Analysis → Stakes Created
```

When intents are created or updated, all registered context brokers receive notifications. Each broker applies its connection logic and creates stakes connecting related intents from different users.


## Communication and Synthesis Layer

Index automatically generates contextual communications:

**Connection Requests**: Include AI-generated "What Could Happen Here" synthesis
**Connection Acceptance**: Include AI-generated introduction text based on shared stakes

```typescript
// Vibe checking: What could this collaboration look like?
synthesizeVibeCheck(targetUserId, contextUserId) → collaboration_potential

// Introduction synthesis: Why these people should connect  
synthesizeIntro(senderUserId, recipientUserId) → introduction_text
```


**Contextual Privacy in Communication**: All automatically generated communications are based on:
- Agent reasoning and explanations (discoverable with contextually relevant people)
- Synthesis narratives derived from agent insights
- General collaboration potential assessments

**Never included**: Raw intent content, private file details, or specific personal information from other users. Index maintains privacy while providing meaningful context for why connections might be valuable.


## API Architecture

### RESTful Interface

The protocol exposes a comprehensive REST API that enables developers to integrate Index functionality into their applications:

**Authentication**: All endpoints require Bearer token authentication:
```typescript
Authorization: Bearer YOUR_API_TOKEN
```

**Core API Endpoints**:

**Intent Management**:
```typescript
// Create intent
POST /api/intents
{
  "payload": "Looking for ML researchers to collaborate on AI research...",
  "isIncognito": false,
  "indexIds": ["index-ai-research"]  // References Intent.indexes relationship
}

// Get intents with filtering
GET /api/intents?page=1&limit=20&archived=false

// Update intent
PUT /api/intents/{id}
{
  "payload": "Updated intent description",
  "isIncognito": true
}
```

**Index Management**:
```typescript
// Create index
POST /api/indexes
{
  "title": "AI Research Network"
}

// Add member with permissions
POST /api/indexes/{id}/members
{
  "userId": "user-456",
  "permissions": ["can-read", "can-discover"]
}
```

**File Processing**:
```typescript
// Upload files for intent generation
POST /api/indexes/{indexId}/files
// FormData with file attachment

// Get AI-generated intent suggestions
GET /api/indexes/{indexId}/suggested_intents
```

**Discovery and Connections**:
```typescript
// Get stakes involving user's intents
GET /api/stakes/by-user?includeDiscovered=false

// Get discovery results for shared index
GET /api/stakes/index/{code}/by-user
```

### Reusable Components

The protocol provides a library of React components that enable developers to quickly integrate discovery functionality:

**Installation**:
```bash
npm install @index/react
```

**Core Components**:

**IntentForm**: Create and submit new intents with validation
```typescript
import { IntentForm } from '@index/react';

<IntentForm 
  session={session}
  indexId="index-abc"
  onSubmit={(intent) => handleIntentSubmit(intent)}
/>
```

**VibeCheck**: Analyze compatibility between users, intents, or content ([Demo](http://index.network/share/607e6bce-d292-41b3-9fa2-167a5fed1bd2))
```typescript
import { VibeCheck } from '@index/react';

<VibeCheck 
  session={session}
  indexId="index-abc"
  onResult={(result) => console.log('Vibe result:', result)}
/>
```

**MatchList**: Display and manage intent matches with filtering
```typescript
import { MatchList } from '@index/react';

<MatchList 
  session={session}
  indexId="index-abc"
  limit={10}
  sort="recency"
/>
```

**Radar**: Interactive exploration of connections and patterns ([Demo](https://x.com/indexnetwork_/status/1828847341001924833))
```typescript
import { Radar } from '@index/react';

<Radar 
  session={session}
  indexId="index-abc"
/>
```

**Conversational Agents**: Index also supports conversational integrations for platforms like Slack, Discord, and other chat environments, enabling intent inference and matchmaking within existing communication workflows.

## Connection and Discovery Workflow

### Connection State Machine

```typescript
type ConnectionAction = 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE';

// State transitions
null → REQUEST → {ACCEPT, DECLINE, SKIP, CANCEL}
DECLINE/SKIP → REQUEST (can try again)
ACCEPT → [connected]
```

**Why explicit state management**: Future decentralized coordination will require immutable communication about consents. The explicit state for connections prevents ambiguity and enables coordination integrity. Currently implemented in PostgreSQL with the same state machine logic to prepare for decentralized operation.


## Scalability and Performance Considerations

### Database Design for Scale

**Intent Stakes as Arrays**: Using arrays for intent relationships enables efficient queries while maintaining data consistency:

```sql
-- Find stakes involving specific intents
WHERE intents @> ARRAY['intent-id-1']::text[]

-- Find stakes connecting two users' intents  
WHERE EXISTS(SELECT 1 FROM unnest(intents) WHERE intent_id IN (...))
```

### Agent Processing Architecture

**Asynchronous Broker Execution**: All context brokers process intents in asynchronously, preventing any single agent from blocking the pipeline:

```typescript
const brokerPromises = CONTEXT_BROKERS.map(async (broker) => {
  try {
    await broker.onIntentCreated(intentId);
  } catch (error) {
    console.error(`Broker ${broker.agentId} failed:`, error);
  }
});

```

