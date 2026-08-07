import type { HistoricalClaim } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { defineHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";

const NETWORK_ID = "h1-housewares";

const source = {
  bio: "Engineering-management graduate who had run a family manufacturing business and was participating with his spouse in their joint search for European home-goods design.",
  location: "",
  interests: ["European design in a joint home-goods search", "United States home-goods market in a joint design search"],
  skills: ["engineering management", "manufacturing operations"],
  intent: "Participate with a spouse in their joint search for European design for the United States home-goods market.",
} as const;

const partner = {
  bio: "Product designer and son of a sculptor who had apprenticed with his father.",
  location: "",
  interests: ["product design"],
  skills: ["product design", "apprenticeship with a sculptor father"],
  intent: "Work as a product designer after apprenticing with a sculptor father.",
} as const;

const description = "An engineering-management graduate participating in a joint search for European home-goods design is paired with a product designer who apprenticed with a sculptor father.";

const semanticNegatives = {
  "h1-c": "Retail buying and supplier sourcing do not establish original product-design experience.",
  "h1-d": "Packaging and identity work do not establish three-dimensional product-design experience.",
  "h1-e": "A gallery-oriented ceramic practice does not establish professional product-design experience.",
} as const;

const syntheticProfiles = [
  {
    userId: "h1-c",
    bio: "Housewares retail buyer who curates contemporary product assortments for national stores.",
    location: "",
    interests: ["modern housewares", "consumer preferences"],
    skills: ["supplier sourcing", "retail merchandising"],
    intent: "Source a distinctive European-designed household collection for a national retail assortment.",
  },
  {
    userId: "h1-d",
    bio: "Multidisciplinary visual designer who develops packaging systems and brand identities for household-product companies.",
    location: "",
    interests: ["packaging design", "visual identity"],
    skills: ["graphic design", "print production"],
    intent: "Develop a visual identity and packaging system for a new household-products collection.",
  },
  {
    userId: "h1-e",
    bio: "Studio sculptor whose practice includes small functional ceramic objects and commissioned exhibition pieces.",
    location: "",
    interests: ["functional ceramics", "sculptural form"],
    skills: ["ceramic forming", "studio fabrication"],
    intent: "Develop a cohesive collection of sculptural ceramic table objects for galleries and specialty shops.",
  },
] as const;

const claims: HistoricalClaim[] = [
  {
    kind: "historical",
    id: "fact-nierenberg-background",
    text: "Before the documented telephone contact, Ted Nierenberg had earned a bachelor's degree in engineering management and had run his family's metal-fabrication business with his brother.",
    citationIds: ["latimes-nierenberg-obituary"],
    preConnection: true,
  },
  {
    kind: "historical",
    id: "fact-nierenberg-search",
    text: "Before the documented telephone contact, Ted Nierenberg was participating with Martha Nierenberg in their joint search for European design for the United States home-goods market.",
    citationIds: ["new-yorker-dansk-history"],
    preConnection: true,
  },
  {
    kind: "historical",
    id: "fact-quistgaard-craft",
    text: "Before the documented telephone contact, Jens Quistgaard was a sculptor's son, had apprenticed with his father, and worked as a product designer.",
    citationIds: ["new-yorker-dansk-history", "latimes-nierenberg-obituary"],
    preConnection: true,
  },
  {
    kind: "derived",
    id: "model-description",
    text: description,
    basisClaimIds: ["fact-nierenberg-background", "fact-nierenberg-search", "fact-quistgaard-craft"],
    rationale: "Restates the documented engineering-management background, participation in the joint design search, and product-design apprenticeship facts.",
  },
  {
    kind: "derived",
    id: "model-source-bio",
    text: source.bio,
    basisClaimIds: ["fact-nierenberg-background", "fact-nierenberg-search"],
    rationale: "Restates the documented degree, family-business work, and participation with his spouse in their joint search.",
  },
  ...[
    ["model-source-interest-design", source.interests[0], ["fact-nierenberg-search"]],
    ["model-source-interest-market", source.interests[1], ["fact-nierenberg-search"]],
    ["model-source-skill-management", source.skills[0], ["fact-nierenberg-background"]],
    ["model-source-skill-manufacturing", source.skills[1], ["fact-nierenberg-background"]],
    ["model-source-intent", source.intent, ["fact-nierenberg-search"]],
  ].map(([id, text, basisClaimIds]) => ({
    kind: "derived" as const,
    id: id as string,
    text: text as string,
    basisClaimIds: basisClaimIds as string[],
    rationale: "Uses only the corresponding documented pre-telephone-contact background or joint-search fact.",
  })),
  {
    kind: "derived",
    id: "model-partner-bio",
    text: partner.bio,
    basisClaimIds: ["fact-quistgaard-craft"],
    rationale: "Restates the documented product-design role and apprenticeship with his sculptor father.",
  },
  ...[
    ["model-partner-interest-design", partner.interests[0]],
    ["model-partner-skill-design", partner.skills[0]],
    ["model-partner-skill-apprenticeship", partner.skills[1]],
    ["model-partner-intent", partner.intent],
  ].map(([id, text]) => ({
    kind: "derived" as const,
    id: id!,
    text: text!,
    basisClaimIds: ["fact-quistgaard-craft"],
    rationale: "Uses only the documented product-design role and apprenticeship with his sculptor father.",
  })),
  {
    kind: "derived",
    id: "model-network-context",
    text: "A home-goods design setting connecting engineering-management and manufacturing experience with product-design experience.",
    basisClaimIds: ["fact-nierenberg-background", "fact-nierenberg-search", "fact-quistgaard-craft"],
    rationale: "Restates only the documented market setting and participant backgrounds.",
  },
  ...syntheticProfiles.flatMap((profile) => {
    const reason = semanticNegatives[profile.userId];
    return [
      ["bio", profile.bio],
      ["interest-0", profile.interests[0]],
      ["interest-1", profile.interests[1]],
      ["skill-0", profile.skills[0]],
      ["skill-1", profile.skills[1]],
      ["intent", profile.intent],
    ].map(([suffix, text]) => ({
      kind: "authored" as const,
      id: `${profile.userId}-${suffix}`,
      text: text!,
      participantId: profile.userId,
      violatedRequirement: reason,
    }));
  }),
];

export const HISTORICAL_CASE_01 = defineHistoricalQualityCase({
  id: "historical/builder-and-operator",
  rule: "historical",
  tier: 3,
  domains: ["technology"],
  description,
  input: {
    discovererId: "h1-a",
    entities: [
      {
        userId: "h1-a",
        profile: { name: "(source user)", bio: source.bio, location: source.location, interests: [...source.interests], skills: [...source.skills] },
        intents: [{ intentId: "h1-a-1", payload: source.intent }],
        networkId: NETWORK_ID,
      },
      {
        userId: "h1-b",
        profile: { name: "Participant B", bio: partner.bio, location: partner.location, interests: [...partner.interests], skills: [...partner.skills] },
        intents: [{ intentId: "h1-b-1", payload: partner.intent }],
        networkId: NETWORK_ID,
        ragScore: 70,
      },
      ...syntheticProfiles.map((profile, index) => ({
        userId: profile.userId,
        profile: {
          name: `Participant ${String.fromCharCode(67 + index)}`,
          bio: profile.bio,
          location: profile.location,
          interests: [...profile.interests],
          skills: [...profile.skills],
        },
        intents: [{ intentId: `${profile.userId}-1`, payload: profile.intent }],
        networkId: NETWORK_ID,
        ragScore: 70,
      })),
    ],
    networkContexts: {
      [NETWORK_ID]: "A home-goods design setting connecting engineering-management and manufacturing experience with product-design experience.",
    },
  },
  expect: [
    { candidateId: "h1-b", match: true, scoreBand: [60, 100] },
    { candidateId: "h1-c", match: false, scoreBand: [0, 29] },
    { candidateId: "h1-d", match: false, scoreBand: [0, 29] },
    { candidateId: "h1-e", match: false, scoreBand: [0, 29] },
  ],
  reportNames: {
    "h1-a": "Ted Nierenberg",
    "h1-b": "Jens Quistgaard",
  },
  historicalQuality: {
    cutoff: {
      event: {
        id: "h1-nierenberg-quistgaard-first-contact",
        description: "Immediately before Ted and Martha Nierenberg telephoned Jens Quistgaard during their 1954 European design-sourcing trip.",
      },
      calendarProxy: { date: "1954", precision: "year" },
      confidence: "medium",
      uncertaintyRationale: "Independent accounts agree on first contact and company formation in 1954 but differ on the discovery location and do not establish an exact day.",
      exclusive: true,
      orderingCitationIds: ["new-yorker-dansk-history", "latimes-nierenberg-obituary"],
    },
    citations: [
      {
        id: "new-yorker-dansk-history",
        url: "https://www.newyorker.com/culture/cultural-comment/dansk-and-the-promise-of-a-simple-scandinavian-life",
        title: "Dansk and the Promise of a Simple Scandinavian Life",
        publisher: "The New Yorker",
        excerpt: "In 1954, the Nierenbergs—Ted, an American entrepreneur; Martha, a biochemist and Hungarian Jewish refugee—were on a delayed honeymoon in Europe, seeking European design that might appeal to the burgeoning U.S. market for home goods. … They called him right from the center … the Nierenbergs showed up on his doorstep. ‘And that was the start of Dansk Designs. That afternoon,’ he told Guldberg. … He was the son of a sculptor, and he had dropped out of school and apprenticed with his father.",
      },
      {
        id: "latimes-nierenberg-obituary",
        url: "https://www.latimes.com/local/obituaries/la-me-theodore-nierenberg5-2009aug05-story.html",
        title: "Theodore D. Nierenberg dies at 86; founder of Dansk",
        publisher: "Los Angeles Times",
        excerpt: "Trained as an engineer, Nierenberg was visiting a Copenhagen museum in 1954 when he spotted hand-forged stainless steel flatware with teak handles, then an unusual combination. He tracked down its Danish designer, Jens Quistgaard, on a farm and convinced him it could be mass-produced. … In 1944, he earned a bachelor’s in engineering management from what is now Carnegie Mellon University. With a brother, he ran the family’s metal-fabrication business but started traveling the world, looking to do something ‘he could be proud of and enjoy.’",
      },
      {
        id: "moma-quistgaard-1953",
        url: "https://www.moma.org/collection/works/1190",
        title: "Jens H. Quistgaard. Fjord Flatware. 1953",
        publisher: "The Museum of Modern Art",
        excerpt: "Jens H. Quistgaard. Fjord Flatware. 1953.",
      },
      {
        id: "cooper-hewitt-quistgaard",
        url: "https://collection.cooperhewitt.org/people/18044007/",
        title: "Jens H. Quistgaard",
        publisher: "Cooper Hewitt, Smithsonian Design Museum",
        excerpt: "We have 40 objects that Jens H. Quistgaard has been involved with. … Jens H. Quistgaard has related object(s) with Dansk International Designs, Ltd.",
      },
    ],
    claims,
    claimProvenance: {
      "/description": ["model-description"],
      "/input/entities/0/profile/bio": ["model-source-bio"],
      "/input/entities/0/profile/interests/0": ["model-source-interest-design"],
      "/input/entities/0/profile/interests/1": ["model-source-interest-market"],
      "/input/entities/0/profile/skills/0": ["model-source-skill-management"],
      "/input/entities/0/profile/skills/1": ["model-source-skill-manufacturing"],
      "/input/entities/0/intents/0/payload": ["model-source-intent"],
      "/input/entities/1/profile/bio": ["model-partner-bio"],
      "/input/entities/1/profile/interests/0": ["model-partner-interest-design"],
      "/input/entities/1/profile/skills/0": ["model-partner-skill-design"],
      "/input/entities/1/profile/skills/1": ["model-partner-skill-apprenticeship"],
      "/input/entities/1/intents/0/payload": ["model-partner-intent"],
      ...Object.fromEntries(syntheticProfiles.flatMap((profile, index) => [
        [`/input/entities/${index + 2}/profile/bio`, [`${profile.userId}-bio`]],
        [`/input/entities/${index + 2}/profile/interests/0`, [`${profile.userId}-interest-0`]],
        [`/input/entities/${index + 2}/profile/interests/1`, [`${profile.userId}-interest-1`]],
        [`/input/entities/${index + 2}/profile/skills/0`, [`${profile.userId}-skill-0`]],
        [`/input/entities/${index + 2}/profile/skills/1`, [`${profile.userId}-skill-1`]],
        [`/input/entities/${index + 2}/intents/0/payload`, [`${profile.userId}-intent`]],
      ])),
      "/input/networkContexts/h1-housewares": ["model-network-context"],
      "/triggerInputs/intent/text": ["model-source-intent"],
      "/triggerInputs/enrichment/premises/0": ["model-source-bio"],
      "/triggerInputs/enrichment/premises/1": ["model-source-intent"],
      "/triggerInputs/enrichment/userContext": ["model-source-bio"],
    },
    participantKinds: {
      "h1-a": "historical",
      "h1-b": "historical",
      "h1-c": "synthetic",
      "h1-d": "synthetic",
      "h1-e": "synthetic",
    },
    outcomeCitationIds: ["cooper-hewitt-quistgaard"],
    anonymizationReview: {
      reviewer: "independent-review-pending",
      reviewedAt: "2026-08-06",
      recognizability: "medium",
      decision: "pending",
      rationale: "Pending independent verification of first-contact chronology, field-level provenance, combination leakage, and exact matching, matrix, and seed serializations.",
    },
    semanticNegatives: { ...semanticNegatives },
    triggerInputs: {
      intent: { text: source.intent },
      enrichment: { premises: [source.bio, source.intent], userContext: source.bio },
    },
  },
});
