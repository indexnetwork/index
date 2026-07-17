import type { ClarificationCase } from "./clarification.types.js";

/** Focused golden corpus covering every canonical QUD category and null. */
export const CASES: ClarificationCase[] = [
  {
    id: "missing-constituent/absent-target",
    description: "An action with no participant or outcome needs its core target.",
    input: "I need to find someone for something important.",
    profileContext: "I am building an early-stage climate technology company.",
    activeIntentsContext: "none",
    expectedType: "missing_constituent",
  },
  {
    id: "missing-constraint/absent-location",
    description: "A concrete hiring target without a ranking boundary needs a constraint.",
    input: "I want to hire a senior machine-learning engineer, but I have not decided where they should be based.",
    profileContext: "I lead an AI startup with a distributed engineering team.",
    activeIntentsContext: "none",
    expectedType: "missing_constraint",
  },
  {
    id: "open-alternative-set/two-scopes",
    description: "Materially different collaboration scopes remain unresolved.",
    input: "I want a partner, either a technical co-founder to build the company or a channel partner to sell the product.",
    profileContext: "I am launching a B2B analytics product.",
    activeIntentsContext: "none",
    expectedType: "open_alternative_set",
    expectedQuestionTerms: ["technical co-founder", "channel partner"],
  },
  {
    id: "specific/null",
    description: "A sufficiently constrained intent requires no QUD repair.",
    input: "I am looking for a senior ML engineer in Berlin for a full-time role building production LLM evaluation systems this quarter.",
    profileContext: "I lead engineering at an AI startup in Berlin.",
    activeIntentsContext: "none",
    expectedType: null,
  },
];
