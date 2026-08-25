import { describe, expect, it } from 'bun:test';

import { SANDBOX_E2E_CASES, SANDBOX_MINIMAL_PERSONAS, SANDBOX_PERSONAS, SANDBOX_TWENTY_PERSONAS, type SandboxNetworkKey, type SandboxPersona } from '../sandbox-personas';

const NETWORK_KEYS: SandboxNetworkKey[] = ['stack', 'latent', 'pixel', 'launch', 'atelier', 'arena', 'syllabus', 'reps', 'tribe', 'bench'];

const FIXED_INVESTORS = [
  { email: 'mira.kovac@sandbox.test', userId: 'f1000000-0000-4000-8000-000000000001', intentId: 'f2000000-0000-4000-8000-000000000001' },
  { email: 'deniz.arslan@sandbox.test', userId: 'f1000000-0000-4000-8000-000000000002', intentId: 'f2000000-0000-4000-8000-000000000002' },
  { email: 'ruth.langley@sandbox.test', userId: 'f1000000-0000-4000-8000-000000000003', intentId: 'f2000000-0000-4000-8000-000000000003' },
];

function assertPopulationShape(personas: SandboxPersona[], { minIntents = 3 }: { minIntents?: number } = {}): void {
  const emails = personas.map((persona) => persona.email);
  expect(new Set(emails).size).toBe(emails.length);

  for (const persona of personas) {
    // RFC 2606: `.test` can never be a deliverable mailbox, so no real user
    // can collide with a seed persona.
    expect(persona.email.endsWith('.test')).toBe(true);
    expect(persona.premises.length).toBeGreaterThanOrEqual(4);
    expect(persona.premises.length).toBeLessThanOrEqual(6);
    expect(persona.intents.length).toBeGreaterThanOrEqual(minIntents);
    expect(persona.intents.length).toBeLessThanOrEqual(5);
    expect(new Set(persona.premises).size).toBe(persona.premises.length);
    expect(new Set(persona.intents).size).toBe(persona.intents.length);
    expect(persona.networkKeys.length).toBeGreaterThan(0);
    for (const key of persona.networkKeys) expect(NETWORK_KEYS).toContain(key);
    expect(persona.profile.identity.name).toBe(persona.name);
    expect(persona.profile.identity.location.length).toBeGreaterThan(0);
  }
}

describe('SANDBOX_PERSONAS', () => {
  it('is a 90–100 person population with the authored record shape', () => {
    expect(SANDBOX_PERSONAS.length).toBeGreaterThanOrEqual(90);
    expect(SANDBOX_PERSONAS.length).toBeLessThanOrEqual(100);
    assertPopulationShape(SANDBOX_PERSONAS);
  });

  it('keeps every derived persona on the sandbox-person address family', () => {
    const derived = SANDBOX_PERSONAS.filter((persona) => !persona.fixedIds);
    for (const persona of derived) {
      expect(persona.email).toMatch(/^sandbox-person-\d{2}@index-network\.test$/);
    }
  });

  it('carries the three fixed-id investors with their exact user and intent ids', () => {
    for (const investor of FIXED_INVESTORS) {
      const persona = SANDBOX_PERSONAS.find((candidate) => candidate.email === investor.email);
      expect(persona).toBeDefined();
      expect(persona!.fixedIds?.userId).toBe(investor.userId);
      expect(persona!.fixedIds?.intentIds[0]).toBe(investor.intentId);
      // The primary intent is the one prior threads reference; it stays first.
      expect(persona!.intents.length).toBeGreaterThanOrEqual(2);
    }
    const fixed = SANDBOX_PERSONAS.filter((persona) => persona.fixedIds);
    expect(fixed.map((persona) => persona.email).sort()).toEqual(FIXED_INVESTORS.map((investor) => investor.email).sort());
    const fixedUserIds = fixed.map((persona) => persona.fixedIds!.userId);
    expect(new Set(fixedUserIds).size).toBe(fixedUserIds.length);
  });
});

describe('SANDBOX_MINIMAL_PERSONAS', () => {
  it('is exactly five fully authored people with name-based fixture emails', () => {
    expect(SANDBOX_MINIMAL_PERSONAS).toHaveLength(5);
    // One shared market: the supporting people carry two focused signals each.
    assertPopulationShape(SANDBOX_MINIMAL_PERSONAS, { minIntents: 2 });
    expect(SANDBOX_MINIMAL_PERSONAS.map((persona) => persona.email).sort()).toEqual([
      'aisha-okafor@sandbox.test',
      'daniel-ruiz@sandbox.test',
      'ethan-brooks@sandbox.test',
      'maya-chen@sandbox.test',
      'sofia-martinez@sandbox.test',
    ]);
    for (const persona of SANDBOX_MINIMAL_PERSONAS) expect(persona.fixedIds).toBeUndefined();
  });

  it('does not collide with the full population', () => {
    const fullEmails = new Set(SANDBOX_PERSONAS.map((persona) => persona.email));
    for (const persona of SANDBOX_MINIMAL_PERSONAS) expect(fullEmails.has(persona.email)).toBe(false);
  });
});

describe('SANDBOX_TWENTY_PERSONAS', () => {
  it('is the five-person Launch market plus the fixed fifteen existing authored personas', () => {
    expect(SANDBOX_TWENTY_PERSONAS).toHaveLength(20);
    expect(SANDBOX_TWENTY_PERSONAS.slice(0, 5)).toEqual(SANDBOX_MINIMAL_PERSONAS);
    const fullEmails = new Set(SANDBOX_PERSONAS.map((persona) => persona.email));
    for (const persona of SANDBOX_TWENTY_PERSONAS.slice(5)) expect(fullEmails.has(persona.email)).toBe(true);
    expect(SANDBOX_TWENTY_PERSONAS.slice(5).map((persona) => persona.name)).toEqual([
      'Nora Kim', 'Maya Patel', 'Rosa Delgado', 'Selin Demir', 'Kerem Arslan',
      'Ege Yılmaz', 'Amara Okafor', 'Julian Foster', 'Pilar Santos', 'Leo Martins',
      'Ines Costa', 'Duarte Ferreira', 'Priya Nair', 'Daniel Wu', 'Harriet Osei',
    ]);
  });

  it('exports stable designated PersonalAgent E2E signals', () => {
    for (const scenario of Object.values(SANDBOX_E2E_CASES)) {
      for (const seat of [scenario.source, scenario.candidate]) {
        const persona = SANDBOX_MINIMAL_PERSONAS.find((candidate) => candidate.email === seat.email);
        expect(persona).toBeDefined();
        expect(persona!.intents[seat.intentIndex]).toBeDefined();
      }
    }
  });
});
