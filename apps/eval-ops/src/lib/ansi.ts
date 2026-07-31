/**
 * Minimal ANSI SGR parser for harness output.
 *
 * Only colour is interpreted; cursor movement and erase sequences are dropped.
 * Output is rendered as React text nodes, never as HTML — the log is untrusted
 * output of a model-driven process.
 */
export interface AnsiSegment {
  text: string;
  className: string;
}

const SGR_CLASS: Record<number, string> = {
  30: 'text-term-dim',
  31: 'text-term-red',
  32: 'text-term-green',
  33: 'text-term-yellow',
  34: 'text-term-blue',
  35: 'text-term-magenta',
  36: 'text-term-cyan',
  37: 'text-term-white',
  90: 'text-term-dim',
  91: 'text-term-red',
  92: 'text-term-green',
  93: 'text-term-yellow',
  94: 'text-term-blue',
  95: 'text-term-magenta',
  96: 'text-term-cyan',
  97: 'text-term-white',
};

// eslint-disable-next-line no-control-regex -- intentionally parsing ANSI escape sequences
const ESCAPE = /\u001b\[([0-9;]*)([A-Za-z])/g;

export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let className = '';
  let cursor = 0;

  const push = (text: string): void => {
    if (text.length === 0) return;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.className === className) last.text += text;
    else segments.push({ text, className });
  };

  for (const match of input.matchAll(ESCAPE)) {
    push(input.slice(cursor, match.index));
    cursor = (match.index ?? 0) + match[0].length;
    if (match[2] !== 'm') continue; // non-SGR sequences are dropped entirely
    for (const raw of match[1].split(';')) {
      const code = Number(raw === '' ? '0' : raw);
      if (code === 0 || code === 39) className = '';
      else if (SGR_CLASS[code] !== undefined) className = SGR_CLASS[code];
    }
  }
  push(input.slice(cursor));
  return segments.length > 0 ? segments : [{ text: '', className: '' }];
}
