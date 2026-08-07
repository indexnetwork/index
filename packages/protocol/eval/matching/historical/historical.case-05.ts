import type { HistoricalClaim } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { defineHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";

const NETWORK_ID = "h5-biomed";

const source = {
  bio: "Physician-scientist trained in immune and microbial research who studied antigen-presenting cells in viral disease and investigated ways to load those cells with antigen for vaccine research.",
  location: "U.S. East Coast",
  interests: ["antigen-presenting cells", "infectious disease", "vaccine research"],
  skills: ["clinical medicine", "immunology", "microbiology", "cellular immune methods"],
  intent: "Find a molecular researcher who can prepare an antigen-encoding RNA payload for evaluation in antigen-presenting cells.",
} as const;

const partner = {
  bio: "Biochemist experienced in producing laboratory-made nucleic acids encoding therapeutic proteins and testing their expression in cells.",
  location: "U.S. East Coast",
  interests: ["nucleic-acid biology", "therapeutic protein research", "experimental methods"],
  skills: ["biochemistry", "nucleic-acid production", "laboratory transcription", "cell-based expression studies"],
  intent: "Develop laboratory-produced nucleic acids for therapeutic protein expression in cell-based experiments.",
} as const;

const description = "A vaccine-focused immunologist who needs an antigen-encoding RNA payload is paired with a biochemist experienced in producing therapeutic-protein nucleic acids.";

const semanticNegatives = {
  "h5-c": "Same-side vaccine immunologist also lacks the required RNA preparation capability.",
  "h5-d": "Computational RNA analyst lacks wet-lab nucleic-acid production and cell-expression capability.",
  "h5-e": "Plant RNA researcher works in the wrong biological domain for human antigen-delivery research.",
} as const;

const syntheticProfiles = [
  {
    userId: "h5-c",
    bio: "Vaccine immunologist studying antigen-presenting cells but unable to prepare RNA payloads.",
    location: "U.S. East Coast",
    interests: ["vaccine immunology", "antigen-presenting cells"],
    skills: ["immunology", "cellular immune assays"],
    intent: "Find a collaborator who can prepare antigen-encoding RNA for cell-based evaluation.",
  },
  {
    userId: "h5-d",
    bio: "Computational RNA analyst who models sequence data without wet-lab nucleic-acid production or cell-expression practice.",
    location: "U.S. East Coast",
    interests: ["RNA analytics", "computational biology"],
    skills: ["sequence analysis", "statistical modeling"],
    intent: "Analyze RNA sequences computationally without producing nucleic acids or testing expression in cells.",
  },
  {
    userId: "h5-e",
    bio: "Plant RNA researcher studying crop cells rather than human antigen-delivery systems.",
    location: "U.S. East Coast",
    interests: ["plant RNA", "crop biology"],
    skills: ["plant molecular biology", "plant cell methods"],
    intent: "Study RNA processes in plants rather than prepare payloads for human antigen-delivery research.",
  },
] as const;

const claims: HistoricalClaim[] = [
  {
    kind: "historical",
    id: "fact-weissman-training",
    text: "Before meeting Karikó, Drew Weissman completed medical, immunology, microbiology, clinical, and federal research training.",
    citationIds: ["nobel-medicine-2023-press-release", "nobel-medicine-2023-advanced-information"],
    preConnection: true,
  },
  {
    kind: "historical",
    id: "fact-weissman-cell-virus-work",
    text: "Before meeting Karikó, Weissman studied dendritic cells in viral disease and began vaccine research focused on loading those antigen-presenting cells with antigen.",
    citationIds: ["cell-persistent-progress"],
    preConnection: true,
  },
  {
    kind: "historical",
    id: "fact-weissman-rna-need",
    text: "Before meeting Karikó, Weissman needed RNA for his antigen-loading research but did not have access to it or know how to make it.",
    citationIds: ["cell-persistent-progress"],
    preConnection: true,
  },
  {
    kind: "historical",
    id: "fact-kariko-rna-goal",
    text: "Before meeting Weissman, Katalin Karikó was interested in making messenger RNA encoding therapeutic protein.",
    citationIds: ["cell-persistent-progress"],
    preConnection: true,
  },
  {
    kind: "historical",
    id: "fact-kariko-rna-methods",
    text: "Before meeting Weissman, Karikó's biochemistry work included laboratory transcription of nucleic acids and cell-based protein-expression studies.",
    citationIds: ["cell-persistent-progress", "nobel-medicine-2023-advanced-information"],
    preConnection: true,
  },
  {
    kind: "historical",
    id: "fact-pair-east-coast",
    text: "Both researchers held training or research positions on the U.S. East Coast before their collaboration.",
    citationIds: ["cell-persistent-progress", "nobel-medicine-2023-press-release"],
    preConnection: true,
  },
  {
    kind: "derived",
    id: "model-description",
    text: description,
    basisClaimIds: ["fact-weissman-cell-virus-work", "fact-weissman-rna-need", "fact-kariko-rna-goal", "fact-kariko-rna-methods"],
    rationale: "Generalizes the documented pre-connection seeker need and complementary laboratory capability without later joint findings or outcomes.",
  },
  {
    kind: "derived",
    id: "model-source-bio",
    text: source.bio,
    basisClaimIds: ["fact-weissman-training", "fact-weissman-cell-virus-work"],
    rationale: "Generalizes the documented training, antigen-presenting-cell, viral-disease, and vaccine-research facts.",
  },
  {
    kind: "derived",
    id: "model-source-location",
    text: source.location,
    basisClaimIds: ["fact-pair-east-coast"],
    rationale: "Generalizes documented pre-connection training and research locations to a broad region.",
  },
  ...[
    ["model-source-interest-cells", source.interests[0], ["fact-weissman-cell-virus-work"]],
    ["model-source-interest-disease", source.interests[1], ["fact-weissman-cell-virus-work"]],
    ["model-source-interest-vaccine", source.interests[2], ["fact-weissman-cell-virus-work"]],
    ["model-source-skill-clinical", source.skills[0], ["fact-weissman-training"]],
    ["model-source-skill-immunology", source.skills[1], ["fact-weissman-training", "fact-weissman-cell-virus-work"]],
    ["model-source-skill-microbiology", source.skills[2], ["fact-weissman-training"]],
    ["model-source-skill-cellular", source.skills[3], ["fact-weissman-cell-virus-work"]],
    ["model-source-intent", source.intent, ["fact-weissman-cell-virus-work", "fact-weissman-rna-need"]],
  ].map(([id, text, basisClaimIds]) => ({
    kind: "derived" as const,
    id: id as string,
    text: text as string,
    basisClaimIds: basisClaimIds as string[],
    rationale: "Conservative abstraction of Weissman's documented pre-connection training, research activity, and stated RNA need.",
  })),
  {
    kind: "derived",
    id: "model-partner-bio",
    text: partner.bio,
    basisClaimIds: ["fact-kariko-rna-goal", "fact-kariko-rna-methods"],
    rationale: "Generalizes the documented pre-connection biochemistry, nucleic-acid production, and cell-expression work.",
  },
  {
    kind: "derived",
    id: "model-partner-location",
    text: partner.location,
    basisClaimIds: ["fact-pair-east-coast"],
    rationale: "Generalizes documented pre-connection research positions to a broad region.",
  },
  ...[
    ["model-partner-interest-nucleic", partner.interests[0]],
    ["model-partner-interest-protein", partner.interests[1]],
    ["model-partner-interest-methods", partner.interests[2]],
    ["model-partner-skill-biochemistry", partner.skills[0]],
    ["model-partner-skill-production", partner.skills[1]],
    ["model-partner-skill-transcription", partner.skills[2]],
    ["model-partner-skill-expression", partner.skills[3]],
    ["model-partner-intent", partner.intent],
  ].map(([id, text]) => ({
    kind: "derived" as const,
    id: id!,
    text: text!,
    basisClaimIds: ["fact-kariko-rna-goal", "fact-kariko-rna-methods"],
    rationale: "Conservative abstraction of Karikó's documented pre-connection nucleic-acid production and cell-expression research.",
  })),
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

export const HISTORICAL_CASE_05 = defineHistoricalQualityCase({
  id: "historical/domain-expert-and-ml",
  rule: "historical",
  tier: 3,
  domains: ["research"],
  description,
  input: {
    discovererId: "h5-a",
    entities: [
      {
        userId: "h5-a",
        profile: { name: "(source user)", bio: source.bio, location: source.location, interests: [...source.interests], skills: [...source.skills] },
        intents: [{ intentId: "h5-a-1", payload: source.intent }],
        networkId: NETWORK_ID,
      },
      {
        userId: "h5-b",
        profile: { name: "Participant B", bio: partner.bio, location: partner.location, interests: [...partner.interests], skills: [...partner.skills] },
        intents: [{ intentId: "h5-b-1", payload: partner.intent }],
        networkId: NETWORK_ID,
        ragScore: 91,
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
        ragScore: [80, 70, 61][index],
      })),
    ],
  },
  expect: [
    { candidateId: "h5-b", match: true, scoreBand: [60, 100] },
    { candidateId: "h5-c", match: false, scoreBand: [0, 29] },
    { candidateId: "h5-d", match: false, scoreBand: [0, 29] },
    { candidateId: "h5-e", match: false, scoreBand: [0, 29] },
  ],
  reportNames: {
    "h5-a": "Drew Weissman",
    "h5-b": "Katalin Karikó",
  },
  historicalQuality: {
    cutoff: {
      event: {
        id: "h5-weissman-kariko-first-substantive-conversation",
        description: "Immediately before Drew Weissman and Katalin Karikó's first substantive conversation and joint work.",
      },
      calendarProxy: { date: "1997", precision: "year" },
      confidence: "medium",
      uncertaintyRationale: "First-person and institutional accounts place the encounter around 1997, one secondary account uses 1998, and no exact date is established.",
      exclusive: true,
      orderingCitationIds: ["cell-persistent-progress", "nobel-kariko-banquet-speech"],
    },
    citations: [
      {
        id: "nobel-kariko-banquet-speech",
        url: "https://www.nobelprize.org/prizes/medicine/2023/kariko/speech/",
        title: "Katalin Karikó – Banquet speech",
        publisher: "Nobel Foundation",
        excerpt: "The anecdote is true, we met at a xerox machine in the hallway of a Medical School building at the University of Pennsylvania in 1997. … Instead, Drew and I started to work together, shoulder-to-shoulder through many decades.",
      },
      {
        id: "cell-persistent-progress",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8462135/",
        title: "Persistent progress",
        publisher: "Cell",
        excerpt: "I did my fellowship at NIH in Tony Fauci’s lab. While I was there, I started a new research program studying dendritic cells and their role in HIV pathogenesis. … So when I came to Penn … the first thing I wanted to do was vaccine research. I started to investigate ways of loading dendritic cells with antigen … I didn’t have access to RNA, and I didn’t know how to make it, so I looked at everything else. And that’s when I met Kati … Katalin Karikó: I started at the University of Pennsylvania in ‘89 and started to get interested in making mRNA coding for therapeutic protein.",
      },
      {
        id: "nobel-medicine-2023-press-release",
        url: "https://www.nobelprize.org/prizes/medicine/2023/press-release/",
        title: "Press release: The Nobel Prize in Physiology or Medicine 2023",
        publisher: "Nobel Foundation",
        excerpt: "She then conducted postdoctoral research at Temple University, Philadelphia, and the University of Health Science, Bethesda. In 1989, she was appointed Assistant Professor at the University of Pennsylvania, where she remained until 2013. … He received his MD, PhD degrees from Boston University in 1987. He did his clinical training at Beth Israel Deaconess Medical Center at Harvard Medical School and postdoctoral research at the National Institutes of Health.",
      },
      {
        id: "nobel-medicine-2023-advanced-information",
        url: "https://www.nobelprize.org/prizes/medicine/2023/advanced-information/",
        title: "The Nobel Prize in Physiology or Medicine 2023 – Advanced information",
        publisher: "Nobel Foundation",
        excerpt: "Karikó had a strong drive to advance the mRNA platform and she systematically investigated different components of in vitro transcribed mRNA to identify requirements for optimal protein expression in cells and tissues. … Weissman had received his MD and PhD degrees from Boston University in immunology and microbiology in 1987. After a residency period at Beth Israel Deaconess Medical Center at Harvard Medical School in Boston, he joined Anthony Fauci’s group at the National Institutes of Health (NIH) for a post-doctoral fellowship to investigate how the human immunodeficiency virus type 1 (HIV-1) interacts with target receptors on different types of immune cells.",
      },
      {
        id: "pnas-kariko-weissman-profile",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10907315/",
        title: "Profile of Katalin Karikó and Drew Weissman: 2023 Nobel laureates in Physiology or Medicine",
        publisher: "Proceedings of the National Academy of Sciences",
        excerpt: "In summary, Katalin Karikó’s and Drew Weissman’s discoveries made it possible to develop COVID-19 mRNA vaccines, which saved millions of lives.",
      },
    ],
    claims,
    claimProvenance: {
      "/description": ["model-description"],
      "/input/entities/0/profile/bio": ["model-source-bio"],
      "/input/entities/0/profile/location": ["model-source-location"],
      "/input/entities/0/profile/interests/0": ["model-source-interest-cells"],
      "/input/entities/0/profile/interests/1": ["model-source-interest-disease"],
      "/input/entities/0/profile/interests/2": ["model-source-interest-vaccine"],
      "/input/entities/0/profile/skills/0": ["model-source-skill-clinical"],
      "/input/entities/0/profile/skills/1": ["model-source-skill-immunology"],
      "/input/entities/0/profile/skills/2": ["model-source-skill-microbiology"],
      "/input/entities/0/profile/skills/3": ["model-source-skill-cellular"],
      "/input/entities/0/intents/0/payload": ["model-source-intent"],
      "/input/entities/1/profile/bio": ["model-partner-bio"],
      "/input/entities/1/profile/location": ["model-partner-location"],
      "/input/entities/1/profile/interests/0": ["model-partner-interest-nucleic"],
      "/input/entities/1/profile/interests/1": ["model-partner-interest-protein"],
      "/input/entities/1/profile/interests/2": ["model-partner-interest-methods"],
      "/input/entities/1/profile/skills/0": ["model-partner-skill-biochemistry"],
      "/input/entities/1/profile/skills/1": ["model-partner-skill-production"],
      "/input/entities/1/profile/skills/2": ["model-partner-skill-transcription"],
      "/input/entities/1/profile/skills/3": ["model-partner-skill-expression"],
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
      "/triggerInputs/intent/text": ["model-source-intent"],
      "/triggerInputs/enrichment/premises/0": ["model-source-bio"],
      "/triggerInputs/enrichment/premises/1": ["model-source-intent"],
      "/triggerInputs/enrichment/userContext": ["model-source-bio"],
    },
    participantKinds: {
      "h5-a": "historical",
      "h5-b": "historical",
      "h5-c": "synthetic",
      "h5-d": "synthetic",
      "h5-e": "synthetic",
    },
    outcomeCitationIds: ["pnas-kariko-weissman-profile"],
    anonymizationReview: {
      reviewer: "independent-review-pending",
      reviewedAt: "2026-08-06",
      recognizability: "medium",
      decision: "pending",
      rationale: "Pending independent verification of the reversed seeker direction, event-relative ordering, field-level provenance, semantic negatives, and exact serialized boundaries.",
    },
    semanticNegatives: { ...semanticNegatives },
    triggerInputs: {
      intent: { text: source.intent },
      enrichment: { premises: [source.bio, source.intent], userContext: source.bio },
    },
  },
});
