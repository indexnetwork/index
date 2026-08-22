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

/**
 * Live-LLM smoke test (real OpenRouter call) — OPT-IN via RUN_LLM_TESTS=1.
 *
 * It is gated off by default for two reasons: (1) it makes a real, slow,
 * non-deterministic model call, and (2) sibling specs in this directory
 * (`enrichment.{decompose,public-lookup,privacy-tools}.spec.ts`) replace the
 * `enrichment.generator.js` module via `mock.module`, which bun applies
 * process-globally with no per-file restore — so under a batch run
 * (`bun test src/enrichment/tests/`) this spec would import the leaked stub
 * instead of the real generator and flake. Run it in isolation:
 *   RUN_LLM_TESTS=1 bun test src/enrichment/tests/enrichment.generator.spec.ts
 */
const RUN_LLM_TESTS = process.env.RUN_LLM_TESTS === '1';

describe('Profile Generator', () => {
  let profileGenerator: EnrichmentGenerator;

  beforeEach(() => {
    profileGenerator = new EnrichmentGenerator();
  })

  it.skipIf(!RUN_LLM_TESTS)('should generate a profile (live LLM; set RUN_LLM_TESTS=1)', async () => {
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
