import type { IntakeEvalCase } from "./intake.types.js";

const SCUBA_PROMPT_TERMS = ["scuba", "diver", "divers", "diving"];
const SCUBA_DOMAIN_TERMS = [
  "scuba", "dive", "diver", "divers", "diving", "buddy", "buddies",
  "instructor", "instruction", "training", "certification", "safety",
  "expedition", "travel", "conservation", "marine", "ocean", "reef",
  "underwater", "photography", "research", "local",
];

/** Surgical live cases for current-answer authority over profile personalization. */
export const CASES: IntakeEvalCase[] = [
  {
    id: "unrelated/scuba-tech-profile",
    description: "A technology profile may add one bridge but cannot dominate a scuba-diver answer.",
    input: {
      brief: "Yank is a software founder building AI and machine-learning products, developer tools, and digital-media systems.",
      rounds: [{
        prompt: "Who are you hoping to connect with at this moment?",
        answer: { selectedOptions: [], freeText: "scuba divers" },
      }],
      maxFollowUps: 1,
    },
    promptTerms: SCUBA_PROMPT_TERMS,
    domainTerms: SCUBA_DOMAIN_TERMS,
    minDomainOptions: 2,
    profileTerms: [
      "ai", "artificial intelligence", "ml", "machine learning", "software",
      "technology", "tech", "digital media", "product", "startup", "founder",
      "engineering", "developer tools",
    ],
    maxProfileOptions: 1,
  },
  {
    id: "unrelated/running-investor-profile",
    description: "An investor profile cannot turn a running-club answer into startup networking.",
    input: {
      brief: "Mira is a venture investor who funds early-stage startups, advises founders, and manages a technology portfolio.",
      rounds: [{
        prompt: "Who do you want to meet right now?",
        answer: { selectedOptions: [], freeText: "a local running club" },
      }],
      maxFollowUps: 1,
    },
    promptTerms: ["run", "running", "runner", "runners", "club"],
    domainTerms: [
      "run", "running", "runner", "runners", "club", "jog", "jogging",
      "training", "race", "marathon", "pace", "fitness", "coach", "route",
      "trail", "exercise", "local", "social",
    ],
    minDomainOptions: 2,
    profileTerms: [
      "investor", "investing", "investment", "venture", "venture capital",
      "fund", "funding", "capital", "startup", "portfolio", "deal", "founder",
      "sponsor", "sponsorship",
    ],
    maxProfileOptions: 1,
  },
  {
    id: "relevant/climate-founders-profile",
    description: "A relevant climate profile may enrich one path without replacing answer-grounded choices.",
    input: {
      brief: "Noah builds AI analytics and data products for climate adaptation teams and advises climate-technology organizations.",
      rounds: [{
        prompt: "Who do you want to meet right now?",
        answer: { selectedOptions: ["climate founders"] },
      }],
      maxFollowUps: 1,
    },
    promptTerms: ["climate", "founder", "founders"],
    domainTerms: [
      "climate", "founder", "founders", "company", "companies", "venture",
      "adaptation", "mitigation", "carbon", "energy", "sustainability",
      "collaboration", "peer", "peers", "stage", "sector",
    ],
    minDomainOptions: 2,
    profileTerms: ["ai", "artificial intelligence", "analytics", "data", "software"],
    maxProfileOptions: 1,
  },
  {
    id: "no-bridge/scuba-pianist-profile",
    description: "An unrelated classical-music profile should not appear in scuba-diver options.",
    input: {
      brief: "Lea is a classical pianist who performs chamber music, studies composition, and organizes concert programs.",
      rounds: [{
        prompt: "Who do you want to meet right now?",
        answer: { selectedOptions: [], freeText: "scuba divers" },
      }],
      maxFollowUps: 1,
    },
    promptTerms: SCUBA_PROMPT_TERMS,
    domainTerms: SCUBA_DOMAIN_TERMS,
    minDomainOptions: 2,
    profileTerms: ["piano", "pianist", "classical", "music", "musical", "concert", "composition", "composer"],
    maxProfileOptions: 0,
  },
];
