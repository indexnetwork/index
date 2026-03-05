/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it } from "bun:test";
import { ExplicitIntentInferrer } from "../intent.inferrer";

describe('ExplicitIntentInferrer - Basic Inference', () => {
  const inferrer = new ExplicitIntentInferrer();

  // We assume the user profile context string
  const profileContext = "User is an experienced software engineer interested in AI and crypto.";

  it('should extract a clear explicit goal', async () => {
    const content = "I want to deploy a Solidity contract to Ethereum mainnet by tomorrow.";
    const result = await inferrer.invoke(content, profileContext);

    expect(result.intents.length).toBeGreaterThan(0);
    const intent = result.intents.find(i => i.type === 'goal');
    expect(intent).toBeDefined();
    expect(intent?.description).toContain("Deploy");
    expect(intent?.confidence).toBe("high");
  }, 30000);

  it('should identify a tombstone (completed goal)', async () => {
    const content = "I finished the React course. It's done.";
    const result = await inferrer.invoke(content, profileContext);

    const tombstone = result.intents.find(i => i.type === 'tombstone');
    expect(tombstone).toBeDefined();
    expect(tombstone?.description).toContain("React course");
  }, 30000);

  it('should ignore vague or phatic communication', async () => {
    const content = "Hey how are you?";
    const result = await inferrer.invoke(content, profileContext);
    // Should be empty or filtered out by the rules
    // The extraction might find nothing or find it low confidence. 
    // Our prompt says "IGNORE purely phatic communication... return empty intents"
    expect(result.intents.length).toBe(0);
  }, 30000);
});

describe('ExplicitIntentInferrer - InferrerOptions', () => {
  const inferrer = new ExplicitIntentInferrer();

  const mockProfile = `
# User Profile

## Identity
Name: John Doe
Role: Software Engineer

## Narrative
I'm passionate about learning new technologies and building scalable systems.
I've been exploring AI/ML and want to transition into that space.

## Current Goals
- Master machine learning fundamentals
- Build a portfolio of ML projects
- Network with AI researchers
`;

  it('should return empty array when allowProfileFallback is false and no content provided', async () => {
    const result = await inferrer.invoke(
      null, 
      mockProfile, 
      { 
        allowProfileFallback: false,
        operationMode: 'create'
      }
    );
    
    expect(result.intents.length).toBe(0);
  }, 30000);

  it('should infer from profile when allowProfileFallback is true and no content provided', async () => {
    const result = await inferrer.invoke(
      null, 
      mockProfile, 
      { 
        allowProfileFallback: true,
        operationMode: 'create'
      }
    );
    
    expect(result.intents.length).toBeGreaterThan(0);
  }, 30000);

  it('should infer from explicit content regardless of fallback setting', async () => {
    const result = await inferrer.invoke(
      'I want to learn Rust programming and build a web framework',
      mockProfile,
      { 
        allowProfileFallback: false,
        operationMode: 'create'
      }
    );
    
    expect(result.intents.length).toBeGreaterThan(0);
  }, 30000);

  it('should default to allowProfileFallback: true for backward compatibility', async () => {
    const result = await inferrer.invoke(
      null,
      mockProfile
      // No options provided
    );
    
    expect(result.intents.length).toBeGreaterThan(0);
  }, 30000);

  it('should handle update operation mode with content', async () => {
    const result = await inferrer.invoke(
      'Change my ML goal to focus on computer vision instead',
      mockProfile,
      { 
        allowProfileFallback: false,
        operationMode: 'update'
      }
    );
    
    expect(result.intents.length).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('should return empty array for phatic communication', async () => {
    const result = await inferrer.invoke(
      'Hello, how are you?',
      mockProfile,
      {
        allowProfileFallback: true,
        operationMode: 'create'
      }
    );

    expect(result.intents.length).toBe(0);
  }, 30000);
});

describe('ExplicitIntentInferrer - Query Grounding (IND-118)', () => {
  const inferrer = new ExplicitIntentInferrer();

  const richProfile = `
# User Profile

## Identity
Name: Alex Chen
Role: Founder & CTO

## Narrative
Building a decentralized discovery protocol using LangGraph and PostgreSQL.
Previously worked on blockchain infrastructure and DeFi protocols.
Interested in expanding the team and securing Series A funding.

## Attributes
Skills: TypeScript, LangGraph, PostgreSQL, Solidity, DeFi
Interests: AI agents, decentralized systems, venture capital
`;

  const profileTerms = ['decentralized', 'series a', 'defi', 'blockchain', 'venture capital', 'funding'];

  it('should infer intents related to the query, not unrelated profile goals', async () => {
    const result = await inferrer.invoke(
      'artist',
      richProfile,
      {
        allowProfileFallback: false,
        operationMode: 'create'
      }
    );

    // Must produce at least one intent grounded in the query
    expect(result.intents.length).toBeGreaterThan(0);
    const hasArtistGrounding = result.intents.some(i =>
      i.description.toLowerCase().includes('artist')
    );
    expect(hasArtistGrounding).toBe(true);

    // Every inferred intent should be grounded in the query ("artist"),
    // not drifting to the user's profile topics (crypto, funding, etc.)
    for (const intent of result.intents) {
      const desc = intent.description.toLowerCase();
      for (const term of profileTerms) {
        expect(desc).not.toContain(term);
      }
    }
  }, 30000);

  it('should produce intents semantically related to a short query', async () => {
    const result = await inferrer.invoke(
      'looking for a photographer',
      richProfile,
      {
        allowProfileFallback: false,
        operationMode: 'create'
      }
    );

    // At least one intent should mention "photograph" (photographer, photography, etc.)
    const hasPhotograph = result.intents.some(i =>
      i.description.toLowerCase().includes('photograph')
    );
    expect(hasPhotograph).toBe(true);
  }, 30000);
});
