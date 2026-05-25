/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { IntentClarifier } from "../intent.clarifier.js";

describe('IntentClarifier', () => {
  const clarifier = new IntentClarifier();

  it('returns needsClarification=false for a specific, actionable intent', async () => {
    const result = await clarifier.invoke(
      'Looking for a senior ML engineer in Berlin with experience in production LLM systems',
      'Full-stack developer building AI-native apps',
      '',
    );
    expect(result.needsClarification).toBe(false);
    expect(result.suggestedDescription).toBeTruthy();
  }, 60000);

  it('returns needsClarification=true for a vague, unactionable intent', async () => {
    const result = await clarifier.invoke(
      'find a job',
      '',
      '',
    );
    expect(result.needsClarification).toBe(true);
    expect(result.clarificationMessage).toBeTruthy();
  }, 60000);

  it('returns suggestedDescription for any intent', async () => {
    const result = await clarifier.invoke(
      'seeking investors for climate tech startup in Europe',
      'Founder at a carbon capture startup',
      '',
    );
    expect(typeof result.suggestedDescription === 'string' || result.suggestedDescription === null).toBe(true);
    expect(result.needsClarification).toBeDefined();
  }, 60000);
});
