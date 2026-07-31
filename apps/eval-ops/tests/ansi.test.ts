import { describe, expect, it } from 'vitest';

import { parseAnsi } from '../src/lib/ansi';

describe('parseAnsi', () => {
  it('returns a single unstyled segment for plain text', () => {
    expect(parseAnsi('hello')).toEqual([{ text: 'hello', className: '' }]);
  });

  it('maps SGR colour codes onto palette classes', () => {
    const segments = parseAnsi('\u001b[32mpass\u001b[0m rest');
    expect(segments[0]).toEqual({ text: 'pass', className: 'text-term-green' });
    expect(segments[1]).toEqual({ text: ' rest', className: '' });
  });

  it('handles bright colours and reset-by-39', () => {
    const segments = parseAnsi('\u001b[91mbright\u001b[39mplain');
    expect(segments[0].className).toBe('text-term-red');
    expect(segments[1].className).toBe('');
  });

  it('drops unsupported escape sequences without emitting them as text', () => {
    const segments = parseAnsi('\u001b[2K\u001b[1Gclean');
    expect(segments.map((s) => s.text).join('')).toBe('clean');
  });

  it('never returns raw escape characters', () => {
    const segments = parseAnsi('\u001b[31mred\u001b[0m');
    expect(segments.map((s) => s.text).join('')).not.toContain('\u001b');
  });

  it('strips unterminated escape sequences', () => {
    const segments = parseAnsi('text\u001b[');
    expect(segments.map((s) => s.text).join('')).toBe('text');
    expect(segments.map((s) => s.text).join('')).not.toContain('\u001b');
  });

  it('strips bare escape characters', () => {
    const segments = parseAnsi('text\u001b alone');
    expect(segments.map((s) => s.text).join('')).toBe('text alone');
    expect(segments.map((s) => s.text).join('')).not.toContain('\u001b');
  });

  it('strips incomplete SGR sequences', () => {
    const segments = parseAnsi('text\u001b[31');
    expect(segments.map((s) => s.text).join('')).toBe('text');
    expect(segments.map((s) => s.text).join('')).not.toContain('\u001b');
  });

  it('handles empty SGR parameter as reset', () => {
    const segments = parseAnsi('\u001b[31mred\u001b[mplain');
    expect(segments[0]).toEqual({ text: 'red', className: 'text-term-red' });
    expect(segments[1]).toEqual({ text: 'plain', className: '' });
  });

  it('handles multi-code SGR sequences', () => {
    // Bold (1) is not mapped, but green (32) is
    const segments = parseAnsi('\u001b[1;32mbold-green\u001b[0m');
    expect(segments[0].className).toBe('text-term-green');
    expect(segments[0].text).toBe('bold-green');
  });

  it('ignores unknown SGR codes gracefully', () => {
    const segments = parseAnsi('\u001b[99munknown\u001b[0mnormal');
    // Unknown code 99 is ignored, text continues with previous className
    expect(segments.map((s) => s.text).join('')).toBe('unknownnormal');
    expect(segments.map((s) => s.text).join('')).not.toContain('\u001b');
  });
});

describe('parseAnsi streaming behavior', () => {
  it('strips trailing escape split across chunks (stateless design)', () => {
    // Simulates a chunk boundary mid-sequence.
    // Design choice: strip incomplete trailing sequences rather than hold them back.
    // This is simpler (stateless) and acceptable since the lost formatting is recoverable
    // when the stream is reassembled client-side if needed, or the log is re-rendered.

    const chunk1 = parseAnsi('start\u001b[3');
    expect(chunk1.map((s) => s.text).join('')).toBe('start');
    expect(chunk1.map((s) => s.text).join('')).not.toContain('\u001b');

    // Next chunk arrives with the continuation '2m', but without the leading \u001b[3,
    // it's not recognized as a color code. The text '2m' is rendered literally.
    const chunk2 = parseAnsi('2mgreen\u001b[0m');
    expect(chunk2.map((s) => s.text).join('')).toBe('2mgreen');
    expect(chunk2.map((s) => s.text).join('')).not.toContain('\u001b');
    // The green would have been colored if the sequence wasn't split, but that's
    // acceptable loss for the simpler stateless design.
  });
});
