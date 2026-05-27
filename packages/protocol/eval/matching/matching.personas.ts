import type { EvaluatorEntity } from "../../src/opportunity/opportunity.evaluator.js";

const NETWORK = "idx-commons";

/** Build an entity with sensible defaults; override any field. */
export function persona(
  userId: string,
  profile: EvaluatorEntity["profile"],
  extra: Partial<Omit<EvaluatorEntity, "userId" | "profile">> = {},
): EvaluatorEntity {
  return { userId, profile, networkId: NETWORK, ...extra };
}

/** A realistic, reusable contemporary persona pool for Tier-2 cases. */
export const POOL = {
  technicalCofounder: persona(
    "p-tech-cofounder",
    {
      name: "Maya Chen",
      bio: "Staff ML engineer, ex-Stripe. Built recommendation and fraud systems at scale. Wants to start a company.",
      location: "San Francisco, CA",
      interests: ["machine learning", "fraud detection", "startups"],
      skills: ["Python", "distributed systems", "ML infrastructure"],
    },
    {
      intents: [{ intentId: "p-tech-1", payload: "Looking to co-found a company as the technical founder with a strong commercial partner." }],
    },
  ),
  designer: persona("p-designer", {
    name: "Liam O'Brien",
    bio: "Product designer focused on consumer fintech. Led design at two seed-stage startups.",
    location: "New York, NY",
    interests: ["product design", "fintech", "typography"],
    skills: ["UX", "design systems", "prototyping"],
  }),
  vcInvestor: persona(
    "p-vc",
    {
      name: "Priya Nair",
      bio: "Partner at a seed fund. Writes first checks into developer tools and infra. Former founder (acquired).",
      location: "San Francisco, CA",
      interests: ["developer tools", "infrastructure", "seed investing"],
      skills: ["due diligence", "fundraising", "board work"],
    },
    {
      intents: [{ intentId: "p-vc-1", payload: "Want to meet technical founders building developer infrastructure at pre-seed." }],
    },
  ),
  researcher: persona("p-researcher", {
    name: "Dr. Tomás Herrera",
    bio: "NLP researcher, publishes on retrieval and evaluation. Currently academic, open to industry collaboration.",
    location: "Remote",
    interests: ["NLP", "information retrieval", "evaluation"],
    skills: ["research", "PyTorch", "experiment design"],
  }),
  operator: persona("p-operator", {
    name: "Grace Kim",
    bio: "Two-time GTM lead. Scaled revenue orgs from zero to Series B. Not technical.",
    location: "Austin, TX",
    interests: ["go-to-market", "sales", "operations"],
    skills: ["GTM strategy", "hiring", "revenue ops"],
  }),
} satisfies Record<string, EvaluatorEntity>;
