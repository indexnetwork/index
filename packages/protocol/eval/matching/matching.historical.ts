import type { MatchingCase } from "./matching.types.js";

/**
 * Tier 3 — Historical collaborations.
 *
 * Each case recreates a documented, demonstrably-successful collaboration as the two
 * people looked BEFORE they connected, anonymized so the evaluator judges on fit rather
 * than fame. The discoverer (`*-a`) is the seeker; the real partner (`*-b`) is the match;
 * `*-c/d/e` are plausible contemporaries who were around but were not the right fit, each
 * chosen to fall into a genuine reject category: same-side (both seeking the same thing),
 * complementary/non-substitutive role (enables the relation from outside it), or misaligned
 * fit. All entities share one thematically-relevant index (except the single adjacent-index
 * distractor in case 5) so community membership never separates them — only fit does.
 *
 * Distractor RAG scores are kept competitive so the test is "the evaluator rejects a
 * plausible RAG hit", not "RAG never surfaced it".
 *
 * Convention: every real partner uses the band `[60, 100]` and every distractor uses
 * `[0, 29]`. The partner band is deliberately lenient (the floor is 60, not 70) so the
 * first baseline absorbs model variance; a partner landing in 60–69 is itself a mild
 * finding. Keep this convention for new cases.
 */

// ── Case 1: hardware builder + commercial operator → cofounders ──────────────
// Real: Steve Wozniak (builder, h1-b) + Steve Jobs (operator, h1-a), ~1976. Anonymized.
const H1 = "h1-club";
const case1: MatchingCase = {
  id: "historical/builder-and-operator",
  rule: "historical",
  tier: 3,
  description:
    "Operator seeking a hardware builder to commercialize a personal computer should surface the gifted board designer over a same-side promoter, a parts supplier, and a non-committal hobbyist.",
  input: {
    discovererId: "h1-a",
    entities: [
      {
        userId: "h1-a",
        profile: {
          name: "(source user)",
          bio: "Runs a small electronics resale side business. Convinced affordable personal computers can be sold to ordinary individuals, not just companies. Commercially driven and persuasive, but not an engineer.",
          location: "Bay Area",
          interests: ["personal computing", "consumer electronics", "selling"],
          skills: ["sales", "deal-making", "sourcing parts"],
        },
        intents: [
          { intentId: "h1-a-1", payload: "Find a brilliant hardware engineer to build an affordable personal-computer product I can sell to hobbyists and individuals." },
        ],
        networkId: H1,
      },
      {
        userId: "h1-b",
        profile: {
          name: "Daniel Reyes",
          bio: "Self-taught hardware engineer who designs elegant computer circuit boards for fun and shares the schematics at his hobby club. Cares about the craft far more than money and has never tried to sell anything.",
          location: "Bay Area",
          interests: ["circuit design", "personal computers", "electronics"],
          skills: ["digital hardware design", "circuit boards", "microprocessors"],
        },
        networkId: H1,
        ragScore: 92,
        matchedVia: "designs personal-computer hardware",
      },
      {
        userId: "h1-c",
        profile: {
          name: "Marcus Webb",
          bio: "Ambitious promoter who also wants to bring personal computers to market. Strong at pitching and selling, cannot build hardware, and is likewise looking for an engineer to partner with.",
          location: "Bay Area",
          interests: ["personal computing", "marketing", "startups"],
          skills: ["sales", "promotion", "fundraising"],
        },
        intents: [
          { intentId: "h1-c-1", payload: "Looking for a hardware engineer to build a personal computer I can take to market." },
        ],
        networkId: H1,
        ragScore: 79,
        matchedVia: "wants to commercialize personal computers",
      },
      {
        userId: "h1-d",
        profile: {
          name: "Priya Ortega",
          bio: "Runs a shop supplying electronic components and chips to the hobby community. Sells parts to builders but does not design or build computers and has no interest in co-founding anything.",
          location: "Bay Area",
          interests: ["component distribution", "retail", "electronics"],
          skills: ["procurement", "inventory", "supplier relationships"],
        },
        networkId: H1,
        ragScore: 71,
        matchedVia: "supplies parts to computer hobbyists",
      },
      {
        userId: "h1-e",
        profile: {
          name: "Theo Lindqvist",
          bio: "Enthusiastic hobbyist who loves tinkering with kit computers on weekends purely for enjoyment. Has a day job he likes and no desire to start a company or ship a product.",
          location: "Bay Area",
          interests: ["hobby electronics", "kit computers", "tinkering"],
          skills: ["soldering", "assembling kits"],
        },
        networkId: H1,
        ragScore: 67,
        matchedVia: "active personal-computer hobbyist",
      },
    ],
    networkContexts: {
      [H1]:
        "A hobbyist club for people building personal computers from individual parts. Members swap circuit-board designs and share a conviction that computing should reach ordinary individuals, not only institutions.",
    },
  },
  expect: [
    { candidateId: "h1-b", match: true, scoreBand: [60, 100], role: "agent" },
    { candidateId: "h1-c", match: false, scoreBand: [0, 29] },
    { candidateId: "h1-d", match: false, scoreBand: [0, 29] },
    { candidateId: "h1-e", match: false, scoreBand: [0, 29] },
  ],
};

// ── Case 2: two co-researchers cracking a molecular structure → landmark paper ──
// Real: James Watson (data-driven biologist, h2-a) + Francis Crick (physics modeler, h2-b), ~1953. Anonymized.
const H2 = "h2-lab";
const case2: MatchingCase = {
  id: "historical/co-researchers-structure",
  rule: "historical",
  tier: 3,
  description:
    "Biologist with diffraction data seeking a structural model-builder should surface the physics-trained modeler over a same-side data biologist, a lab administrator, and an unrelated chemist.",
  input: {
    discovererId: "h2-a",
    entities: [
      {
        userId: "h2-a",
        profile: {
          name: "(source user)",
          bio: "Young biologist with access to X-ray diffraction data on a key biological molecule. Certain its three-dimensional structure is solvable and within reach. Strong on biological intuition, weaker on physical model-building.",
          location: "Cambridge",
          interests: ["molecular biology", "structure", "diffraction data"],
          skills: ["biology", "experiment interpretation"],
        },
        intents: [
          { intentId: "h2-a-1", payload: "Find a collaborator who reasons physically about molecular structure to jointly build a model and crack this molecule's shape with me." },
        ],
        networkId: H2,
      },
      {
        userId: "h2-b",
        profile: {
          name: "Alan Pierce",
          bio: "Physics-trained researcher who builds structural models and reasons from first principles about how atoms fit together. Restless for a biological problem worth his modeling skill.",
          location: "Cambridge",
          interests: ["structural modeling", "physics", "molecular structure"],
          skills: ["model building", "crystallography theory", "first-principles reasoning"],
        },
        networkId: H2,
        ragScore: 90,
        matchedVia: "builds physical models of molecular structure",
      },
      {
        userId: "h2-c",
        profile: {
          name: "Renu Adeyemi",
          bio: "Another experimental biologist with her own diffraction data, also hunting for a modeler to interpret it. Strong empiricist, not a model-builder herself.",
          location: "Cambridge",
          interests: ["molecular biology", "diffraction", "structure"],
          skills: ["biology", "data collection"],
        },
        intents: [
          { intentId: "h2-c-1", payload: "Looking for a structural modeler to help me interpret my diffraction data." },
        ],
        networkId: H2,
        ragScore: 80,
        matchedVia: "works on molecular structure from diffraction data",
      },
      {
        userId: "h2-d",
        profile: {
          name: "Gordon Vale",
          bio: "Laboratory administrator who manages funding, equipment, and scheduling for the research group. Keeps the lab running but does no scientific modeling or experiments himself.",
          location: "Cambridge",
          interests: ["research administration", "operations"],
          skills: ["budgeting", "lab management", "scheduling"],
        },
        networkId: H2,
        ragScore: 64,
        matchedVia: "member of the structure-research lab",
      },
      {
        userId: "h2-e",
        profile: {
          name: "Sofia Marchetti",
          bio: "Synthetic chemist focused on the reaction kinetics of small industrial compounds, an entirely different subfield. Skilled, but not working on biological macromolecular structure.",
          location: "Cambridge",
          interests: ["synthetic chemistry", "reaction kinetics"],
          skills: ["organic synthesis", "kinetics"],
        },
        networkId: H2,
        ragScore: 61,
        matchedVia: "chemistry researcher in a shared lab network",
      },
    ],
    networkContexts: {
      [H2]:
        "A university laboratory circle racing to determine the three-dimensional structure of a key biological molecule. Members combine experimental data and theoretical modeling toward that single goal.",
    },
  },
  expect: [
    { candidateId: "h2-b", match: true, scoreBand: [60, 100], role: "peer" },
    { candidateId: "h2-c", match: false, scoreBand: [0, 29] },
    { candidateId: "h2-d", match: false, scoreBand: [0, 29] },
    { candidateId: "h2-e", match: false, scoreBand: [0, 29] },
  ],
};

// ── Case 3: songwriting duo, same scene, complementary styles → creative partnership ──
// Real: John Lennon (raw/edge, h3-a) + Paul McCartney (melodic, h3-b), late 1950s. Anonymized.
const H3 = "h3-scene";
const case3: MatchingCase = {
  id: "historical/songwriting-duo",
  rule: "historical",
  tier: 3,
  description:
    "Edgy young musician with half-finished songs seeking a co-writer should surface the melodically gifted writer over a same-side frontman, a club promoter, and a classical musician.",
  input: {
    discovererId: "h3-a",
    entities: [
      {
        userId: "h3-a",
        profile: {
          name: "(source user)",
          bio: "Young musician in a port-city club scene with raw energy, attitude, and a notebook of half-finished songs. Strong on lyrics and drive, less disciplined on melody and arrangement.",
          location: "port city, north of England",
          interests: ["rock and roll", "songwriting", "performing"],
          skills: ["lyrics", "rhythm guitar", "stage presence"],
        },
        intents: [
          { intentId: "h3-a-1", payload: "Find a co-writer in the local scene whose melodic instinct complements my lyrics and edge so we can write songs together." },
        ],
        networkId: H3,
      },
      {
        userId: "h3-b",
        profile: {
          name: "Sam Whitfield",
          bio: "Melodically gifted young musician in the same club scene, technically fluent and a quick study on harmony. Looking for a writing partner with lyrical ideas and attitude to push against.",
          location: "port city, north of England",
          interests: ["melody", "songwriting", "harmony"],
          skills: ["melody", "bass", "arrangement", "harmony"],
        },
        networkId: H3,
        ragScore: 91,
        matchedVia: "songwriter seeking a writing partner in the scene",
      },
      {
        userId: "h3-c",
        profile: {
          name: "Eddie Cross",
          bio: "Another local frontman who is also looking for a co-writer to supply songs for his act. Charismatic performer, not a strong composer; wants someone to write for him.",
          location: "port city, north of England",
          interests: ["performing", "rock and roll"],
          skills: ["vocals", "stage presence"],
        },
        intents: [
          { intentId: "h3-c-1", payload: "Looking for a songwriter to write material for my act." },
        ],
        networkId: H3,
        ragScore: 78,
        matchedVia: "frontman in the local music scene",
      },
      {
        userId: "h3-d",
        profile: {
          name: "Marion Tate",
          bio: "Promoter who books bands into the local clubs and venues. Connects acts to stages and audiences but does not write or perform music.",
          location: "port city, north of England",
          interests: ["live music", "venues", "promotion"],
          skills: ["booking", "promotion", "venue relationships"],
        },
        networkId: H3,
        ragScore: 66,
        matchedVia: "books acts in the local scene",
      },
      {
        userId: "h3-e",
        profile: {
          name: "Henrik Vogel",
          bio: "Conservatory-trained classical musician devoted to the orchestral repertoire and chamber recitals. No interest in popular songwriting or club performance.",
          location: "port city, north of England",
          interests: ["classical music", "orchestral repertoire"],
          skills: ["classical performance", "sight-reading"],
        },
        networkId: H3,
        ragScore: 60,
        matchedVia: "musician in the city's music community",
      },
    ],
    networkContexts: {
      [H3]:
        "A local skiffle-and-club music scene in a working-class port city, where young musicians form bands, swap songs, and play the same circuit of small venues.",
    },
  },
  expect: [
    { candidateId: "h3-b", match: true, scoreBand: [60, 100], role: "peer" },
    { candidateId: "h3-c", match: false, scoreBand: [0, 29] },
    { candidateId: "h3-d", match: false, scoreBand: [0, 29] },
    { candidateId: "h3-e", match: false, scoreBand: [0, 29] },
  ],
};

// ── Case 4: first-check investor + technical founder → backed company ──
// Real: an early angel writing a first check (h4-b) + the technical founder they backed (h4-a). Anonymized.
const H4 = "h4-spinout";
const case4: MatchingCase = {
  id: "historical/first-check-investor",
  rule: "historical",
  tier: 3,
  description:
    "Technical founder with a prototype seeking a first check and guidance should surface the matched-stage first-check angel over a same-side founder, a wrong-stage growth investor, and an unrelated-sector angel.",
  input: {
    discovererId: "h4-a",
    entities: [
      {
        userId: "h4-a",
        profile: {
          name: "(source user)",
          bio: "Technical founder with a working prototype built out of a university spinout scene. Strong engineering, no business network, and no money. Needs a first believer to help turn the prototype into a company.",
          location: "Stanford area",
          interests: ["systems software", "startups", "search infrastructure"],
          skills: ["engineering", "systems design", "prototyping"],
        },
        intents: [
          { intentId: "h4-a-1", payload: "Find a first-check investor in my domain and stage who will fund the prototype and give early guidance to turn it into a company." },
        ],
        networkId: H4,
      },
      {
        userId: "h4-b",
        profile: {
          name: "Walter Hsu",
          bio: "Experienced angel who writes first checks into early technical teams in exactly this domain and stage. Known for backing prototypes before anyone else and rolling up his sleeves with founders.",
          location: "Stanford area",
          interests: ["early-stage investing", "deep tech", "founder mentorship"],
          skills: ["first-check investing", "technical diligence", "founder coaching"],
        },
        networkId: H4,
        ragScore: 90,
        matchedVia: "writes first checks into early technical founders",
      },
      {
        userId: "h4-c",
        profile: {
          name: "Dana Okoro",
          bio: "Another early-stage technical founder out of the same spinout scene, also raising her first round. A peer, not a funder; she is seeking capital herself.",
          location: "Stanford area",
          interests: ["machine learning", "startups", "fundraising"],
          skills: ["engineering", "product"],
        },
        intents: [
          { intentId: "h4-c-1", payload: "Raising a first round for my own prototype and looking for early investors." },
        ],
        networkId: H4,
        ragScore: 80,
        matchedVia: "early founder in the spinout scene",
      },
      {
        userId: "h4-d",
        profile: {
          name: "Gregory Mainwaring",
          bio: "Growth-stage investor who only writes large checks into companies with millions in revenue and proven traction. Does not do first checks or pre-revenue prototypes.",
          location: "Stanford area",
          interests: ["growth equity", "late-stage investing", "scaling"],
          skills: ["growth investing", "financial modeling", "board governance"],
        },
        networkId: H4,
        ragScore: 73,
        matchedVia: "technology investor",
      },
      {
        userId: "h4-e",
        profile: {
          name: "Helena Brandt",
          bio: "Active angel who invests exclusively in consumer food and beverage brands. Writes first checks, but only in a sector with nothing to do with this founder's technical product.",
          location: "Stanford area",
          interests: ["consumer brands", "food and beverage", "retail"],
          skills: ["first-check investing", "brand building"],
        },
        networkId: H4,
        ragScore: 62,
        matchedVia: "early-stage angel investor",
      },
    ],
    networkContexts: {
      [H4]:
        "An early-stage community around a university spinout scene, where technical founders with prototypes meet the first-check angels who back deep-tech teams before traction.",
    },
  },
  expect: [
    { candidateId: "h4-b", match: true, scoreBand: [60, 100], role: "agent" },
    { candidateId: "h4-c", match: false, scoreBand: [0, 29] },
    { candidateId: "h4-d", match: false, scoreBand: [0, 29] },
    { candidateId: "h4-e", match: false, scoreBand: [0, 29] },
  ],
};

// ── Case 5: domain expert + ML researcher → cross-disciplinary breakthrough ──
// Real: a structural-biology domain expert (h5-b) + a deep-learning researcher (h5-a), AlphaFold-style. Anonymized.
// Note: h5-e is an ADJACENT-INDEX distractor (different, less-relevant index) — see spec §"Shared community context".
const H5 = "h5-consortium";
const H5_ADJ = "h5-generic-data";
const case5: MatchingCase = {
  id: "historical/domain-expert-and-ml",
  rule: "historical",
  tier: 3,
  description:
    "ML researcher seeking a domain expert to ground a model on a hard scientific problem should surface the complementary structural-science expert over a same-side ML researcher, an unrelated-science expert, and a generalist analyst from a less-relevant index.",
  input: {
    discovererId: "h5-a",
    entities: [
      {
        userId: "h5-a",
        profile: {
          name: "(source user)",
          bio: "Deep-learning researcher with a powerful, general modeling approach looking for a hard, well-characterized scientific problem and a domain expert to ground it in reality. Strong on models, light on the science itself.",
          location: "London",
          interests: ["deep learning", "scientific problems", "representation learning"],
          skills: ["machine learning", "neural networks", "large-scale training"],
        },
        intents: [
          { intentId: "h5-a-1", payload: "Find a domain scientist with a hard, well-defined structural problem and curated data, to jointly apply my deep-learning models to it." },
        ],
        networkId: H5,
      },
      {
        userId: "h5-b",
        profile: {
          name: "Ravi Sundaram",
          bio: "Structural-science domain expert with deep knowledge of a long-standing prediction problem and years of curated experimental data. Lacks modeling firepower in-house and wants a serious computational collaborator.",
          location: "London",
          interests: ["structural biology", "prediction problems", "curated datasets"],
          skills: ["domain expertise", "experimental data curation", "structure determination"],
        },
        networkId: H5,
        ragScore: 90,
        matchedVia: "domain expert with a hard structural prediction problem",
      },
      {
        userId: "h5-c",
        profile: {
          name: "Lena Fischer",
          bio: "Another deep-learning researcher with a similar modeling toolkit, also looking for a scientific problem to apply it to. A mirror of the discoverer — same side, not a complementary domain partner.",
          location: "London",
          interests: ["deep learning", "representation learning", "scientific ML"],
          skills: ["machine learning", "neural networks"],
        },
        intents: [
          { intentId: "h5-c-1", payload: "Looking for a scientific problem and dataset to apply my deep-learning models to." },
        ],
        networkId: H5,
        ragScore: 81,
        matchedVia: "deep-learning researcher seeking scientific problems",
      },
      {
        userId: "h5-d",
        profile: {
          name: "Tobias Lindgren",
          bio: "Domain expert in observational astronomy, an entirely different science with no connection to the structural problem at hand. Eminent in his field, but the wrong domain for this collaboration.",
          location: "London",
          interests: ["astronomy", "observational data"],
          skills: ["astrophysics", "telescope data analysis"],
        },
        networkId: H5,
        ragScore: 64,
        matchedVia: "scientist in the interdisciplinary consortium",
      },
      {
        userId: "h5-e",
        profile: {
          name: "Bianca Rossi",
          bio: "Generalist data analyst who builds business dashboards and reports. Competent with spreadsheets and BI tools, but does no scientific research and was surfaced through a general analytics group, not the science consortium.",
          location: "London",
          interests: ["business intelligence", "dashboards", "reporting"],
          skills: ["SQL", "data visualization", "spreadsheets"],
        },
        networkId: H5_ADJ,
        ragScore: 58,
        matchedVia: "data analyst in a general analytics community",
      },
    ],
    networkContexts: {
      [H5]:
        "An interdisciplinary consortium applying machine learning to a hard, long-standing scientific problem, bringing together domain scientists with curated data and computational researchers.",
      [H5_ADJ]:
        "A general business-analytics community for people who build dashboards and reports across industries — broad and not tied to any scientific domain.",
    },
  },
  expect: [
    { candidateId: "h5-b", match: true, scoreBand: [60, 100], role: "peer" },
    { candidateId: "h5-c", match: false, scoreBand: [0, 29] },
    { candidateId: "h5-d", match: false, scoreBand: [0, 29] },
    { candidateId: "h5-e", match: false, scoreBand: [0, 29] },
  ],
};

export const HISTORICAL_CASES: MatchingCase[] = [case1, case2, case3, case4, case5];
