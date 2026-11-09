import { describe, expect, test } from 'bun:test';

import { MAX_REFUSED_IN_A_ROW, deliverMorningEmails } from './morning';

class Refused extends Error {}

interface Claim { id: string; off: boolean }

function harness(options: {
  compose?: (claim: Claim) => Promise<string | null>;
  send?: (claim: Claim) => Promise<void>;
} = {}) {
  const sent: string[] = [];
  const released: string[] = [];
  const errors: string[] = [];
  const deps = {
    compose: options.compose ?? (async (claim: Claim) => `email for ${claim.id}`),
    send: async (claim: Claim, email: string) => {
      if (options.send) await options.send(claim);
      sent.push(`${claim.id}:${email}`);
    },
    release: async (claim: Claim) => { released.push(claim.id); },
    refused: (error: unknown) => error instanceof Refused,
    onError: (title: string, claim: Claim) => { errors.push(`${title} ${claim.id}`); },
  };
  return { deps, sent, released, errors };
}

const claims = (...ids: string[]): Claim[] => ids.map((id) => ({ id, off: false }));

describe('morning email delivery', () => {
  test('a sent email keeps its claim', async () => {
    const { deps, sent, released } = harness();
    await deliverMorningEmails(claims('a', 'b'), deps);
    expect(sent).toEqual(['a:email for a', 'b:email for b']);
    expect(released).toEqual([]);
  });

  test('a refused email is handed back for a later pass', async () => {
    const { deps, sent, released } = harness({
      send: async (claim) => { if (claim.id === 'b') throw new Refused('API key is invalid'); },
    });
    await deliverMorningEmails(claims('a', 'b', 'c'), deps);
    expect(sent).toEqual(['a:email for a', 'c:email for c']);
    expect(released).toEqual(['b']);
  });

  test('a failure that may have delivered keeps the claim, so it is never sent twice', async () => {
    const { deps, released, errors } = harness({
      send: async () => { throw new Error('Unable to fetch data. The request could not be resolved.'); },
    });
    await deliverMorningEmails(claims('a', 'b', 'c', 'd'), deps);
    expect(released).toEqual([]);
    expect(errors).toHaveLength(4);
  });

  test('an email that could not be built is handed back', async () => {
    const { deps, sent, released } = harness({
      compose: async (claim) => {
        if (claim.id === 'a') throw new Error('database went away');
        return `email for ${claim.id}`;
      },
    });
    await deliverMorningEmails(claims('a', 'b'), deps);
    expect(released).toEqual(['a']);
    expect(sent).toEqual(['b:email for b']);
  });

  test('an owner owed nothing keeps the claim and gets no email', async () => {
    const { deps, sent, released } = harness({ compose: async () => null });
    await deliverMorningEmails(claims('a'), deps);
    expect(sent).toEqual([]);
    expect(released).toEqual([]);
  });

  test('an owner who turned the brief off is neither emailed nor handed back', async () => {
    const { deps, sent, released } = harness({ send: async () => { throw new Refused('rate limited'); } });
    const result = await deliverMorningEmails([{ id: 'off', off: true }, ...claims('a')], deps);
    expect(sent).toEqual([]);
    expect(released).toEqual(['a']);
    expect(result.stopped).toBe(false);
  });

  test('repeated refusals stop the pass and hand back every morning not yet tried', async () => {
    let attempts = 0;
    const { deps, released } = harness({ send: async () => { attempts += 1; throw new Refused('API key is invalid'); } });
    const all = [...claims('a', 'b', 'c', 'd', 'e'), { id: 'off', off: true }];
    const result = await deliverMorningEmails(all, deps);
    expect(result.stopped).toBe(true);
    expect(attempts).toBe(MAX_REFUSED_IN_A_ROW);
    expect(released).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('a success between refusals resets the count', async () => {
    const { deps, sent } = harness({
      send: async (claim) => { if (claim.id !== 'c') throw new Refused('rate limited'); },
    });
    const result = await deliverMorningEmails(claims('a', 'b', 'c', 'd', 'e'), deps);
    expect(result.stopped).toBe(false);
    expect(sent).toEqual(['c:email for c']);
  });

  test('a release that fails is reported and the pass goes on', async () => {
    const { deps, sent, errors } = harness({
      send: async (claim) => { if (claim.id === 'a') throw new Refused('rate limited'); },
    });
    deps.release = async () => { throw new Error('db down'); };
    await deliverMorningEmails(claims('a', 'b'), deps);
    expect(errors).toContain('Morning email release failed a');
    expect(sent).toEqual(['b:email for b']);
  });
});
