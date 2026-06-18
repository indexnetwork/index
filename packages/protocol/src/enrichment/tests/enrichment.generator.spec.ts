/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { EnrichmentGenerator } from "../enrichment.generator.js";
import { beforeEach, describe, expect, it } from "bun:test";

const FIXTURE_RESULTS = JSON.stringify([
  {
    title: "Seref Yarar – Index Network",
    content: "Seref Yarar is the founder of Index Network, a privacy-preserving discovery protocol. Previously built tools for decentralized identity and Web3 infrastructure. Based in Istanbul, Turkey."
  },
  {
    title: "serefyarar (Seref Yarar) · GitHub",
    content: "serefyarar has 42 public repositories. Contributor to open-source projects in TypeScript, Solidity, and distributed systems. Interests include decentralized protocols, AI agents, and developer tooling."
  },
  {
    title: "Seref Yarar on LinkedIn",
    content: "Founder at Index Network. Former software engineer with experience in blockchain, distributed systems, and AI. Skills: TypeScript, Node.js, Solidity, LangChain, PostgreSQL."
  }
], null, 2);

describe('Profile Generator', () => {
  let profileGenerator: EnrichmentGenerator;

  beforeEach(() => {
    profileGenerator = new EnrichmentGenerator();
  })

  it('should generate a profile', async () => {
    const result = await profileGenerator.invoke(FIXTURE_RESULTS);
    expect(!!result.output.identity.bio).toBe(true);
    expect(!!result.output.identity.location).toBe(true);
    expect(!!result.output.identity.name).toBe(true);
    expect(!!result.output.attributes.interests.length).toBe(true);
    expect(!!result.output.attributes.skills.length).toBe(true);
    expect(!!result.output.narrative.context).toBe(true);
    expect(!!result.textToEmbed).toBe(true);
  }, 60000);
})
