/**
 * Smartest: spec-driven, LLM-verified testing for agents and graphs.
 * Data is generated from the spec at test time and never persisted.
 */

import { runScenario } from './smartest.runner';
import { expectSmartest } from './smartest.expect';
import type { FixtureDef, GeneratorDef, GeneratorFn, GeneratorParams, GeneratorRegistry, ResolvedFixtures, RunScenarioResult, RunScenarioReport, RunScenarioOptions, SmartestScenario, SmartestSut, SmartestVerification, VerificationResult } from './smartest.types';

export { runScenario, expectSmartest };
export { SMARTEST_GENERATOR_MODEL, SMARTEST_VERIFIER_MODEL } from './smartest.config';
export { defaultGeneratorRegistry, mergeGeneratorRegistry, textGenerator } from './smartest.generators';
export type { FixtureDef, GeneratorDef, GeneratorFn, GeneratorParams, GeneratorRegistry, ResolvedFixtures, RunScenarioResult, RunScenarioReport, RunScenarioOptions, SmartestScenario, SmartestSut, SmartestVerification, VerificationResult };

/**
 * Helper to define a scenario with type checking (no runtime effect).
 */
export function defineScenario(scenario: SmartestScenario): SmartestScenario {
  return scenario;
}
