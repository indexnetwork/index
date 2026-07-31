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
});
