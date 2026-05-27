import type { EvaluatorEntity } from "../../src/opportunity/opportunity.evaluator.js";
import type { MatchingCase } from "./matching.types.js";
import { POOL } from "./matching.personas.js";
import { HISTORICAL_CASES } from "./matching.historical.js";

const NETWORK = "idx-commons";

// Shared source used by the ported identity cases (mirrors evaluator-identity-query.spec.ts).
const creativeTechSource: EvaluatorEntity = {
  userId: "src-yanki",
  profile: {
    name: "(source user)",
    bio: "Professional with a focus on creative technology and game development.",
    location: "Remote",
    interests: ["game development", "visual arts", "interactive experiences"],
    skills: ["product strategy", "developer tools"],
  },
  intents: [
    { intentId: "i-1", payload: "Connect and collaborate with visual artists" },
    { intentId: "i-2", payload: "Connect with Unreal Engine game developers for collaboration and knowledge sharing" },
  ],
  networkId: NETWORK,
};

export const CASES: MatchingCase[] = [
  // ── Tier 1: IS-A / identity query (ported) ──────────────────────────────
  {
    id: "is_a_identity/samurai-vs-character-designer",
    rule: "is_a_identity",
    tier: 1,
    description: "'samurai' identity query must reject a character-design artist (subject-matter ≠ identity).",
    input: {
      discovererId: "src-yanki",
      entities: [
        creativeTechSource,
        {
          userId: "c-yuki",
          profile: {
            name: "Yuki Tanaka",
            bio: "Visual artist and illustrator. Digital and traditional, focus on character design.",
            location: "Tokyo, JP",
            interests: ["illustration", "character design", "digital art"],
            skills: ["illustration", "character design", "digital painting"],
          },
          networkId: NETWORK,
          ragScore: 100,
          matchedVia: "visual artists interested in historical themes",
        },
      ],
      discoveryQuery: "samurai",
    },
    expect: [{ candidateId: "c-yuki", match: false, scoreBand: [0, 29] }],
  },
  {
    id: "is_a_identity/investor-vs-funded-engineer",
    rule: "is_a_identity",
    tier: 1,
    description: "'investors' identity query must reject an engineer who raised funding (raising ≠ investing).",
    input: {
      discovererId: "src-yanki",
      entities: [
        creativeTechSource,
        {
          userId: "c-sam",
          profile: {
            name: "Sam Rivera",
            bio: "ML engineer. Raised a $500K pre-seed for a side project.",
            location: "Austin, TX",
            interests: ["machine learning", "NLP", "startups"],
            skills: ["Python", "PyTorch", "MLOps"],
          },
          intents: [{ intentId: "c-1", payload: "Find a product-minded founder to pair with on an LLM B2B tool." }],
          networkId: NETWORK,
          ragScore: 65,
          matchedVia: "startup funding and investment",
        },
      ],
      discoveryQuery: "investors",
    },
    expect: [{ candidateId: "c-sam", match: false, scoreBand: [0, 29] }],
  },
  {
    id: "is_a_identity/investor-vs-real-investor",
    rule: "is_a_identity",
    tier: 1,
    description: "'investors' identity query must accept an actual angel investor.",
    input: {
      discovererId: "src-yanki",
      entities: [
        creativeTechSource,
        {
          userId: "c-sarah",
          profile: {
            name: "Sarah Hoople Shere",
            bio: "Angel investor and former CTO. Writes checks for pre-seed/seed developer tools and infra.",
            location: "San Francisco, CA",
            interests: ["developer tools", "infrastructure", "early-stage investing"],
            skills: ["due diligence", "technical evaluation", "portfolio management"],
          },
          intents: [{ intentId: "c-2", payload: "Connect with technical founders building for developers." }],
          networkId: NETWORK,
          ragScore: 55,
          matchedVia: "startup funding and investment",
        },
      ],
      discoveryQuery: "investors",
    },
    expect: [{ candidateId: "c-sarah", match: true, scoreBand: [70, 100] }],
  },
  {
    id: "query_primary/background-intent-does-not-rescue",
    rule: "query_primary",
    tier: 1,
    description: "Explicit 'samurai' query must override the source's 'visual artists' background intent.",
    input: {
      discovererId: "src-yanki",
      entities: [
        creativeTechSource,
        {
          userId: "c-yuki",
          profile: {
            name: "Yuki Tanaka",
            bio: "Visual artist and illustrator, focus on character design.",
            location: "Tokyo, JP",
            interests: ["illustration", "character design"],
            skills: ["illustration", "character design"],
          },
          networkId: NETWORK,
          ragScore: 100,
          matchedVia: "visual artists",
        },
      ],
      discoveryQuery: "samurai",
    },
    expect: [
      {
        candidateId: "c-yuki",
        match: false,
        scoreBand: [0, 29],
        reasoningCriteria:
          "The reasoning must NOT justify a match primarily on the source's background intent to connect with visual artists; the explicit query 'samurai' is an identity query that takes priority. PASS if there is no opportunity or it is presented as a weak/non-match.",
      },
    ],
  },

  // ── Tier 1: complementary role ──────────────────────────────────────────
  {
    id: "complementary_role/vc-for-cofounder-intent",
    rule: "complementary_role",
    tier: 1,
    description: "A VC cannot fill a 'co-founder' open argument — complementary role, cap ≤30.",
    input: {
      discovererId: "src-founder",
      entities: [
        {
          userId: "src-founder",
          profile: { name: "(source user)", bio: "Solo technical founder building a B2B AI product.", location: "SF", skills: ["engineering"] },
          intents: [{ intentId: "f-1", payload: "Looking for a technical co-founder to build with." }],
          networkId: NETWORK,
        },
        POOL.vcInvestor,
      ],
    },
    expect: [{ candidateId: "p-vc", match: false, scoreBand: [0, 29] }],
  },
  {
    id: "complementary_role/engineer-for-cofounder-intent",
    rule: "complementary_role",
    tier: 1,
    description: "Minimal pair: an engineer who wants to co-found CAN fill the open argument — substitutive, accept.",
    input: {
      discovererId: "src-founder",
      entities: [
        {
          userId: "src-founder",
          profile: { name: "(source user)", bio: "Commercial founder building a B2B AI product, needs a technical partner.", location: "SF", skills: ["sales", "product"] },
          intents: [{ intentId: "f-1", payload: "Looking for a technical co-founder to build with." }],
          networkId: NETWORK,
        },
        POOL.technicalCofounder,
      ],
    },
    expect: [{ candidateId: "p-tech-cofounder", match: true, scoreBand: [70, 100], role: "agent" }],
  },

  // ── Tier 1: same-side ───────────────────────────────────────────────────
  {
    id: "same_side/both-seeking-investors",
    rule: "same_side",
    tier: 1,
    description: "Two founders both seeking investors are same-side — no opportunity.",
    input: {
      discovererId: "src-raising",
      entities: [
        {
          userId: "src-raising",
          profile: { name: "(source user)", bio: "Founder raising a seed round for a climate startup.", location: "Berlin", skills: ["product"] },
          intents: [{ intentId: "r-1", payload: "Raising a seed round; looking for investors." }],
          networkId: NETWORK,
        },
        {
          userId: "c-raising",
          profile: { name: "Dana Wolf", bio: "Founder raising a seed round for a logistics startup.", location: "Berlin", skills: ["operations"] },
          intents: [{ intentId: "c-1", payload: "Looking for investors for our seed round." }],
          networkId: NETWORK,
          ragScore: 70,
          matchedVia: "seed fundraising",
        },
      ],
    },
    expect: [{ candidateId: "c-raising", match: false, scoreBand: [0, 29] }],
  },

  // ── Tier 1: already known ───────────────────────────────────────────────
  {
    id: "already_known/same-company-cofounders",
    rule: "already_known",
    tier: 1,
    description: "Two people who are co-founders of the same company already know each other — no opportunity.",
    input: {
      discovererId: "src-acme",
      entities: [
        {
          userId: "src-acme",
          profile: { name: "(source user)", bio: "Co-founder and CEO of Acme Robotics.", location: "Boston", skills: ["leadership"] },
          intents: [{ intentId: "a-1", payload: "Looking to meet other robotics founders." }],
          networkId: NETWORK,
        },
        {
          userId: "c-acme",
          profile: { name: "Wei Zhang", bio: "Co-founder and CTO of Acme Robotics. Builds the autonomy stack.", location: "Boston", skills: ["robotics", "controls"] },
          networkId: NETWORK,
          ragScore: 80,
          matchedVia: "robotics founders",
        },
      ],
    },
    expect: [{ candidateId: "c-acme", match: false, scoreBand: [0, 29] }],
  },

  // ── Tier 1: location ────────────────────────────────────────────────────
  {
    id: "location/known-mismatch-penalized",
    rule: "location",
    tier: 1,
    description: "Query asks for SF; a New York candidate with otherwise strong fit is penalized (≤40).",
    input: {
      discovererId: "src-yanki",
      entities: [
        creativeTechSource,
        {
          userId: "c-ny",
          profile: {
            name: "Alex Pratt",
            bio: "Unreal Engine developer building interactive experiences.",
            location: "New York, NY",
            interests: ["game development", "Unreal Engine"],
            skills: ["Unreal Engine", "C++"],
          },
          networkId: NETWORK,
          ragScore: 75,
          matchedVia: "Unreal Engine developers",
        },
      ],
      discoveryQuery: "Unreal Engine developers in SF",
    },
    expect: [{ candidateId: "c-ny", match: false, scoreBand: [0, 29] }],
  },
  {
    id: "location/unknown-not-penalized",
    rule: "location",
    tier: 1,
    description: "Minimal pair: same candidate with UNKNOWN location must not be penalized for location.",
    input: {
      discovererId: "src-yanki",
      entities: [
        creativeTechSource,
        {
          userId: "c-unknown",
          profile: {
            name: "Alex Pratt",
            bio: "Unreal Engine developer building interactive experiences.",
            location: "",
            interests: ["game development", "Unreal Engine"],
            skills: ["Unreal Engine", "C++"],
          },
          networkId: NETWORK,
          ragScore: 75,
          matchedVia: "Unreal Engine developers",
        },
      ],
      discoveryQuery: "Unreal Engine developers in SF",
    },
    expect: [{ candidateId: "c-unknown", match: true, scoreBand: [60, 100] }],
  },

  // ── Tier 1: valency / role assignment ───────────────────────────────────
  {
    id: "valency_role/seeker-gets-patient-provider-gets-agent",
    rule: "valency_role",
    tier: 1,
    description: "Source needs ML help; candidate offers ML expertise — candidate is the agent (provider).",
    input: {
      discovererId: "src-needs-ml",
      entities: [
        {
          userId: "src-needs-ml",
          profile: { name: "(source user)", bio: "Non-technical founder of a health startup, needs ML help.", location: "SF", skills: ["product"] },
          intents: [{ intentId: "n-1", payload: "Need an ML engineer to help build our prediction models." }],
          networkId: NETWORK,
        },
        {
          userId: "c-ml",
          profile: { name: "Ravi Patel", bio: "ML engineer available for contract and advisory work on prediction models.", location: "SF", skills: ["ML", "Python"] },
          intents: [{ intentId: "c-1", payload: "Available to help health startups build ML prediction systems." }],
          networkId: NETWORK,
          ragScore: 80,
          matchedVia: "ML engineers",
        },
      ],
    },
    expect: [{ candidateId: "c-ml", match: true, scoreBand: [70, 100], role: "agent" }],
  },

  // ── Tier 1: score calibration ───────────────────────────────────────────
  {
    id: "score_calibration/must-meet-primary-role",
    rule: "score_calibration",
    tier: 1,
    description: "A candidate whose PRIMARY role is exactly what the source seeks should land must-meet (≥85).",
    input: {
      discovererId: "src-seek-aiml",
      entities: [
        {
          userId: "src-seek-aiml",
          profile: { name: "(source user)", bio: "Commercial founder seeking an AI/ML co-founder.", location: "SF", skills: ["sales"] },
          intents: [{ intentId: "s-1", payload: "Seeking an AI/ML engineer to co-found a startup." }],
          networkId: NETWORK,
        },
        {
          userId: "c-aiml",
          profile: { name: "Nadia Hassan", bio: "Senior AI/ML engineer who wants to co-found a company.", location: "SF", skills: ["ML", "LLMs"] },
          intents: [{ intentId: "c-1", payload: "Want to co-found an AI startup as the technical founder." }],
          networkId: NETWORK,
          ragScore: 90,
          matchedVia: "AI/ML engineers",
        },
      ],
    },
    expect: [{ candidateId: "c-aiml", match: true, scoreBand: [85, 100] }],
  },

  // ── Tier 1: event-network awareness ─────────────────────────────────────
  {
    id: "event_network/co-attendance-theme-lift",
    rule: "event_network",
    tier: 1,
    description: "Two attendees of the same themed event with aligned interests get a co-attendance lift.",
    input: {
      discovererId: "src-attendee",
      entities: [
        {
          userId: "src-attendee",
          profile: { name: "(source user)", bio: "Builder attending a month-long AI residency.", location: "Healdsburg, CA", interests: ["AI agents"], skills: ["engineering"] },
          intents: [{ intentId: "e-1", payload: "Meet other AI agent builders at the residency to collaborate during the event." }],
          networkId: "idx-event",
        },
        {
          userId: "c-attendee",
          profile: { name: "Jonah Lee", bio: "AI agent researcher attending the same residency.", location: "Healdsburg, CA", interests: ["AI agents", "multi-agent systems"], skills: ["research"] },
          intents: [{ intentId: "c-1", payload: "Looking to pair with builders on agent projects during the residency." }],
          networkId: "idx-event",
          ragScore: 78,
          matchedVia: "AI agent builders",
        },
      ],
      networkContexts: {
        "idx-event": "Event: AI Residency. Dates: 2026-05-30 to 2026-06-27. Location: Healdsburg, CA. Themes: AI agents, autonomy, tooling.",
      },
    },
    expect: [{ candidateId: "c-attendee", match: true, scoreBand: [70, 100], role: "peer" }],
  },

  // ── Tier 2: realistic multi-candidate ranking/calibration ───────────────
  {
    id: "score_calibration/tier2-cofounder-pool",
    rule: "score_calibration",
    tier: 2,
    description:
      "Commercial founder seeks a technical co-founder against the persona pool. The technical co-founder should be must/should-meet; the VC is complementary (reject); the designer is at most worth-considering.",
    input: {
      discovererId: "src-commercial",
      entities: [
        {
          userId: "src-commercial",
          profile: {
            name: "(source user)",
            bio: "Commercial founder with deep fintech distribution. Needs a technical co-founder to build the product.",
            location: "San Francisco, CA",
            interests: ["fintech", "go-to-market"],
            skills: ["sales", "partnerships"],
          },
          intents: [{ intentId: "cc-1", payload: "Seeking a technical co-founder to build a fintech product with me." }],
          networkId: NETWORK,
        },
        POOL.technicalCofounder,
        POOL.vcInvestor,
        POOL.designer,
      ],
    },
    expect: [
      { candidateId: "p-tech-cofounder", match: true, scoreBand: [70, 100], role: "agent" },
      { candidateId: "p-vc", match: false, scoreBand: [0, 29] },
      { candidateId: "p-designer", match: false, scoreBand: [0, 29] },
    ],
  },
  ...HISTORICAL_CASES,
];
