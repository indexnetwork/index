import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

const html = readFileSync(join(process.cwd(), 'public/trace-pitch.html'), 'utf8');

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

test('describes reach as networks in scope', () => {
  expect(html).toContain('128 networks in scope');
  expect(html).not.toContain('128 indexes in scope');
});

test('starts with full question and negotiation feeds', () => {
  vi.useFakeTimers();
  const body = html.match(/<body>([\s\S]*?)<script>/)?.[1];
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(body).toBeDefined();
  expect(script).toBeDefined();

  document.body.innerHTML = body ?? '';
  window.eval(script ?? '');
  vi.advanceTimersByTime(1_100);

  expect(document.querySelector('#questions')?.children).toHaveLength(4);
  expect(document.querySelector('#negs')?.children).toHaveLength(9);

  vi.advanceTimersByTime(20_000);

  expect(document.querySelector('#questions')?.children).toHaveLength(4);
  expect(document.querySelector('#negs')?.children).toHaveLength(9);
});
