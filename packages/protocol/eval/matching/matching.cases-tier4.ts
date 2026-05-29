/**
 * Tier 4 — Programmatic Corpus Augmentation
 *
 * Each case is a deterministic perturbation of a Tier-1/2 seed. Persona details
 * (name, bio, location, interests, skills) vary while preserving the original
 * rule semantics and expectations. These cases exercise evaluator generalization
 * on superficially different inputs. Expect to ~double the observable corpus
 * (bringing per-rule CI down to stable levels for the Anthropic framework).
 *
 * Adding a variant: clone the seed, change non-semantic fields, update the id
 * and description, and export it in the TIER4_CASES array below.
 */

import type { MatchingCase } from "./matching.types.js";
import type { EvaluatorEntity } from "../../src/opportunity/opportunity.evaluator.js";
import { POOL } from "./matching.personas.js";

const NETWORK = "idx-commons";

// ═══════════════════════════════════════════════════════════════
// Shared source users
// ═══════════════════════════════════════════════════════════════

/** Creative-tech discoverer (mirrors the original identity cases). */
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

// ═══════════════════════════════════════════════════════════════
// Per-rule augmentation
// ═══════════════════════════════════════════════════════════════

// ── IS-A identity query (4 variants of the 3 Tier-1 seeds) ─────

const _isA_1: MatchingCase = {
  id: "is_a_identity/startup-funder-vs-funded-bootstrapper",
  rule: "is_a_identity",
  tier: 4,
    domains: ["funding", "technology"],
  description: "'startup funders' identity query must reject a bootstrapper who self-funded (bootstrapping ≠ funding others). Minimal-pair variant of investor-vs-funded-engineer.",
  input: {
    discovererId: "src-yanki",
    entities: [
      creativeTechSource,
      {
        userId: "c-bootstrap",
        profile: {
          name: "Lena Vos",
          bio: "Built a bootstrapped B2B dev-tool to $2M ARR without any external capital.",
          location: "Amsterdam, NL",
          interests: ["bootstrapping", "developer tools", "SaaS"],
          skills: ["product", "growth", "engineering"],
        },
        intents: [{ intentId: "c-1", payload: "Find experienced B2B SaaS mentors to help scale past early traction." }],
        networkId: NETWORK,
        ragScore: 62,
        matchedVia: "funding and startup growth",
      },
    ],
    discoveryQuery: "startup funders",
  },
  expect: [
    { candidateId: "c-bootstrap", match: false, scoreBand: [0, 29] },
  ],
};

const _isA_2: MatchingCase = {
  id: "is_a_identity/art-director-vs-illustrator",
  rule: "is_a_identity",
  tier: 4,
  domains: ["arts"],
  description: "'art director' identity query must reject a solo illustrator with no visual-direction ownership. Minimal-pair of samurai-vs-character-designer.",
  input: {
    discovererId: "src-yanki",
    entities: [
      creativeTechSource,
      {
        userId: "c-lucia",
        profile: {
          name: "Lucia Marchetti",
          bio: "Solo illustrator and visual storyteller working on editorial and book-cover commissions. Executes assigned briefs; does not lead visual direction, manage artists, or own brand/art-direction decisions.",
          location: "Barcelona, ES",
          interests: ["editorial illustration", "storytelling", "traditional media"],
          skills: ["illustration", "watercolour", "composition"],
        },
        networkId: NETWORK,
        ragScore: 88,
        matchedVia: "illustration and visual art",
      },
    ],
    discoveryQuery: "art director",
  },
  expect: [
    { candidateId: "c-lucia", match: false, scoreBand: [0, 29] },
  ],
};

const _isA_3: MatchingCase = {
  id: "is_a_identity/scout-vs-scouted-athlete",
  rule: "is_a_identity",
  tier: 4,
    domains: ["sports"],
  description: "'scouts' identity query must accept a talent scout and reject a recently-signed athlete (being signed ≠ scouting).",
  input: {
    discovererId: "src-yanki",
    entities: [
      {
        userId: "src-scout",
        profile: {
          name: "(source user)",
          bio: "Esports organisation owner expanding into conventional athletics scouting.",
          location: "Los Angeles, CA",
          interests: ["scouting", "athlete development", "sports analytics"],
          skills: ["organisation building", "talent identification"],
        },
        intents: [{ intentId: "sc-1", payload: "Meet professional scouts across sports to build a cross-discipline scouting pipeline." }],
        networkId: NETWORK,
      },
      {
        userId: "c-scout",
        profile: {
          name: "Omar Demir",
          bio: "Professional football scout with a decade of experience identifying talent across European youth academies.",
          location: "London, UK",
          interests: ["scouting", "youth development", "football"],
          skills: ["talent evaluation", "performance analysis", "recruitment"],
        },
        intents: [{ intentId: "sc-2", payload: "Want to collaborate with scouts in other sports and share evaluation frameworks." }],
        networkId: NETWORK,
        ragScore: 78,
        matchedVia: "sports scouting and talent",
      },
      {
        userId: "c-athlete",
        profile: {
          name: "Diego Souza",
          bio: "Recently signed professional basketball player. Was scouted and recruited by an agency — does not scout others himself.",
          location: "São Paulo, BR",
          interests: ["basketball", "training", "fitness"],
          skills: ["athletic performance", "team play"],
        },
        networkId: NETWORK,
        ragScore: 65,
        matchedVia: "scouting basketball athletes",
      },
    ],
    discoveryQuery: "scouts",
  },
  expect: [
    { candidateId: "c-scout", match: true, scoreBand: [70, 100] },
    { candidateId: "c-athlete", match: false, scoreBand: [0, 29] },
  ],
};

const _isA_4: MatchingCase = {
  id: "is_a_identity/investor-vs-grant-recipient",
  rule: "is_a_identity",
  tier: 4,
    domains: ["funding", "research"],
  description: "'investors' identity query must reject an academic who received a research grant (receiving a grant ≠ investing). Minimal-pair variant.",
  input: {
    discovererId: "src-yanki",
    entities: [
      creativeTechSource,
      {
        userId: "c-grant",
        profile: {
          name: "Dr. Aisha Okafor",
          bio: "Professor who won a $1.2M NSF research grant. Does not invest in startups or write checks.",
          location: "Atlanta, GA",
          interests: ["computational biology", "research funding", "academia"],
          skills: ["grant writing", "research management", "bioinformatics"],
        },
        intents: [{ intentId: "cg-1", payload: "Find research collaborators in biotech who need computational expertise." }],
        networkId: NETWORK,
        ragScore: 60,
        matchedVia: "funding and investment in research",
      },
    ],
    discoveryQuery: "investors",
  },
  expect: [
    { candidateId: "c-grant", match: false, scoreBand: [0, 29] },
  ],
};

// ── Complementary role (2 variants of the 2 Tier-1 seeds) ──────

const _comp_1: MatchingCase = {
  id: "complementary_role/design-cofounder-for-tech-founder",
  rule: "complementary_role",
  tier: 4,
    domains: ["technology", "arts"],
  description: "Technical founder seeking a design co-founder should surface the designer, not the VC who enables but does NOT fill the design role.",
  input: {
    discovererId: "src-tech-seek",
    entities: [
      {
        userId: "src-tech-seek",
        profile: {
          name: "(source user)",
          bio: "Full-stack engineer who built a prototype but can't design the UX. Needs a design-focused co-founder.",
          location: "Berlin, DE",
          interests: ["developer tools", "API design", "UX"],
          skills: ["engineering", "systems design"],
        },
        intents: [{ intentId: "ts-1", payload: "Looking for a designer co-founder to own product UX and visual identity." }],
        networkId: NETWORK,
      },
      POOL.vcInvestor,
      {
        userId: "p-designer-alt",
        profile: {
          name: "Camille Fontaine",
          bio: "Product designer who co-founded a consumer-fintech app and led design from zero to Series A.",
          location: "Paris, FR",
          interests: ["product design", "consumer fintech", "design systems"],
          skills: ["UX", "interaction design", "brand identity", "prototyping"],
        },
        intents: [{ intentId: "pf-1", payload: "Want to join an early-stage technical founder as a design co-founder." }],
        networkId: NETWORK,
        ragScore: 92,
        matchedVia: "UX design and co-founder search",
      },
    ],
  },
  expect: [
    { candidateId: "p-vc", match: false, scoreBand: [0, 29] },
    { candidateId: "p-designer-alt", match: true, scoreBand: [70, 100], role: "agent" },
  ],
};

const _comp_2: MatchingCase = {
  id: "complementary_role/marketing-cofounder-for-ai-engineer",
  rule: "complementary_role",
  tier: 4,
    domains: ["technology"],
  description: "AI engineer seeking a GTM co-founder should surface the marketing expert, who complements rather than mirrors.",
  input: {
    discovererId: "src-ai-engineer",
    entities: [
      {
        userId: "src-ai-engineer",
        profile: {
          name: "(source user)",
          bio: "ML engineer who built a working AI agent product but has zero go-to-market experience. Needs a commercial co-founder.",
          location: "London, UK",
          interests: ["AI agents", "LLMs", "developer tools"],
          skills: ["ML", "Python", "agent architecture"],
        },
        intents: [{ intentId: "ae-1", payload: "Looking for a GTM-focused co-founder to handle customers, pricing, and positioning." }],
        networkId: NETWORK,
      },
      POOL.operator,
      {
        userId: "p-tech-alt",
        profile: {
          name: "Jun Park",
          bio: "Senior AI engineer with infra background, also looking for a commercial co-founder to pair with. A mirror, not a complement — same-side.",
          location: "London, UK",
          interests: ["AI agents", "systems", "startups"],
          skills: ["ML", "Kubernetes", "distributed systems"],
        },
        intents: [{ intentId: "pj-1", payload: "Need a GTM co-founder to handle the commercial side while I build." }],
        networkId: NETWORK,
        ragScore: 85,
        matchedVia: "AI engineer seeking co-founder",
      },
    ],
  },
  expect: [
    { candidateId: "p-operator", match: true, scoreBand: [70, 100], role: "agent" },
    { candidateId: "p-tech-alt", match: false, scoreBand: [0, 29] },
  ],
};

// ── Same-side (2 variants of the 1 Tier-1 seed) ─────────────────

const _same_1: MatchingCase = {
  id: "same_side/both-seeking-cofounders",
  rule: "same_side",
  tier: 4,
    domains: ["technology"],
  description: "Two founders both seeking co-founders (not looking to BE a co-founder for each other) are same-side. Synonym of both-seeking-investors.",
  input: {
    discovererId: "src-seek-cof",
    entities: [
      {
        userId: "src-seek-cof",
        profile: {
          name: "(source user)",
          bio: "Technical founder building a health-tech platform, looking for a commercial co-founder.",
          location: "Austin, TX",
          interests: ["health tech", "AI diagnostics"],
          skills: ["engineering", "ML"],
        },
        intents: [{ intentId: "scf-1", payload: "Seeking a commercial co-founder to lead business development for our health-tech startup." }],
        networkId: NETWORK,
      },
      {
        userId: "c-seek-cof",
        profile: {
          name: "Fatima El-Khoury",
          bio: "Also a technical founder, building a telehealth product. Is looking for her own commercial co-founder — not looking to join someone else.",
          location: "Austin, TX",
          interests: ["telehealth", "SaaS"],
          skills: ["engineering", "product"],
        },
        intents: [{ intentId: "cf-1", payload: "Looking for a commercial founder to partner with on my telehealth startup." }],
        networkId: NETWORK,
        ragScore: 72,
        matchedVia: "founder seeking co-founder",
      },
    ],
  },
  expect: [
    { candidateId: "c-seek-cof", match: false, scoreBand: [0, 29] },
  ],
};

const _same_2: MatchingCase = {
  id: "same_side/both-hiring-engineers",
  rule: "same_side",
  tier: 4,
    domains: ["technology"],
  description: "Two hiring managers both recruiting senior engineers are same-side — neither is the hire the other needs.",
  input: {
    discovererId: "src-hiring",
    entities: [
      {
        userId: "src-hiring",
        profile: {
          name: "(source user)",
          bio: "CTO of a 20-person startup, actively hiring for a staff ML engineer.",
          location: "San Francisco, CA",
          interests: ["hiring", "team building", "ML infrastructure"],
          skills: ["engineering leadership", "hiring"],
        },
        intents: [{ intentId: "sh-1", payload: "Hiring a staff-level ML engineer to build our recommendation system." }],
        networkId: NETWORK,
      },
      {
        userId: "c-recruiting",
        profile: {
          name: "Nico Bauer",
          bio: "VP Engineering at a Series-A company, also recruiting senior ML talent. Looking for candidates — not looking to be hired themselves.",
          location: "San Francisco, CA",
          interests: ["hiring", "ML", "team scaling"],
          skills: ["engineering management", "recruiting"],
        },
        intents: [{ intentId: "cb-1", payload: "Recruiting for two senior ML engineer roles on my team." }],
        networkId: NETWORK,
        ragScore: 74,
        matchedVia: "ML engineer hiring",
      },
    ],
  },
  expect: [
    { candidateId: "c-recruiting", match: false, scoreBand: [0, 29] },
  ],
};

// ── Location (2 variants of the 2 Tier-1 seeds) ─────────────────

const _loc_1: MatchingCase = {
  id: "location/berlin-mismatch-vs-london-query",
  rule: "location",
  tier: 4,
    domains: ["location", "technology"],
  description: "Query asks for London; a Berlin candidate with strong fit is penalized (≤40). Synonym of known-mismatch-penalized.",
  input: {
    discovererId: "src-yanki",
    entities: [
      creativeTechSource,
      {
        userId: "c-berlin",
        profile: {
          name: "Jonas Weber",
          bio: "Senior Unity developer building educational games for museums and cultural institutions.",
          location: "Berlin, DE",
          interests: ["game development", "Unity", "education"],
          skills: ["Unity", "C#", "game design"],
        },
        networkId: NETWORK,
        ragScore: 78,
        matchedVia: "game developers",
      },
    ],
    discoveryQuery: "game developers in London",
  },
  expect: [
    { candidateId: "c-berlin", match: false, scoreBand: [0, 29] },
  ],
};

const _loc_2: MatchingCase = {
  id: "location/unknown-city-not-penalized-variant",
  rule: "location",
  tier: 4,
  domains: ["location", "technology"],
  description: "Query asks for Tokyo technical artists; a candidate with empty location must not be penalized. Synonym of unknown-not-penalized.",
  input: {
    discovererId: "src-yanki",
    entities: [
      creativeTechSource,
      {
        userId: "c-empty-loc",
        profile: {
          name: "Haruki Mori",
          bio: "Technical artist building procedural generation tools for game studios. Remote-first, location undisclosed.",
          location: "",
          interests: ["procedural generation", "Houdini", "game art"],
          skills: ["Houdini", "procedural content", "technical art"],
        },
        networkId: NETWORK,
        ragScore: 72,
        matchedVia: "game industry technical artists",
      },
    ],
    discoveryQuery: "technical artists in Tokyo",
  },
  expect: [
    { candidateId: "c-empty-loc", match: true, scoreBand: [60, 100] },
  ],
};

// ── Valency / role (2 variants of the 1 Tier-1 seed) ────────────

const _role_1: MatchingCase = {
  id: "valency_role/seeker-needs-design-provider-offers-design",
  rule: "valency_role",
  tier: 4,
    domains: ["arts", "technology"],
  description: "Source needs design help; candidate offers design services — candidate is the provider (agent). Synonym of seeker-gets-patient-provider-gets-agent.",
  input: {
    discovererId: "src-needs-design",
    entities: [
      {
        userId: "src-needs-design",
        profile: {
          name: "(source user)",
          bio: "Developer building a B2B analytics dashboard with no design skills. Needs a UI/UX designer to make it usable.",
          location: "Remote",
          interests: ["analytics", "developer tools"],
          skills: ["engineering", "data pipelines"],
        },
        intents: [{ intentId: "nd-1", payload: "Need a UI/UX designer to overhaul the interface on my analytics product." }],
        networkId: NETWORK,
      },
      {
        userId: "c-designer-alt",
        profile: {
          name: "Rosa Delgado",
          bio: "Freelance UI/UX designer specializing in data-heavy interfaces and analytics dashboards. Available for contracts.",
          location: "Bogotá, CO",
          interests: ["data visualisation", "UI design", "developer tools"],
          skills: ["UI/UX", "Figma", "design systems", "data viz"],
        },
        intents: [{ intentId: "rd-1", payload: "Available to design interfaces for data-analytics and developer-tool startups." }],
        networkId: NETWORK,
        ragScore: 84,
        matchedVia: "UI/UX designers for data products",
      },
    ],
  },
  expect: [
    { candidateId: "c-designer-alt", match: true, scoreBand: [70, 100], role: "agent" },
  ],
};

const _role_2: MatchingCase = {
  id: "valency_role/seeker-offers-capacity-provider-needs-capacity",
  rule: "valency_role",
  tier: 4,
    domains: ["technology"],
  description: "Source has spare compute capacity; candidate needs compute. The source is the provider (agent) and the candidate is the seeker (patient). Role reversal variant.",
  input: {
    discovererId: "src-has-gpu",
    entities: [
      {
        userId: "src-has-gpu",
        profile: {
          name: "(source user)",
          bio: "Runs a small GPU cluster with idle capacity between jobs. Happy to lend cycles to researchers who need them.",
          location: "Zurich, CH",
          interests: ["distributed computing", "research support"],
          skills: ["HPC", "infrastructure"],
        },
        intents: [{ intentId: "sg-1", payload: "Looking for ML researchers who need compute capacity so I can put my idle GPUs to good use." }],
        networkId: NETWORK,
      },
      {
        userId: "c-needs-gpu",
        profile: {
          name: "Dr. Karim Abadi",
          bio: "ML researcher with a promising model architecture but no GPU budget. Needs compute to run experiments.",
          location: "Zurich, CH",
          interests: ["deep learning", "efficient architectures", "NLP"],
          skills: ["research", "PyTorch", "experiment design"],
        },
        intents: [{ intentId: "ka-1", payload: "Need access to a GPU cluster for training runs — my university allocation is exhausted." }],
        networkId: NETWORK,
        ragScore: 76,
        matchedVia: "GPU compute for ML research",
      },
    ],
  },
  expect: [
    { candidateId: "c-needs-gpu", match: true, scoreBand: [70, 100], role: "patient" },
  ],
};

// ── Score calibration (2 variants of the 2 Tier-1/2 seeds) ───────

const _cal_1: MatchingCase = {
  id: "score_calibration/must-meet-sales-cofounder",
  rule: "score_calibration",
  tier: 4,
    domains: ["technology"],
  description: "Technical founder seeking a GTM co-founder should score a candidate whose primary role IS GTM co-founder at ≥85. Synonym of must-meet-primary-role.",
  input: {
    discovererId: "src-seek-sales",
    entities: [
      {
        userId: "src-seek-sales",
        profile: {
          name: "(source user)",
          bio: "Deep-tech founder with a working prototype, needs a sales-oriented co-founder to drive revenue.",
          location: "Munich, DE",
          interests: ["deep tech", "enterprise sales", "SaaS"],
          skills: ["engineering", "systems architecture"],
        },
        intents: [{ intentId: "ss-1", payload: "Seeking a sales-oriented co-founder to lead go-to-market for a deep-tech SaaS product." }],
        networkId: NETWORK,
      },
      {
        userId: "c-sales-cof",
        profile: {
          name: "Aleks Nowak",
          bio: "Two-time GTM hire at seed-stage dev-tool companies. Built revenue from zero to $1M ARR at both. Ready to co-found.",
          location: "Berlin, DE",
          interests: ["enterprise sales", "developer tools", "GTM strategy"],
          skills: ["enterprise sales", "GTM strategy", "hiring", "pricing"],
        },
        intents: [{ intentId: "an-1", payload: "Want to join a deep-tech founder as sales-oriented co-founder to take the product to market." }],
        networkId: NETWORK,
        ragScore: 93,
        matchedVia: "sales co-founders for developer tools",
      },
    ],
  },
  expect: [
    { candidateId: "c-sales-cof", match: true, scoreBand: [85, 100] },
  ],
};

const _cal_2: MatchingCase = {
  id: "score_calibration/tier2-researcher-pool-variant",
  rule: "score_calibration",
  tier: 4,
    domains: ["technology", "research"],
  description: "Commercial founder seeks a technical co-founder against a reshuffled persona pool. The technical co-founder must-meet; researcher and operator are below-threshold.",
  input: {
    discovererId: "src-commercial-2",
    entities: [
      {
        userId: "src-commercial-2",
        profile: {
          name: "(source user)",
          bio: "Commercial founder with deep logistics distribution. Needs a technical co-founder to build the platform.",
          location: "Chicago, IL",
          interests: ["logistics", "supply chain", "B2B"],
          skills: ["sales", "operations", "partnerships"],
        },
        intents: [{ intentId: "cc2-1", payload: "Seeking a technical co-founder to build a logistics-platform with me." }],
        networkId: NETWORK,
      },
      POOL.technicalCofounder,
      POOL.researcher,
      POOL.operator,
    ],
  },
  expect: [
    { candidateId: "p-tech-cofounder", match: true, scoreBand: [70, 100] },
    { candidateId: "p-researcher", match: false, scoreBand: [0, 29] },
    { candidateId: "p-operator", match: false, scoreBand: [0, 29] },
  ],
};

// ═══════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════

export const TIER4_CASES: MatchingCase[] = [
  _isA_1,
  _isA_2,
  _isA_3,
  _isA_4,
  _comp_1,
  _comp_2,
  _same_1,
  _same_2,
  _loc_1,
  _loc_2,
  _role_1,
  _role_2,
  _cal_1,
  _cal_2,
];