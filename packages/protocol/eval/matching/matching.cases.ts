import type { EvaluatorEntity } from "../../src/opportunity/opportunity.evaluator.js";
import type { MatchingCase } from "./matching.types.js";
import { POOL } from "./matching.personas.js";
import { HISTORICAL_CASES } from "./matching.historical.js";
import { TIER4_CASES } from "./matching.cases-tier4.js";

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
    domains: ["arts"],
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
    domains: ["funding", "technology"],
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
    domains: ["funding", "technology"],
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
    domains: ["arts"],
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
  {
    id: "query_primary/specific-art-query-accepts-illustrator",
    rule: "query_primary",
    tier: 1,
    domains: ["arts"],
    description: "Minimal pair: when the explicit query asks for a samurai character illustrator, the same visual artist should be accepted.",
    input: {
      discovererId: "src-yanki",
      entities: [
        creativeTechSource,
        {
          userId: "c-yuki",
          profile: {
            name: "Yuki Tanaka",
            bio: "Visual artist and illustrator, focus on character design for historical and fantasy games.",
            location: "Tokyo, JP",
            interests: ["illustration", "character design", "historical costume"],
            skills: ["illustration", "character design", "digital painting"],
          },
          intents: [{ intentId: "yuki-1", payload: "Open to collaborating on game character illustration and visual development." }],
          networkId: NETWORK,
          ragScore: 100,
          matchedVia: "visual artists",
        },
      ],
      discoveryQuery: "samurai character illustrator",
    },
    expect: [{ candidateId: "c-yuki", match: true, scoreBand: [70, 100], role: "agent" }],
  },
  {
    id: "query_primary/investors-query-rejects-funded-founder",
    rule: "query_primary",
    tier: 1,
    domains: ["funding", "technology"],
    description: "Explicit 'investors' query must reject a founder/engineer who has raised money but does not invest.",
    input: {
      discovererId: "src-yanki",
      entities: [
        creativeTechSource,
        {
          userId: "c-sam",
          profile: {
            name: "Sam Rivera",
            bio: "ML engineer and founder. Raised a $500K pre-seed for a side project; does not write checks into other startups.",
            location: "Austin, TX",
            interests: ["machine learning", "NLP", "startups"],
            skills: ["Python", "PyTorch", "MLOps"],
          },
          intents: [{ intentId: "sam-1", payload: "Find investors and product collaborators for an LLM B2B tool." }],
          networkId: NETWORK,
          ragScore: 75,
          matchedVia: "startup funding and investment",
        },
      ],
      discoveryQuery: "investors",
    },
    expect: [{ candidateId: "c-sam", match: false, scoreBand: [0, 29] }],
  },
  {
    id: "query_primary/founders-raising-seed-accepts-founder",
    rule: "query_primary",
    tier: 1,
    domains: ["funding", "technology"],
    description: "Minimal pair: when the explicit query asks for founders raising seed, the funded founder should be accepted.",
    input: {
      discovererId: "src-yanki",
      entities: [
        creativeTechSource,
        {
          userId: "c-sam",
          profile: {
            name: "Sam Rivera",
            bio: "ML engineer and founder building an LLM B2B tool. Recently raised a small pre-seed and is preparing a larger seed round.",
            location: "Austin, TX",
            interests: ["machine learning", "NLP", "startups"],
            skills: ["Python", "PyTorch", "MLOps"],
          },
          intents: [{ intentId: "sam-2", payload: "Meet investors and design partners before raising a seed round." }],
          networkId: NETWORK,
          ragScore: 75,
          matchedVia: "startup funding and investment",
        },
      ],
      discoveryQuery: "founders raising seed",
    },
    expect: [{ candidateId: "c-sam", match: true, scoreBand: [70, 100] }],
  },
  {
    id: "query_primary/location-query-rejects-wrong-city",
    rule: "query_primary",
    tier: 1,
    domains: ["location", "technology"],
    description: "Explicit London query must reject a Berlin candidate even when their technical profile matches the background intent.",
    input: {
      discovererId: "src-yanki",
      entities: [
        creativeTechSource,
        {
          userId: "c-berlin-unreal",
          profile: {
            name: "Marta Vogel",
            bio: "Senior Unreal Engine developer building interactive installations and game prototypes.",
            location: "Berlin, DE",
            interests: ["Unreal Engine", "interactive media", "games"],
            skills: ["Unreal Engine", "C++", "real-time rendering"],
          },
          networkId: NETWORK,
          ragScore: 91,
          matchedVia: "Unreal Engine developers",
        },
      ],
      discoveryQuery: "London Unreal Engine developers",
    },
    expect: [{ candidateId: "c-berlin-unreal", match: false, scoreBand: [0, 29] }],
  },
  {
    id: "query_primary/vague-query-can-use-background-intent",
    rule: "query_primary",
    tier: 1,
    domains: ["arts"],
    description: "When the explicit query is vague, the source's background visual-artist intent may fill in the blanks.",
    input: {
      discovererId: "src-yanki",
      entities: [
        creativeTechSource,
        {
          userId: "c-yuki",
          profile: {
            name: "Yuki Tanaka",
            bio: "Visual artist and illustrator, focus on character design for interactive media.",
            location: "Tokyo, JP",
            interests: ["illustration", "character design", "interactive art"],
            skills: ["illustration", "character design", "digital painting"],
          },
          intents: [{ intentId: "yuki-2", payload: "Interested in collaborations with creative technologists and game teams." }],
          networkId: NETWORK,
          ragScore: 88,
          matchedVia: "visual artists",
        },
      ],
      discoveryQuery: "collaborators",
    },
    expect: [{ candidateId: "c-yuki", match: true, scoreBand: [70, 100] }],
  },
  {
    id: "query_primary/scouts-query-rejects-scouted-athlete",
    rule: "query_primary",
    tier: 1,
    domains: ["sports"],
    description: "Explicit 'scouts' query must reject an athlete who was scouted; being scouted is not being a scout.",
    input: {
      discovererId: "src-sports",
      entities: [
        {
          userId: "src-sports",
          profile: { name: "(source user)", bio: "Community organizer building youth sports programs.", location: "Remote", interests: ["basketball", "youth programs"], skills: ["program design"] },
          intents: [{ intentId: "sports-src-1", payload: "Find youth basketball scouts who can identify emerging talent for a camp." }],
          networkId: NETWORK,
        },
        {
          userId: "c-athlete",
          profile: {
            name: "Andre Mills",
            bio: "High-school basketball guard recently discovered by a regional scout and invited to a development camp. He plays, but does not evaluate other athletes.",
            location: "Chicago, IL",
            interests: ["basketball", "training"],
            skills: ["ball handling", "shooting"],
          },
          networkId: NETWORK,
          ragScore: 86,
          matchedVia: "basketball scouting and talent",
        },
      ],
      discoveryQuery: "scouts",
    },
    expect: [{ candidateId: "c-athlete", match: false, scoreBand: [0, 29] }],
  },

  // ── Tier 1: complementary role ──────────────────────────────────────────
  {
    id: "complementary_role/vc-for-cofounder-intent",
    rule: "complementary_role",
    tier: 1,
    domains: ["funding", "technology"],
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
    domains: ["technology"],
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
    domains: ["funding", "technology"],
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
    domains: ["technology"],
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
    domains: ["location", "technology"],
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
    domains: ["location", "technology"],
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
    domains: ["technology"],
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
    domains: ["technology"],
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

  // ── Tier 1: event-network claim safety ──────────────────────────────────
  {
    id: "event_network/co-membership-is-not-attendance",
    rule: "event_network",
    tier: 1,
    domains: ["community", "technology"],
    description: "Shared event-network placement alone must not prove candidate attendance or a shared session.",
    input: {
      discovererId: "src-attendee",
      discoveryQuery: "Find someone who attended the same AI residency session as me.",
      entities: [
        {
          userId: "src-attendee",
          profile: { name: "(source user)", bio: "AI product builder.", interests: ["AI agents"], skills: ["engineering"] },
          networkId: "idx-event",
        },
        {
          userId: "c-attendee",
          profile: { name: "Jonah Lee", bio: "Software researcher open to technical conversations.", interests: ["developer tools"], skills: ["research"] },
          networkId: "idx-event",
          ragScore: 78,
          matchedVia: "event network retrieval",
        },
      ],
      networkContexts: {
        "idx-event": "Event: AI Residency. Dates: 2026-05-30 to 2026-06-27. Location: Healdsburg, CA. Themes: AI agents, autonomy, tooling.",
      },
    },
    expect: [{ candidateId: "c-attendee", match: false, scoreBand: [0, 29] }],
  },

  // ── Tier 2: realistic multi-candidate ranking/calibration ───────────────
  {
    id: "score_calibration/tier2-cofounder-pool",
    rule: "score_calibration",
    tier: 2,
    domains: ["technology", "funding"],
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
      { candidateId: "p-tech-cofounder", match: true, scoreBand: [70, 100] },
      { candidateId: "p-vc", match: false, scoreBand: [0, 29] },
      { candidateId: "p-designer", match: false, scoreBand: [0, 29] },
    ],
  },
  ...HISTORICAL_CASES,
  ...TIER4_CASES,
];
