/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { IndexNegotiator } from "../negotiation.agent.js";
import type { UserNegotiationContext, SeedAssessment } from "../negotiation.state.js";
import { assertLLM } from "../../shared/agent/tests/llm-assert.js";

/**
 * Tests that the negotiator respects the discoveryQuery as the primary criterion
 * and doesn't accept matches that only satisfy background intents.
 */

const discovererUser: UserNegotiationContext = {
  id: 'user-yanki',
  intents: [
    { id: 'i1', title: 'Connect with visual artists', description: 'Connect and collaborate with visual artists', confidence: 0.9 },
    { id: 'i2', title: 'Game developers', description: 'Connect with Unreal Engine game developers for collaboration', confidence: 0.85 },
  ],
  profile: { name: 'Yanki', bio: 'Creative technologist and game developer', skills: ['product strategy', 'developer tools'] },
};

const characterArtist: UserNegotiationContext = {
  id: 'user-yuki',
  intents: [
    { id: 'i3', title: 'Art collaborations', description: 'Seeking collaborative projects with other creatives', confidence: 0.9 },
  ],
  profile: { name: 'Yuki Tanaka', bio: 'Visual artist and illustrator. Digital and traditional, focus on character design.', skills: ['illustration', 'character design', 'digital painting'] },
};

const seedAssessment: SeedAssessment = {
  reasoning: 'Character design artist found via visual arts lens.',
  valencyRole: 'peer',
};

const indexContext = { networkId: 'net-1', prompt: 'Creative professionals network' };

describe('IndexNegotiator: discoveryQuery priority', () => {
  const negotiator = new IndexNegotiator();

  it('rejects a character artist when discoveryQuery is "samurai"', async () => {
    const result = await negotiator.invoke({
      ownUser: discovererUser,
      otherUser: characterArtist,
      indexContext,
      seedAssessment,
      history: [],
      isDiscoverer: true,
      discoveryQuery: 'samurai',
    });

    console.log('\n[Negotiator: "samurai" query vs character artist]');
    console.log(`  action=${result.action}`);
    console.log(`  reasoning="${result.assessment.reasoning.slice(0, 200)}..."`);

    await assertLLM(
      { discoveryQuery: 'samurai', candidate: 'Yuki Tanaka — character design artist', action: result.action, reasoning: result.assessment.reasoning },
      'The discoverer searched for "samurai" — an identity query meaning someone who IS a samurai. ' +
      'Yuki Tanaka is a character design artist, not a samurai. Even though she matches the background intent "connect with visual artists", ' +
      'the discovery query takes priority. ' +
      'PASS criteria: The action should be "reject" (preferred) or "counter" with strong reservations about the identity mismatch. ' +
      'The reasoning must acknowledge that the user searched for "samurai" and this candidate is not one. ' +
      'FAIL if action is "accept" or "propose" without acknowledging the identity mismatch. ' +
      'FAIL if the reasoning primarily justifies the match based on the "visual artists" background intent rather than the "samurai" query.'
    );
  }, 120000);

  it('accepts a good match even with discoveryQuery when identity is satisfied', async () => {
    const kendoInstructor: UserNegotiationContext = {
      id: 'user-kendo',
      intents: [
        { id: 'i4', title: 'Teach kendo', description: 'Offering kendo and traditional Japanese martial arts instruction', confidence: 0.95 },
      ],
      profile: { name: 'Takeshi Yamamoto', bio: 'Kendo 7th dan. Samurai martial arts instructor and historian of bushido tradition.', skills: ['kendo', 'iaido', 'bushido history', 'martial arts instruction'] },
    };

    const result = await negotiator.invoke({
      ownUser: discovererUser,
      otherUser: kendoInstructor,
      indexContext,
      seedAssessment: { reasoning: 'Samurai martial arts practitioner found.', valencyRole: 'agent' },
      history: [],
      isDiscoverer: true,
      discoveryQuery: 'samurai',
    });

    console.log('\n[Negotiator: "samurai" query vs kendo instructor]');
    console.log(`  action=${result.action}`);
    console.log(`  reasoning="${result.assessment.reasoning.slice(0, 200)}..."`);

    await assertLLM(
      { discoveryQuery: 'samurai', candidate: 'Takeshi Yamamoto — kendo instructor and samurai historian', action: result.action, reasoning: result.assessment.reasoning },
      'The discoverer searched for "samurai". Takeshi Yamamoto is a kendo 7th dan, samurai martial arts instructor and historian — this IS a samurai practitioner. ' +
      'PASS criteria: The action should be "propose" or "accept". The reasoning should identify this as a strong match for the "samurai" query. ' +
      'FAIL if the action is "reject".'
    );
  }, 120000);

  it('candidate side proposes without discoveryQuery (graph only passes query to discoverer)', async () => {
    const investor: UserNegotiationContext = {
      id: 'user-investor',
      intents: [
        { id: 'i5', title: 'AI deals', description: 'Looking for early-stage AI startups to invest in', confidence: 0.95 },
      ],
      profile: { name: 'Jane VC', bio: 'General Partner at AI Ventures, early-stage investor in consumer AI.', skills: ['venture capital', 'AI investing', 'due diligence'] },
    };

    const founder: UserNegotiationContext = {
      id: 'user-founder',
      intents: [
        { id: 'i6', title: 'Find investors', description: 'Seeking seed funding for consumer AI product', confidence: 0.9 },
      ],
      profile: { name: 'Sam Founder', bio: 'Co-founder building a consumer AI product. UX and product design background.', skills: ['product design', 'fundraising'] },
    };

    // Simulate the candidate (investor) side WITHOUT discoveryQuery,
    // matching what the graph now does after the fix.
    const result = await negotiator.invoke({
      ownUser: investor,
      otherUser: founder,
      indexContext,
      seedAssessment: { reasoning: 'Founder seeking AI investment, investor found via consumer AI lens.', valencyRole: 'agent' },
      history: [{
        action: 'propose' as const,
        assessment: { reasoning: 'Sam is looking for investors and Jane is an investor in consumer AI.', suggestedRoles: { ownUser: 'patient' as const, otherUser: 'agent' as const } },
      }],
      isDiscoverer: false,
      // No discoveryQuery — the graph gates this on isSource
    });

    console.log('\n[Negotiator: candidate investor side, no discoveryQuery]');
    console.log(`  action=${result.action}`);
    console.log(`  reasoning="${result.assessment.reasoning.slice(0, 200)}..."`);

    await assertLLM(
      { discoveryQuery: null, candidate: 'Jane VC — GP at AI Ventures, investor in consumer AI', action: result.action, reasoning: result.assessment.reasoning },
      'Jane VC is an investor being asked to evaluate a founder seeking investment. No discoveryQuery is present (the graph only passes it to the discoverer side). ' +
      'Jane should evaluate based on profile and intent alignment — a founder seeking AI investment matches her stated intent to find AI startups. ' +
      'PASS criteria: The action should be "accept" or "counter" — NOT "reject". The reasoning should evaluate fit based on intents and profiles. ' +
      'FAIL if the action is "reject" due to applying an inverted query check (e.g. "Sam is not an investor").'
    );
  }, 120000);

  it('proposes normally when no discoveryQuery is set (background intent match)', async () => {
    const result = await negotiator.invoke({
      ownUser: discovererUser,
      otherUser: characterArtist,
      indexContext,
      seedAssessment,
      history: [],
      isDiscoverer: true,
      // No discoveryQuery — background intent matching
    });

    console.log('\n[Negotiator: no query, background intent match vs character artist]');
    console.log(`  action=${result.action}`);
    console.log(`  reasoning="${result.assessment.reasoning.slice(0, 200)}..."`);

    // Without a discoveryQuery, the character artist DOES match the "connect with visual artists" intent
    await assertLLM(
      { discoveryQuery: null, candidate: 'Yuki Tanaka — character design artist', action: result.action, reasoning: result.assessment.reasoning },
      'No explicit discovery query was set. The discoverer has a background intent "Connect and collaborate with visual artists". ' +
      'Yuki Tanaka IS a visual artist. This is a legitimate intent-based match. ' +
      'PASS criteria: The action should be "propose" (opening turn for a valid match). ' +
      'FAIL if the action is "reject" — without an explicit query, background intent matching is the correct behavior.'
    );
  }, 120000);
});
