import type { PremiseCase } from "./premise.types.js";

/**
 * Premise eval golden corpus (starter set).
 *
 * Tier 1 cases are surgical: one clear behaviour, mostly deterministic checks.
 * Tier 2 cases are more realistic, multi-fact inputs. Decomposer cases exercise
 * `PremiseDecomposer.invoke`; analyzer cases exercise `PremiseAnalyzer.invoke`.
 *
 * Grow the corpus by appending cases here. Re-run with `--update-baseline` after
 * an intentional change. Score bands are intentionally generous — they assert
 * direction (high vs low), not exact LLM values.
 */
export const CASES: PremiseCase[] = [
  // ─── Decomposer ──────────────────────────────────────────────────────────
  {
    id: "atomicity/compound-split",
    rule: "atomicity",
    tier: 2,
    component: "decompose",
    description: "Compound, multi-fact sentence splits into atomic first-person premises.",
    input: "I'm a software engineer at Google and I know Python and Rust, based in San Francisco.",
    expect: {
      minPremises: 4,
      maxPremises: 7,
      mustCover: ["works at Google / is a software engineer", "knows Python", "knows Rust", "based in San Francisco"],
    },
  },
  {
    id: "atomicity/third-person-to-first",
    rule: "atomicity",
    tier: 2,
    component: "decompose",
    description: "Third-person bio is converted to first-person atomic premises.",
    input: "Jane Smith is a senior data scientist at Netflix in Los Angeles. She has 8 years of experience in recommender systems.",
    expect: {
      minPremises: 3,
      maxPremises: 6,
      mustCover: ["senior data scientist", "works at Netflix", "based in Los Angeles", "experience in recommender systems"],
    },
  },
  {
    id: "tier_classification/founder-raising",
    rule: "tier_classification",
    tier: 1,
    component: "decompose",
    description: "Stable identity facts are assertive; current fundraising status is contextual.",
    input: "I'm a climate tech founder based in Berlin. I hold a PhD in renewable energy systems and I'm currently raising a Series A.",
    expect: {
      minPremises: 3,
      minAssertive: 2,
      minContextual: 1,
      mustCover: ["climate tech founder", "based in Berlin", "PhD in renewable energy", "raising Series A"],
    },
  },
  {
    id: "intent_exclusion/skip-desires",
    rule: "intent_exclusion",
    tier: 1,
    component: "decompose",
    description: "Self-descriptive facts are kept; desires/requests (intents) are dropped.",
    input: "I'm a product designer in New York. I'm looking for a technical cofounder and I want to learn machine learning.",
    expect: {
      minPremises: 2,
      maxPremises: 4,
      mustCover: ["product designer", "based in New York"],
      mustNotContain: "a desire, request, or intent such as looking for a cofounder or wanting to learn machine learning",
    },
  },
  {
    id: "empty_input/greeting",
    rule: "empty_input",
    tier: 1,
    component: "decompose",
    description: "Input with no self-descriptive facts yields an empty premise array.",
    input: "Yes, please create my profile now.",
    expect: { expectEmpty: true },
  },

  // ─── Analyzer ────────────────────────────────────────────────────────────
  {
    id: "speech_act/declarative-identity",
    rule: "speech_act",
    tier: 1,
    component: "analyze",
    description: "An identity/role/status premise classifies as DECLARATIVE.",
    input: "I am a climate-tech founder",
    expect: { speechActType: "DECLARATIVE" },
  },
  {
    id: "speech_act/assertive-capability",
    rule: "speech_act",
    tier: 1,
    component: "analyze",
    description: "A capability/experience premise classifies as ASSERTIVE.",
    input: "I have 10 years of experience in distributed systems",
    expect: { speechActType: "ASSERTIVE" },
  },
  {
    id: "felicity_calibration/specific-high-clarity",
    rule: "felicity_calibration",
    tier: 1,
    component: "analyze",
    description: "A highly specific premise scores high clarity and low semantic entropy.",
    input: "I build distributed database systems in Rust at a Series B startup in Berlin",
    expect: { clarityBand: [65, 100], entropyBand: [0, 0.45] },
  },
  {
    id: "felicity_calibration/grandiose-low-authority",
    rule: "felicity_calibration",
    tier: 1,
    component: "analyze",
    description: "A grandiose, unverifiable claim scores low authority.",
    input: "I am the world's leading expert in absolutely everything",
    expect: { authorityBand: [0, 45] },
  },
  {
    id: "entropy/vague-high-entropy",
    rule: "entropy",
    tier: 1,
    component: "analyze",
    description: "An uninformative premise scores low clarity and high semantic entropy.",
    input: "I'm a person who does things",
    expect: { clarityBand: [0, 45], entropyBand: [0.6, 1] },
  },
];
