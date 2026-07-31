import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';

import { Fixture } from '../src/routes/Fixture';

const ALLOWED = {
  allowed: true,
  target: {
    databaseName: 'neondb',
    host: 'ep-example.neon.tech',
    redactedUrl: 'postgresql://ep-example.neon.tech/neondb',
  },
  maxPersonas: 50,
  appliesMigrationsOnReset: true,
  personaCount: 50,
  personaEmails: ['seed-tester-1@example.com'],
  tables: { users: 53, intents: 120, opportunities: 340 },
  countsError: null,
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
    stub(ALLOWED);
    const { container } = render(
      <BrowserRouter>
        <Fixture />
      </BrowserRouter>,
    );
    await screen.findByRole('heading', { name: /Target Database/ });
    expect(container.textContent).not.toMatch(/:\/\/[^/]*:[^@]*@/);
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
});
