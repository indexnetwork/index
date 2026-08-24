/**
 * Canonical model-assignment authority for every protocol agent.
 *
 * The resolver is pure: callers provide the complete environment projection it
 * may read. Historical eval planning uses the returned all-agent map so an
 * unmentioned agent cannot drift behind an implicit runtime default.
 */
export const CANONICAL_AGENT_MODEL_DEFAULTS = Object.freeze({
  intentInferrer: "google/gemini-3.7-flash",
  intentIndexer: "google/gemini-3.7-flash",
  intentVerifier: "google/gemini-3.7-flash",
  intentReconciler: "google/gemini-3.7-flash",
  intentClarifier: "google/gemini-3.7-flash",
  profileGenerator: "google/gemini-3.7-flash",
  hydeGenerator: "google/gemini-3.7-flash",
  hydeValidator: "google/gemini-3.7-flash",
  lensInferrer: "google/gemini-3.7-flash",
  opportunityEvaluator: "google/gemini-3.7-flash",
  opportunityPresenter: "google/gemini-3.7-flash",
  negotiator: "google/gemini-3.7-flash",
  negotiationReflector: "google/gemini-3.7-flash",
  homeCategorizer: "google/gemini-3.7-flash",
  suggestionGenerator: "google/gemini-3.7-flash",
  chatTitleGenerator: "google/gemini-3.7-flash",
  negotiationInsights: "google/gemini-3.7-flash",
  chatContextSummarizer: "google/gemini-3.7-flash",
  signalIntakePack: "google/gemini-3.7-flash",
  negotiationSummarizer: "google/gemini-3.7-flash",
  poolDiscriminatorMiner: "google/gemini-3.7-flash",
  poolDiscriminatorAssigner: "google/gemini-3.7-flash",
  negotiationEvidenceMiner: "google/gemini-3.7-flash",
  inviteGenerator: "google/gemini-3.7-flash",
  premiseAnalyzer: "google/gemini-3.7-flash",
  premiseDecomposer: "google/gemini-3.7-flash",
  premiseIndexer: "google/gemini-3.7-flash",
  userContextGenerator: "google/gemini-3.7-flash",
  networkRecommender: "google/gemini-3.7-flash",
  interruptClassifier: "google/gemini-3.7-flash",
  chat: "google/gemini-3.7-flash",
} as const);

export type CanonicalModelAgent = keyof typeof CANONICAL_AGENT_MODEL_DEFAULTS;
export type CanonicalAllAgentModels = Readonly<Record<CanonicalModelAgent, string>>;
export const CANONICAL_MODEL_AGENTS = Object.freeze(Object.keys(CANONICAL_AGENT_MODEL_DEFAULTS) as CanonicalModelAgent[]);

function parseOverrides(raw: string | undefined): Partial<Record<CanonicalModelAgent, string>> {
  if (raw?.trim() === undefined || raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("EVAL_MODEL_OVERRIDES is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("EVAL_MODEL_OVERRIDES must be a JSON object of agent -> model id");
  }
  const overrides: Partial<Record<CanonicalModelAgent, string>> = {};
  for (const [agent, model] of Object.entries(parsed as Record<string, unknown>)) {
    if (!CANONICAL_MODEL_AGENTS.includes(agent as CanonicalModelAgent)) {
      throw new Error(`EVAL_MODEL_OVERRIDES names an unknown agent "${agent}". Known agents: ${CANONICAL_MODEL_AGENTS.join(", ")}`);
    }
    if (typeof model !== "string" || model.trim() === "") {
      throw new Error(`EVAL_MODEL_OVERRIDES value for "${agent}" must be a non-empty model id string`);
    }
    overrides[agent as CanonicalModelAgent] = model.trim();
  }
  return overrides;
}

export function resolveCanonicalAllAgentModels(
  environment: Readonly<Record<string, string | undefined>>,
  options: { applyEvalOverrides?: boolean } = {},
): CanonicalAllAgentModels {
  const models: Record<CanonicalModelAgent, string> = { ...CANONICAL_AGENT_MODEL_DEFAULTS };
  const chatModel = environment.CHAT_MODEL?.trim();
  if (chatModel) models.chat = chatModel;
  if (options.applyEvalOverrides !== false) {
    Object.assign(models, parseOverrides(environment.EVAL_MODEL_OVERRIDES));
  }
  return Object.freeze(models);
}
