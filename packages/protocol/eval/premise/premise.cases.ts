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
    human: {
      scenario: "a run-on sentence packing several facts together: a software engineer at Google who knows Python and Rust and lives in San Francisco.",
      expectation: "break it into separate, single-fact statements — one each for the role, each skill, and the location.",
    },
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
    human: {
      scenario: "a bio written about someone else (\u201cJane Smith is a senior data scientist at Netflix\u2026\u201d).",
      expectation: "rewrite the facts in the person's own voice and split them out: role, employer, location, experience.",
    },
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
    human: {
      scenario: "a founder who lists permanent facts (their role, their PhD, their city) alongside a temporary one (currently raising a Series A).",
      expectation: "keep the lasting facts as stable identity, and mark the fundraising as a current, time-bound status.",
    },
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
    human: {
      scenario: "someone who states who they are (a product designer in New York) but also what they want (a cofounder, and to learn ML).",
      expectation: "keep the facts about who they are, and drop the wishes — those are goals, not facts.",
    },
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
    human: {
      scenario: "a message with no real facts in it — just \u201cYes, please create my profile now.\u201d",
      expectation: "recognize there's nothing to save and not invent any facts.",
    },
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
    human: {
      scenario: "the statement \u201cI am a climate-tech founder.\u201d",
      expectation: "recognize this as an identity claim (who someone is), not just a description of what they've done.",
    },
    input: "I am a climate-tech founder",
    expect: { speechActType: "DECLARATIVE" },
  },
  {
    id: "speech_act/assertive-capability",
    rule: "speech_act",
    tier: 1,
    component: "analyze",
    description: "A capability/experience premise classifies as ASSERTIVE.",
    human: {
      scenario: "the statement \u201cI have 10 years of experience in distributed systems.\u201d",
      expectation: "recognize this as a description of experience, not an identity claim.",
    },
    input: "I have 10 years of experience in distributed systems",
    expect: { speechActType: "ASSERTIVE" },
  },
  {
    id: "felicity_calibration/specific-high-clarity",
    rule: "felicity_calibration",
    tier: 1,
    component: "analyze",
    description: "A highly specific premise scores high clarity and low semantic entropy.",
    human: {
      scenario: "a very specific claim: \u201cI build distributed database systems in Rust at a Series B startup in Berlin.\u201d",
      expectation: "rate it as highly specific and easy to match (high clarity, low vagueness).",
    },
    input: "I build distributed database systems in Rust at a Series B startup in Berlin",
    expect: { clarityBand: [65, 100], entropyBand: [0, 0.45] },
  },
  {
    id: "felicity_calibration/grandiose-low-authority",
    rule: "felicity_calibration",
    tier: 1,
    component: "analyze",
    description: "A grandiose, unverifiable claim scores low authority.",
    human: {
      scenario: "a grandiose, unverifiable boast: \u201cI am the world's leading expert in absolutely everything.\u201d",
      expectation: "rate its credibility low — the speaker has no real standing to claim it.",
    },
    input: "I am the world's leading expert in absolutely everything",
    expect: { authorityBand: [0, 45] },
  },
  {
    id: "entropy/vague-high-entropy",
    rule: "entropy",
    tier: 1,
    component: "analyze",
    description: "An uninformative premise scores low clarity and high semantic entropy.",
    human: {
      scenario: "an empty, vague statement: \u201cI'm a person who does things.\u201d",
      expectation: "rate it as too vague to be useful (low clarity, high vagueness).",
    },
    input: "I'm a person who does things",
    expect: { clarityBand: [0, 45], entropyBand: [0.6, 1] },
  },
];
