# IND-322: Premise Graph and Generator (Protocol Layer)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the premise processing pipeline in `packages/protocol/src/premise/` — state annotation, graph factory, analyzer (speech-act classification + felicity scoring), embedding, and auto-indexing into networks.

**Architecture:** Follows the intent graph pattern: `PremiseGraphFactory` receives typed deps via constructor injection, compiles a LangGraph `StateGraph`. Three modes: `create` (analyze + embed + index), `update` (re-analyze + re-embed), `query` (read-only). The analyzer is a new LLM agent adapted from `SemanticVerifier` for premise speech acts (DECLARATIVE/ASSERTIVE instead of COMMISSIVE/DIRECTIVE). Auto-indexing reuses the `IntentIndexer` pattern via a `PremiseIndexer` agent.

**Tech Stack:** LangGraph, LangChain, Zod, `createModel()` from `model.config.ts`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/protocol/src/premise/premise.state.ts` | LangGraph state annotation |
| Create | `packages/protocol/src/premise/premise.analyzer.ts` | LLM agent: speech-act classification + felicity scoring for premises |
| Create | `packages/protocol/src/premise/premise.indexer.ts` | LLM agent: score premise relevancy to a network |
| Create | `packages/protocol/src/premise/premise.graph.ts` | `PremiseGraphFactory` class with create/update/query modes |
| Create | `packages/protocol/src/premise/tests/premise.analyzer.spec.ts` | Unit tests for analyzer |
| Create | `packages/protocol/src/premise/tests/premise.graph.spec.ts` | Graph integration tests with mocked deps |
| Modify | `packages/protocol/src/shared/interfaces/database.interface.ts` | Add `PremiseGraphDatabase` type and premise CRUD methods to `Database` |
| Modify | `packages/protocol/src/index.ts` | Export `PremiseGraphFactory` and `PremiseGraphDatabase` |

---

### Task 1: Add premise CRUD methods to the Database interface

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts`

- [ ] **Step 1: Add premise-related types near the existing intent types**

Find the `IntentInput` interface (around line 120) and add these types nearby:

```typescript
export interface PremiseAssertion {
  text: string;
  tier: 'assertive' | 'contextual';
  summary?: string;
}

export interface PremiseProvenance {
  source: 'explicit' | 'enrichment' | 'integration' | 'onboarding';
  sourceId?: string;
  confidence: number;
  timestamp: string;
}

export interface PremiseAnalysis {
  speechActType: 'DECLARATIVE' | 'ASSERTIVE';
  felicityAuthority: number;
  felicitySincerity: number;
  felicityClarity: number;
  semanticEntropy: number;
}

export interface PremiseValidity {
  validFrom?: string;
  validUntil?: string;
  volatile: boolean;
}

export interface PremiseRecord {
  id: string;
  userId: string;
  assertion: PremiseAssertion;
  provenance: PremiseProvenance;
  analysis: PremiseAnalysis | null;
  validity: PremiseValidity;
  embedding: number[] | null;
  status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
  createdAt: Date;
  updatedAt: Date;
  retractedAt: Date | null;
}
```

- [ ] **Step 2: Add premise CRUD methods to the `Database` interface**

Find the `Database` interface and add these methods:

```typescript
createPremise(input: {
  userId: string;
  assertion: PremiseAssertion;
  provenance: PremiseProvenance;
  analysis?: PremiseAnalysis;
  validity: PremiseValidity;
  embedding?: number[];
}): Promise<PremiseRecord>;

getPremise(premiseId: string): Promise<PremiseRecord | null>;

getPremisesForUser(userId: string, status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED'): Promise<PremiseRecord[]>;

updatePremise(premiseId: string, updates: {
  assertion?: PremiseAssertion;
  analysis?: PremiseAnalysis;
  validity?: PremiseValidity;
  embedding?: number[];
  status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
  retractedAt?: Date;
}): Promise<PremiseRecord>;

assignPremiseToNetwork(premiseId: string, networkId: string, relevancyScore: number): Promise<void>;

getPremiseNetworks(premiseId: string): Promise<Array<{ networkId: string; relevancyScore: number | null }>>;
```

- [ ] **Step 3: Add `PremiseGraphDatabase` narrowed type**

Add after the `ProfileGraphDatabase` type (around line 1750):

```typescript
/**
 * Database interface narrowed for Premise Graph operations.
 * Provides premise lifecycle: create, read, update, and network assignment.
 *
 * Access layer: UserDatabase (user's own premises)
 */
export type PremiseGraphDatabase = Pick<
  Database,
  'createPremise' | 'getPremise' | 'getPremisesForUser' | 'updatePremise' | 'assignPremiseToNetwork' | 'getPremiseNetworks' | 'getUserIndexIds' | 'getNetwork' | 'getNetworkMemberContext'
>;
```

- [ ] **Step 4: Verify compilation**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: Errors about unimplemented methods in adapter — this is expected since the adapter lives in `backend/`. The interface itself should be valid.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/shared/interfaces/database.interface.ts
git commit -m "feat(protocol): add premise CRUD methods and PremiseGraphDatabase type"
```

---

### Task 2: Create the premise state annotation

**Files:**
- Create: `packages/protocol/src/premise/premise.state.ts`

- [ ] **Step 1: Create the state file**

```typescript
import { Annotation } from "@langchain/langgraph";
import type { PremiseAnalysis, PremiseRecord } from "../shared/interfaces/database.interface.js";
import type { DebugMetaAgent } from '../chat/chat-streaming.types.js';

export const PremiseGraphState = Annotation.Root({
  userId: Annotation<string>,

  assertionText: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  tier: Annotation<'assertive' | 'contextual'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'assertive',
  }),

  validFrom: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  validUntil: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  volatile: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  operationMode: Annotation<'create' | 'update' | 'query'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'create',
  }),

  targetPremiseId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  analysis: Annotation<PremiseAnalysis | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  embedding: Annotation<number[] | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  premise: Annotation<PremiseRecord | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  networkAssignments: Annotation<Array<{ networkId: string; relevancyScore: number }>>({
    reducer: (curr, next) => next,
    default: () => [],
  }),

  error: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  readResult: Annotation<{
    premises: PremiseRecord[];
    count: number;
    message?: string;
  } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  agentTimings: Annotation<DebugMetaAgent[]>({
    reducer: (acc, val) => [...acc, ...val],
    default: () => [],
  }),
});
```

- [ ] **Step 2: Verify compilation**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors from this file (imports resolve)

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/premise/premise.state.ts
git commit -m "feat(protocol): add premise graph state annotation"
```

---

### Task 3: Create the premise analyzer

**Files:**
- Create: `packages/protocol/src/premise/premise.analyzer.ts`

- [ ] **Step 1: Create the analyzer**

This adapts the `SemanticVerifier` pattern for premise-specific speech acts:

```typescript
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";

const logger = protocolLogger("PremiseAnalyzer");

const model = createModel("premiseAnalyzer");

const systemPrompt = `
You are the Premise Analyzer for the Index Network — an intent-driven discovery protocol.

Your job: classify a self-descriptive premise using adapted Speech Act Theory, then score its felicity conditions.

A premise is a proposition a person asserts about themselves. It is NOT a desire or request (those are intents). Premises are conditions of possibility — facts about who someone is that ground opportunity discovery.

Always reason before classifying. Output reasoning first.

═══════════════════════════════════════════════════
STEP 1 — CLASSIFY THE SPEECH ACT
═══════════════════════════════════════════════════

DECLARATIVE: The premise constitutes a fact about the speaker's identity, role, or status.
  Examples:
  · "I am a climate-tech founder" → DECLARATIVE
  · "I hold a PhD in computational biology" → DECLARATIVE
  · "I am based in Berlin" → DECLARATIVE
  · "I am raising Series A" → DECLARATIVE (constitutes current status)

ASSERTIVE: The premise describes a capability, experience, or characteristic.
  Examples:
  · "I have 10 years of experience in distributed systems" → ASSERTIVE
  · "I built a collaboration platform used by 50k users" → ASSERTIVE
  · "I speak fluent Mandarin and German" → ASSERTIVE
  · "I specialize in zero-knowledge proofs" → ASSERTIVE

═══════════════════════════════════════════════════
STEP 2 — SCORE THE FELICITY CONDITIONS (0–100)
═══════════════════════════════════════════════════

AUTHORITY (Preparatory Condition)
  Does the speaker plausibly have standing to assert this?
  100 → Highly specific, verifiable claim ("I founded X in 2019")
   60 → Plausible but unverifiable ("I have deep expertise in AI")
   20 → Implausible or grandiose ("I am the world's leading expert")

SINCERITY (Sincerity Condition)
  Does the linguistic form suggest genuine self-description vs. aspiration?
  100 → Present tense, first person, specific ("I am a YC-backed founder")
   60 → Hedged or aspirational ("I'm sort of getting into crypto")
   20 → Clearly aspirational masquerading as fact ("I'm basically a VC")

CLARITY (Essential Condition)
  How specific and matchable is this premise?
  100 → "I build distributed database systems in Rust at a Series B startup"
   60 → "I work in tech" (clear direction, vague spec)
   20 → "I do things" (barely informative)

SEMANTIC ENTROPY → 0.0 to 1.0
  0.0 = maximally constrained (role + domain + location + stage all specified)
  1.0 = no constraints at all
  0.0 example: "I am a senior ML engineer at Google Brain in Mountain View"
  1.0 example: "I'm a person"
`;

const responseFormat = z.object({
  reasoning: z.string().describe(
    "Step-by-step analysis: (1) whether this is DECLARATIVE or ASSERTIVE and why, " +
    "(2) felicity condition assessment."
  ),
  speechActType: z.enum(["DECLARATIVE", "ASSERTIVE"]).describe(
    "DECLARATIVE = constitutes identity/role/status; ASSERTIVE = describes capability/experience"
  ),
  felicityAuthority: z.number().min(0).max(100).describe(
    "Preparatory: does the speaker plausibly have standing to assert this (0-100)"
  ),
  felicitySincerity: z.number().min(0).max(100).describe(
    "Sincerity: genuine self-description vs. aspirational (0-100)"
  ),
  felicityClarity: z.number().min(0).max(100).describe(
    "Essential: how specific and matchable is this premise (0-100)"
  ),
  semanticEntropy: z.number().min(0).max(1).describe(
    "Constraint density: 0.0 = maximally specific, 1.0 = completely unconstrained"
  ),
});

export type PremiseAnalyzerOutput = z.infer<typeof responseFormat>;

export class PremiseAnalyzer {
  private model: ReturnType<typeof model.withStructuredOutput>;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "premise_analyzer"
    });
  }

  @Timed()
  public async invoke(premiseText: string, profileContext?: string): Promise<PremiseAnalyzerOutput> {
    logger.verbose(`[PremiseAnalyzer.invoke] Analyzing: "${premiseText.substring(0, 50)}..."`);

    const contextBlock = profileContext
      ? `\n# Speaker Profile (Context)\n${profileContext}\n`
      : "";

    const prompt = `${contextBlock}
# Premise to Analyze
"${premiseText}"

Classify this premise and score its felicity conditions.`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt),
    ];

    const result = await this.model.invoke(messages);
    const output = responseFormat.parse(result);

    logger.verbose(`[PremiseAnalyzer.invoke] Result: ${output.speechActType} entropy=${output.semanticEntropy}`);
    return output;
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors from this file

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/premise/premise.analyzer.ts
git commit -m "feat(protocol): add premise analyzer (speech-act classification + felicity scoring)"
```

---

### Task 4: Create the premise indexer

**Files:**
- Create: `packages/protocol/src/premise/premise.indexer.ts`

- [ ] **Step 1: Create the indexer**

Adapted from `IntentIndexer` — scores premise relevancy to a network:

```typescript
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";

const logger = protocolLogger("PremiseIndexer");

const model = createModel("premiseIndexer");

const systemPrompt = `
You are a Premise Evaluator for a social networking protocol.

TASK:
Determine if a User Premise (a self-descriptive proposition about who someone is) is relevant to a specific Index (community).

INPUTS:
1. Premise: A self-description the user asserts about themselves.
2. Index Prompt: The purpose/scope of the target community (Index).
3. Member Prompt: The specific sharing preferences of the user in that community (optional).

SCORING RUBRIC:
- 0.9-1.0: Highly relevant. The premise directly relates to the community's purpose.
- 0.7-0.8: Good relevance. The premise is clearly adjacent to the community's focus.
- 0.5-0.6: Moderate. Borderline relevance.
- 0.3-0.4: Low relevance. Weak connection.
- 0.0-0.2: Not relevant. The premise has no connection to this community.

OUTPUT RULES:
- Provide indexScore based on how well the Premise fits the Index Prompt.
- Provide memberScore based on how well the Premise fits the Member Prompt (if provided). If Member Prompt is missing/empty, return 0.0.
- Provide concise reasoning.
`;

const responseFormat = z.object({
  indexScore: z.number().min(0).max(1).describe("Score for index relevance (0.0-1.0)"),
  memberScore: z.number().min(0).max(1).describe("Score for member preference match (0.0-1.0)"),
  reasoning: z.string().describe("Brief reasoning for the scores"),
});

export type PremiseIndexerOutput = z.infer<typeof responseFormat>;

export class PremiseIndexer {
  private model: ReturnType<typeof model.withStructuredOutput>;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "premise_indexer"
    });
  }

  @Timed()
  public async invoke(input: {
    premiseText: string;
    indexPrompt: string;
    memberPrompt?: string;
    networkContext?: string;
  }): Promise<PremiseIndexerOutput> {
    logger.verbose(`[PremiseIndexer.invoke] Scoring premise against index`);

    const prompt = [
      "# Premise",
      input.premiseText,
      "",
      "# Index Prompt",
      input.indexPrompt || "(No index prompt provided)",
      "",
      "# Member Prompt",
      input.memberPrompt || "(No member prompt provided)",
      ...(input.networkContext ? ["", "# Network Context", input.networkContext] : []),
    ].join("\n");

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt),
    ];

    const result = await this.model.invoke(messages);
    return responseFormat.parse(result);
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/premise/premise.indexer.ts
git commit -m "feat(protocol): add premise indexer (network relevancy scoring)"
```

---

### Task 5: Create the premise graph factory

**Files:**
- Create: `packages/protocol/src/premise/premise.graph.ts`

- [ ] **Step 1: Create the graph factory**

```typescript
import { StateGraph, START, END } from "@langchain/langgraph";
import { PremiseGraphState } from "./premise.state.js";
import { PremiseAnalyzer } from "./premise.analyzer.js";
import { PremiseIndexer } from "./premise.indexer.js";
import type { PremiseGraphDatabase, PremiseAnalysis } from "../shared/interfaces/database.interface.js";
import type { EmbeddingGenerator } from "../shared/interfaces/embedder.interface.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { timed } from "../shared/observability/performance.js";
import type { DebugMetaAgent } from "../chat/chat-streaming.types.js";

const logger = protocolLogger("PremiseGraphFactory");

export class PremiseGraphFactory {
  constructor(
    private database: PremiseGraphDatabase,
    private embedder: EmbeddingGenerator,
  ) {}

  public createGraph() {
    const analyzer = new PremiseAnalyzer();
    const indexer = new PremiseIndexer();

    const queryNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.query", async () => {
        const premises = await this.database.getPremisesForUser(state.userId, 'ACTIVE');
        return {
          readResult: {
            premises,
            count: premises.length,
          },
        };
      });
    };

    const analyzeNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.analyze", async () => {
        if (!state.assertionText) {
          return { error: "assertionText is required for create/update mode" };
        }

        const start = Date.now();
        const result = await analyzer.invoke(state.assertionText);
        const timing: DebugMetaAgent = {
          name: "premise-analyzer",
          durationMs: Date.now() - start,
        };

        const analysis: PremiseAnalysis = {
          speechActType: result.speechActType,
          felicityAuthority: result.felicityAuthority,
          felicitySincerity: result.felicitySincerity,
          felicityClarity: result.felicityClarity,
          semanticEntropy: result.semanticEntropy,
        };

        return { analysis, agentTimings: [timing] };
      });
    };

    const embedNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.embed", async () => {
        if (!state.assertionText) {
          return { error: "assertionText is required for embedding" };
        }

        const embedding = await this.embedder.generateEmbedding(state.assertionText);
        return { embedding };
      });
    };

    const persistNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.persist", async () => {
        if (state.operationMode === 'update' && state.targetPremiseId) {
          const updated = await this.database.updatePremise(state.targetPremiseId, {
            assertion: {
              text: state.assertionText!,
              tier: state.tier,
            },
            analysis: state.analysis ?? undefined,
            validity: {
              validFrom: state.validFrom,
              validUntil: state.validUntil,
              volatile: state.volatile,
            },
            embedding: state.embedding,
          });
          return { premise: updated };
        }

        const premise = await this.database.createPremise({
          userId: state.userId,
          assertion: {
            text: state.assertionText!,
            tier: state.tier,
          },
          provenance: {
            source: 'explicit',
            confidence: 1.0,
            timestamp: new Date().toISOString(),
          },
          analysis: state.analysis ?? undefined,
          validity: {
            validFrom: state.validFrom,
            validUntil: state.validUntil,
            volatile: state.volatile,
          },
          embedding: state.embedding,
        });
        return { premise };
      });
    };

    const indexNode = async (state: typeof PremiseGraphState.State) => {
      return timed("PremiseGraph.index", async () => {
        if (!state.premise) return {};

        const indexIds = await this.database.getUserIndexIds(state.userId);
        const assignments: Array<{ networkId: string; relevancyScore: number }> = [];

        for (const networkId of indexIds) {
          const network = await this.database.getNetwork(networkId);
          if (!network || !network.prompt) continue;

          const memberContext = await this.database.getNetworkMemberContext(networkId, state.userId);

          const start = Date.now();
          const result = await indexer.invoke({
            premiseText: state.assertionText!,
            indexPrompt: network.prompt,
            memberPrompt: memberContext?.prompt ?? undefined,
          });
          const timing: DebugMetaAgent = {
            name: "premise-indexer",
            durationMs: Date.now() - start,
          };

          const score = Math.max(result.indexScore, result.memberScore);
          if (score >= 0.5) {
            await this.database.assignPremiseToNetwork(state.premise.id, networkId, score);
            assignments.push({ networkId, relevancyScore: score });
          }
        }

        return { networkAssignments: assignments };
      });
    };

    const routeByMode = (state: typeof PremiseGraphState.State) => {
      if (state.error) return "end";
      if (state.operationMode === 'query') return "query";
      return "analyze";
    };

    const graph = new StateGraph(PremiseGraphState)
      .addNode("query", queryNode)
      .addNode("analyze", analyzeNode)
      .addNode("embed", embedNode)
      .addNode("persist", persistNode)
      .addNode("index", indexNode)
      .addConditionalEdges(START, routeByMode, {
        query: "query",
        analyze: "analyze",
        end: END,
      })
      .addEdge("query", END)
      .addEdge("analyze", "embed")
      .addEdge("embed", "persist")
      .addEdge("persist", "index")
      .addEdge("index", END);

    return graph.compile();
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: May show errors about `EmbeddingGenerator` type — check if the embedder interface uses `EmbeddingGenerator` or `Embedder`. Adjust the import accordingly (the profile graph uses `Embedder` from `embedder.interface.ts`).

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/premise/premise.graph.ts
git commit -m "feat(protocol): add PremiseGraphFactory with create/update/query modes"
```

---

### Task 6: Export from index.ts

**Files:**
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Add PremiseGraphFactory export**

In the graph factories section (around line 90, after the `ProfileGraphFactory` export), add:

```typescript
export { PremiseGraphFactory } from "./premise/premise.graph.js";
```

- [ ] **Step 2: Add PremiseGraphDatabase export**

In the interfaces section, add:

```typescript
export type { PremiseGraphDatabase } from "./shared/interfaces/database.interface.js";
```

- [ ] **Step 3: Add PremiseAnalyzer and PremiseIndexer exports**

In the agents section (around line 102, after the `IntentIndexer` export), add:

```typescript
export { PremiseAnalyzer } from "./premise/premise.analyzer.js";
export { PremiseIndexer } from "./premise/premise.indexer.js";
```

- [ ] **Step 4: Add type exports for premise interfaces**

In the interfaces section, add:

```typescript
export type {
  PremiseAssertion,
  PremiseProvenance,
  PremiseAnalysis,
  PremiseValidity,
  PremiseRecord,
} from "./shared/interfaces/database.interface.js";
```

- [ ] **Step 5: Verify build**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds (or shows only adapter-related errors from missing implementations)

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): export PremiseGraphFactory, analyzer, indexer, and types"
```

---

### Task 7: Write analyzer unit tests

**Files:**
- Create: `packages/protocol/src/premise/tests/premise.analyzer.spec.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect, beforeAll } from "bun:test";
import { config } from "dotenv";

config({ path: ".env.development", override: true });

import { PremiseAnalyzer } from "../premise.analyzer.js";

describe("PremiseAnalyzer", () => {
  let analyzer: PremiseAnalyzer;

  beforeAll(() => {
    analyzer = new PremiseAnalyzer();
  });

  it("classifies an identity statement as DECLARATIVE", async () => {
    const result = await analyzer.invoke("I am a climate-tech founder based in Berlin");

    expect(result.speechActType).toBe("DECLARATIVE");
    expect(result.felicityClarity).toBeGreaterThan(50);
    expect(result.semanticEntropy).toBeLessThan(0.7);
  }, 30_000);

  it("classifies a capability statement as ASSERTIVE", async () => {
    const result = await analyzer.invoke("I have 10 years of experience building distributed database systems in Rust");

    expect(result.speechActType).toBe("ASSERTIVE");
    expect(result.felicityAuthority).toBeGreaterThan(50);
    expect(result.felicityClarity).toBeGreaterThan(60);
  }, 30_000);

  it("scores a vague premise with high entropy", async () => {
    const result = await analyzer.invoke("I work in tech");

    expect(result.semanticEntropy).toBeGreaterThan(0.6);
    expect(result.felicityClarity).toBeLessThan(50);
  }, 30_000);

  it("scores a specific premise with low entropy", async () => {
    const result = await analyzer.invoke(
      "I am a senior ML engineer at Google Brain in Mountain View, specializing in transformer architectures"
    );

    expect(result.semanticEntropy).toBeLessThan(0.3);
    expect(result.felicityClarity).toBeGreaterThan(70);
  }, 30_000);
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/protocol && bun test src/premise/tests/premise.analyzer.spec.ts`
Expected: All 4 tests pass (requires `OPENROUTER_API_KEY` in `.env.development`)

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/premise/tests/premise.analyzer.spec.ts
git commit -m "test(protocol): add premise analyzer unit tests"
```

---

### Task 8: Write graph integration tests

**Files:**
- Create: `packages/protocol/src/premise/tests/premise.graph.spec.ts`

- [ ] **Step 1: Create test file with mocked deps**

```typescript
import { describe, it, expect, beforeAll } from "bun:test";
import { config } from "dotenv";

config({ path: ".env.development", override: true });

import { PremiseGraphFactory } from "../premise.graph.js";
import type { PremiseGraphDatabase, PremiseRecord } from "../../shared/interfaces/database.interface.js";

function createMockDatabase(): PremiseGraphDatabase {
  const premises: PremiseRecord[] = [];

  return {
    createPremise: async (input) => {
      const record: PremiseRecord = {
        id: crypto.randomUUID(),
        userId: input.userId,
        assertion: input.assertion,
        provenance: input.provenance,
        analysis: input.analysis ?? null,
        validity: input.validity,
        embedding: input.embedding ?? null,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        retractedAt: null,
      };
      premises.push(record);
      return record;
    },
    getPremise: async (id) => premises.find(p => p.id === id) ?? null,
    getPremisesForUser: async (userId, status) =>
      premises.filter(p => p.userId === userId && (!status || p.status === status)),
    updatePremise: async (id, updates) => {
      const idx = premises.findIndex(p => p.id === id);
      if (idx === -1) throw new Error("Premise not found");
      premises[idx] = { ...premises[idx], ...updates, updatedAt: new Date() };
      return premises[idx];
    },
    assignPremiseToNetwork: async () => {},
    getPremiseNetworks: async () => [],
    getUserIndexIds: async () => [],
    getNetwork: async () => null,
    getNetworkMemberContext: async () => null,
  };
}

function createMockEmbedder() {
  return {
    generateEmbedding: async (_text: string) => new Array(2000).fill(0.01),
    generateEmbeddings: async (texts: string[]) => texts.map(() => new Array(2000).fill(0.01)),
  };
}

describe("PremiseGraphFactory", () => {
  it("creates a premise with analysis and embedding", async () => {
    const db = createMockDatabase();
    const embedder = createMockEmbedder();
    const factory = new PremiseGraphFactory(db, embedder);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      assertionText: "I am a climate-tech founder based in Berlin",
      tier: "assertive" as const,
      volatile: false,
    });

    expect(result.premise).toBeDefined();
    expect(result.premise!.assertion.text).toBe("I am a climate-tech founder based in Berlin");
    expect(result.premise!.assertion.tier).toBe("assertive");
    expect(result.analysis).toBeDefined();
    expect(result.analysis!.speechActType).toMatch(/DECLARATIVE|ASSERTIVE/);
    expect(result.embedding).toBeDefined();
    expect(result.embedding!.length).toBe(2000);
    expect(result.error).toBeUndefined();
  }, 60_000);

  it("returns premises in query mode without LLM calls", async () => {
    const db = createMockDatabase();
    const embedder = createMockEmbedder();
    const factory = new PremiseGraphFactory(db, embedder);
    const graph = factory.createGraph();

    // Seed a premise
    await db.createPremise({
      userId: "user-1",
      assertion: { text: "I am a founder", tier: "assertive" },
      provenance: { source: "explicit", confidence: 1.0, timestamp: new Date().toISOString() },
      validity: { volatile: false },
    });

    const result = await graph.invoke({
      userId: "user-1",
      operationMode: "query" as const,
    });

    expect(result.readResult).toBeDefined();
    expect(result.readResult!.count).toBe(1);
    expect(result.readResult!.premises[0].assertion.text).toBe("I am a founder");
  }, 10_000);
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/protocol && bun test src/premise/tests/premise.graph.spec.ts`
Expected: Both tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/premise/tests/premise.graph.spec.ts
git commit -m "test(protocol): add premise graph integration tests"
```
