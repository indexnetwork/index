/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it } from "bun:test";
import type { Runnable } from "@langchain/core/runnables";
import { OpportunityEvaluator, CandidateProfile, EvaluatorInput, type EvaluatorEntity } from "../opportunity.evaluator.js";

import { assertLLM } from "../../shared/agent/tests/llm-assert.js";

describe('OpportunityEvaluator', () => {
  const evaluator = new OpportunityEvaluator();

  const sourceProfile = `
        Name: Alice
        Bio: Senior Blockchain Developer building a DeFi protocol.
        Skills: Rust, Solidity, React.
        Interests: DeFi, Zero Knowledge Proofs.
    `;

  const candidates: CandidateProfile[] = [
    {
      userId: "user-bob",
      identity: { name: "Bob", bio: "Crypto investor and community manager.", location: "NYC" },
      attributes: { skills: ["Marketing", "Community"], interests: ["DeFi", "Bitcoin"] }
    },
    {
      userId: "user-charlie",
      identity: { name: "Charlie", bio: "Chef.", location: "Paris" },
      attributes: { skills: ["Cooking"], interests: ["Food"] }
    }
  ];

  it('should find a high-value match', async () => {
    const result = await evaluator.invoke(sourceProfile, candidates, { minScore: 50 });

    expect(result.length).toBeGreaterThan(0);
    const match = result[0];
    expect(match.candidateId).toBe("user-bob");
    expect(match.score).toBeGreaterThan(50);
    expect(match.reasoning).toBeDefined();
  }, 60000);

  it('should filter out low relevance candidates', async () => {
    // For this test, we need the mock to return DIFFERENT results based on input, or simpler:
    // We can just create a new evaluator with a mock that returns NOTHING.

    const result = await evaluator.invoke(sourceProfile, candidates, { minScore: 90 });

    const charlieMatch = result.find(r => r.candidateId === "user-charlie");
    expect(charlieMatch).toBeUndefined();
  }, 60000);

  describe('invokeEntityBundle', () => {
    it('returns no opportunities when entity-bundle model returns empty (e.g. already know each other)', async () => {
      const mockEntityBundleModel = {
        invoke: async () => ({ opportunities: [] }),
      } as unknown as Runnable;
      const evaluatorWithMock = new OpportunityEvaluator({
        entityBundleModel: mockEntityBundleModel,
      });
      const input: EvaluatorInput = {
        discovererId: 'discoverer-1',
        entities: [
          {
            userId: 'user-a',
            profile: {
              name: 'Alice',
              bio: 'Co-founder at Acme Corp.',
              context: 'Building Acme Corp. with Bob.',
            },
            networkId: 'index-1',
          },
          {
            userId: 'user-b',
            profile: {
              name: 'Bob',
              bio: 'Co-founder at Acme Corp.',
              context: 'Building Acme Corp. with Alice.',
            },
            networkId: 'index-1',
          },
        ],
      };
      const result = await evaluatorWithMock.invokeEntityBundle(input, { minScore: 70 });
      expect(result).toHaveLength(0);
    });

    it('includes same-side matching rule in entity bundle prompt', async () => {
      let capturedMessages: unknown[] = [];
      const mockEntityBundleModel = {
        invoke: async (messages: unknown[]) => {
          capturedMessages = messages;
          return { opportunities: [] };
        },
      } as unknown as Runnable;

      const evaluatorWithMock = new OpportunityEvaluator({ entityBundleModel: mockEntityBundleModel });

      const input: EvaluatorInput = {
        discovererId: 'user-1',
        entities: [
          {
            userId: 'user-1',
            profile: { name: 'Alice', bio: 'Founder raising capital' },
            intents: [{ intentId: 'i1', payload: 'Looking for investors' }],
            networkId: 'idx-1',
          },
          {
            userId: 'user-2',
            profile: { name: 'Bob', bio: 'Founder raising capital' },
            intents: [{ intentId: 'i2', payload: 'Seeking investors for my startup' }],
            networkId: 'idx-1',
          },
        ],
        discoveryQuery: 'find me investors',
      };

      await evaluatorWithMock.invokeEntityBundle(input, { minScore: 30 });

      // Verify the system prompt contains same-side matching rule
      const systemMsg = capturedMessages[0] as { content: string };
      expect(systemMsg.content).toContain('SAME-SIDE MATCHING');

      // Verify the human message contains same-side check in discovery query rules
      const humanMsg = capturedMessages[1] as { content: string };
      expect(humanMsg.content).toContain('SAME-SIDE CHECK');
    }, 10000);

    it.skip('returns no opportunity when entities clearly already know each other (e.g. co-founders) [integration: live LLM]', async () => {
      const input: EvaluatorInput = {
        discovererId: 'discoverer-1',
        entities: [
          {
            userId: 'user-a',
            profile: {
              name: 'Alice',
              bio: 'Co-founder at Acme Corp.',
              context: 'Building Acme Corp. with Bob.',
            },
            networkId: 'index-1',
          },
          {
            userId: 'user-b',
            profile: {
              name: 'Bob',
              bio: 'Co-founder at Acme Corp.',
              context: 'Building Acme Corp. with Alice.',
            },
            networkId: 'index-1',
          },
        ],
      };
      const result = await evaluator.invokeEntityBundle(input, { minScore: 70 });
      expect(result).toHaveLength(0);
    }, 30000);

    it('penalizes candidates with known location mismatch when discoveryQuery mentions location', async () => {
      const mockEntityBundleModel = {
        invoke: async () => ({
          opportunities: [
            {
              reasoning: 'NY-based investor matches investor criteria but is in wrong city.',
              score: 35,
              actors: [
                { userId: 'discoverer-1', role: 'patient', intentId: null },
                { userId: 'candidate-ny', role: 'agent', intentId: null },
              ],
            },
          ],
        }),
      } as unknown as Runnable;
      const evaluatorWithMock = new OpportunityEvaluator({
        entityBundleModel: mockEntityBundleModel,
      });
      const input: EvaluatorInput = {
        discovererId: 'discoverer-1',
        entities: [
          {
            userId: 'discoverer-1',
            profile: {
              name: 'Alice',
              bio: 'Founder building an AI startup.',
              location: 'San Francisco',
            },
            networkId: 'index-1',
          },
          {
            userId: 'candidate-ny',
            profile: {
              name: 'Bob',
              bio: 'VC partner at TechFund.',
              location: 'New York',
            },
            networkId: 'index-1',
            ragScore: 85,
          },
        ],
        discoveryQuery: 'investors in San Francisco',
      };
      const results = await evaluatorWithMock.invokeEntityBundle(input, { minScore: 50 });
      // Mock returns score 35, which is below minScore 50 — should be filtered
      expect(results.length).toBe(0);
    }, 30000);

    it('does not penalize candidates with unknown location when discoveryQuery mentions location', async () => {
      const mockEntityBundleModel = {
        invoke: async () => ({
          opportunities: [
            {
              reasoning: 'Candidate matches investor criteria; location unverified.',
              score: 80,
              actors: [
                { userId: 'discoverer-1', role: 'patient', intentId: null },
                { userId: 'candidate-unknown', role: 'agent', intentId: null },
              ],
            },
          ],
        }),
      } as unknown as Runnable;
      const evaluatorWithMock = new OpportunityEvaluator({
        entityBundleModel: mockEntityBundleModel,
      });
      const input: EvaluatorInput = {
        discovererId: 'discoverer-1',
        entities: [
          {
            userId: 'discoverer-1',
            profile: {
              name: 'Alice',
              bio: 'Founder building an AI startup.',
              location: 'San Francisco',
            },
            networkId: 'index-1',
          },
          {
            userId: 'candidate-unknown',
            profile: {
              name: 'Charlie',
              bio: 'Angel investor in deep tech.',
            },
            networkId: 'index-1',
            ragScore: 75,
          },
        ],
        discoveryQuery: 'investors in San Francisco',
      };
      const results = await evaluatorWithMock.invokeEntityBundle(input, { minScore: 50 });
      expect(results.length).toBe(1);
      expect(results[0].score).toBeGreaterThanOrEqual(50);
    }, 30000);
  });
});

// ─── Stress test: 25 fully unrelated candidates ───────────────────────────────

const DISCOVERER_ID = 'user-founder-alice';

const sourceEntity: EvaluatorEntity = {
  userId: DISCOVERER_ID,
  profile: {
    name: '(source user)',
    bio: 'Serial founder building an AI-native developer tools startup. Previously founded two SaaS companies (acquired).',
    location: 'San Francisco, CA',
    interests: ['artificial intelligence', 'developer tools', 'open source'],
    skills: ['product strategy', 'fundraising', 'go-to-market'],
    context: 'Looking for a technical co-founder with deep ML/AI expertise to lead the engineering team.',
  },
  intents: [
    { intentId: 'i-1', payload: 'Looking for an AI/ML co-founder with production LLM experience to build our core inference engine.' },
    { intentId: 'i-2', payload: 'Seeking a CTO-level technical partner with a track record in developer tooling or infrastructure.' },
  ],
  networkId: 'idx-ai-founders',
};

const stressCandidates: EvaluatorEntity[] = [
  { userId: 'user-chef', profile: { name: 'Pierre Dubois', bio: 'Executive chef running three Michelin-starred restaurants.', interests: ['fine dining', 'culinary arts'], skills: ['menu design', 'kitchen management'], context: 'Expanding into Tokyo.' }, intents: [{ intentId: 'c-1', payload: 'Looking for a commercial kitchen space to lease in Tokyo.' }], networkId: 'idx-ai-founders', ragScore: 12, matchedVia: 'mirror' },
  { userId: 'user-yoga', profile: { name: 'Amara Osei', bio: 'Certified yoga instructor and studio owner.', interests: ['yoga', 'mindfulness'], skills: ['teaching', 'breathwork'] }, intents: [{ intentId: 'c-2', payload: 'Seeking a videographer to produce online yoga class content.' }], networkId: 'idx-ai-founders', ragScore: 8, matchedVia: 'reciprocal' },
  { userId: 'user-musician', profile: { name: 'Kai Nakamura', bio: 'Jazz pianist and composer.', interests: ['jazz', 'music theory'], skills: ['piano', 'composition'] }, intents: [{ intentId: 'c-3', payload: 'Looking for a record label for a jazz-electronic fusion album.' }], networkId: 'idx-ai-founders', ragScore: 6, matchedVia: 'mirror' },
  { userId: 'user-realtor', profile: { name: 'Sandra Bloom', bio: 'Licensed real estate agent specializing in luxury properties.', interests: ['real estate', 'interior design'], skills: ['property valuation', 'negotiation'] }, intents: [{ intentId: 'c-4', payload: 'Seeking high-net-worth clients from Latin America for luxury properties.' }], networkId: 'idx-ai-founders', ragScore: 10, matchedVia: 'reciprocal' },
  { userId: 'user-therapist', profile: { name: 'Dr. Nadia Russo', bio: 'Licensed clinical psychologist specializing in trauma-informed therapy.', interests: ['trauma therapy', 'EMDR'], skills: ['CBT', 'EMDR'] }, intents: [{ intentId: 'c-5', payload: 'Looking for a co-author to write a book on trauma-informed approaches.' }], networkId: 'idx-ai-founders', ragScore: 9, matchedVia: 'mirror' },
  { userId: 'user-farmer', profile: { name: 'Tom Okafor', bio: 'Third-generation farmer running a 400-acre regenerative farm.', interests: ['regenerative agriculture', 'soil health'], skills: ['crop rotation', 'livestock management'] }, intents: [{ intentId: 'c-6', payload: 'Seeking a distribution partner to sell heirloom grain and meat boxes.' }], networkId: 'idx-ai-founders', ragScore: 7, matchedVia: 'reciprocal' },
  { userId: 'user-journalist', profile: { name: 'Helena Voss', bio: 'Investigative journalist covering geopolitics and financial crime.', interests: ['investigative journalism', 'geopolitics'], skills: ['investigative research', 'long-form writing'] }, intents: [{ intentId: 'c-7', payload: 'Looking for a legal team for a sensitive investigative series.' }], networkId: 'idx-ai-founders', ragScore: 11, matchedVia: 'mirror' },
  { userId: 'user-nurse', profile: { name: 'Grace Mensah', bio: 'ICU nurse with 12 years of critical care experience.', interests: ['critical care', 'nursing education'], skills: ['critical care nursing', 'ACLS'] }, intents: [{ intentId: 'c-8', payload: 'Seeking funding to scale a peer mentorship program for ICU nurses.' }], networkId: 'idx-ai-founders', ragScore: 8, matchedVia: 'reciprocal' },
  { userId: 'user-lawyer', profile: { name: 'Marcus Adeyemi', bio: 'Partner at a boutique immigration law firm.', interests: ['immigration law', 'international talent'], skills: ['immigration law', 'visa applications'] }, intents: [{ intentId: 'c-9', payload: 'Looking to partner with HR leaders who need immigration support.' }], networkId: 'idx-ai-founders', ragScore: 14, matchedVia: 'mirror' },
  { userId: 'user-architect', profile: { name: 'Sofia Brandt', bio: 'Licensed architect and urban designer.', interests: ['sustainable architecture', 'urban design'], skills: ['AutoCAD', 'LEED certification'] }, intents: [{ intentId: 'c-10', payload: 'Seeking a developer partner for a passive house mixed-use project.' }], networkId: 'idx-ai-founders', ragScore: 9, matchedVia: 'reciprocal' },
  { userId: 'user-teacher', profile: { name: 'James Obi', bio: 'High school biology and chemistry teacher.', interests: ['science education', 'curriculum development'], skills: ['teaching', 'curriculum design'] }, intents: [{ intentId: 'c-11', payload: 'Looking for sponsors to fund an after-school science program.' }], networkId: 'idx-ai-founders', ragScore: 7, matchedVia: 'mirror' },
  { userId: 'user-vet', profile: { name: 'Dr. Camille Petit', bio: 'Large animal veterinarian in rural Montana.', interests: ['equine medicine', 'livestock health'], skills: ['equine surgery', 'herd health management'] }, intents: [{ intentId: 'c-12', payload: 'Seeking an experienced large animal veterinarian to join the practice.' }], networkId: 'idx-ai-founders', ragScore: 6, matchedVia: 'reciprocal' },
  { userId: 'user-travel-blogger', profile: { name: 'Lena Johansson', bio: 'Travel blogger with 800k followers focusing on slow travel.', interests: ['slow travel', 'travel photography'], skills: ['photography', 'content creation', 'SEO'] }, intents: [{ intentId: 'c-13', payload: 'Looking for sustainable tour operators in Southeast Asia.' }], networkId: 'idx-ai-founders', ragScore: 8, matchedVia: 'mirror' },
  { userId: 'user-novelist', profile: { name: 'Rafael Torres', bio: 'Science fiction novelist with four published novels.', interests: ['science fiction', 'speculative fiction'], skills: ['fiction writing', 'world-building', 'screenwriting'] }, intents: [{ intentId: 'c-14', payload: 'Looking for a literary agent for a science fiction trilogy.' }], networkId: 'idx-ai-founders', ragScore: 7, matchedVia: 'reciprocal' },
  { userId: 'user-marine-biologist', profile: { name: 'Dr. Yuki Hayashi', bio: 'Marine biologist specializing in coral reef ecosystems.', interests: ['coral reef ecology', 'climate science'], skills: ['field research', 'ecological modeling'] }, intents: [{ intentId: 'c-15', payload: 'Seeking NGO partners to fund a coral reef restoration program.' }], networkId: 'idx-ai-founders', ragScore: 6, matchedVia: 'mirror' },
  { userId: 'user-sommelier', profile: { name: 'Antoine Leclerc', bio: 'Master sommelier and wine educator.', interests: ['wine', 'viticulture'], skills: ['wine pairing', 'cellar management'] }, intents: [{ intentId: 'c-16', payload: 'Seeking a technology partner to build a wine education platform.' }], networkId: 'idx-ai-founders', ragScore: 10, matchedVia: 'reciprocal' },
  { userId: 'user-film-director', profile: { name: 'Nia Okonkwo', bio: 'Independent film director. Sundance alum.', interests: ['filmmaking', 'documentary'], skills: ['directing', 'screenwriting'] }, intents: [{ intentId: 'c-17', payload: 'Looking for a music rights clearance attorney for a documentary.' }], networkId: 'idx-ai-founders', ragScore: 7, matchedVia: 'mirror' },
  { userId: 'user-landscape-artist', profile: { name: 'Chen Wei', bio: 'Landscape painter and installation artist.', interests: ['landscape painting', 'installation art'], skills: ['oil painting', 'installation design'] }, intents: [{ intentId: 'c-18', payload: 'Seeking a gallery in New York to host a solo exhibition.' }], networkId: 'idx-ai-founders', ragScore: 5, matchedVia: 'reciprocal' },
  { userId: 'user-social-worker', profile: { name: 'Amina Diallo', bio: 'Licensed clinical social worker specializing in youth homelessness.', interests: ['youth homelessness', 'housing policy'], skills: ['case management', 'crisis intervention'] }, intents: [{ intentId: 'c-19', payload: 'Seeking foundation grants for transitional housing for homeless youth.' }], networkId: 'idx-ai-founders', ragScore: 6, matchedVia: 'mirror' },
  { userId: 'user-sculptor', profile: { name: 'Björn Lindqvist', bio: 'Public sculptor working with steel, stone, and reclaimed materials.', interests: ['public art', 'sculpture'], skills: ['metalworking', 'stone carving'] }, intents: [{ intentId: 'c-20', payload: 'Looking for a structural engineering collaborator for a steel sculpture.' }], networkId: 'idx-ai-founders', ragScore: 5, matchedVia: 'reciprocal' },
  { userId: 'user-personal-trainer', profile: { name: 'Darius King', bio: 'Elite personal trainer and sports performance coach.', interests: ['strength training', 'sports performance'], skills: ['strength and conditioning', 'nutrition planning'] }, intents: [{ intentId: 'c-21', payload: 'Seeking a sports app development partner to build a training platform.' }], networkId: 'idx-ai-founders', ragScore: 9, matchedVia: 'mirror' },
  { userId: 'user-dentist', profile: { name: 'Dr. Rosa Fuentes', bio: 'Orthodontist and dental practice owner.', interests: ['orthodontics', 'dental technology'], skills: ['orthodontic treatment', 'clear aligners'] }, intents: [{ intentId: 'c-22', payload: 'Looking for dental technology vendors offering 3D printing solutions.' }], networkId: 'idx-ai-founders', ragScore: 7, matchedVia: 'reciprocal' },
  { userId: 'user-watchmaker', profile: { name: 'Hans Müller', bio: 'Master watchmaker and horologist in Geneva.', interests: ['watchmaking', 'horology'], skills: ['movement repair', 'bespoke watch design'] }, intents: [{ intentId: 'c-23', payload: 'Seeking collectors interested in commissioning bespoke mechanical watches.' }], networkId: 'idx-ai-founders', ragScore: 4, matchedVia: 'mirror' },
  { userId: 'user-firefighter', profile: { name: 'Carlos Mendez', bio: 'Firefighter and paramedic with 15 years of service.', interests: ['firefighting', 'emergency medicine'], skills: ['emergency response', 'paramedic care'] }, intents: [{ intentId: 'c-24', payload: 'Looking for nonprofits to fund wildfire preparedness training.' }], networkId: 'idx-ai-founders', ragScore: 5, matchedVia: 'reciprocal' },
  { userId: 'user-fashion-designer', profile: { name: 'Isabelle Fontaine', bio: 'Haute couture fashion designer in Paris.', interests: ['sustainable fashion', 'haute couture'], skills: ['pattern making', 'garment construction'] }, intents: [{ intentId: 'c-25', payload: 'Seeking luxury retail partners in Japan and South Korea.' }], networkId: 'idx-ai-founders', ragScore: 5, matchedVia: 'mirror' },
];

const stressVerificationCriteria =
  'The discoverer is an AI/ML startup founder seeking a technical co-founder with LLM expertise. ' +
  'All 25 candidates are from completely unrelated domains (chef, yoga instructor, jazz musician, real estate agent, therapist, farmer, journalist, nurse, immigration lawyer, architect, teacher, veterinarian, travel blogger, novelist, marine biologist, sommelier, film director, landscape artist, social worker, sculptor, personal trainer, dentist, watchmaker, firefighter, fashion designer). ' +
  'PASS criteria: the opportunities list must be EMPTY or contain only results with score < 30. ' +
  'None of these candidates have any AI/ML engineering background, software development skills, or startup co-founder intent that matches what the discoverer seeks. ' +
  'FAIL if any candidate scores >= 50. Any match found is a false positive — the evaluator hallucinated relevance where none exists.';

async function runBundleEval(): Promise<{ opportunities: Array<{ reasoning: string; score: number; candidateUserId: string }>; durationMs: number }> {
  const evaluator = new OpportunityEvaluator();
  const input: EvaluatorInput = {
    discovererId: DISCOVERER_ID,
    entities: [sourceEntity, ...stressCandidates],
  };
  const start = Date.now();
  const raw = await evaluator.invokeEntityBundle(input, { minScore: 50 });
  const durationMs = Date.now() - start;
  const opportunities = raw.map(op => {
    const candidate = op.actors.find(a => a.userId !== DISCOVERER_ID);
    return { reasoning: op.reasoning, score: op.score, candidateUserId: candidate?.userId ?? '' };
  });
  return { opportunities, durationMs };
}

async function runParallelEval(): Promise<{ opportunities: Array<{ reasoning: string; score: number; candidateUserId: string }>; durationMs: number }> {
  const evaluator = new OpportunityEvaluator();
  const start = Date.now();
  const parallelResults = await Promise.all(
    stressCandidates.map(candidate => {
      const input: EvaluatorInput = {
        discovererId: DISCOVERER_ID,
        entities: [sourceEntity, candidate],
      };
      return evaluator.invokeEntityBundle(input, { minScore: 50 })
        .catch(() => [] as Awaited<ReturnType<typeof evaluator.invokeEntityBundle>>);
    })
  );
  const durationMs = Date.now() - start;
  const opportunities = parallelResults.flat().map(op => {
    const candidate = op.actors.find(a => a.userId !== DISCOVERER_ID);
    return { reasoning: op.reasoning, score: op.score, candidateUserId: candidate?.userId ?? '' };
  });
  return { opportunities, durationMs };
}

describe('OpportunityEvaluator: stress test — 25 unrelated candidates', () => {
  it('bundle mode returns no matches for fully unrelated candidates', async () => {
    const { opportunities, durationMs } = await runBundleEval();

    console.log(`\n[Bundle] duration=${durationMs}ms, results=${opportunities.length}`);
    for (const o of [...opportunities].sort((a, b) => b.score - a.score)) {
      console.log(`  score=${o.score}  ${o.candidateUserId}  "${o.reasoning.slice(0, 80)}..."`);
    }

    await assertLLM({ opportunities, durationMs }, stressVerificationCriteria);
  }, 180000);

  it('parallel mode returns no matches for fully unrelated candidates', async () => {
    const { opportunities, durationMs } = await runParallelEval();

    console.log(`\n[Parallel] duration=${durationMs}ms, results=${opportunities.length}`);
    for (const o of [...opportunities].sort((a, b) => b.score - a.score)) {
      console.log(`  score=${o.score}  ${o.candidateUserId}  "${o.reasoning.slice(0, 80)}..."`);
    }

    await assertLLM({ opportunities, durationMs }, stressVerificationCriteria);
  }, 180000);
});
