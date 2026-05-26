/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { ChatTitleGenerator } from "../chat.title.generator.js";

describe('ChatTitleGenerator', () => {
  const generator = new ChatTitleGenerator();

  it('returns "New chat" for greeting-only conversation', async () => {
    const result = await generator.invoke({
      messages: [
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there! How can I help you today?' },
      ],
    });
    expect(result.toLowerCase()).toContain('new chat');
  }, 30000);

  it('returns a short title (≤6 words) for a substantive conversation', async () => {
    const result = await generator.invoke({
      messages: [
        { role: 'user', content: 'I want to find a co-founder with ML engineering experience for my AI startup.' },
        { role: 'assistant', content: 'I can help you discover potential co-founders. Looking at your profile and network...' },
      ],
    });
    const wordCount = result.trim().split(/\s+/).length;
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(wordCount).toBeLessThanOrEqual(6);
  }, 30000);

  it('returns a string result for any valid input', async () => {
    const result = await generator.invoke({
      messages: [
        { role: 'user', content: 'Find me investors in climate tech in Berlin.' },
        { role: 'assistant', content: 'Searching for climate tech investors in Berlin...' },
      ],
    });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  }, 30000);
});
