import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';

import { Fixture } from '../src/routes/Fixture';
import { scrubCredentials } from '../src/lib/scrub';

const ALLOWED = {
  allowed: true,
  target: {
    databaseName: 'neondb',
    host: 'ep-example.neon.tech',
    redactedUrl: 'postgresql://ep-example.neon.tech/neondb',
  },
  maxPersonas: 50,
  appliesMigrationsOnReset: true,
  seedApiKeysPath: 'services/api/.seed-api-keys.json',
  personaCount: 50,
  personaEmails: ['seed-tester-1@example.com'],
  tables: { users: 53, intents: 120, opportunities: 340 },
  countsError: null,
};

const ALLOWED_WITH_CREDENTIALS = {
  allowed: true,
  target: {
    databaseName: 'neondb',
    host: 'ep-example.neon.tech',
    redactedUrl: 'postgresql://user:secretpass@ep-example.neon.tech/neondb',
  },
  maxPersonas: 50,
  appliesMigrationsOnReset: true,
  seedApiKeysPath: 'services/api/.seed-api-keys.json',
  personaCount: 50,
  personaEmails: ['seed-tester-1@example.com'],
  tables: { users: 53, intents: 120, opportunities: 340 },
  countsError: 'Database error: connection failed to postgres://admin:topsecret@host/db',
};

const REFUSED = {
  allowed: false,
  reason:
    'Refusing to operate on database "protocol_prod": *_prod / *_production names hold real user data.',
};

let reset: unknown = null;

function stub(fixture: unknown) {
  reset = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/fixture/reset')) {
        reset = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: 'run-1',
            spec: { kind: 'fixture-reset', personas: 50, migrate: true, databaseName: 'neondb' },
            argv: [],
            status: 'running',
            createdAt: new Date().toISOString(),
            startedAt: null,
            endedAt: null,
            exitCode: null,
            pid: null,
            artifactPath: null,
            workload: 3,
            env: {},
            profileFingerprint: '',
            experimental: false,
          }),
          { status: 202 },
        );
      }
      return new Response(JSON.stringify(fixture));
    }),
  );
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => cleanup());

describe('Fixture', () => {
  it('renders read-only with the refusal reason when the target is refused', async () => {
    stub(REFUSED);
    render(
      <BrowserRouter>
        <Fixture />
      </BrowserRouter>,
    );

    expect(await screen.findByText(/protocol_prod/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset/i })).toBeNull();
  });

  it('never displays credentials', async () => {
    stub(ALLOWED_WITH_CREDENTIALS);
    const { container } = render(
      <BrowserRouter>
        <Fixture />
      </BrowserRouter>,
    );
    await screen.findByRole('heading', { name: /Target Database/ });
    // The fixture deliberately contains credentials in both redactedUrl and countsError
    expect(container.textContent).not.toContain('secretpass');
    expect(container.textContent).not.toContain('topsecret');
  });

  it('requires the exact database name before resetting', async () => {
    stub(ALLOWED);
    render(
      <BrowserRouter>
        <Fixture />
      </BrowserRouter>,
    );
    await screen.findByRole('heading', { name: /Target Database/ });

    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    await userEvent.type(screen.getByLabelText(/type the database name/i), 'wrong');
    expect(screen.getByRole('button', { name: /confirm reset/i })).toBeDisabled();
    expect(reset).toBeNull();
  });

  it('sends the confirmation name and persona count once armed', async () => {
    stub(ALLOWED);
    render(
      <BrowserRouter>
        <Fixture />
      </BrowserRouter>,
    );
    await screen.findByRole('heading', { name: /Target Database/ });

    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    await userEvent.type(screen.getByLabelText(/type the database name/i), 'neondb');
    await userEvent.click(screen.getByRole('button', { name: /confirm reset/i }));

    expect(reset).toEqual({ confirmDatabaseName: 'neondb', personas: 50 });
  });

  it('states that seeding only enqueues indexing work', async () => {
    stub(ALLOWED);
    const { container } = render(
      <BrowserRouter>
        <Fixture />
      </BrowserRouter>,
    );
    await screen.findByRole('heading', { name: /Target Database/ });
    expect(container.textContent).toMatch(/enqueue.*indexing/i);
  });

  it('renders reset errors inline without destroying the status display', async () => {
    stub(ALLOWED);
    // Modify stub to return 409 on reset
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/api/fixture/reset')) {
          return new Response(
            JSON.stringify({ error: 'Refusing to reset: run queue is not empty' }),
            { status: 409 },
          );
        }
        return new Response(JSON.stringify(ALLOWED));
      }),
    );

    render(
      <BrowserRouter>
        <Fixture />
      </BrowserRouter>,
    );
    await screen.findByRole('heading', { name: /Target Database/ });

    // Arm the reset
    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    await userEvent.type(screen.getByLabelText(/type the database name/i), 'neondb');
    await userEvent.click(screen.getByRole('button', { name: /confirm reset/i }));

    // Error should appear inline, status should still be visible
    expect(await screen.findByText(/run queue is not empty/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Target Database/ })).toBeInTheDocument();
    expect(screen.getAllByText(/neondb/i).length).toBeGreaterThan(0);
  });

  it('displays the seed API keys path from the server response', async () => {
    stub(ALLOWED);
    render(
      <BrowserRouter>
        <Fixture />
      </BrowserRouter>,
    );
    await screen.findByRole('heading', { name: /Target Database/ });
    expect(await screen.findByText('services/api/.seed-api-keys.json')).toBeInTheDocument();
    expect(screen.getByText(/db:seed.*writes/i)).toBeInTheDocument();
  });
});


describe('scrubCredentials parity with the server', () => {
  /**
   * Fixture.tsx keeps its own copy of the server's scrubber as defence in depth:
   * it must strip credentials even if the server's scrubbing is bypassed. Two
   * copies of a security regex silently diverge, so pin them together — the same
   * technique fixture.spec.ts uses upstream for REAL_DATA_DATABASE_NAMES.
   *
   * The server module is read as source rather than imported: ops.fixture.ts
   * imports bun:SQL, which cannot load in a browser test environment. Comparing
   * the regex literals is what actually matters here.
   */
  it('uses replacement rules identical to the ops core implementation', async () => {
    const source = await readFile(
      resolve(__dirname, '../../../packages/protocol/eval/ops/ops.fixture.ts'),
      'utf8',
    );

    const serverBody = source.match(
      /export function scrubCredentials\(message: string\): string \{([\s\S]*?)\n\}/,
    );
    expect(serverBody, 'scrubCredentials not found in ops.fixture.ts').not.toBeNull();

    // Compare the .replace(...) chain verbatim, normalising only quote style and
    // whitespace. Anything else differing is real divergence.
    const normalise = (body: string) =>
      body
        .replace(/"/g, "'")
        .replace(/\s+/g, '')
        .replace(/message|text/g, 'INPUT');

    expect(normalise(scrubCredentials.toString())).toContain(
      normalise(serverBody![1]).replace(/^return/, '').replace(/;$/, ''),
    );
  });

  it('actually removes the credential (the pin is not vacuous)', () => {
    expect(scrubCredentials('postgresql://user:secret@host/db')).not.toContain('secret');
    expect(scrubCredentials('password=topsecret')).not.toContain('topsecret');
    expect(scrubCredentials('postgresql://user:secret@host/db')).toContain('host/db');
  });
});
