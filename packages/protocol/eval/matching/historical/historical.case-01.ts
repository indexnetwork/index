import type { HistoricalClaim } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { defineHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";

const NETWORK_ID = "h1-housewares";

const source = {
  bio: "Engineering-trained manufacturer with metal-fabrication experience seeking modern household products suitable for scaled production and a broad consumer market.",
  location: "North America",
  interests: ["modern household products", "industrial production", "consumer design"],
  skills: ["engineering management", "metal fabrication", "product commercialization"],
  intent: "Find original household-product designs that can be adapted for reliable industrial production and a broad consumer market.",
} as const;

const partner = {
  bio: "European sculptor and product designer trained in metal craft who had created a hand-forged functional household prototype before first contact.",
  location: "Europe",
  interests: ["functional household objects", "sculptural product design", "material experimentation"],
  skills: ["product design", "metal craft", "prototype making", "material combination"],
  intent: "Develop functional household objects that combine sculptural form, traditional craft, and practical daily use.",
} as const;

const description = "An engineering-trained manufacturer seeking modern household products is paired with a sculptor-product designer whose existing prototype and craft expertise can anchor scaled production.";

const semanticNegatives = {
  "h1-c": "Same-side retail and market operator lacks original product-design capability.",
  "h1-d": "Print and graphic designer lacks three-dimensional household-product and material-prototype capability.",
  "h1-e": "One-off sculptural craft practitioner lacks functional-product and repeatable-production orientation.",
} as const;

const syntheticProfiles = [
  {
    userId: "h1-c",
    bio: "Retail assortment manager experienced in consumer markets but unable to create original product designs.",
    location: "North America",
    interests: ["consumer markets", "retail assortment"],
    skills: ["market analysis", "retail operations"],
    intent: "Find finished household products to distribute without contributing original product-design capability.",
  },
  {
    userId: "h1-d",
    bio: "Print and graphic designer focused on two-dimensional visual communication rather than household-product prototypes.",
    location: "Europe",
    interests: ["print design", "visual identity"],
    skills: ["graphic composition", "print production"],
    intent: "Create visual materials without designing three-dimensional household products or material prototypes.",
  },
  {
    userId: "h1-e",
    bio: "Sculptural craft practitioner producing one-off decorative objects without a functional or repeatable-production focus.",
    location: "Europe",
    interests: ["decorative sculpture", "craft materials"],
    skills: ["sculptural craft", "one-off fabrication"],
    intent: "Produce singular decorative objects rather than functional products designed for repeatable production.",
  },
] as const;

const claims: HistoricalClaim[] = [
  {
    kind: "historical",
    id: "fact-nierenberg-background",
    text: "Before first contact, Ted Nierenberg was trained in engineering management and had worked in his family's metal-fabrication business.",
    citationIds: ["latimes-nierenberg-obituary"],
    preConnection: true,
  },
  {
    kind: "historical",
    id: "fact-nierenberg-search",
    text: "Before first contact, the Nierenbergs were seeking European design for the broad United States home-goods market.",
    citationIds: ["new-yorker-dansk-history", "latimes-nierenberg-obituary"],
    preConnection: true,
  },
  {
    kind: "historical",
    id: "fact-quistgaard-craft",
    text: "Before first contact, Jens Quistgaard was a sculptor's son who had apprenticed in metal craft and worked as a product designer.",
    citationIds: ["new-yorker-dansk-history", "latimes-nierenberg-obituary"],
    preConnection: true,
  },
  {
    kind: "historical",
    id: "fact-quistgaard-prototype",
    text: "Before first contact, Jens Quistgaard had created a hand-forged functional household prototype combining materials.",
    citationIds: ["latimes-nierenberg-obituary", "moma-quistgaard-1953"],
    preConnection: true,
  },
  {
    kind: "derived",
    id: "model-description",
    text: description,
    basisClaimIds: ["fact-nierenberg-background", "fact-nierenberg-search", "fact-quistgaard-craft", "fact-quistgaard-prototype"],
    rationale: "Generalizes the documented pre-contact manufacturer need and designer capability without names, places, or outcome details.",
  },
  {
    kind: "derived",
    id: "model-source-bio",
    text: source.bio,
    basisClaimIds: ["fact-nierenberg-background", "fact-nierenberg-search"],
    rationale: "Generalizes the documented engineering, manufacturing, sourcing, and consumer-market facts.",
  },
  {
    kind: "derived",
    id: "model-source-location",
    text: source.location,
    basisClaimIds: ["fact-nierenberg-search"],
    rationale: "Generalizes the documented American market context to a continent.",
  },
  ...[
    ["model-source-interest-products", source.interests[0]],
    ["model-source-interest-production", source.interests[1]],
    ["model-source-interest-design", source.interests[2]],
    ["model-source-skill-management", source.skills[0]],
    ["model-source-skill-fabrication", source.skills[1]],
    ["model-source-skill-commercialization", source.skills[2]],
    ["model-source-intent", source.intent],
  ].map(([id, text]) => ({
    kind: "derived" as const,
    id: id!,
    text: text!,
    basisClaimIds: ["fact-nierenberg-background", "fact-nierenberg-search"],
    rationale: "Conservative abstraction of the documented pre-contact manufacturing background and design-sourcing objective.",
  })),
  {
    kind: "derived",
    id: "model-partner-bio",
    text: partner.bio,
    basisClaimIds: ["fact-quistgaard-craft", "fact-quistgaard-prototype"],
    rationale: "Generalizes the documented pre-contact craft training, product-design role, and existing prototype.",
  },
  {
    kind: "derived",
    id: "model-partner-location",
    text: partner.location,
    basisClaimIds: ["fact-quistgaard-craft"],
    rationale: "Generalizes the documented European design-sourcing context.",
  },
  ...[
    ["model-partner-interest-functional", partner.interests[0]],
    ["model-partner-interest-sculptural", partner.interests[1]],
    ["model-partner-interest-materials", partner.interests[2]],
    ["model-partner-skill-design", partner.skills[0]],
    ["model-partner-skill-craft", partner.skills[1]],
    ["model-partner-skill-prototype", partner.skills[2]],
    ["model-partner-skill-combination", partner.skills[3]],
    ["model-partner-intent", partner.intent],
  ].map(([id, text]) => ({
    kind: "derived" as const,
    id: id!,
    text: text!,
    basisClaimIds: ["fact-quistgaard-craft", "fact-quistgaard-prototype"],
    rationale: "Conservative abstraction of the documented pre-contact design, craft, and prototype evidence.",
  })),
  {
    kind: "derived",
    id: "model-network-context",
    text: "A household-product setting connecting industrial manufacturing with original design, craft, and prototype expertise.",
    basisClaimIds: ["fact-nierenberg-background", "fact-nierenberg-search", "fact-quistgaard-craft", "fact-quistgaard-prototype"],
    rationale: "Describes only the broad pre-contact capability setting.",
  },
  ...syntheticProfiles.flatMap((profile) => {
    const reason = semanticNegatives[profile.userId];
    return [
      ["bio", profile.bio],
      ["location", profile.location],
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
        ragScore: 92,
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
        ragScore: [78, 69, 63][index],
      })),
    ],
    networkContexts: {
      [NETWORK_ID]: "A household-product setting connecting industrial manufacturing with original design, craft, and prototype expertise.",
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
        description: "Immediately before Ted and Martha Nierenberg first contacted and met Jens Quistgaard during their 1954 European design-sourcing trip.",
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
      "/input/entities/0/profile/location": ["model-source-location"],
      "/input/entities/0/profile/interests/0": ["model-source-interest-products"],
      "/input/entities/0/profile/interests/1": ["model-source-interest-production"],
      "/input/entities/0/profile/interests/2": ["model-source-interest-design"],
      "/input/entities/0/profile/skills/0": ["model-source-skill-management"],
      "/input/entities/0/profile/skills/1": ["model-source-skill-fabrication"],
      "/input/entities/0/profile/skills/2": ["model-source-skill-commercialization"],
      "/input/entities/0/intents/0/payload": ["model-source-intent"],
      "/input/entities/1/profile/bio": ["model-partner-bio"],
      "/input/entities/1/profile/location": ["model-partner-location"],
      "/input/entities/1/profile/interests/0": ["model-partner-interest-functional"],
      "/input/entities/1/profile/interests/1": ["model-partner-interest-sculptural"],
      "/input/entities/1/profile/interests/2": ["model-partner-interest-materials"],
      "/input/entities/1/profile/skills/0": ["model-partner-skill-design"],
      "/input/entities/1/profile/skills/1": ["model-partner-skill-craft"],
      "/input/entities/1/profile/skills/2": ["model-partner-skill-prototype"],
      "/input/entities/1/profile/skills/3": ["model-partner-skill-combination"],
      "/input/entities/1/intents/0/payload": ["model-partner-intent"],
      ...Object.fromEntries(syntheticProfiles.flatMap((profile, index) => [
        [`/input/entities/${index + 2}/profile/bio`, [`${profile.userId}-bio`]],
        [`/input/entities/${index + 2}/profile/location`, [`${profile.userId}-location`]],
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
