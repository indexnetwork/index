import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { App } from '../src/App';

// The shell renders the Overview route, which fetches on mount. Without a stub
// that hits the real network and prints ECONNREFUSED stack traces on every run;
// test output has to stay pristine for a real failure to be noticeable.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      // The shell gates its children on this answer, so the dashboard only mounts
      // when the operator is signed in.
      if (String(url).endsWith('/api/auth/status')) {
        return new Response(JSON.stringify({ authenticated: true, email: 'ops@index.network', name: 'Ops' }));
      }
      if (String(url).endsWith('/api/harnesses')) {
        return new Response(JSON.stringify({ harnesses: [] }));
      }
      if (String(url).endsWith('/api/artifacts')) {
        return new Response(JSON.stringify({ refs: [], issues: [] }));
      }
      if (String(url).endsWith('/api/runs')) {
        return new Response(JSON.stringify({ runs: [], issues: [] }));
      }
      if (String(url).endsWith('/api/fixture')) {
        return new Response(JSON.stringify({ allowed: false, reason: 'not configured' }));
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the terminal title bar', () => {
    render(<App />);
    expect(screen.getByText(/index eval ops/i)).toBeInTheDocument();
  });

  it('links to every route an operator needs', async () => {
    render(<App />);
    const expected: ReadonlyArray<[string, string]> = [
      ['overview', '/'],
      ['launch', '/launch'],
      ['compare', '/compare'],
      ['profiles', '/profiles'],
    ];
    // The nav mounts with the dashboard, once the stubbed status answer arrives:
    // a link to a route the operator cannot open yet is not an offer worth making.
    for (const [name, href] of expected) {
      expect(await screen.findByRole('link', { name })).toHaveAttribute('href', href);
    }
  });
});
