import type { DiscoveryRetrievalCase } from "./discovery-retrieval.types.js";

/**
 * Frozen Tier-1 paired corpus for premise versus user-context retrieval.
 * Candidate identities and representations are fictional and deliberately fixed.
 */
export const CASES: DiscoveryRetrievalCase[] = [
  {
    id: "complementary-role/hardware-founder-supply-chain-operator",
    rule: "complementary_role",
    tier: 1,
    description: "A hardware founder should retrieve a complementary supply-chain operator, not another founder.",
    source: {
      intent: "Find an experienced supply-chain operator to help launch a low-volume climate hardware company.",
      userContext: "I am founding a climate hardware company and need an operator who has launched physical products and managed suppliers.",
    },
    candidates: [
      {
        userId: "candidate-operator",
        displayName: "Mira Patel",
        premises: ["Led supplier selection and contract manufacturing for battery products.", "Built operations teams for low-volume hardware launches."],
        userContext: "Operations leader for climate hardware who manages suppliers, contract manufacturing, and early product launches.",
      },
      {
        userId: "candidate-founder",
        displayName: "Evan Ross",
        premises: ["Founded a carbon-accounting software company.", "Raises seed rounds for climate startups."],
        userContext: "Climate software founder focused on fundraising and carbon-accounting products.",
      },
      {
        userId: "candidate-investor",
        displayName: "Noor Chen",
        premises: ["Invests in electrification startups.", "Advises on venture financing."],
        userContext: "Early-stage climate investor specializing in electrification and venture finance.",
      },
    ],
    expect: {
      expectedUserIds: ["candidate-operator"],
      excludedUserIds: ["candidate-founder"],
      topK: 2,
      maxExpectedRank: 2,
      reasoningCriteria: "The result must prioritize a supply-chain operator complementary to the founder and avoid treating another founder as the requested operator.",
    },
  },
  {
    id: "same-side-exclusion/founder-seeking-seed-investor",
    rule: "same_side_exclusion",
    tier: 1,
    description: "A founder seeking capital should retrieve an investor and exclude a superficially relevant fellow founder.",
    source: {
      intent: "Meet a seed investor who backs developer tools companies before product-market fit.",
      userContext: "I am a developer-tools founder preparing a pre-product-market-fit seed round and need an investor partner.",
    },
    candidates: [
      {
        userId: "candidate-seed-investor",
        displayName: "Leah Kim",
        premises: ["Leads pre-seed and seed investments in developer infrastructure.", "Works with founders before product-market fit."],
        userContext: "Seed investor focused on developer infrastructure and developer tools before product-market fit.",
      },
      {
        userId: "candidate-devtools-founder",
        displayName: "Omar Diaz",
        premises: ["Founded a developer-tools company.", "Is also raising a seed round."],
        userContext: "Developer-tools founder currently raising seed capital for an infrastructure product.",
      },
      {
        userId: "candidate-engineer",
        displayName: "June Park",
        premises: ["Builds observability platforms.", "Mentors early engineering teams."],
        userContext: "Staff engineer and mentor for observability and infrastructure teams.",
      },
    ],
    expect: {
      expectedUserIds: ["candidate-seed-investor"],
      excludedUserIds: ["candidate-devtools-founder"],
      topK: 2,
      maxExpectedRank: 2,
      reasoningCriteria: "The result must identify an investor rather than matching the source with another founder who is on the same fundraising side.",
    },
  },
  {
    id: "location-constraint/berlin-climate-engineer",
    rule: "location_constraint",
    tier: 1,
    description: "A Berlin-specific request should favor the qualified Berlin candidate over a similar remote candidate.",
    source: {
      intent: "Connect me with a Berlin-based machine-learning engineer working on grid flexibility.",
      userContext: "I am building a Berlin climate-tech team and need a local machine-learning engineer for grid flexibility.",
    },
    candidates: [
      {
        userId: "candidate-berlin-engineer",
        displayName: "Tobias Werner",
        premises: ["Machine-learning engineer based in Berlin.", "Builds forecasting systems for grid flexibility."],
        userContext: "Berlin-based machine-learning engineer developing grid-flexibility forecasting systems.",
      },
      {
        userId: "candidate-london-engineer",
        displayName: "Amara Singh",
        premises: ["Machine-learning engineer based in London.", "Builds forecasting systems for electricity demand."],
        userContext: "London machine-learning engineer working on electricity-demand forecasting and grid analytics.",
      },
      {
        userId: "candidate-berlin-designer",
        displayName: "Felix Hart",
        premises: ["Product designer based in Berlin.", "Works on energy consumer apps."],
        userContext: "Berlin product designer for consumer energy applications.",
      },
    ],
    expect: {
      expectedUserIds: ["candidate-berlin-engineer"],
      excludedUserIds: ["candidate-london-engineer"],
      topK: 2,
      maxExpectedRank: 2,
      reasoningCriteria: "The result must satisfy both the Berlin location and machine-learning grid-flexibility role constraints.",
    },
  },
  {
    id: "organization-constraint/open-source-foundation-product-lead",
    rule: "organization_constraint",
    tier: 1,
    description: "An organization-specific request should retrieve the person at the named foundation, not a similar role elsewhere.",
    source: {
      intent: "Find a product lead at the Open Source Climate Foundation to discuss interoperable emissions data.",
      userContext: "I need a product counterpart at the Open Source Climate Foundation for an emissions-data interoperability project.",
    },
    candidates: [
      {
        userId: "candidate-foundation-lead",
        displayName: "Rina Cole",
        premises: ["Product lead at the Open Source Climate Foundation.", "Maintains interoperable emissions-data standards."],
        userContext: "Product lead at the Open Source Climate Foundation working on interoperable emissions-data standards.",
      },
      {
        userId: "candidate-consultancy-lead",
        displayName: "Mateo Silva",
        premises: ["Product lead at a climate-data consultancy.", "Designs emissions-data integrations."],
        userContext: "Climate-data consultancy product lead who designs emissions-data integrations for clients.",
      },
      {
        userId: "candidate-foundation-researcher",
        displayName: "Ivy Brooks",
        premises: ["Researcher at the Open Source Climate Foundation.", "Studies carbon-accounting methods."],
        userContext: "Researcher at the Open Source Climate Foundation studying carbon-accounting methods.",
      },
    ],
    expect: {
      expectedUserIds: ["candidate-foundation-lead"],
      excludedUserIds: ["candidate-consultancy-lead"],
      topK: 2,
      maxExpectedRank: 2,
      reasoningCriteria: "The result must match both the Open Source Climate Foundation affiliation and the product-lead role.",
    },
  },
  {
    id: "compressed-context/community-energy-partner",
    rule: "compressed_context",
    tier: 1,
    description: "A compressed user context should preserve a candidate's cross-premise community-energy fit.",
    source: {
      intent: "Meet someone who can partner on community-owned solar financing and local utility coordination.",
      userContext: "I am organizing a community-owned solar project and need a partner who combines financing knowledge with local utility coordination.",
    },
    candidates: [
      {
        userId: "candidate-community-energy",
        displayName: "Sana Malik",
        premises: ["Structured financing for community-owned solar cooperatives.", "Coordinates interconnection work with municipal utilities."],
        userContext: "Community-energy operator combining cooperative solar finance with municipal utility coordination.",
      },
      {
        userId: "candidate-solar-finance",
        displayName: "Caleb Moore",
        premises: ["Finances commercial solar projects.", "Advises institutional infrastructure funds."],
        userContext: "Commercial solar finance adviser for institutional infrastructure investors.",
      },
      {
        userId: "candidate-utility-policy",
        displayName: "Yuki Tan",
        premises: ["Works on utility regulation.", "Researches municipal energy policy."],
        userContext: "Utility-policy researcher focused on municipal energy regulation.",
      },
    ],
    expect: {
      expectedUserIds: ["candidate-community-energy"],
      excludedUserIds: ["candidate-solar-finance"],
      topK: 2,
      maxExpectedRank: 2,
      reasoningCriteria: "The result must preserve the combined community-solar finance and local-utility coordination relationship, not only one topic.",
    },
  },
  {
    id: "premise-distractor/biotech-lab-automation",
    rule: "premise_distractor",
    tier: 1,
    description: "A superficially similar automation premise must not outrank the domain-specific lab-automation candidate.",
    source: {
      intent: "Connect me with an engineer who has automated wet-lab workflows for synthetic biology teams.",
      userContext: "I run a synthetic biology team and need an engineer experienced in wet-lab automation, robotics, and experimental workflows.",
    },
    candidates: [
      {
        userId: "candidate-lab-automation",
        displayName: "Priya Shah",
        premises: ["Built liquid-handling robotics for synthetic biology laboratories.", "Automated experimental workflows for wet-lab research teams."],
        userContext: "Engineer for synthetic biology labs specializing in liquid-handling robotics and wet-lab workflow automation.",
      },
      {
        userId: "candidate-office-automation",
        displayName: "Drew Allen",
        premises: ["Automates workflows with robotics software for back-office teams.", "Builds automation dashboards for operations departments."],
        userContext: "Workflow automation engineer for back-office operations and business-process dashboards.",
      },
      {
        userId: "candidate-biologist",
        displayName: "Lina Okoro",
        premises: ["Synthetic biology researcher.", "Designs microbial experiments."],
        userContext: "Synthetic biology researcher designing microbial experiments without laboratory automation engineering experience.",
      },
    ],
    expect: {
      expectedUserIds: ["candidate-lab-automation"],
      excludedUserIds: ["candidate-office-automation"],
      topK: 2,
      maxExpectedRank: 2,
      reasoningCriteria: "The result must distinguish wet-lab synthetic-biology automation from superficially similar back-office workflow automation.",
    },
  },
];

/** Validate the frozen corpus before a live retrieval run. */
export function validateCorpus(cases: DiscoveryRetrievalCase[]): void {
  if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error("Duplicate retrieval eval case id");

  for (const c of cases) {
    if (c.tier !== 1) throw new Error(`${c.id}: initial corpus must be Tier 1`);
    if (c.candidates.some((p) => p.premises.length === 0 || !p.userContext.trim())) {
      throw new Error(`${c.id}: every candidate needs premises and userContext`);
    }
    for (const id of [...c.expect.expectedUserIds, ...c.expect.excludedUserIds]) {
      if (!c.candidates.some((p) => p.userId === id)) throw new Error(`${c.id}: expectedUserIds/excludedUserIds entry ${id} is not in candidates`);
    }
    if (c.expect.topK < 1 || c.expect.maxExpectedRank < 1 || c.expect.maxExpectedRank > c.expect.topK) {
      throw new Error(`${c.id}: invalid rank expectations`);
    }
    if (c.expect.excludedUserIds.length > 0 && c.expect.topK >= c.candidates.length) {
      throw new Error(`${c.id}: topK must be smaller than the candidate pool when exclusions are required`);
    }
  }
}
