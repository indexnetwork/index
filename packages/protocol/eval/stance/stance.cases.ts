import type { StanceCase } from "./stance.types.js";

/**
 * Negotiator-stance corpus (IND-611).
 *
 * Half the fixtures are genuinely valuable matches; half are *plausible but low
 * value* — the failure mode the current advocate prompt is structurally biased
 * toward, where a shared topic, an overlapping keyword, or a satisfied
 * discovery query reads as sufficient grounds to connect.
 *
 * Fixture authoring rules, so the corpus measures the stance rather than
 * rewarding it:
 * - Low-value cases are never *absurd*. An obvious mismatch is already rejected
 *   under `advocate`, so it discriminates nothing. Each one is topically
 *   adjacent and would survive a keyword filter.
 * - Both buckets use the same style, length, and level of concreteness. Value
 *   must not be inferable from prose quality.
 * - No fixture text mentions attention, opportunity cost, being "worth it", or
 *   anything else echoing a stance fragment.
 * - `rationale` is documentation for the reader; it is never sent to a model.
 *
 * Failure modes probed by the low bucket: subject-matter adjacency mistaken for
 * role identity, one-sided extraction, stage/scope mismatch, and a satisfied
 * discovery query hiding an unusable fit.
 */
export const CASES: StanceCase[] = [
  // ─── Genuinely valuable ────────────────────────────────────────────────────
  {
    id: "high/complementary-hire",
    value: "high",
    rationale:
      "Concrete, current, two-sided: an open role with a named stack meets someone seeking exactly that work, at the same stage and location.",
    networkPrompt: "AI builders network",
    source: {
      id: "u-src",
      profile: {
        name: "Alice",
        bio: "Co-founder of a seed-stage company building LLM evaluation infrastructure. Team of six in Berlin.",
        skills: ["product", "evaluation", "python"],
      },
      intents: [
        {
          id: "i-src",
          title: "Hire a senior ML engineer",
          description:
            "Hiring a senior ML engineer in Berlin to own our offline evaluation pipeline: dataset curation, judge models, and regression gating. Full-time, starting this quarter.",
          confidence: 1,
        },
      ],
    },
    candidate: {
      id: "u-cand",
      profile: {
        name: "Bob",
        bio: "Senior ML engineer in Berlin, six years building training and evaluation pipelines at two ML platform companies.",
        skills: ["pytorch", "evaluation", "data pipelines"],
      },
      intents: [
        {
          id: "i-cand",
          title: "Join an early-stage evaluation team",
          description:
            "Looking for a full-time senior role at a seed-stage company where I own model evaluation end to end. Based in Berlin, available in six weeks.",
          confidence: 1,
        },
      ],
    },
    seedAssessment: {
      reasoning: "An open senior evaluation role meets an engineer seeking exactly that scope, same city and stage.",
      valencyRole: "agent",
    },
  },
  {
    id: "high/mutual-distribution",
    value: "high",
    rationale:
      "Each side holds precisely what the other lacks, both state the same collaboration shape, and both are ready now.",
    networkPrompt: "B2B founders network",
    source: {
      id: "u-src",
      profile: {
        name: "Alice",
        bio: "Founder of a compliance-automation product used by twenty mid-market insurers.",
        skills: ["compliance", "enterprise sales", "product"],
      },
      intents: [
        {
          id: "i-src",
          title: "Find a distribution partner into European insurers",
          description:
            "Our product is proven in the US mid-market. I want a partner with existing European insurance relationships to co-sell into that market this year.",
          confidence: 1,
        },
      ],
    },
    candidate: {
      id: "u-cand",
      profile: {
        name: "Bob",
        bio: "Runs a European insurtech consultancy with active contracts at eleven insurers in Germany, France, and the Netherlands.",
        skills: ["insurance", "partnerships", "go-to-market"],
      },
      intents: [
        {
          id: "i-cand",
          title: "Add a compliance product to our portfolio",
          description:
            "My clients keep asking for compliance automation and I have nothing to sell them. I want to co-sell a proven product into my existing accounts.",
          confidence: 1,
        },
      ],
    },
    seedAssessment: {
      reasoning: "One side has a proven product without European reach; the other has European reach without a product.",
      valencyRole: "peer",
    },
  },
  {
    id: "high/query-satisfied-and-fits",
    value: "high",
    rationale:
      "The discovery query is satisfied by identity, not adjacency, AND the underlying fit is real — the case that must survive a necessary-not-sufficient query rule.",
    networkPrompt: "Climate capital network",
    discoveryQuery: "climate hardware investors",
    source: {
      id: "u-src",
      profile: {
        name: "Alice",
        bio: "Founder of a direct-air-capture hardware startup with a working pilot unit and two industrial LOIs.",
        skills: ["hardware", "carbon capture", "fundraising"],
      },
      intents: [
        {
          id: "i-src",
          title: "Raise a Series A for climate hardware",
          description:
            "Raising a $12M Series A to move our direct-air-capture unit from pilot to first commercial deployment. Looking for investors who have led hardware rounds.",
          confidence: 1,
        },
      ],
    },
    candidate: {
      id: "u-cand",
      profile: {
        name: "Bob",
        bio: "Partner at a climate-focused venture fund. Has led seven Series A rounds in carbon capture and industrial decarbonization hardware.",
        skills: ["venture capital", "climate", "hardware investing"],
      },
      intents: [
        {
          id: "i-cand",
          title: "Lead Series A rounds in carbon capture",
          description:
            "Actively deploying from a new fund into carbon-capture hardware at the pilot-to-commercial transition. Write $8-15M leads.",
          confidence: 1,
        },
      ],
    },
    seedAssessment: {
      reasoning: "A hardware climate founder raising a Series A meets a fund partner who leads exactly those rounds at exactly that stage.",
      valencyRole: "patient",
    },
  },
  {
    id: "high/specific-unblocking-expertise",
    value: "high",
    rationale:
      "A named, current blocker meets someone who has shipped the exact solution; the ask is bounded and the counterparty states a matching motive.",
    networkPrompt: "Infrastructure engineering network",
    source: {
      id: "u-src",
      profile: {
        name: "Alice",
        bio: "Staff engineer responsible for a multi-tenant Postgres fleet serving 400 customers.",
        skills: ["postgres", "distributed systems", "sre"],
      },
      intents: [
        {
          id: "i-src",
          title: "Solve noisy-neighbour isolation on shared Postgres",
          description:
            "We are hitting per-tenant contention on a shared Postgres fleet and are deciding between logical sharding and per-tenant databases. I want to talk to someone who has run this migration at similar scale.",
          confidence: 1,
        },
      ],
    },
    candidate: {
      id: "u-cand",
      profile: {
        name: "Bob",
        bio: "Former database platform lead; migrated a 900-tenant shared Postgres estate to per-tenant databases over eighteen months.",
        skills: ["postgres", "sharding", "migrations"],
      },
      intents: [
        {
          id: "i-cand",
          title: "Advise teams on multi-tenant database migrations",
          description:
            "I want to spend a few hours a month advising teams facing the shared-versus-isolated tenancy decision, which I have now done twice end to end.",
          confidence: 1,
        },
      ],
    },
    seedAssessment: {
      reasoning: "A live tenancy-isolation decision meets someone who has completed that exact migration and wants to advise on it.",
      valencyRole: "patient",
    },
  },

  // ─── Plausible but low value ───────────────────────────────────────────────
  {
    id: "low/topical-adjacency",
    value: "low",
    rationale:
      "Both sides say 'AI safety', but one wants a research collaborator on interpretability and the other writes explainers for a general audience. Vocabulary overlap, no working overlap.",
    networkPrompt: "AI builders network",
    source: {
      id: "u-src",
      profile: {
        name: "Alice",
        bio: "Research engineer working on mechanistic interpretability of transformer circuits.",
        skills: ["interpretability", "pytorch", "research"],
      },
      intents: [
        {
          id: "i-src",
          title: "Find a research collaborator on interpretability",
          description:
            "Looking for someone to co-author empirical work on circuit-level interpretability — someone who will run experiments and read the sparse-autoencoder literature with me.",
          confidence: 1,
        },
      ],
    },
    candidate: {
      id: "u-cand",
      profile: {
        name: "Bob",
        bio: "Writer covering AI safety for a general-audience newsletter with 30,000 subscribers.",
        skills: ["writing", "editing", "science communication"],
      },
      intents: [
        {
          id: "i-cand",
          title: "Meet people working on AI safety",
          description:
            "I write about AI safety and I like meeting researchers to keep my coverage current and find story ideas.",
          confidence: 1,
        },
      ],
    },
    seedAssessment: {
      reasoning: "Both parties describe their work in terms of AI safety.",
      valencyRole: "peer",
    },
  },
  {
    id: "low/one-sided-extraction",
    value: "low",
    rationale:
      "The counterparty's stated intent is to extract introductions and advice; nothing flows back. The classic match that does no harm and delivers no value.",
    networkPrompt: "B2B founders network",
    source: {
      id: "u-src",
      profile: {
        name: "Alice",
        bio: "Second-time founder; sold a logistics SaaS company and now runs a Series B supply-chain platform.",
        skills: ["enterprise sales", "logistics", "fundraising"],
      },
      intents: [
        {
          id: "i-src",
          title: "Find design partners for a new forecasting module",
          description:
            "I need two or three mid-market shippers willing to be design partners for a demand-forecasting module launching next quarter.",
          confidence: 1,
        },
      ],
    },
    candidate: {
      id: "u-cand",
      profile: {
        name: "Bob",
        bio: "First-time founder, three months in, exploring ideas in the logistics space. No product yet.",
        skills: ["excel", "operations"],
      },
      intents: [
        {
          id: "i-cand",
          title: "Learn from experienced logistics founders",
          description:
            "I want to talk to founders who have already built and sold in logistics, get feedback on my ideas, and ideally warm introductions to their investors.",
          confidence: 1,
        },
      ],
    },
    seedAssessment: {
      reasoning: "Both parties are founders working in logistics.",
      valencyRole: "agent",
    },
  },
  {
    id: "low/stage-mismatch",
    value: "low",
    rationale:
      "Genuine, honest intents on both sides that cannot transact: a pre-revenue idea-stage founder and an investor whose mandate starts at $3M ARR. Nothing is wrong with either party; the match is simply not actionable.",
    networkPrompt: "Climate capital network",
    source: {
      id: "u-src",
      profile: {
        name: "Alice",
        bio: "Solo founder sketching a marketplace for reclaimed construction materials. No product, no customers yet.",
        skills: ["construction", "sustainability"],
      },
      intents: [
        {
          id: "i-src",
          title: "Raise a first round for a reclaimed-materials marketplace",
          description:
            "I want to raise a small first round to build a prototype marketplace for reclaimed construction materials.",
          confidence: 1,
        },
      ],
    },
    candidate: {
      id: "u-cand",
      profile: {
        name: "Bob",
        bio: "Growth-stage investor in circular-economy businesses. Fund mandate starts at $3M ARR with two years of operating history.",
        skills: ["growth investing", "circular economy"],
      },
      intents: [
        {
          id: "i-cand",
          title: "Invest in circular-economy marketplaces",
          description:
            "Deploying into circular-economy marketplaces with at least $3M ARR and proven unit economics. Cheque size $10-25M.",
          confidence: 1,
        },
      ],
    },
    seedAssessment: {
      reasoning: "Both parties are focused on circular-economy construction materials.",
      valencyRole: "patient",
    },
  },
  {
    id: "low/query-satisfied-but-unusable",
    value: "low",
    rationale:
      "The discovery query IS satisfied by identity — the counterparty really is an investor — but their thesis and geography make the match unusable. This is the direct test of the necessary-not-sufficient query rule: advocate treats query satisfaction as a mandate to connect.",
    networkPrompt: "Climate capital network",
    discoveryQuery: "climate hardware investors",
    source: {
      id: "u-src",
      profile: {
        name: "Alice",
        bio: "Founder of a direct-air-capture hardware startup with a working pilot unit, based in Berlin.",
        skills: ["hardware", "carbon capture", "fundraising"],
      },
      intents: [
        {
          id: "i-src",
          title: "Raise a Series A for climate hardware",
          description:
            "Raising a $12M Series A to move our direct-air-capture unit from pilot to first commercial deployment.",
          confidence: 1,
        },
      ],
    },
    candidate: {
      id: "u-cand",
      profile: {
        name: "Bob",
        bio: "Angel investor in climate technology. Writes $25k cheques, exclusively into pre-seed software companies incorporated in Singapore.",
        skills: ["angel investing", "climate", "software"],
      },
      intents: [
        {
          id: "i-cand",
          title: "Back pre-seed climate software founders in Singapore",
          description:
            "I write $25k pre-seed cheques into Singapore-incorporated climate software companies. I do not invest in hardware and I do not invest outside Singapore.",
          confidence: 1,
        },
      ],
    },
    seedAssessment: {
      reasoning: "The counterparty is a climate investor and the search query was for climate hardware investors.",
      valencyRole: "patient",
    },
  },
];
