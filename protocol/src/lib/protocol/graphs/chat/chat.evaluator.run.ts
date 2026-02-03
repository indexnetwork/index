/**
 * Focused test run: Discovery, Intent Expression, Opportunity Finding
 */

import { config } from "dotenv";
config({ path: ".env.development", override: true });

import {
  ScenarioGenerator,
  runNeedFulfillmentTest,
  USER_NEEDS,
  USER_PERSONAS,
  type ChatAgentInterface,
  type GeneratedScenario,
  type UserPersonaId,
} from "./chat.evaluator";
import { ChatGraphFactory } from "./chat.graph";
import { HumanMessage } from "@langchain/core/messages";
import type { ChatGraphCompositeDatabase } from "../../interfaces/database.interface";
import type { Embedder } from "../../interfaces/embedder.interface";
import type { Scraper } from "../../interfaces/scraper.interface";

// ═══════════════════════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════════════════════

function createStatefulMockDatabase(): ChatGraphCompositeDatabase {
  const state = {
    profile: null as any,
    intents: [] as any[],
    indexes: [
      { id: "idx-1", title: "AI Founders", prompt: "AI startup founders" },
      { id: "idx-2", title: "ML Engineers", prompt: "Machine learning engineers" },
    ],
    memberships: [{ indexId: "idx-1", role: "member" }],
  };

  return {
    getProfile: async () => state.profile,
    saveProfile: async (userId: string, profile: any) => {
      state.profile = { ...profile, userId, updatedAt: new Date() };
    },
    saveHydeProfile: async () => {},
    getActiveIntents: async () => state.intents.filter((i) => !i.deletedAt),
    getIntentsInIndexForMember: async () => [],
    createIntent: async (data: any) => {
      const intent = {
        id: `intent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        payload: data.payload,
        summary: data.payload.slice(0, 100),
        userId: data.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        isIncognito: false,
      };
      state.intents.push(intent);
      console.log(`    ✓ Intent created: "${intent.summary}"`);
      return intent;
    },
    updateIntent: async (intentId: string, updates: any) => {
      const intent = state.intents.find((i) => i.id === intentId);
      if (intent) {
        Object.assign(intent, updates, { updatedAt: new Date() });
        return intent;
      }
      return null;
    },
    archiveIntent: async (intentId: string) => {
      const intent = state.intents.find((i) => i.id === intentId);
      if (intent) {
        intent.deletedAt = new Date();
        return { success: true };
      }
      return { success: false };
    },
    getUser: async () => ({ id: "test-user", email: "test@example.com" }),
    getUserIndexIds: async () => state.memberships.map((m) => m.indexId),
    getIndexMemberships: async () =>
      state.memberships.map((m) => ({
        ...m,
        index: state.indexes.find((i) => i.id === m.indexId),
      })),
    getIntentForIndexing: async () => null,
    getIndexMemberContext: async () => null,
    isIntentAssignedToIndex: async () => false,
    assignIntentToIndex: async () => {},
    unassignIntentFromIndex: async () => {},
    getOwnedIndexes: async () => [],
    isIndexOwner: async () => false,
    getIndexMembersForOwner: async () => [],
    getIndexIntentsForOwner: async () => [],
    updateIndexSettings: async () => ({}) as any,
  } as unknown as ChatGraphCompositeDatabase;
}

const mockEmbedder: Embedder = {
  generate: async () => new Array(2000).fill(0),
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

const mockScraper: Scraper = {
  scrape: async () => "Scraped content from the page.",
  extractUrlContent: async (url: string) =>
    `Professional profile: Software engineer with 10 years experience in AI/ML, previously at Google and Meta. Skills: Python, TensorFlow, PyTorch, distributed systems.`,
} as unknown as Scraper;

function createChatAgentAdapter(database: ChatGraphCompositeDatabase): ChatAgentInterface {
  const factory = new ChatGraphFactory(database, mockEmbedder, mockScraper);
  let graph = factory.createGraph();
  let messages: any[] = [];

  return {
    async chat(message: string) {
      messages.push(new HumanMessage(message));
      const result = await graph.invoke({
        userId: "test-eval-user",
        messages,
      });
      messages = result.messages;

      const toolsUsed: string[] = [];
      for (const msg of result.messages) {
        if (msg.tool_calls?.length) {
          for (const tc of msg.tool_calls) {
            toolsUsed.push(tc.name);
          }
        }
      }

      return {
        response: result.responseText || "",
        toolsUsed,
      };
    },
    reset() {
      graph = factory.createGraph();
      messages = [];
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MANUAL TEST SCENARIOS - More realistic user messages
// ═══════════════════════════════════════════════════════════════════════════════

const INTENT_EXPRESSION_SCENARIOS: Partial<GeneratedScenario>[] = [
  // Hiring intents
  {
    id: "hiring-ml-engineer",
    generatedMessage: "I'm looking to hire ML engineers for my startup",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.BUSY_FOUNDER,
  },
  {
    id: "hiring-frontend",
    generatedMessage: "Need a React developer, someone senior who knows Next.js",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.BUSY_FOUNDER,
  },
  {
    id: "hiring-designer",
    generatedMessage: "Looking for a product designer to help with our mobile app",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.DETAIL_ORIENTED,
  },

  // Co-founder intents
  {
    id: "cofounder-technical",
    generatedMessage: "I'm a business guy looking for a technical co-founder",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.NEW_USER,
  },
  {
    id: "cofounder-business",
    generatedMessage: "I'm an engineer, need someone who can handle sales and fundraising",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.POWER_USER,
  },

  // Learning/mentorship intents
  {
    id: "learn-ai",
    generatedMessage: "I want to learn about AI and machine learning, looking for a mentor",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.NEW_USER,
  },
  {
    id: "startup-advice",
    generatedMessage: "First time founder here, looking for experienced founders to learn from",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.NEW_USER,
  },

  // Investment intents
  {
    id: "seeking-investment",
    generatedMessage: "We're raising a seed round, looking for angels interested in AI",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.BUSY_FOUNDER,
  },
  {
    id: "looking-to-invest",
    generatedMessage: "I'm an angel investor looking for early-stage AI startups",
    need: USER_NEEDS.EXPRESS_OFFER,
    persona: USER_PERSONAS.POWER_USER,
  },

  // Collaboration intents
  {
    id: "collaboration-research",
    generatedMessage: "Looking for researchers to collaborate on an open source LLM project",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.DETAIL_ORIENTED,
  },
  {
    id: "freelance-work",
    generatedMessage: "I'm available for freelance backend work, especially Python/Django",
    need: USER_NEEDS.EXPRESS_OFFER,
    persona: USER_PERSONAS.POWER_USER,
  },

  // Vague/ambiguous intents
  {
    id: "vague-networking",
    generatedMessage: "Just want to meet interesting people in tech",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.VAGUE_USER,
  },
  {
    id: "vague-help",
    generatedMessage: "need some help with my startup stuff",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.MOBILE_USER,
  },
];

const DISCOVERY_SCENARIOS: Partial<GeneratedScenario>[] = [
  // Direct discovery requests
  {
    id: "find-ml-people",
    generatedMessage: "Who in this network works with machine learning?",
    need: USER_NEEDS.FIND_PEOPLE,
    persona: USER_PERSONAS.POWER_USER,
  },
  {
    id: "find-founders",
    generatedMessage: "Show me other founders in my space",
    need: USER_NEEDS.FIND_PEOPLE,
    persona: USER_PERSONAS.BUSY_FOUNDER,
  },
  {
    id: "find-investors",
    generatedMessage: "Are there any investors here interested in healthcare startups?",
    need: USER_NEEDS.FIND_PEOPLE,
    persona: USER_PERSONAS.NEW_USER,
  },
  {
    id: "find-designers",
    generatedMessage: "I need to find UX designers who have worked on B2B products",
    need: USER_NEEDS.FIND_PEOPLE,
    persona: USER_PERSONAS.DETAIL_ORIENTED,
  },

  // Serendipity/exploration
  {
    id: "explore-opportunities",
    generatedMessage: "What opportunities are available for someone with my background?",
    need: USER_NEEDS.EXPLORE_SERENDIPITY,
    persona: USER_PERSONAS.NEW_USER,
  },
  {
    id: "explore-matches",
    generatedMessage: "Who might be a good match for me?",
    need: USER_NEEDS.EXPLORE_SERENDIPITY,
    persona: USER_PERSONAS.VAGUE_USER,
  },
  {
    id: "explore-network",
    generatedMessage: "What's happening in the network? Any interesting people?",
    need: USER_NEEDS.EXPLORE_SERENDIPITY,
    persona: USER_PERSONAS.POWER_USER,
  },

  // Discovery after intent
  {
    id: "discover-after-intent",
    generatedMessage: "I just said I'm looking for ML engineers - can you find me some?",
    need: USER_NEEDS.FIND_PEOPLE,
    persona: USER_PERSONAS.FRUSTRATED_USER,
  },
];

const COMBINED_SCENARIOS: Partial<GeneratedScenario>[] = [
  // Intent + immediate discovery
  {
    id: "intent-and-find",
    generatedMessage: "I'm hiring ML engineers - who's available?",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.BUSY_FOUNDER,
  },
  {
    id: "offer-and-find",
    generatedMessage: "I do freelance React work, who needs a developer?",
    need: USER_NEEDS.EXPRESS_OFFER,
    persona: USER_PERSONAS.POWER_USER,
  },
  {
    id: "cofounder-and-find",
    generatedMessage: "Looking for a technical co-founder, any engineers here building in AI?",
    need: USER_NEEDS.EXPRESS_WANT,
    persona: USER_PERSONAS.BUSY_FOUNDER,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ═══════════════════════════════════════════════════════════════════════════════

async function runScenario(
  scenario: Partial<GeneratedScenario>,
  chatAgent: ChatAgentInterface,
  category: string
): Promise<TestResult> {
  const fullScenario: GeneratedScenario = {
    id: scenario.id!,
    need: scenario.need!,
    persona: scenario.persona!,
    generatedMessage: scenario.generatedMessage!,
    context: { hasProfile: true, hasIntents: false, isIndexOwner: false },
    evaluationCriteria: {
      needFulfilled: scenario.need!.description,
      successSignals: scenario.need!.successSignals,
      failureSignals: scenario.need!.failureSignals,
      qualityFactors: ["Response is natural", "Correct tools used", "Need was addressed"],
    },
  };

  const result = await runNeedFulfillmentTest(fullScenario, chatAgent, {
    verbose: false,
    maxTurns: 3,
    timeoutMs: 90000,
  });

  return {
    category,
    scenario: {
      id: scenario.id!,
      message: scenario.generatedMessage!,
      need: scenario.need!.id,
      persona: scenario.persona!.id,
    },
    conversation: result.conversation,
    evaluation: {
      verdict: result.evaluation.overallVerdict,
      score: result.evaluation.fulfillmentScore,
      reasoning: result.evaluation.reasoning,
      successSignals: result.evaluation.successSignalsMatched,
      failureSignals: result.evaluation.failureSignalsTriggered,
    },
    metadata: {
      toolsUsed: result.metadata.toolsUsed,
      turnCount: result.metadata.turnCount,
      duration: result.metadata.duration,
    },
  };
}

interface TestResult {
  category: string;
  scenario: {
    id: string;
    message: string;
    need: string;
    persona: string;
  };
  conversation: Array<{ role: string; content: string }>;
  evaluation: {
    verdict: string;
    score: number;
    reasoning: string;
    successSignals: string[];
    failureSignals: string[];
  };
  metadata: {
    toolsUsed: string[];
    turnCount: number;
    duration: number;
  };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  CHAT AGENT EVALUATION - Discovery, Intents, Opportunities");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  const allResults: TestResult[] = [];
  const startTime = Date.now();

  // ─────────────────────────────────────────────────────────────────────────────
  // INTENT EXPRESSION TESTS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("┌─────────────────────────────────────────────────────────────────┐");
  console.log("│  INTENT EXPRESSION SCENARIOS                                    │");
  console.log("└─────────────────────────────────────────────────────────────────┘\n");

  for (const scenario of INTENT_EXPRESSION_SCENARIOS) {
    const database = createStatefulMockDatabase();
    const chatAgent = createChatAgentAdapter(database);

    console.log(`▶ [${scenario.id}] "${scenario.generatedMessage}"`);

    try {
      const result = await runScenario(scenario, chatAgent, "intent");
      allResults.push(result);

      const verdict = result.evaluation.verdict;
      const icon = verdict === "success" ? "✅" : verdict === "partial" ? "⚠️" : "❌";
      console.log(`  ${icon} ${verdict.toUpperCase()} (${result.evaluation.score})`);
      console.log(`     Tools: ${result.metadata.toolsUsed.join(", ") || "none"}`);
      console.log(`     ${result.evaluation.reasoning.slice(0, 100)}...`);
    } catch (e) {
      console.log(`  ❌ ERROR: ${e}`);
    }
    console.log();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DISCOVERY TESTS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n┌─────────────────────────────────────────────────────────────────┐");
  console.log("│  DISCOVERY SCENARIOS                                            │");
  console.log("└─────────────────────────────────────────────────────────────────┘\n");

  for (const scenario of DISCOVERY_SCENARIOS) {
    const database = createStatefulMockDatabase();
    const chatAgent = createChatAgentAdapter(database);

    console.log(`▶ [${scenario.id}] "${scenario.generatedMessage}"`);

    try {
      const result = await runScenario(scenario, chatAgent, "discovery");
      allResults.push(result);

      const verdict = result.evaluation.verdict;
      const icon = verdict === "success" ? "✅" : verdict === "partial" ? "⚠️" : "❌";
      console.log(`  ${icon} ${verdict.toUpperCase()} (${result.evaluation.score})`);
      console.log(`     Tools: ${result.metadata.toolsUsed.join(", ") || "none"}`);
      console.log(`     ${result.evaluation.reasoning.slice(0, 100)}...`);
    } catch (e) {
      console.log(`  ❌ ERROR: ${e}`);
    }
    console.log();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COMBINED (INTENT + DISCOVERY) TESTS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n┌─────────────────────────────────────────────────────────────────┐");
  console.log("│  COMBINED SCENARIOS (Intent + Discovery)                        │");
  console.log("└─────────────────────────────────────────────────────────────────┘\n");

  for (const scenario of COMBINED_SCENARIOS) {
    const database = createStatefulMockDatabase();
    const chatAgent = createChatAgentAdapter(database);

    console.log(`▶ [${scenario.id}] "${scenario.generatedMessage}"`);

    try {
      const result = await runScenario(scenario, chatAgent, "combined");
      allResults.push(result);

      const verdict = result.evaluation.verdict;
      const icon = verdict === "success" ? "✅" : verdict === "partial" ? "⚠️" : "❌";
      console.log(`  ${icon} ${verdict.toUpperCase()} (${result.evaluation.score})`);
      console.log(`     Tools: ${result.metadata.toolsUsed.join(", ") || "none"}`);
      console.log(`     ${result.evaluation.reasoning.slice(0, 100)}...`);
    } catch (e) {
      console.log(`  ❌ ERROR: ${e}`);
    }
    console.log();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUMMARY & REPORT GENERATION
  // ─────────────────────────────────────────────────────────────────────────────
  const totalDuration = Date.now() - startTime;

  const byCategory = {
    intent: allResults.filter((r) => r.category === "intent"),
    discovery: allResults.filter((r) => r.category === "discovery"),
    combined: allResults.filter((r) => r.category === "combined"),
  };

  const totalSuccess = allResults.filter((r) => r.evaluation.verdict === "success").length;
  const totalPartial = allResults.filter((r) => r.evaluation.verdict === "partial").length;
  const totalFailure = allResults.filter(
    (r) => !["success", "partial"].includes(r.evaluation.verdict)
  ).length;

  // Tool usage analysis
  const toolUsage: Record<string, number> = {};
  for (const result of allResults) {
    for (const tool of result.metadata.toolsUsed) {
      toolUsage[tool] = (toolUsage[tool] || 0) + 1;
    }
  }

  // Generate comprehensive report
  const report = generateReport(allResults, byCategory, {
    totalSuccess,
    totalPartial,
    totalFailure,
    toolUsage,
    totalDuration,
  });

  // Save report to dedicated directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportDir = "./eval-reports";

  // Create directory if it doesn't exist
  await Bun.write(`${reportDir}/.gitkeep`, "");

  const reportPath = `${reportDir}/chat-eval-report-${timestamp}.md`;
  const jsonPath = `${reportDir}/chat-eval-results-${timestamp}.json`;
  const conversationsPath = `${reportDir}/chat-eval-conversations-${timestamp}.md`;

  // Generate conversations log
  const conversationsLog = generateConversationsLog(allResults);

  await Bun.write(reportPath, report);
  await Bun.write(jsonPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total: allResults.length,
      success: totalSuccess,
      partial: totalPartial,
      failure: totalFailure,
      successRate: ((totalSuccess + totalPartial * 0.5) / allResults.length * 100).toFixed(1) + "%",
      duration: totalDuration,
    },
    toolUsage,
    results: allResults,
  }, null, 2));
  await Bun.write(conversationsPath, conversationsLog);

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  for (const [category, results] of Object.entries(byCategory)) {
    const success = results.filter((r) => r.evaluation.verdict === "success").length;
    const partial = results.filter((r) => r.evaluation.verdict === "partial").length;
    const failure = results.filter(
      (r) => !["success", "partial"].includes(r.evaluation.verdict)
    ).length;

    console.log(`${category.toUpperCase()}: ${success}✅ ${partial}⚠️  ${failure}❌  (${results.length} total)`);
  }

  console.log(`\nTOTAL: ${totalSuccess}✅ ${totalPartial}⚠️  ${totalFailure}❌  (${allResults.length} total)`);
  console.log(
    `SUCCESS RATE: ${(((totalSuccess + totalPartial * 0.5) / allResults.length) * 100).toFixed(1)}%`
  );

  console.log("\n─────────────────────────────────────────────────────────────────");
  console.log("REPORTS GENERATED:\n");
  console.log(`  📄 Report:        ${reportPath}`);
  console.log(`  💬 Conversations: ${conversationsPath}`);
  console.log(`  📊 JSON Data:     ${jsonPath}`);
}

function generateConversationsLog(allResults: TestResult[]): string {
  const lines: string[] = [];

  lines.push("# Chat Agent Evaluation - Conversation Logs");
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Total Conversations:** ${allResults.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Group by verdict for easier analysis
  const byVerdict: Record<string, TestResult[]> = {
    success: [],
    partial: [],
    failure: [],
    misunderstood: [],
    blocked: [],
  };

  for (const r of allResults) {
    const verdict = r.evaluation.verdict;
    if (!byVerdict[verdict]) byVerdict[verdict] = [];
    byVerdict[verdict].push(r);
  }

  // Success cases first
  if (byVerdict.success.length > 0) {
    lines.push("## ✅ Successful Conversations");
    lines.push("");
    for (const r of byVerdict.success) {
      lines.push(...formatConversation(r));
    }
  }

  // Partial
  if (byVerdict.partial.length > 0) {
    lines.push("## ⚠️ Partial Success Conversations");
    lines.push("");
    for (const r of byVerdict.partial) {
      lines.push(...formatConversation(r));
    }
  }

  // Failures
  const failures = [...(byVerdict.failure || []), ...(byVerdict.misunderstood || []), ...(byVerdict.blocked || [])];
  if (failures.length > 0) {
    lines.push("## ❌ Failed Conversations");
    lines.push("");
    for (const r of failures) {
      lines.push(...formatConversation(r));
    }
  }

  return lines.join("\n");
}

function formatConversation(result: TestResult): string[] {
  const lines: string[] = [];
  const icon = result.evaluation.verdict === "success" ? "✅" :
               result.evaluation.verdict === "partial" ? "⚠️" : "❌";

  lines.push(`### ${icon} ${result.scenario.id}`);
  lines.push("");
  lines.push(`| Property | Value |`);
  lines.push(`|----------|-------|`);
  lines.push(`| **User Message** | "${result.scenario.message}" |`);
  lines.push(`| **Category** | ${result.category} |`);
  lines.push(`| **Need** | ${result.scenario.need} |`);
  lines.push(`| **Persona** | ${result.scenario.persona} |`);
  lines.push(`| **Verdict** | ${result.evaluation.verdict.toUpperCase()} |`);
  lines.push(`| **Score** | ${result.evaluation.score} |`);
  lines.push(`| **Tools Used** | ${result.metadata.toolsUsed.join(", ") || "none"} |`);
  lines.push(`| **Turns** | ${result.metadata.turnCount} |`);
  lines.push(`| **Duration** | ${result.metadata.duration}ms |`);
  lines.push("");

  lines.push("**Evaluation:**");
  lines.push(`> ${result.evaluation.reasoning}`);
  lines.push("");

  lines.push("**Conversation:**");
  lines.push("");
  lines.push("```");

  if (result.conversation.length === 0) {
    lines.push("(No conversation recorded)");
  } else {
    for (const turn of result.conversation) {
      const prefix = turn.role === "user" ? "👤 USER" : "🤖 ASSISTANT";
      lines.push(`${prefix}:`);
      // Wrap long lines
      const content = turn.content.split("\n").map(line => {
        if (line.length > 100) {
          return line.match(/.{1,100}/g)?.join("\n  ") || line;
        }
        return line;
      }).join("\n");
      lines.push(content);
      lines.push("");
    }
  }

  lines.push("```");
  lines.push("");
  lines.push("---");
  lines.push("");

  return lines;
}

function generateReport(
  allResults: TestResult[],
  byCategory: Record<string, TestResult[]>,
  stats: {
    totalSuccess: number;
    totalPartial: number;
    totalFailure: number;
    toolUsage: Record<string, number>;
    totalDuration: number;
  }
): string {
  const lines: string[] = [];

  lines.push("# Chat Agent Evaluation Report");
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Total Duration:** ${(stats.totalDuration / 1000).toFixed(1)}s`);
  lines.push(`**Total Scenarios:** ${allResults.length}`);
  lines.push("");

  // Executive Summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Success Rate | ${(((stats.totalSuccess + stats.totalPartial * 0.5) / allResults.length) * 100).toFixed(1)}% |`);
  lines.push(`| ✅ Success | ${stats.totalSuccess} |`);
  lines.push(`| ⚠️ Partial | ${stats.totalPartial} |`);
  lines.push(`| ❌ Failure | ${stats.totalFailure} |`);
  lines.push("");

  // Results by Category
  lines.push("## Results by Category");
  lines.push("");
  lines.push("| Category | Success | Partial | Failure | Total | Rate |");
  lines.push("|----------|---------|---------|---------|-------|------|");

  for (const [category, results] of Object.entries(byCategory)) {
    const success = results.filter((r) => r.evaluation.verdict === "success").length;
    const partial = results.filter((r) => r.evaluation.verdict === "partial").length;
    const failure = results.filter((r) => !["success", "partial"].includes(r.evaluation.verdict)).length;
    const rate = ((success + partial * 0.5) / results.length * 100).toFixed(0);
    lines.push(`| ${category} | ${success} | ${partial} | ${failure} | ${results.length} | ${rate}% |`);
  }
  lines.push("");

  // Tool Usage
  lines.push("## Tool Usage Patterns");
  lines.push("");
  lines.push("| Tool | Times Called |");
  lines.push("|------|--------------|");
  for (const [tool, count] of Object.entries(stats.toolUsage).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${tool} | ${count} |`);
  }
  lines.push("");

  // Key Issues
  lines.push("## Key Issues Identified");
  lines.push("");

  const failures = allResults.filter((r) => !["success", "partial"].includes(r.evaluation.verdict));
  const issuePatterns: Record<string, string[]> = {};

  for (const f of failures) {
    const reasoning = f.evaluation.reasoning.toLowerCase();
    let pattern = "other";

    if (reasoning.includes("find_opportunities") && reasoning.includes("intent")) {
      pattern = "Wrong tool: Used find_opportunities instead of create_intent";
    } else if (reasoning.includes("try again") || reasoning.includes("unable to find")) {
      pattern = "Poor error recovery: Just said 'try again' on failure";
    } else if (reasoning.includes("misunderstood") || reasoning.includes("wrong")) {
      pattern = "Misunderstood user intent";
    } else if (reasoning.includes("offer") && reasoning.includes("want")) {
      pattern = "Confused offer vs want";
    }

    if (!issuePatterns[pattern]) issuePatterns[pattern] = [];
    issuePatterns[pattern].push(f.scenario.id);
  }

  for (const [pattern, ids] of Object.entries(issuePatterns)) {
    lines.push(`### ${pattern}`);
    lines.push(`Affected scenarios: ${ids.join(", ")}`);
    lines.push("");
  }

  // Detailed Results by Category
  for (const [category, results] of Object.entries(byCategory)) {
    lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)} Scenarios`);
    lines.push("");

    for (const result of results) {
      const icon = result.evaluation.verdict === "success" ? "✅" :
                   result.evaluation.verdict === "partial" ? "⚠️" : "❌";

      lines.push(`### ${icon} ${result.scenario.id}`);
      lines.push("");
      lines.push(`**User Message:** "${result.scenario.message}"`);
      lines.push("");
      lines.push(`**Need:** ${result.scenario.need} | **Persona:** ${result.scenario.persona}`);
      lines.push("");
      lines.push(`**Verdict:** ${result.evaluation.verdict.toUpperCase()} (Score: ${result.evaluation.score})`);
      lines.push("");
      lines.push(`**Tools Used:** ${result.metadata.toolsUsed.join(", ") || "none"}`);
      lines.push("");
      lines.push(`**Evaluation:** ${result.evaluation.reasoning}`);
      lines.push("");

      // Conversation log
      if (result.conversation.length > 0) {
        lines.push("<details>");
        lines.push("<summary>View Conversation</summary>");
        lines.push("");
        lines.push("```");
        for (const turn of result.conversation) {
          const prefix = turn.role === "user" ? "👤 USER" : "🤖 ASSISTANT";
          lines.push(`${prefix}:`);
          lines.push(turn.content);
          lines.push("");
        }
        lines.push("```");
        lines.push("</details>");
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  // Recommendations
  lines.push("## Recommendations");
  lines.push("");

  if (stats.toolUsage["find_opportunities"] > stats.toolUsage["create_intent"] * 2) {
    lines.push("1. **Rebalance tool selection:** The agent calls `find_opportunities` much more than `create_intent`. When users express a want/need, the agent should first capture it as an intent before searching.");
    lines.push("");
  }

  const discoveryResults = byCategory.discovery || [];
  const discoveryFailures = discoveryResults.filter((r) => !["success", "partial"].includes(r.evaluation.verdict));
  if (discoveryFailures.length > discoveryResults.length * 0.5) {
    lines.push("2. **Improve discovery error handling:** Most discovery scenarios fail. The agent should gracefully handle empty results and offer alternatives (e.g., create an intent to be notified when matches appear).");
    lines.push("");
  }

  const offerScenarios = allResults.filter((r) => r.scenario.need === "express_offer");
  const offerFailures = offerScenarios.filter((r) => !["success", "partial"].includes(r.evaluation.verdict));
  if (offerFailures.length > 0) {
    lines.push("3. **Distinguish offers from wants:** The agent treats user offers (e.g., 'I do freelance work') the same as wants. It should recognize offers and create appropriate intents.");
    lines.push("");
  }

  lines.push("4. **Improve intent verification:** Some valid user intents are being dropped by the semantic verifier. Review the ASSERTIVE classification logic.");
  lines.push("");

  return lines.join("\n");
}

main().catch(console.error);
