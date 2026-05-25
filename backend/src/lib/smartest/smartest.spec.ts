/**
 * Tests for the smartest harness: fixture resolution, input refs, runner (no LLM).
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  runScenario,
  defineScenario,
  expectSmartest,
  defaultGeneratorRegistry,
} from './index';
import type { SmartestScenario } from './smartest.types';
import { resolveFixtures, resolveInputRefs, isGeneratorDef } from './smartest.fixtures';

describe('smartest fixtures', () => {
  it('isGeneratorDef identifies generator defs', () => {
    expect(isGeneratorDef({ generate: 'profile' })).toBe(true);
    expect(isGeneratorDef({ generate: 'text', params: { prompt: 'Hi' } })).toBe(true);
    expect(isGeneratorDef({ generate: 'x', seed: 42 })).toBe(true);
    expect(isGeneratorDef('inline')).toBe(false);
    expect(isGeneratorDef(null)).toBe(false);
    expect(isGeneratorDef(() => Promise.resolve(1))).toBe(false);
  });

  it('resolveFixtures returns empty object when no fixtures', async () => {
    const resolved = await resolveFixtures({});
    expect(resolved).toEqual({});
  });

  it('resolveFixtures resolves inline values as-is', async () => {
    const resolved = await resolveFixtures({
      fixtures: {
        profile: 'User is Alice.',
        count: 42,
      },
    });
    expect(resolved.profile).toBe('User is Alice.');
    expect(resolved.count).toBe(42);
  });

  it('resolveFixtures runs async generator functions', async () => {
    const resolved = await resolveFixtures({
      fixtures: {
        value: async () => Promise.resolve('generated'),
      },
    });
    expect(resolved.value).toBe('generated');
  });

  it('resolveFixtures runs declarative generator from registry', async () => {
    const registry = {
      double: async (params: { seed?: number }) =>
        Promise.resolve((params.seed ?? 0) * 2),
    };
    const resolved = await resolveFixtures(
      {
        fixtures: {
          value: { generate: 'double', seed: 21 },
        },
      },
      registry
    );
    expect(resolved.value).toBe(42);
  });

  it('resolveFixtures throws for unknown generator name', async () => {
    await expect(
      resolveFixtures(
        {
          fixtures: {
            x: { generate: 'nonexistent' },
          },
        },
        {}
      )
    ).rejects.toThrow(/Unknown generator/);
  });

  it('resolveInputRefs replaces @fixtures.key with value', () => {
    const resolved = { profile: 'Alice', n: 10 };
    const input = { text: '@fixtures.profile', count: '@fixtures.n' };
    const out = resolveInputRefs(input, resolved) as { text: string; count: number };
    expect(out.text).toBe('Alice');
    expect(out.count).toBe(10);
  });

  it('resolveInputRefs deep-replaces in nested objects', () => {
    const resolved = { profile: 'Bob' };
    const input = { user: { name: '@fixtures.profile' } };
    const out = resolveInputRefs(input, resolved) as { user: { name: string } };
    expect(out.user.name).toBe('Bob');
  });

  it('resolveInputRefs leaves non-ref strings unchanged', () => {
    const resolved = { x: 1 };
    const input = { a: 'hello', b: '@fixtures.x' };
    const out = resolveInputRefs(input, resolved) as { a: string; b: number };
    expect(out.a).toBe('hello');
    expect(out.b).toBe(1);
  });

  it('resolveInputRefs throws for unknown fixture ref', () => {
    const resolved: Record<string, unknown> = {};
    const input = { ref: '@fixtures.missing' };
    expect(() => resolveInputRefs(input, resolved)).toThrow(/no matching fixture/);
  });
});

describe('smartest runScenario', () => {
  it('runs scenario with inline fixtures and llmVerify false', async () => {
    const scenario = defineScenario({
      name: 'no-llm',
      description: 'Echo back the input.',
      fixtures: {
        msg: 'Hello',
      },
      sut: {
        type: 'agent',
        factory: () => ({}),
        invoke: async (_instance, resolvedInput) => {
          const input = resolvedInput as { message: string };
          return { echoed: input.message };
        },
        input: { message: '@fixtures.msg' },
      },
      verification: {
        criteria: 'Output should echo the message.',
        llmVerify: false,
      },
    });

    const result = await runScenario(scenario);
    expect(result.pass).toBe(true);
    expect((result.output as { echoed: string }).echoed).toBe('Hello');
    expect(result.verification).toBeUndefined();
  });

  it('runs scenario with async fixture generator', async () => {
    const scenario: SmartestScenario = {
      name: 'async-fixture',
      description: 'Use generated value.',
      fixtures: {
        value: async () => Promise.resolve(100),
      },
      sut: {
        type: 'agent',
        factory: () => ({}),
        invoke: async (_i, resolvedInput) => {
          const input = resolvedInput as { v: number };
          return { double: input.v * 2 };
        },
        input: { v: '@fixtures.value' },
      },
      verification: { criteria: 'N/A', llmVerify: false },
    };

    const result = await runScenario(scenario);
    expect(result.pass).toBe(true);
    expect((result.output as { double: number }).double).toBe(200);
  });

  it('expectSmartest throws with report and reasoning when result.pass is false', () => {
    const result = {
      pass: false,
      schemaError: 'Expected number, received string',
      report: {
        scenarioName: 'test',
        phases: { resolveFixtures: 1, invoke: 10 },
        totalMs: 11,
      },
      verification: { pass: false, reasoning: 'The output did not satisfy the criteria.' },
    };
    expect(() => expectSmartest(result)).toThrow();
    try {
      expectSmartest(result);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('test');
      expect(msg).toContain('11ms');
      expect(msg).toContain('Expected number');
      expect(msg).toContain('did not satisfy');
    }
  });

  it('fails schema check when output does not match schema', async () => {
    const { z } = await import('zod');
    const scenario: SmartestScenario = {
      name: 'schema-fail',
      description: 'Output must have valid field.',
      sut: {
        type: 'agent',
        factory: () => ({}),
        invoke: async () => ({ invalid: 'not a number' }),
        input: {},
      },
      verification: {
        criteria: 'N/A',
        schema: z.object({ valid: z.number() }),
        llmVerify: false,
      },
    };

    const result = await runScenario(scenario);
    expect(result.pass).toBe(false);
    expect(result.schemaError).toBeDefined();
    expect(result.verification).toBeUndefined();
  });

  it('runs scenario with declarative generator and custom registry', async () => {
    const scenario: SmartestScenario = {
      name: 'generator-fixture',
      description: 'Use named generator for fixture.',
      fixtures: {
        value: { generate: 'triple', seed: 4 },
      },
      sut: {
        type: 'agent',
        factory: () => ({}),
        invoke: async (_i, resolvedInput) => {
          const input = resolvedInput as { v: number };
          return { result: input.v + 1 };
        },
        input: { v: '@fixtures.value' },
      },
      verification: { criteria: 'N/A', llmVerify: false },
    };

    const result = await runScenario(scenario, {
      generators: {
        triple: async (params) => (params.seed ?? 0) * 3,
      },
    });
    expect(result.pass).toBe(true);
    expect((result.output as { result: number }).result).toBe(13); // 4*3 + 1
  });

  it('default registry includes only generic text generator', () => {
    expect(defaultGeneratorRegistry.text).toBeDefined();
    expect(typeof defaultGeneratorRegistry.text).toBe('function');
    expect(Object.keys(defaultGeneratorRegistry)).toEqual(['text']);
  });

  it('passes responseSchema (and other params) through to generator', async () => {
    const profileSchema = z.object({
      name: z.string(),
      role: z.string(),
      interests: z.array(z.string()),
    });
    const scenario: SmartestScenario = {
      name: 'profile-with-schema',
      description: 'Profile generator receives responseSchema.',
      fixtures: {
        profile: {
          generate: 'structuredProfile',
          responseSchema: profileSchema,
          params: { hint: 'engineer' },
        },
      },
      sut: {
        type: 'agent',
        factory: () => ({}),
        invoke: async (_i, resolvedInput) => {
          const input = resolvedInput as { profile: unknown };
          return { received: input.profile };
        },
        input: { profile: '@fixtures.profile' },
      },
      verification: { criteria: 'N/A', llmVerify: false },
    };

    const result = await runScenario(scenario, {
      generators: {
        structuredProfile: (params) => {
          const schema = params.responseSchema ?? params.params?.responseSchema;
          if (!schema || typeof (schema as { parse: (v: unknown) => unknown }).parse !== 'function') {
            return Promise.resolve({ name: 'Fallback', role: 'Unknown', interests: [] });
          }
          return Promise.resolve(
            (schema as { parse: (v: unknown) => unknown }).parse({
              name: 'Alice',
              role: 'Software Engineer',
              interests: ['Rust', 'AI'],
            })
          );
        },
      },
    });
    expect(result.pass).toBe(true);
    const received = (result.output as { received: unknown }).received as {
      name: string;
      role: string;
      interests: string[];
    };
    expect(received.name).toBe('Alice');
    expect(received.role).toBe('Software Engineer');
    expect(received.interests).toEqual(['Rust', 'AI']);
  });
});
