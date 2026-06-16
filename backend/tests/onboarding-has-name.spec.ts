import { describe, it, expect } from 'bun:test';

/**
 * Tests for the hasName derivation used in resolveChatContext (tool.helpers.ts:182)
 * and buildGreeting (frontend/src/app/onboarding/page.tsx).
 *
 * The hasName check must handle null, undefined, empty string, and whitespace-only values.
 */
describe('hasName derivation', () => {
  // Mirrors the logic in resolveChatContext: `!!user.name?.trim()`
  function deriveHasName(name: string | null | undefined): boolean {
    return !!name?.trim();
  }

  it('returns true for a normal name', () => {
    expect(deriveHasName('Alice Smith')).toBe(true);
  });

  it('returns false for null', () => {
    expect(deriveHasName(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(deriveHasName(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(deriveHasName('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(deriveHasName('   ')).toBe(false);
    expect(deriveHasName('\t')).toBe(false);
    expect(deriveHasName(' \n ')).toBe(false);
  });

  it('returns true for name with leading/trailing whitespace', () => {
    expect(deriveHasName('  Alice  ')).toBe(true);
  });
});

/**
 * Tests for buildGreeting (frontend/src/app/onboarding/page.tsx).
 * Mirrors the function to verify both greeting paths.
 */
describe('buildGreeting', () => {
  const GREETING_PREAMBLE = `Hey, I'm Index. I help the right people find you — and help you find them.

I learn what you're working on, what you care about, and what you're open to right now. From there, I exchange signals with other agents and quietly look for moments where things line up — when a conversation makes sense, when an idea connects, or when an opportunity becomes real. When someone shows up, I'll tell you why and what could happen between you two.

Let's get you set up.`;

  function buildGreeting(hasName: boolean, userName?: string): string {
    return hasName
      ? `${GREETING_PREAMBLE}\nYou're ${userName}, right?`
      : `${GREETING_PREAMBLE} What's your name, and what's your LinkedIn, Twitter/X, or GitHub?`;
  }

  it('includes name confirmation when hasName is true', () => {
    const result = buildGreeting(true, '**Alice**');
    expect(result).toContain("You're **Alice**, right?");
    expect(result).toStartWith(GREETING_PREAMBLE);
  });

  it('asks for name and socials when hasName is false', () => {
    const result = buildGreeting(false);
    expect(result).toContain("What's your name");
    expect(result).toContain('LinkedIn');
    expect(result).toContain('Twitter/X');
    expect(result).toContain('GitHub');
    expect(result).toStartWith(GREETING_PREAMBLE);
  });

  it('includes the preamble in both cases', () => {
    const withName = buildGreeting(true, '**Bob**');
    const withoutName = buildGreeting(false);
    expect(withName).toContain('I help the right people find you');
    expect(withoutName).toContain('I help the right people find you');
  });
});
