import { describe, expect, test } from 'bun:test';

import { ConnectLinkController, safeSearch } from '../connect-link.controller';

const controller = new ConnectLinkController();
const frontendBase = (process.env.WEB_APP_URL || 'https://index.network').replace(/\/+$/, '');

function get(url: string, code?: string): Promise<Response> {
  return controller.resolve(new Request(url), null, code === undefined ? undefined : { code }) as Promise<Response>;
}

describe('ConnectLinkController tombstone', () => {
  test('preserves the query string on the redirect', async () => {
    const response = await get(
      'https://protocol.index.network/c/aB3xY9zQ2w?link_preview=false',
      'aB3xY9zQ2w',
    );

    expect(response.status).toBe(302);
    // Dropping `?link_preview=false` would make chat clients render preview
    // cards for links whose sender suppressed them.
    expect(response.headers.get('location')).toBe(`${frontendBase}/c/aB3xY9zQ2w?link_preview=false`);
  });

  test('redirects without a query string when the request has none', async () => {
    const response = await get('https://protocol.index.network/c/aB3xY9zQ2w', 'aB3xY9zQ2w');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${frontendBase}/c/aB3xY9zQ2w`);
  });

  test('serves the expired page for malformed codes, query string or not', async () => {
    const response = await get('https://protocol.index.network/c/nope?link_preview=false', 'nope');

    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('text/html');
    expect(await response.text()).toContain('no longer available');
  });

  test('rejects a missing code', async () => {
    const response = await get('https://protocol.index.network/c/');

    expect(response.status).toBe(400);
  });
});

describe('safeSearch', () => {
  test('returns the query string, or empty for none and for unparseable urls', () => {
    expect(safeSearch('https://x.test/c/abc?a=b&c=d')).toBe('?a=b&c=d');
    expect(safeSearch('https://x.test/c/abc')).toBe('');
    expect(safeSearch('not a url')).toBe('');
  });
});
