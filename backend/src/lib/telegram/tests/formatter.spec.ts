import { describe, it, expect } from 'bun:test';
import {
  parseResponseSegments,
  hasStructuredBlocks,
  formatOpportunityCardHtml,
  formatOpportunityCardPlainText,
  type ResponseSegment,
} from '../formatter';

// ── parseResponseSegments ──────────────────────────────────────────────────────

describe('parseResponseSegments', () => {
  it('returns a single text segment for plain responses', () => {
    const segments = parseResponseSegments('Hello, how are you?');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ type: 'text', content: 'Hello, how are you?' });
  });

  it('parses opportunity blocks into typed card segments', () => {
    const response = [
      'Found connections.',
      '',
      '```opportunity',
      '{"opportunityId":"opp-1","name":"Alice","headline":"AI researcher"}',
      '```',
      '',
      'Want more?',
    ].join('\n');

    const segments = parseResponseSegments(response);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: 'text', content: 'Found connections.' });
    expect(segments[1].type).toBe('opportunity');
    if (segments[1].type === 'opportunity') {
      expect(segments[1].card.name).toBe('Alice');
      expect(segments[1].card.opportunityId).toBe('opp-1');
    }
    expect(segments[2]).toEqual({ type: 'text', content: 'Want more?' });
  });

  it('handles multiple consecutive opportunity blocks', () => {
    const response = [
      '```opportunity',
      '{"opportunityId":"opp-1","name":"Alice"}',
      '```',
      '',
      '```opportunity',
      '{"opportunityId":"opp-2","name":"Bob"}',
      '```',
    ].join('\n');

    const segments = parseResponseSegments(response);
    const oppSegments = segments.filter((s) => s.type === 'opportunity');
    expect(oppSegments).toHaveLength(2);
  });

  it('drops malformed JSON in opportunity blocks silently', () => {
    const response = [
      'Text before.',
      '',
      '```opportunity',
      '{invalid json}',
      '```',
      '',
      'Text after.',
    ].join('\n');

    const segments = parseResponseSegments(response);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ type: 'text', content: 'Text before.' });
    expect(segments[1]).toEqual({ type: 'text', content: 'Text after.' });
  });

  it('extracts description from intent_proposal blocks as text', () => {
    const response = [
      '```intent_proposal',
      '{"proposalId":"p-1","description":"Looking for AI researchers"}',
      '```',
    ].join('\n');

    const segments = parseResponseSegments(response);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ type: 'text', content: 'Looking for AI researchers' });
  });

  it('falls back to summary field for intent_proposal without description', () => {
    const response = [
      '```intent_proposal',
      '{"proposalId":"p-2","summary":"Web3 enthusiast"}',
      '```',
    ].join('\n');

    const segments = parseResponseSegments(response);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ type: 'text', content: 'Web3 enthusiast' });
  });

  it('returns empty array for empty input', () => {
    expect(parseResponseSegments('')).toHaveLength(0);
    expect(parseResponseSegments('   ')).toHaveLength(0);
  });

  it('preserves interleaving order of prose and blocks', () => {
    const response = [
      'Intro text.',
      '',
      '```opportunity',
      '{"opportunityId":"1","name":"Alice"}',
      '```',
      '',
      'Middle text.',
      '',
      '```opportunity',
      '{"opportunityId":"2","name":"Bob"}',
      '```',
      '',
      'Trailing text.',
    ].join('\n');

    const segments = parseResponseSegments(response);
    const types = segments.map((s) => s.type);
    expect(types).toEqual(['text', 'opportunity', 'text', 'opportunity', 'text']);
  });
});

// ── hasStructuredBlocks ────────────────────────────────────────────────────────

describe('hasStructuredBlocks', () => {
  it('returns false for text-only segments', () => {
    const segments: ResponseSegment[] = [{ type: 'text', content: 'hello' }];
    expect(hasStructuredBlocks(segments)).toBe(false);
  });

  it('returns true when opportunity segments exist', () => {
    const segments: ResponseSegment[] = [
      { type: 'text', content: 'intro' },
      { type: 'opportunity', card: { opportunityId: '1' } },
    ];
    expect(hasStructuredBlocks(segments)).toBe(true);
  });

  it('returns false for empty segments', () => {
    expect(hasStructuredBlocks([])).toBe(false);
  });
});

// ── formatOpportunityCardHtml ──────────────────────────────────────────────────

describe('formatOpportunityCardHtml', () => {
  it('renders name as bold and headline as italic', () => {
    const { text } = formatOpportunityCardHtml(
      { opportunityId: '1', name: 'Alice', headline: 'Great collaborator' },
      'https://index.network',
    );
    expect(text).toContain('<b>Alice</b>');
    expect(text).toContain('<i>Great collaborator</i>');
  });

  it('escapes HTML special characters in all fields', () => {
    const { text } = formatOpportunityCardHtml(
      {
        opportunityId: '1',
        name: 'Bob & Carol',
        headline: 'Uses <React>',
        mainText: 'Builds apps with "TypeScript" & more',
      },
      'https://index.network',
    );
    expect(text).toContain('Bob &amp; Carol');
    expect(text).toContain('&lt;React&gt;');
    expect(text).toContain('&quot;TypeScript&quot;');
  });

  it('includes main text body', () => {
    const { text } = formatOpportunityCardHtml(
      { opportunityId: '1', name: 'Eve', mainText: 'Eve is an expert in cryptography.' },
      'https://index.network',
    );
    expect(text).toContain('Eve is an expert in cryptography.');
  });

  it('includes mutual intents label with emoji', () => {
    const { text } = formatOpportunityCardHtml(
      { opportunityId: '1', name: 'Dave', mutualIntentsLabel: 'Aligned goals' },
      'https://index.network',
    );
    expect(text).toContain('🎯 Aligned goals');
  });

  it('includes narrator chip as italic editorial note', () => {
    const { text } = formatOpportunityCardHtml(
      { opportunityId: '1', name: 'Eve', narratorChip: { name: 'Index', text: 'Strong overlap in AI' } },
      'https://index.network',
    );
    expect(text).toContain('💡 <i>Strong overlap in AI</i>');
  });

  it('generates inline keyboard with action button', () => {
    const { keyboard } = formatOpportunityCardHtml(
      { opportunityId: '1', name: 'Frank', primaryActionLabel: 'Start Chat' },
      'https://index.network',
    );
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]).toHaveLength(1);
    expect(keyboard[0][0].text).toContain('Start Chat');
    expect(keyboard[0][0].url).toBe('https://index.network/opportunities');
  });

  it('uses "View" as default button label when primaryActionLabel is absent', () => {
    const { keyboard } = formatOpportunityCardHtml(
      { opportunityId: '1', name: 'Grace' },
      'https://app.example.com',
    );
    expect(keyboard[0][0].text).toContain('View');
    expect(keyboard[0][0].url).toBe('https://app.example.com/opportunities');
  });

  it('handles minimal card with only name', () => {
    const { text } = formatOpportunityCardHtml(
      { opportunityId: '1', name: 'Zoe' },
      'https://index.network',
    );
    expect(text).toContain('<b>Zoe</b>');
    // Should not contain undefined or null
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('defaults name to "Someone" when missing', () => {
    const { text } = formatOpportunityCardHtml(
      { opportunityId: '1' },
      'https://index.network',
    );
    expect(text).toContain('<b>Someone</b>');
  });
});

// ── formatOpportunityCardPlainText ─────────────────────────────────────────────

describe('formatOpportunityCardPlainText', () => {
  it('renders card without HTML tags', () => {
    const text = formatOpportunityCardPlainText({
      opportunityId: '1',
      name: 'Alice',
      headline: 'AI researcher',
      mainText: 'Alice works in AI.',
      mutualIntentsLabel: 'Aligned goals',
      narratorChip: { name: 'Index', text: 'Strong fit' },
    });
    expect(text).toContain('Alice');
    expect(text).toContain('AI researcher');
    expect(text).toContain('Alice works in AI.');
    expect(text).toContain('🎯 Aligned goals');
    expect(text).toContain('💡 Strong fit');
    expect(text).not.toContain('<b>');
    expect(text).not.toContain('<i>');
  });

  it('handles card with only name', () => {
    const text = formatOpportunityCardPlainText({ opportunityId: '1', name: 'Bob' });
    expect(text).toBe('Bob');
  });
});
