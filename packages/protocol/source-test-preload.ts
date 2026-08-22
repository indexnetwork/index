/**
 * Hermetic source-test preload.
 *
 * Production modules may construct model-backed agents before a focused spec
 * can inject its own model. This harness-only structural double prevents that
 * construction from reading credentials or opening a provider connection.
 * Agent-keyed responses provide only the structural data each production
 * boundary requires. Specs that assert a behavior use their own module mock
 * and therefore retain control of their semantic fixture.
 *
 * The direct model.config contract specs are intentionally left unmocked —
 * they assert model.config's own behaviour, so replacing it with the structural
 * double would make them assert the double instead of the contract.
 */
import { mock } from "bun:test";

const modelConfigSpecs = [
  "/shared/agent/tests/model.config.spec.ts",
  "/shared/agent/tests/model-overrides.spec.ts",
];
const localModelMockSpecs = [
  "/chat/tests/chat.agent.persona.spec.ts",
  "/chat/tests/chat.agent.spec.ts",
  "/contacts/tests/contact.inviter.claim-safety.spec.ts",
  "/enrichment/tests/enrichment.graph.spec.ts",
  "/intents/tests/intent.clarifier.spec.ts",
  "/intents/tests/intent.graph.spec.ts",
  "/intents/tests/intent.inferrer.spec.ts",
  "/intents/tests/intent.reconciler.spec.ts",
  "/intents/tests/intent.verifier.spec.ts",
  "/negotiations/tests/negotiation.agent.spec.ts",
  "/negotiations/tests/negotiation.summarizer.spec.ts",
  "/negotiations/tests/negotiator-timeout.spec.ts",
  "/premises/tests/premise.analyzer.spec.ts",
];
const runsSpec = (spec: string) => process.argv.some((arg) => arg.endsWith(spec));
const runsModelConfigSpec = modelConfigSpecs.some(runsSpec);
const runsLocalModelMockSpec = localModelMockSpecs.some(runsSpec);

// Bun merges the package bunfig preload with an explicit config's preload.
// Clearing here keeps the source gate hermetic even when the regular preload
// has already loaded a developer-only root .env.test.
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENAI_API_KEY;

if (!runsModelConfigSpec && !runsLocalModelMockSpec) {
  const promptText = (input: unknown): string => {
    if (!Array.isArray(input)) return "";
    return String((input.at(-1) as { content?: unknown } | undefined)?.content ?? "");
  };

  const structuredResponse = (agent: string, input: unknown): Record<string, unknown> => {
    const prompt = promptText(input).toLowerCase();
    if (agent === "lensInferrer") {
      const corpus = prompt.includes("marketplace") ? "intents" : "profiles";
      const label = prompt.includes("depin") || prompt.includes("sensor")
        ? "DePIN infrastructure investors"
        : prompt.includes("machine learning") ? "Experienced machine learning engineer" : "Relevant collaborators";
      return { lenses: [{ label, corpus, reasoning: "Deterministic source-test lens." }] };
    }
    if (agent === "hydeGenerator") return { hypotheticalDocument: "A relevant professional collaborator with complementary goals." };
    if (agent === "intentIndexer" || agent === "premiseIndexer") {
      return { indexScore: 0.8, memberScore: 0.6, reasoning: "Deterministic source-test relevance." };
    }
    if (agent === "premiseAnalyzer") {
      return { reasoning: "Deterministic source-test analysis.", speechActType: "DECLARATIVE", felicityAuthority: 80, felicitySincerity: 80, felicityClarity: 80, semanticEntropy: 0.2 };
    }
    if (agent === "premiseDecomposer") {
      return { reasoning: "Deterministic source-test decomposition.", premises: [], retractedPremiseIds: [], revisedBio: null };
    }
    if (agent === "intentReconciler") return { actions: [] };
    if (agent === "intentVerifier") {
      return { reasoning: "Deterministic source-test verification.", classification: "ASSERTIVE", felicity_scores: { clarity: 80, authority: 80, sincerity: 80 }, semantic_entropy: 0.2, referential_anchor: null, referential_breadth: "narrow", missing_selectional_constraints: [], specificity_warning: null, flags: [] };
    }
    if (agent === "opportunityEvaluator") return { opportunities: [] };
    if (agent === "opportunityPresenter") {
      return { presentation: { headline: "A relevant connection", personalizedSummary: "This is a relevant opportunity.", suggestedAction: "Review the opportunity.", greeting: "I would like to compare notes." } };
    }
    if (agent === "homeCategorizer") return { sections: [] };
    if (agent === "suggestionGenerator") {
      return { suggestions: [{ label: "Share more context", type: "prompt", followupText: null, prefill: "I am looking for " }] };
    }
    if (agent === "chatTitleGenerator") return { title: "Conversation" };
    if (agent === "negotiationReflector") return { memory: "Deterministic source-test reflection.", shouldContinue: true };
    if (agent === "negotiationSummarizer") return { summary: "Deterministic source-test summary." };
    if (agent === "negotiator") return { hasOpportunity: false, agreedRoles: [], reasoning: "Deterministic source-test negotiation.", turnCount: 0 };
    return {};
  };

  const modelFor = (agent: string) => {
    const model = {
      invoke: async (input: unknown) => structuredResponse(agent, input),
      bind: () => model,
      bindTools: () => model,
      withStructuredOutput: () => model,
      stream: async function* (): AsyncGenerator<{ content: string }> {
        yield { content: "Deterministic source-test response." };
      },
    };
    return model;
  };

  mock.module(import.meta.resolve("./src/internal/shared/agent/model.config.js"), () => ({
    createModel: (agent: string) => modelFor(agent),
    createFallbackModel: () => undefined,
    createStructuredModel: (agent: string) => modelFor(agent),
    createResilientModel: (agent: string) => modelFor(agent),
    getModelName: () => "source-test-model",
  }));
}
