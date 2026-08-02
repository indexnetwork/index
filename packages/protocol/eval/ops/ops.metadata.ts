/**
 * Display + validation metadata for the eval-ops guided configuration UI.
 *
 * Single source of truth for: what the allowlisted env flags mean and accept,
 * which agents each scorecard harness exercises (and what those agents do),
 * and the selectable models. Consumed by the server (validation, metadata
 * endpoint) and by the browser app (guided editors).
 *
 * Like ops.allowlist.ts, this module must stay dependency-free (no node
 * built-ins) so the Vite bundle can import it. Copy is grounded in the code
 * that reads each flag — see the file references in each description; do not
 * write plausible-sounding text that the code does not back.
 */

import type { OpsHarness } from "./ops.types.js";

export interface EnvFlagMeta {
  key: string;
  /** Plain-English name, e.g. "Pool question mining". */
  label: string;
  /** What the flag changes in the live pipeline, one or two sentences. */
  description: string;
  kind: "enum" | "boolean" | "integer" | "number" | "string";
  /** Allowed values for enum/boolean flags (mirrors startup.env.ts schemas). */
  values?: readonly string[];
  /** Human-readable default, e.g. "off" or "7 days". */
  defaultDescription: string;
}

/**
 * All 16 PROFILE_ENV_ALLOWLIST flags, in allowlist order. Every flag tunes
 * the live discovery/negotiation services — the four scorecard harnesses do
 * not read them (eval/ops/ops.metadata.spec.ts pins the kind/values mirror of
 * services/api/src/startup.env.ts and the protocol use sites).
 */
export const ENV_FLAG_METADATA: readonly EnvFlagMeta[] = Object.freeze([
  {
    key: "DISCOVERY_ALLOWED_TYPES",
    label: "Discovery allowed types",
    description:
      "Comma-separated list (`intent`, `profile`) gating which data types may participate in opportunity matching. Unknown tokens are ignored with a warning; if nothing valid remains, both stay allowed so a typo never disables discovery (src/opportunity/discovery.env.ts).",
    kind: "string",
    defaultDescription: "both intent and profile",
  },
  {
    key: "DISCOVERY_PROFILE_SOURCE",
    label: "Discovery profile source",
    description:
      "Selects how profiles participate in matching: `premise` (atomic premises as the profile corpus) or `user_context` (synthesized context paragraphs). Unknown values warn once and fall back so discovery keeps running (src/opportunity/discovery.env.ts).",
    kind: "string",
    defaultDescription: "premise",
  },
  {
    key: "DISCOVERY_CONTEXT_TO_INTENT",
    label: "Context-to-intent discovery",
    description:
      "Only relevant when DISCOVERY_PROFILE_SOURCE is `user_context`: `1` also matches contexts against intents, `0` restricts discovery to context-to-context evidence (src/opportunity/application/opportunity.graph.ts).",
    kind: "enum",
    values: ["0", "1"],
    defaultDescription: "1 (enabled when the user-context profile source is active)",
  },
  {
    key: "DISCOVERY_REJECTION_COOLDOWN_DAYS",
    label: "Rejection cooldown (days)",
    description:
      "How many days a rejected candidate stays suppressed before discovery may suggest it again. Positive float in days (src/opportunity/application/opportunity.graph.ts).",
    kind: "number",
    defaultDescription: "7 days",
  },
  {
    key: "DISCOVERY_SOURCE_PREMISE_LIMIT",
    label: "Source premise discovery limit",
    description:
      "Per-source cap on candidate premise matches in one discovery run. `0` explicitly disables source-premise discovery (src/opportunity/application/opportunity.graph.ts).",
    kind: "integer",
    defaultDescription: "40",
  },
  {
    key: "RUN_OPPORTUNITY_EVAL_IN_PARALLEL",
    label: "Parallel opportunity evaluation",
    description:
      "When `true`, the live discovery graph evaluates candidate opportunities in parallel instead of sequentially (src/opportunity/application/opportunity.graph.ts).",
    kind: "boolean",
    values: ["true", "false"],
    defaultDescription: "false",
  },
  {
    key: "INTRODUCER_DISCOVERY_ENABLED",
    label: "Introducer discovery",
    description:
      "Strict, default-off gate for finding opportunities on behalf of another user (src/opportunity/application/opportunity.introducer-feature.ts).",
    kind: "boolean",
    values: ["true", "false"],
    defaultDescription: "false",
  },
  {
    key: "NEGOTIATION_INCLUDE_OTHER_INTENTS",
    label: "Negotiation includes other intents",
    description:
      "Default-compatible deployment policy: whether an autonomous opportunity negotiation may reference the parties' other intents (src/opportunity/application/opportunity.existing-negotiation.ts).",
    kind: "enum",
    values: ["true", "false"],
    defaultDescription: "true",
  },
  {
    key: "NEGOTIATION_MAX_TURNS_CHAT",
    label: "Max negotiation turns (chat)",
    description:
      "Turn cap for negotiations started from a chat conversation (src/opportunity/application/opportunity.graph.ts).",
    kind: "integer",
    defaultDescription: "4",
  },
  {
    key: "NEGOTIATION_MAX_TURNS_AMBIENT",
    label: "Max negotiation turns (ambient)",
    description:
      "Turn cap for negotiations without a chat conversation (src/opportunity/application/opportunity.graph.ts).",
    kind: "integer",
    defaultDescription: "6",
  },
  {
    key: "NEGOTIATION_EVIDENCE_QUESTIONS_MODE",
    label: "Negotiation-evidence questions",
    description:
      "Lens C question producer: `off` never runs; `shadow` mines and verifies neutral hypotheses over allowlisted negotiation evidence with aggregate telemetry only — no questions persisted, no behavior change; `on` is reserved for a later phase (src/opportunity/negotiation-evidence/negotiation-evidence.env.ts).",
    kind: "enum",
    values: ["off", "shadow", "on"],
    defaultDescription: "off",
  },
  {
    key: "OUTCOME_QUESTIONS_MODE",
    label: "Outcome questions",
    description:
      "Lens B outcome-question pipeline: `off` captures nothing; `shadow` captures an append-only feedback event per explicit owner action and mines neutral trade-off hypotheses with aggregate telemetry only; `on` currently behaves like `shadow` (src/opportunity/outcome/outcome.env.ts).",
    kind: "enum",
    values: ["off", "shadow", "on"],
    defaultDescription: "off",
  },
  {
    key: "POOL_QUESTIONS_MINING",
    label: "Pool question mining",
    description:
      "P1 shadow axis mining on discovery-run completion: `shadow` mines and scores axes and logs them — no questions are generated and nothing user-facing changes. Any other value (including unset) means off (src/opportunity/discriminator/discriminator.env.ts).",
    kind: "enum",
    values: ["off", "shadow"],
    defaultDescription: "off",
  },
  {
    key: "POOL_QUESTIONS_MODE",
    label: "Pool questions",
    description:
      "When `on`, the mining hook also enqueues a pool_discovery question for the top eligible discriminator (still subject to the questioner master gate and per-intent budget). `on` implies mining runs even when POOL_QUESTIONS_MINING is off (src/opportunity/discriminator/discriminator.env.ts).",
    kind: "enum",
    values: ["off", "on"],
    defaultDescription: "off",
  },
  {
    key: "POOL_QUESTIONS_PUSH",
    label: "Pool question push",
    description:
      "Push delivery mode for high-value-of-information pool questions. Callers additionally require pool-question mode and negotiator availability before anything is delivered (src/opportunity/discriminator/discriminator.env.ts).",
    kind: "enum",
    values: ["off", "on"],
    defaultDescription: "off",
  },
  {
    key: "POOL_QUESTIONS_RANKING",
    label: "Pool question ranking",
    description:
      "Ranking mode for pool questions (src/opportunity/discriminator/discriminator.env.ts).",
    kind: "enum",
    values: ["off", "on"],
    defaultDescription: "off",
  },
]);

export interface AgentMeta {
  /** model.config.ts agent id. */
  id: string;
  /** Plain-English name, e.g. "Evaluator". */
  label: string;
  /** What this agent decides or produces for the harness. */
  role: string;
}

/**
 * The agents each scorecard harness exercises, in pipeline order. Kept in
 * sync with HARNESS_REGISTRY by test; roles are grounded in the agent class
 * docblocks/system prompts.
 */
export const HARNESS_AGENT_METADATA: Readonly<Record<OpsHarness, readonly AgentMeta[]>> = Object.freeze({
  matching: [
    {
      id: "opportunityEvaluator",
      label: "Evaluator",
      role: "Decides accept or reject for each candidate pair, with a score and reasoning — the case score is this model's judgment (src/opportunity/application/opportunity.evaluator.ts).",
    },
  ],
  opportunity: [
    {
      id: "opportunityPresenter",
      label: "Card writer",
      role: "Writes the personalized, second-person card a user sees about an opportunity: headline, summary, and suggested action (src/opportunity/application/opportunity.presenter.ts).",
    },
  ],
  profile: [
    {
      id: "profileGenerator",
      label: "Profile writer",
      role: "Synthesizes the structured user profile — identity, bio, location, skills, interests — from raw data or applies a user request to an existing profile, under privacy rules (src/enrichment/enrichment.generator.ts).",
    },
  ],
  premise: [
    {
      id: "premiseDecomposer",
      label: "Premise decomposer",
      role: "Breaks free-text input about a person into atomic, first-person, self-descriptive premises — one fact per premise (src/premise/premise.decomposer.ts).",
    },
    {
      id: "premiseAnalyzer",
      label: "Premise analyzer",
      role: "Classifies each premise by speech act and scores its felicity conditions — whether it is a well-formed ground for discovery (src/premise/premise.analyzer.ts).",
    },
  ],
});

export interface ModelMeta {
  /** OpenRouter model id (member of ALLOWED_CONFIG_MODELS). */
  id: string;
  /** Short display name. */
  label: string;
  /** Neutral, factual one-liner — no benchmark claims. */
  blurb: string;
}

export const MODEL_METADATA: readonly ModelMeta[] = Object.freeze([
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    blurb: "Current default for every scorecard agent (src/shared/agent/model.config.ts).",
  },
  {
    id: "google/gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    blurb: "Smaller Gemini variant — a cheap option for smoke runs.",
  },
  {
    id: "google/gemini-3-pro-preview",
    label: "Gemini 3 Pro (preview)",
    blurb: "Preview of Google's next-generation Pro model.",
  },
  {
    id: "anthropic/claude-sonnet-4",
    label: "Claude Sonnet 4",
    blurb: "Anthropic's mid-tier Claude 4 model.",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    blurb: "Anthropic's small, fast Claude model.",
  },
  {
    id: "openai/gpt-4.1-mini",
    label: "GPT-4.1 mini",
    blurb: "OpenAI's small GPT-4.1 variant.",
  },
]);
