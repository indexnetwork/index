/**
 * Resolve fixture definitions to values and resolve @fixtures.<key> refs in input.
 * All in-memory; no file I/O.
 */

import type { FixtureDef, GeneratorDef, GeneratorParams, GeneratorRegistry, ResolvedFixtures, SmartestScenario } from './smartest.types';

const FIXTURE_REF_PREFIX = '@fixtures.';

function isFixtureRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(FIXTURE_REF_PREFIX);
}

function getFixtureKey(ref: string): string {
  return ref.slice(FIXTURE_REF_PREFIX.length);
}

/**
 * Type guard for declarative generator def: object with generate: string.
 */
export function isGeneratorDef(def: unknown): def is GeneratorDef {
  return (
    typeof def === 'object' &&
    def !== null &&
    'generate' in def &&
    typeof (def as GeneratorDef).generate === 'string'
  );
}

/**
 * Build params for a generator from a GeneratorDef.
 */
function toGeneratorParams(def: GeneratorDef): GeneratorParams {
  const { generate: _g, seed, params, ...rest } = def;
  return {
    seed,
    params: params ?? {},
    ...rest,
  };
}

/**
 * Resolve a single fixture def: function → call it; generator def → call registry; else return as-is.
 */
async function resolveFixtureDef(
  def: FixtureDef,
  registry: GeneratorRegistry
): Promise<unknown> {
  if (typeof def === 'function') {
    return await (def as () => Promise<unknown>)();
  }
  if (isGeneratorDef(def)) {
    const fn = registry[def.generate];
    if (!fn) {
      throw new Error(
        `Unknown generator "${def.generate}". Register it via runScenario(..., { generators: { "${def.generate}": fn } }).`
      );
    }
    const params = toGeneratorParams(def);
    const result = fn(params);
    return await Promise.resolve(result);
  }
  return def;
}

/**
 * Resolve all fixture definitions to values (inline, async fn, or named generator).
 * @param registry - Map of generator name → function; use default or pass from runScenario options.
 */
export async function resolveFixtures(
  scenario: Pick<SmartestScenario, 'fixtures'>,
  registry: GeneratorRegistry = {}
): Promise<ResolvedFixtures> {
  const fixtures = scenario.fixtures;
  if (!fixtures || Object.keys(fixtures).length === 0) {
    return {};
  }

  const entries = await Promise.all(
    Object.entries(fixtures).map(async ([key, def]) => {
      const value = await resolveFixtureDef(def, registry);
      return [key, value] as const;
    })
  );
  return Object.fromEntries(entries);
}

/**
 * Deep-clone and replace any string value equal to @fixtures.<key> with the
 * corresponding value from resolved. Other values are cloned recursively.
 */
function resolveValue(value: unknown, resolved: ResolvedFixtures): unknown {
  if (isFixtureRef(value)) {
    const key = getFixtureKey(value);
    if (!(key in resolved)) {
      throw new Error(`Fixture ref "${value}" has no matching fixture "${key}".`);
    }
    return resolved[key];
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, resolved));
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveValue(v, resolved);
    }
    return out;
  }

  return value;
}

/**
 * Resolve all @fixtures.<key> references in the given input using the resolved fixtures map.
 * Unknown refs (key not in resolved) throw.
 */
export function resolveInputRefs(input: unknown, resolved: ResolvedFixtures): unknown {
  return resolveValue(input, resolved);
}
