/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { HydeGenerator } from "../profile.hyde.generator.js";
import { beforeEach, describe, expect, it } from "bun:test";

describe('HyDE Generator', () => {
  let hydeGenerator: HydeGenerator;

  beforeEach(() => {
    hydeGenerator = new HydeGenerator();
  })

  it('should generate a profile', async () => {
    try {
      const result = await hydeGenerator.invoke(`
        # Identity\n## Name\nSeref Yarar\n## Bio\nCo-Founder of Index Network and former CTO of GoWit Technology, specializing in decentralized discovery protocols and user-centric data ownership. A Computer Engineering graduate from Bahçeşehir University with over a decade of experience in engineering leadership and digital advertising tech.\n## Location\nNew York, USA\n# Narrative\n## Context\nSeref Yarar is a seasoned technical founder currently building Index Network, a decentralized discovery protocol that allows users to create custom search engines while maintaining data ownership. Based in Brooklyn, New York, he has transitioned from a high-level corporate technical role as CTO and Co-founder of GoWit Technology (2019–2024) to the frontier of Web3 and AI intersection. His background is rooted in the Turkish tech ecosystem, having studied at Bahçeşehir University and led engineering at major Turkish digital agencies like Aleph Group (Genart Medya). Currently, he is focused on shifting the paradigm of search and digital interaction away from centralized platforms like Google and toward agentic, decentralized solutions. He is an active contributor to the developer community, particularly within the Ethereum/Web3 space (Lit Protocol, Ceramic) and the TypeScript ecosystem, maintaining over 1,400 GitHub contributions in the past year. He is also a vocal critic of the current 'swipe-based' economy of dating and search apps, advocating for AI agents that prioritize human-centric matchmaking.\n# Attributes\n## Interests\nDecentralized AI, Web3 and Blockchain Architecture, User Privacy and Personal Sovereignty, Theories of Consciousness, Digital Advertising Ecosystems, Matchmaking Algorithms\n## Skills\nSoftware Engineering, CTO / Technical Leadership, TypeScript, React Native & Expo, Smart Contracts/Web3 Development (Lit Protocol, Ceramic Network), Digital Marketing Technology, System Architecture
      `);
      expect(!!result.output.identity.bio).toBe(true);
      expect(!!result.output.attributes.interests.length).toBe(true);
      expect(!!result.output.attributes.skills.length).toBe(true);
      expect(!!result.output.narrative.context).toBe(true);
      expect(!!result.textToEmbed).toBe(true);
    } catch (e) {
      throw e;
    }
  }, 60000);
})
