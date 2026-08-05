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
  /**
   * The shape the flag's own read site accepts — not the shape startup.env.ts
   * happens to declare. Several flags are declared there as free text and
   * parsed as an enum at the use site; describing those as `string` here would
   * let an operator configure a value that silently falls back at runtime,
   * which is a measurement of nothing dressed up as a difference.
   *
   * `csv-enum` is a comma-separated list drawn from `values`, mirroring
   * DISCOVERY_ALLOWED_TYPES (src/opportunity/discovery.env.ts).
   *
   * `json-model-map` is a JSON object of agent id -> model id, mirroring
   * EVAL_MODEL_OVERRIDES (src/shared/agent/model.config.ts). It exists because
   * `string` would be a lie for that flag in a way that costs money: its read
   * site THROWS on malformed JSON, on an unknown agent key and on a non-string
   * model, and it is read lazily on the first model construction — so a typo
   * surfaces as a crash after the branches have been reset and the run has
   * started spending, not as a refusal at launch.
   */
  kind: "enum" | "boolean" | "csv-enum" | "integer" | "number" | "string" | "json-model-map";
  /** Allowed values (or allowed tokens, for csv-enum) — mirrors the read site. */
  values?: readonly string[];
  /** Smallest value the read site honours; below it the flag silently falls back. */
  min?: number;
  /**
   * Largest value the read site honours. Only set where the read site really
   * has a ceiling — NEGOTIATOR_TURN_TIMEOUT_MS rejects anything above
   * Number.MAX_SAFE_INTEGER because AbortSignal.timeout() throws on it
   * (src/negotiation/application/negotiation.agent.ts).
   */
  max?: number;
  /** Human-readable default, e.g. "off" or "7 days". */
  defaultDescription: string;
}

/**
 * Agent ids EVAL_MODEL_OVERRIDES may name, and the models it may name them to.
 *
 * Injected by the caller rather than imported: the agent list lives in
 * src/shared/agent/model.config.ts (a `getBaseModelConfig` local, not exported)
 * and ALLOWED_CONFIG_MODELS lives in ops.profiles.ts, which imports node:fs and
 * therefore cannot be imported here — this module is in the browser bundle.
 * eval/ops/tests/metadata.spec.ts pins both lists against their real sources.
 */
export interface ModelMapBounds {
  /**
   * Agent ids the map may name. Optional because only the server can derive
   * it (from the harness registry): the browser passes just `models`, so an
   * unknown agent is caught at submit rather than on keystroke. A validator
   * that refuses *less* than the server is safe; one that refuses more would
   * block a legal launch.
   */
  agents?: readonly string[];
  models: readonly string[];
}

/**
 * The only models a client may select, and the single definition of that list.
 *
 * It lives here rather than in ops.profiles.ts because the model-valued env
 * flags below have to state their own accepted values, and this module is the
 * dependency-free one — ops.profiles.ts imports node:fs and cannot be reached
 * from the browser bundle. ops.profiles.ts re-exports it as
 * ALLOWED_CONFIG_MODELS so every existing importer is unaffected.
 *
 * Live spend on a shared URL with no actor attribution yet: free-text slugs
 * stay out until attribution exists. Repo profiles are code-reviewed and exempt.
 */
export const ALLOWED_CONFIG_MODEL_IDS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-3-pro-preview",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-4.1-mini",
] as const;

/**
 * The problem with `value` for this flag, or null when the live service will
 * honour it as written.
 *
 * The single definition of "is this value real", shared by every place a value
 * can be chosen: `validateProfileEnv` (saved configs and ad-hoc launches),
 * `abSideIssues` (the two sides of an A/B run) and the browser app's guided
 * editor. Duplicating it is how a form and a server come to disagree about what
 * a flag accepts.
 *
 * The bar is deliberately "what the read site honours", not "what startup.env.ts
 * parses": a value the reader does not recognise is not refused at runtime, it
 * falls back — `DISCOVERY_PROFILE_SOURCE=user-context` warns once and runs
 * `premise`. Accepting it here would let an A/B run spend two branch resets and
 * a full corpus to report a configuration difference that never existed.
 *
 * Unknown keys are not this function's business: membership is checked against
 * PROFILE_ENV_ALLOWLIST / DISCOVERY_ENV_KEYS by the caller, so each problem
 * is reported exactly once.
 */
export function envFlagValueIssue(meta: EnvFlagMeta, value: string, bounds?: ModelMapBounds): string | null {
  switch (meta.kind) {
    case "enum":
    case "boolean":
      return meta.values?.includes(value) === true
        ? null
        : `must be one of: ${meta.values?.join(", ") ?? "(no values defined)"}`;
    case "csv-enum": {
      // Mirrors discoveryAllowedTypes: tokens are trimmed and lower-cased, and a
      // list with no valid token falls back to "everything allowed" — so an
      // unknown token must be refused here rather than silently ignored.
      const allowed = meta.values ?? [];
      const tokens = value.split(",").map((token) => token.trim().toLowerCase()).filter((token) => token !== "");
      const legal = tokens.length > 0 && tokens.every((token) => allowed.includes(token));
      return legal ? null : `must be a comma-separated list of: ${allowed.join(", ") || "(no values defined)"}`;
    }
    case "integer":
      // Non-negative digits only, mirroring optionalInt in services/api/src/startup.env.ts.
      if (!/^\d+$/.test(value)) return "must be an integer";
      if (meta.min !== undefined && Number(value) < meta.min) return `must be an integer of at least ${meta.min}`;
      if (meta.max !== undefined && Number(value) > meta.max) return `must be an integer of at most ${meta.max}`;
      return null;
    case "number": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return "must be a positive number";
      if (meta.min !== undefined && parsed < meta.min) return `must be at least ${meta.min}`;
      if (meta.max !== undefined && parsed > meta.max) return `must be at most ${meta.max}`;
      return null;
    }
    case "json-model-map": {
      // Mirrors readModelOverrides (src/shared/agent/model.config.ts): every
      // condition below is one the read site throws on. Refusing here turns a
      // mid-run crash into a launch-time message.
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return "must be valid JSON";
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return "must be a JSON object of agent id to model id";
      }
      for (const [agent, model] of Object.entries(parsed as Record<string, unknown>)) {
        if (bounds?.agents !== undefined && !bounds.agents.includes(agent)) {
          return `names an unknown agent "${agent}". Known agents: ${[...bounds.agents].sort().join(", ")}`;
        }
        if (typeof model !== "string" || model.trim() === "") {
          return `value for "${agent}" must be a non-empty model id string`;
        }
        // The read site accepts any string; the site does not. A run launched
        // from a browser may only name a reviewed model, the same bar
        // validateConfigOverrides applies to the per-agent model pickers —
        // otherwise this flag is a hole straight through that restriction.
        if (bounds !== undefined && !bounds.models.includes(model.trim())) {
          return `model "${model.trim()}" is not selectable. Allowed: ${[...bounds.models].join(", ")}`;
        }
      }
      return null;
    }
    case "string":
      return null;
  }
}

/**
 * `envFlagValueIssue` for a key named at runtime. Null for a key with no
 * metadata: whether the key may be set at all is the caller's allowlist check.
 */
export function envValueIssueForKey(key: string, value: string, bounds?: ModelMapBounds): string | null {
  const meta = ENV_FLAG_METADATA.find((flag) => flag.key === key);
  return meta === undefined ? null : envFlagValueIssue(meta, value, bounds);
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
    kind: "csv-enum",
    values: ["intent", "profile"],
    defaultDescription: "both intent and profile",
  },
  {
    key: "DISCOVERY_PROFILE_SOURCE",
    label: "Discovery profile source",
    description:
      "Selects how profiles participate in matching: `premise` (atomic premises as the profile corpus) or `user_context` (synthesized context paragraphs). Unknown values warn once and fall back so discovery keeps running (src/opportunity/discovery.env.ts).",
    kind: "enum",
    values: ["premise", "user_context"],
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
      "Days during which a recently rejected or stalled candidate receives a ×0.5 ranking penalty in discovery — a soft pushdown, not removal. Positive float in days (src/opportunity/application/opportunity.graph.ts).",
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
      "Turn cap for negotiations started from a chat conversation. Read as `Number(...) || 4`, so 0 is not \"no turns\" — it silently becomes the default (src/opportunity/application/opportunity.graph.ts).",
    kind: "integer",
    min: 1,
    defaultDescription: "4",
  },
  {
    key: "NEGOTIATION_MAX_TURNS_AMBIENT",
    label: "Max negotiation turns (ambient)",
    description:
      "Turn cap for negotiations without a chat conversation. Read as `Number(...) || 6`, so 0 is not \"no turns\" — it silently becomes the default (src/opportunity/application/opportunity.graph.ts).",
    kind: "integer",
    min: 1,
    defaultDescription: "6",
  },
  {
    key: "NEGOTIATION_PROTOCOL_VERSION",
    label: "Negotiation protocol version",
    description:
      "Protocol version for negotiations with no prior task for the same opportunity. Read as a strict equality against `v2`, so every other value — including a typo — is `v1`. In-flight negotiations stay pinned to the version they were stamped with (src/negotiation/domain/negotiation.protocol.ts).",
    kind: "enum",
    values: ["v1", "v2"],
    defaultDescription: "v1",
  },
  {
    key: "NEGOTIATION_SCREEN_MODE",
    label: "Outreach screen mode",
    description:
      "The pre-turn outreach gate: `off` never screens; `shadow` screens and records the verdict without acting on it; `enforce` lets a `pass` verdict stop the negotiation before any turn is exchanged. Unset or unrecognised is `off` (src/negotiation/domain/negotiation.screen.contracts.ts).",
    kind: "enum",
    values: ["off", "shadow", "enforce"],
    defaultDescription: "off",
  },
  {
    key: "NEGOTIATION_ASK_USER_ENABLED",
    label: "Ask-user consult pause",
    description:
      "Whether a negotiation may pause to consult its principal (`ask_user`). Read as a strict equality against `true`, so any other value is off (src/negotiation/domain/negotiation.protocol.ts).",
    kind: "boolean",
    values: ["true", "false"],
    defaultDescription: "false",
  },
  {
    key: "NEGOTIATION_ASK_USER_WINDOW_MS",
    label: "Ask-user answer window (ms)",
    description:
      "How long a paused negotiation waits for its principal's answer before expiring. Non-numeric or non-positive values fall back to 24 hours rather than failing (src/negotiation/domain/negotiation.protocol.ts).",
    kind: "integer",
    min: 1,
    defaultDescription: "86400000 (24 hours)",
  },
  {
    key: "NEGOTIATION_CONSULTATION_POLICY_MODE",
    label: "Consultation policy",
    description:
      "Centralised switch for the consultation policy: `off` never consults; `shadow` evaluates eligibility and records it without pausing; `on` allows the pause. Invalid, absent and empty values all roll back to `off` (src/negotiation/domain/negotiation.consultation-policy.ts).",
    kind: "enum",
    values: ["off", "shadow", "on"],
    defaultDescription: "off",
  },
  {
    key: "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
    label: "Deadlock bargaining shift",
    description:
      "Whether a stalemated negotiation shifts into a bargaining stance. Read as a strict equality against `true`, so any other value is off (src/negotiation/domain/negotiation.deadlock.ts).",
    kind: "boolean",
    values: ["true", "false"],
    defaultDescription: "false",
  },
  {
    key: "NEGOTIATION_DEADLOCK_THRESHOLD",
    label: "Deadlock threshold (turns)",
    description:
      "Consecutive non-convergent turns (counters and questions) that constitute a deadlock. Must be an integer of at least 2 — below that a single counter would read as a stalemate — and anything else falls back to 4 (src/negotiation/domain/negotiation.deadlock.ts).",
    kind: "integer",
    min: 2,
    defaultDescription: "4 turns",
  },
  {
    key: "NEGOTIATOR_STANCE",
    label: "Negotiator stance",
    description:
      "The stance the negotiator argues from: `advocate` presses its own user's case; `evaluator` and `skeptic` additionally apply an opportunity-cost value bar and treat a discovery-query match as necessary rather than sufficient. Unset or unrecognised is `advocate` (src/negotiation/domain/negotiation.stance.contracts.ts).",
    kind: "enum",
    values: ["advocate", "evaluator", "skeptic"],
    defaultDescription: "advocate",
  },
  {
    key: "NEGOTIATOR_TURN_TIMEOUT_MS",
    label: "Negotiator turn timeout (ms)",
    description:
      "Hard limit on one negotiation turn's LLM call. Must be above 0 and at most Number.MAX_SAFE_INTEGER: 0 would abort every turn before a response arrived, and a larger value throws inside AbortSignal.timeout(). Invalid values fall back to 15000 (src/negotiation/application/negotiation.agent.ts).",
    kind: "integer",
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    defaultDescription: "15000 (15 seconds)",
  },
  {
    key: "HYDE_FRAME_CONSTRAINTS_ENABLED",
    label: "Frame-constrained HyDE",
    description:
      "Switches hypothetical-document generation from `legacy` to the frame-constrained `frame-v1` mode. Read as a strict equality against `true`, so any other value keeps legacy generation (src/shared/hyde/hyde.env.ts).",
    kind: "boolean",
    values: ["true", "false"],
    defaultDescription: "false (legacy generation)",
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
  {
    key: "EVAL_MODEL_OVERRIDES",
    label: "Per-agent model overrides",
    description:
      "JSON object of agent id to model id, e.g. `{\"opportunityEvaluator\":\"anthropic/claude-sonnet-4\"}`. Applied on top of every other model setting, so it overrides CHAT_MODEL for the `chat` agent. Ignored entirely when NODE_ENV is production. Only the model id moves — temperature, token limits and reasoning effort stay fixed so a run measures a model swap and nothing else (src/shared/agent/model.config.ts).",
    kind: "json-model-map",
    defaultDescription: "no overrides",
  },
  {
    key: "CHAT_MODEL",
    label: "Chat model",
    description:
      "Model for the `chat` agent only; every other agent has a fixed default. Lowest precedence of the three ways to set it: an explicit ModelConfig argument wins, and EVAL_MODEL_OVERRIDES is applied afterwards on top of both (src/shared/agent/model.config.ts).",
    kind: "enum",
    values: [...ALLOWED_CONFIG_MODEL_IDS],
    defaultDescription: "google/gemini-3-pro-preview",
  },
  {
    key: "CHAT_REASONING_EFFORT",
    label: "Chat reasoning effort",
    description:
      "Reasoning effort for the `chat` agent. Passed to the provider as written and never validated at the read site — the cast there is a type assertion, not a check — so the values offered here are those services/api/src/startup.env.ts accepts (src/shared/agent/model.config.ts).",
    kind: "enum",
    values: ["minimal", "low", "medium", "high", "xhigh"],
    defaultDescription: "low",
  },
  {
    key: "SMARTEST_VERIFIER_MODEL",
    label: "LLM judge model",
    description:
      "Model for the LLM judge used by the scorecard harnesses' assertions. Read in a test-only helper the four eval harnesses import, which is why the discovery harness — production graph code — is not offered it (src/shared/agent/tests/llm-assert.ts). Also identifies the judge in a run's scoring fingerprint (eval/shared/governance.ts).",
    kind: "enum",
    values: [...ALLOWED_CONFIG_MODEL_IDS],
    defaultDescription: "google/gemini-2.5-flash",
  },
  {
    key: "OPENROUTER_FALLBACK_MODEL",
    label: "Cross-vendor fallback model",
    description:
      "Model tried when an agent's primary fails, on a different vendor lane so a single provider outage does not stop a run. `none` or `off` disables fallback entirely; the fallback is also skipped when it would equal the primary (src/shared/agent/model.config.ts).",
    kind: "enum",
    values: [...ALLOWED_CONFIG_MODEL_IDS, "none", "off"],
    defaultDescription: "openai/gpt-4o-mini",
  },
  {
    key: "OPENROUTER_REQUEST_TIMEOUT_MS",
    label: "Request timeout (ms)",
    description:
      "Hard upper bound on a single LLM HTTP call. Without it the client waits for the upstream to cut the socket, roughly three minutes through OpenRouter. Parsed with parseInt, and a non-positive or unparseable value falls back to 60000 (src/shared/agent/model.config.ts).",
    kind: "integer",
    min: 1,
    defaultDescription: "60000 (60 seconds)",
  },
  {
    key: "OPENROUTER_MAX_RETRIES",
    label: "HTTP retries per call",
    description:
      "Transport-level retries for one LLM call. 0 is honoured and means no retry — unlike the negotiation turn caps, whose read sites treat 0 as unset. Worst-case latency is bounded by this many retries times the request timeout, which is why the default is 1 rather than the library's 2 (src/shared/agent/model.config.ts).",
    kind: "integer",
    min: 0,
    defaultDescription: "1",
  },
  {
    key: "OPENROUTER_RUNNABLE_MAX_ATTEMPTS",
    label: "Structured-output attempts",
    description:
      "Total attempts (1 means no retry) for retries wrapping the HTTP layer, which additionally cover structured-output parse and validation failures. A caller abort is never retried. Values below 1 fall back to 2 (src/shared/agent/model.config.ts).",
    kind: "integer",
    min: 1,
    defaultDescription: "2",
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
 * The agents each harness exercises, in pipeline order. Kept in sync with
 * HARNESS_REGISTRY by test; roles are grounded in the agent class
 * docblocks/system prompts.
 *
 * A harness with no entries exercises no agent whose model is worth editing
 * per run, and the launch form shows it no model editors.
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
  // Deliberately empty, mirroring HARNESS_REGISTRY["discovery"].agents.
  // Not because the harness runs no model — it invokes the real discovery graph
  // and an LLM judge, all overridable through EVAL_MODEL_OVERRIDES — but because
  // the two sides of an A/B run differ in environment configuration and never in
  // models, so a per-side model editor could not change the comparison it looked
  // like it configured. The launch form edits the AB_FLAGS environment instead
  // (services/api/src/cli/discovery.flags.ts).
  discovery: [],
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

/**
 * A harness flag's presentation and — crucially — whether it may differ between
 * the two sides of an A/B run.
 *
 * `selection` flags decide WHICH cases run. If the two sides disagree, the runs
 * are not comparable at all (compareArtifacts refuses on a selection mismatch),
 * so the UI shares one control between both sides.
 *
 * `scoring` flags decide HOW a run is scored. They may legitimately differ —
 * that is a comparison worth making — but the UI must say so, because a verdict
 * produced under different scoring rules is not a like-for-like result.
 */
export interface FlagMeta {
  /** HarnessFlag.name in ops.registry.ts. */
  name: string;
  label: string;
  /** What changing it does, grounded in the harness CLI help. */
  description: string;
  scope: "selection" | "scoring";
  /** Shown as the control's default/placeholder. */
  defaultLabel: string;
}

/**
 * Copy for every flag the registry can expose. Grounded in the harness usage
 * banner (eval/matching/matching.eval.ts:40-61) and the argv handling beside it.
 * Drift-guarded by test against HARNESS_REGISTRY.
 */
export const FLAG_METADATA: readonly FlagMeta[] = Object.freeze([
  {
    name: "runs",
    label: "Runs per case",
    description: "How many times every case is executed. More runs expose flaky cases that pass only sometimes.",
    scope: "selection",
    defaultLabel: "3",
  },
  {
    name: "case",
    label: "Case",
    description: "Run only cases whose id contains this text — the fastest way to reproduce one failure.",
    scope: "selection",
    defaultLabel: "all cases",
  },
  {
    name: "rule",
    label: "Rule",
    description: "Run only the cases belonging to one rule (for example is_a_identity).",
    scope: "selection",
    defaultLabel: "all rules",
  },
  {
    name: "tier",
    label: "Tier",
    description: "Run only one difficulty tier (1-4). Higher tiers hold the harder, more adversarial cases.",
    scope: "selection",
    defaultLabel: "all tiers",
  },
  {
    name: "noJudge",
    label: "LLM judge",
    description:
      "The judge runs the reasoning checks that cannot be asserted mechanically. Turning it off is free and fast, but scores then reflect deterministic assertions only.",
    scope: "scoring",
    defaultLabel: "on",
  },
  {
    name: "alpha",
    label: "Regression threshold",
    description:
      "Significance level for calling a change a regression. Lower is stricter — fewer changes are reported as real.",
    scope: "scoring",
    defaultLabel: "0.05",
  },
  {
    name: "strictEvidence",
    label: "Strict evidence",
    description: "Fail the run when any requested case-run did not complete, instead of scoring what did finish.",
    scope: "scoring",
    defaultLabel: "off",
  },
  {
    name: "attemptTimeoutMs",
    label: "Attempt timeout",
    description: "How long a single attempt may take before it is abandoned and retried.",
    scope: "scoring",
    defaultLabel: "harness default",
  },
]);
