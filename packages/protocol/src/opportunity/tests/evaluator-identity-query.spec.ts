/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { OpportunityEvaluator, type EvaluatorInput, type EvaluatorEntity } from "../opportunity.evaluator.js";
import { assertLLM } from "../../shared/agent/tests/llm-assert.js";

/**
 * Identity query tests: when a user searches for a role/identity term
 * (e.g. "samurai", "investors"), the evaluator must match against the
 * identity predicate (IS-A), not topical association.
 *
 * A character design artist who draws samurai is NOT a samurai.
 * An engineer who raised funding is NOT an investor.
 */

const DISCOVERER_ID = 'user-yanki';

const sourceEntity: EvaluatorEntity = {
  userId: DISCOVERER_ID,
  profile: {
    name: '(source user)',
    bio: 'Professional with a focus on creative technology and game development.',
    location: 'Remote',
    interests: ['game development', 'visual arts', 'interactive experiences'],
    skills: ['product strategy', 'developer tools'],
  },
  intents: [
    { intentId: 'i-1', payload: 'Connect and collaborate with visual artists' },
    { intentId: 'i-2', payload: 'Connect with Unreal Engine game developers for collaboration and knowledge sharing' },
  ],
  networkId: 'idx-commons',
};

describe('OpportunityEvaluator: identity query handling', () => {
  const evaluator = new OpportunityEvaluator();

  it('rejects a character design artist for "samurai" identity query', async () => {
    const candidate: EvaluatorEntity = {
      userId: 'user-yuki',
      profile: {
        name: 'Yuki Tanaka',
        bio: 'Visual artist and illustrator. Digital and traditional, focus on character design.',
        location: 'Tokyo, JP',
        interests: ['illustration', 'character design', 'digital art'],
        skills: ['illustration', 'character design', 'digital painting'],
      },
      networkId: 'idx-commons',
      ragScore: 100,
      matchedVia: 'visual artists interested in historical or cultural themes',
    };

    const input: EvaluatorInput = {
      discovererId: DISCOVERER_ID,
      entities: [sourceEntity, candidate],
      discoveryQuery: 'samurai',
    };

    const results = await evaluator.invokeEntityBundle(input, { minScore: 30, returnAll: true });

    console.log('\n[Identity Query: "samurai" vs character design artist]');
    for (const op of results) {
      console.log(`  score=${op.score}  reasoning="${op.reasoning.slice(0, 120)}..."`);
    }

    // The character design artist should NOT pass as a "samurai" match
    // Either no results, or score should be well below 50
    await assertLLM(
      { query: 'samurai', candidate: 'Yuki Tanaka — character design artist', results },
      'The query "samurai" is an IDENTITY query — the user wants someone who IS a samurai (practitioner, martial artist, cultural identity). ' +
      'Yuki Tanaka is a character design artist who may draw samurai-themed art but IS NOT a samurai. ' +
      'PASS criteria: Either no opportunities returned, OR all opportunities have score < 50. ' +
      'The reasoning must NOT say this is a good or strong match. It may acknowledge tangential relevance but must recognize the identity mismatch. ' +
      'FAIL if any opportunity has score >= 50 or if the reasoning presents this as a solid/strong connection.'
    );
  }, 120000);

  it('rejects an engineer who raised funding for "investors" identity query', async () => {
    const candidate: EvaluatorEntity = {
      userId: 'user-engineer',
      profile: {
        name: 'Sam Rivera',
        bio: 'ML engineer. Previously worked on recommendation systems and NLP. Raised a $500K pre-seed round for a side project.',
        location: 'Austin, TX',
        interests: ['machine learning', 'NLP', 'startups'],
        skills: ['Python', 'PyTorch', 'MLOps'],
      },
      intents: [
        { intentId: 'c-1', payload: 'I want to find a product-minded founder to pair with on an LLM-based B2B tool.' },
      ],
      networkId: 'idx-commons',
      ragScore: 65,
      matchedVia: 'startup funding and investment',
    };

    const input: EvaluatorInput = {
      discovererId: DISCOVERER_ID,
      entities: [sourceEntity, candidate],
      discoveryQuery: 'investors',
    };

    const results = await evaluator.invokeEntityBundle(input, { minScore: 30, returnAll: true });

    console.log('\n[Identity Query: "investors" vs ML engineer who raised funding]');
    for (const op of results) {
      console.log(`  score=${op.score}  reasoning="${op.reasoning.slice(0, 120)}..."`);
    }

    await assertLLM(
      { query: 'investors', candidate: 'Sam Rivera — ML engineer who raised funding', results },
      'The query "investors" is an IDENTITY query — the user wants someone who IS an investor (VC, angel, fund manager). ' +
      'Sam Rivera is an ML engineer who has raised funding but is NOT an investor — raising money is the opposite of investing it. ' +
      'PASS criteria: Either no opportunities returned, OR all opportunities have score < 50. ' +
      'FAIL if any opportunity has score >= 50.'
    );
  }, 120000);

  it('accepts an actual investor for "investors" identity query', async () => {
    const candidate: EvaluatorEntity = {
      userId: 'user-investor',
      profile: {
        name: 'Sarah Hoople Shere',
        bio: 'Angel investor and former CTO. Writing checks for pre-seed and seed developer tools and infrastructure startups.',
        location: 'San Francisco, CA',
        interests: ['developer tools', 'infrastructure', 'early-stage investing'],
        skills: ['due diligence', 'technical evaluation', 'portfolio management'],
      },
      intents: [
        { intentId: 'c-2', payload: 'Want to connect with technical founders who have deep domain expertise and are building for developers.' },
      ],
      networkId: 'idx-commons',
      ragScore: 55,
      matchedVia: 'startup funding and investment',
    };

    const input: EvaluatorInput = {
      discovererId: DISCOVERER_ID,
      entities: [sourceEntity, candidate],
      discoveryQuery: 'investors',
    };

    const results = await evaluator.invokeEntityBundle(input, { minScore: 30, returnAll: true });

    console.log('\n[Identity Query: "investors" vs actual angel investor]');
    for (const op of results) {
      console.log(`  score=${op.score}  reasoning="${op.reasoning.slice(0, 120)}..."`);
    }

    await assertLLM(
      { query: 'investors', candidate: 'Sarah Hoople Shere — angel investor', results },
      'The query "investors" is an IDENTITY query. Sarah Hoople Shere IS an angel investor who invests in developer tools startups. ' +
      'The discoverer works in creative technology — there is alignment. ' +
      'PASS criteria: At least one opportunity with score >= 70. ' +
      'FAIL if no opportunities or all scores < 70.'
    );
  }, 120000);

  it('does not let background intents override identity query', async () => {
    // The source user has "Connect and collaborate with visual artists" as an intent.
    // A character design artist DOES match that intent.
    // But the query is "samurai" — the intent should not rescue this match.
    const candidate: EvaluatorEntity = {
      userId: 'user-yuki',
      profile: {
        name: 'Yuki Tanaka',
        bio: 'Visual artist and illustrator. Digital and traditional, focus on character design.',
        location: 'Tokyo, JP',
        interests: ['illustration', 'character design', 'digital art'],
        skills: ['illustration', 'character design', 'digital painting'],
      },
      networkId: 'idx-commons',
      ragScore: 100,
      matchedVia: 'visual artists interested in historical or cultural themes',
    };

    const input: EvaluatorInput = {
      discovererId: DISCOVERER_ID,
      entities: [sourceEntity, candidate],
      discoveryQuery: 'samurai',
    };

    const results = await evaluator.invokeEntityBundle(input, { minScore: 30, returnAll: true });

    console.log('\n[Intent override check: "samurai" query with "visual artists" background intent]');
    for (const op of results) {
      console.log(`  score=${op.score}  reasoning="${op.reasoning.slice(0, 120)}..."`);
    }

    // Even though the background intent matches, the query takes priority
    await assertLLM(
      { query: 'samurai', backgroundIntent: 'Connect and collaborate with visual artists', candidate: 'Yuki Tanaka — character design artist', results },
      'The explicit search query "samurai" is an identity query that takes pragmatic priority over the background intent "Connect and collaborate with visual artists". ' +
      'Even though Yuki Tanaka matches the background intent well, the user typed "samurai" — they want someone who IS a samurai. ' +
      'PASS criteria: Either no opportunities, OR all opportunities score < 50. The reasoning must not say "matches the user\'s intent to connect with visual artists" as the primary justification. ' +
      'FAIL if any opportunity scores >= 50 based on the background intent overriding the actual query.'
    );
  }, 120000);
});
